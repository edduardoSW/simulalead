begin;

create type public.simulation_generation_status as enum ('processing', 'completed', 'failed');

create table public.user_simulations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (seller_id, conversation_id)
);

create table public.simulation_generations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  seller_id uuid not null,
  conversation_id text not null,
  batch_id text not null,
  request_id text not null,
  status public.simulation_generation_status not null default 'processing',
  response_text text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (seller_id, conversation_id, batch_id),
  foreign key (seller_id, conversation_id)
    references public.user_simulations(seller_id, conversation_id) on delete cascade,
  check (
    (status = 'completed' and response_text is not null and length(btrim(response_text)) > 0)
    or (status <> 'completed' and response_text is null)
  )
);

create index user_simulations_owner_updated_idx
  on public.user_simulations(seller_id, updated_at desc);

create index simulation_generations_processing_idx
  on public.simulation_generations(seller_id, updated_at)
  where status = 'processing';

alter table public.user_simulations enable row level security;
alter table public.user_simulations force row level security;
alter table public.simulation_generations enable row level security;
alter table public.simulation_generations force row level security;

create policy user_simulations_owner_read on public.user_simulations
for select to authenticated
using (seller_id = auth.uid() and public.is_org_member(organization_id));

create policy user_simulations_owner_write on public.user_simulations
for all to authenticated
using (seller_id = auth.uid() and public.is_org_member(organization_id))
with check (seller_id = auth.uid() and public.is_org_member(organization_id));

create policy simulation_generations_owner_read on public.simulation_generations
for select to authenticated
using (seller_id = auth.uid() and public.is_org_member(organization_id));

-- Generation writes are performed only through the security-definer functions below.

-- Legacy workspace JSON is deliberately not rewritten here. New simulations are
-- stored with an explicit owner; the application reads legacy data through a
-- non-destructive compatibility path until it is saved in the owner-scoped table.

create or replace function public.claim_simulation_generation(
  requested_conversation_id text,
  requested_batch_id text,
  requested_request_id text
)
returns table (
  claimed boolean,
  generation_status public.simulation_generation_status,
  generation_request_id text,
  response_text text,
  error_message text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_org uuid;
  existing public.simulation_generations%rowtype;
begin
  select p.organization_id into caller_org
  from public.profiles p
  where p.id = auth.uid() and p.is_active;

  if caller_org is null then raise exception 'authentication required'; end if;
  if not exists (
    select 1 from public.user_simulations s
    where s.seller_id = auth.uid()
      and s.organization_id = caller_org
      and s.conversation_id = requested_conversation_id
  ) then raise exception 'simulation not found'; end if;

  select * into existing
  from public.simulation_generations g
  where g.seller_id = auth.uid()
    and g.conversation_id = requested_conversation_id
    and g.batch_id = requested_batch_id
  for update;

  if found then
    if existing.status = 'completed' then
      return query select false, existing.status, existing.request_id, existing.response_text, existing.error_message, existing.updated_at;
      return;
    end if;

    if existing.status = 'processing' and existing.updated_at > now() - interval '2 minutes' then
      return query select false, existing.status, existing.request_id, existing.response_text, existing.error_message, existing.updated_at;
      return;
    end if;

    update public.simulation_generations g
    set request_id = requested_request_id,
        status = 'processing',
        response_text = null,
        error_message = null,
        updated_at = now()
    where g.seller_id = auth.uid()
      and g.conversation_id = requested_conversation_id
      and g.batch_id = requested_batch_id
    returning g.* into existing;

    return query select true, existing.status, existing.request_id, existing.response_text, existing.error_message, existing.updated_at;
    return;
  end if;

  insert into public.simulation_generations(
    organization_id, seller_id, conversation_id, batch_id, request_id
  ) values (
    caller_org, auth.uid(), requested_conversation_id, requested_batch_id, requested_request_id
  ) returning * into existing;

  return query select true, existing.status, existing.request_id, existing.response_text, existing.error_message, existing.updated_at;
end;
$$;

create or replace function public.complete_simulation_generation(
  requested_conversation_id text,
  requested_batch_id text,
  requested_request_id text,
  generated_text text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_payload jsonb;
  conversation_messages jsonb;
  next_messages jsonb;
  contact_id text;
  now_text text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if length(btrim(coalesce(generated_text, ''))) = 0 then raise exception 'empty response'; end if;

  perform 1 from public.simulation_generations g
  where g.seller_id = auth.uid()
    and g.conversation_id = requested_conversation_id
    and g.batch_id = requested_batch_id
    and g.request_id = requested_request_id
    and g.status = 'processing'
  for update;
  if not found then raise exception 'generation is no longer active'; end if;

  select s.payload into conversation_payload
  from public.user_simulations s
  where s.seller_id = auth.uid()
    and s.conversation_id = requested_conversation_id
  for update;
  if conversation_payload is null then raise exception 'simulation not found'; end if;

  conversation_messages := case
    when jsonb_typeof(conversation_payload->'messages') = 'array' then conversation_payload->'messages'
    else '[]'::jsonb
  end;

  if not exists (
    select 1 from jsonb_array_elements(conversation_messages) message
    where message->>'sender' = 'contact' and message->>'batchId' = requested_batch_id
  ) then
    select coalesce(jsonb_agg(
      case
        when message->>'sender' = 'seller' and message->>'batchId' = requested_batch_id
          then message || jsonb_build_object('status', 'answered', 'requestId', requested_request_id)
        else message
      end order by ordinal
    ), '[]'::jsonb)
    into next_messages
    from jsonb_array_elements(conversation_messages) with ordinality as items(message, ordinal);

    contact_id := nullif(conversation_payload->>'currentContactId', '');
    next_messages := next_messages || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'sender', 'contact',
      'contactId', contact_id,
      'text', btrim(generated_text),
      'status', 'answered',
      'batchId', requested_batch_id,
      'requestId', requested_request_id,
      'createdAt', now_text
    )));

    update public.user_simulations s
    set payload = jsonb_set(
          jsonb_set(
            jsonb_set(conversation_payload, '{messages}', next_messages, true),
            '{updatedAt}', to_jsonb(now_text), true
          ),
          '{unread}', to_jsonb(coalesce((conversation_payload->>'unread')::integer, 0) + 1), true
        ),
        updated_at = now()
    where s.seller_id = auth.uid()
      and s.conversation_id = requested_conversation_id;
  end if;

  update public.simulation_generations g
  set status = 'completed', response_text = btrim(generated_text), error_message = null, updated_at = now()
  where g.seller_id = auth.uid()
    and g.conversation_id = requested_conversation_id
    and g.batch_id = requested_batch_id
    and g.request_id = requested_request_id;
end;
$$;

create or replace function public.fail_simulation_generation(
  requested_conversation_id text,
  requested_batch_id text,
  requested_request_id text,
  failure_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_payload jsonb;
  conversation_messages jsonb;
  next_messages jsonb;
begin
  update public.simulation_generations g
  set status = 'failed', response_text = null,
      error_message = left(coalesce(nullif(btrim(failure_message), ''), 'Falha tecnica ao gerar a resposta.'), 1000),
      updated_at = now()
  where g.seller_id = auth.uid()
    and g.conversation_id = requested_conversation_id
    and g.batch_id = requested_batch_id
    and g.request_id = requested_request_id
    and g.status = 'processing';
  if not found then return; end if;

  select s.payload into conversation_payload
  from public.user_simulations s
  where s.seller_id = auth.uid()
    and s.conversation_id = requested_conversation_id
  for update;
  if conversation_payload is null then return; end if;

  conversation_messages := case
    when jsonb_typeof(conversation_payload->'messages') = 'array' then conversation_payload->'messages'
    else '[]'::jsonb
  end;
  select coalesce(jsonb_agg(
    case
      when message->>'sender' = 'seller' and message->>'batchId' = requested_batch_id
        then message || jsonb_build_object('status', 'failed', 'requestId', requested_request_id)
      else message
    end order by ordinal
  ), '[]'::jsonb)
  into next_messages
  from jsonb_array_elements(conversation_messages) with ordinality as items(message, ordinal);

  update public.user_simulations s
  set payload = jsonb_set(conversation_payload, '{messages}', next_messages, true), updated_at = now()
  where s.seller_id = auth.uid()
    and s.conversation_id = requested_conversation_id;
end;
$$;

revoke all on function public.claim_simulation_generation(text,text,text) from public, anon;
revoke all on function public.complete_simulation_generation(text,text,text,text) from public, anon;
revoke all on function public.fail_simulation_generation(text,text,text,text) from public, anon;
grant execute on function public.claim_simulation_generation(text,text,text) to authenticated;
grant execute on function public.complete_simulation_generation(text,text,text,text) to authenticated;
grant execute on function public.fail_simulation_generation(text,text,text,text) to authenticated;

commit;
