begin;

create table public.independent_training_sessions (
  conversation_id text not null check (length(conversation_id) between 1 and 160 and conversation_id ~ '^[A-Za-z0-9:_-]+$'),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  scenario_id text not null check (length(scenario_id) between 1 and 160),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  current_request_id text,
  current_request_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (seller_id, conversation_id)
);

create unique index independent_training_one_active_per_seller_idx
  on public.independent_training_sessions(seller_id)
  where status = 'active';
create index independent_training_recent_idx
  on public.independent_training_sessions(seller_id, updated_at desc);

alter table public.independent_training_sessions enable row level security;
alter table public.independent_training_sessions force row level security;

create policy independent_training_sessions_owner_read
on public.independent_training_sessions for select to authenticated
using (
  seller_id = auth.uid()
  and public.is_org_member(organization_id)
);

revoke all on public.independent_training_sessions from public, anon, authenticated;
grant select on public.independent_training_sessions to authenticated;

create function public.start_independent_training_session(
  requested_conversation_id text,
  requested_scenario_id text,
  requested_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_caller_org uuid;
  v_payload jsonb;
begin
  select p.organization_id into v_caller_org
  from public.profiles as p
  where p.id = auth.uid() and p.is_active;
  if v_caller_org is null then raise exception 'authentication required'; end if;
  if requested_conversation_id is null or length(requested_conversation_id) not between 1 and 160
    or requested_conversation_id !~ '^[A-Za-z0-9:_-]+$'
  then raise exception 'invalid conversation id'; end if;
  if requested_scenario_id is null or length(requested_scenario_id) not between 1 and 160
  then raise exception 'invalid scenario id'; end if;
  if jsonb_typeof(requested_payload) <> 'object' then raise exception 'invalid training payload'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':independent-training', 0));

  update public.independent_training_sessions as session
  set status = 'abandoned',
      current_request_id = null,
      current_request_started_at = null,
      updated_at = now()
  where session.seller_id = auth.uid() and session.status = 'active';

  v_payload := requested_payload
    || jsonb_build_object('messages', '[]'::jsonb, 'interfaceStage', 'practice');

  insert into public.independent_training_sessions as session(
    conversation_id, organization_id, seller_id, scenario_id, payload, status, updated_at
  ) values (
    requested_conversation_id, v_caller_org, auth.uid(), requested_scenario_id, v_payload, 'active', now()
  );

  return v_payload;
end;
$$;

create function public.claim_independent_training_turn(
  requested_conversation_id text,
  requested_request_id text,
  requested_seller_text text
)
returns table (
  claimed boolean,
  response_text text,
  session_payload jsonb,
  session_status text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_payload jsonb;
  v_status text;
  v_current_request_id text;
  v_current_request_started_at timestamptz;
  v_messages jsonb;
  v_existing_response text;
begin
  if requested_request_id is null or length(requested_request_id) not between 1 and 160
    or requested_request_id !~ '^[A-Za-z0-9:_-]+$'
  then raise exception 'invalid request id'; end if;
  if requested_seller_text is null or length(btrim(requested_seller_text)) not between 1 and 4000
  then raise exception 'invalid seller message'; end if;

  select session.payload, session.status, session.current_request_id, session.current_request_started_at
  into v_payload, v_status, v_current_request_id, v_current_request_started_at
  from public.independent_training_sessions as session
  where session.seller_id = auth.uid()
    and session.conversation_id = requested_conversation_id
  for update;
  if not found then raise exception 'training session not found'; end if;

  v_messages := case when jsonb_typeof(v_payload->'messages') = 'array'
    then v_payload->'messages' else '[]'::jsonb end;

  select message.value->>'text' into v_existing_response
  from jsonb_array_elements(v_messages) with ordinality as message(value, ordinal)
  where message.value->>'from' = 'lead'
    and message.value->>'requestId' = requested_request_id
  order by message.ordinal desc
  limit 1;
  if v_existing_response is not null then
    return query select false, v_existing_response, v_payload, v_status;
    return;
  end if;
  if v_status <> 'active' then
    return query select false, null::text, v_payload, v_status;
    return;
  end if;
  if v_current_request_id is not null
    and v_current_request_started_at > now() - interval '2 minutes'
  then
    return query select false, null::text, v_payload, v_status;
    return;
  end if;

  if not exists (
    select 1 from jsonb_array_elements(v_messages) as message(value)
    where message.value->>'from' = 'seller'
      and message.value->>'requestId' = requested_request_id
  ) then
    v_messages := v_messages || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'from', 'seller',
      'text', btrim(requested_seller_text),
      'requestId', requested_request_id,
      'createdAt', now()
    ));
    v_payload := jsonb_set(v_payload, '{messages}', v_messages, true);
  end if;

  update public.independent_training_sessions as session
  set payload = v_payload,
      current_request_id = requested_request_id,
      current_request_started_at = now(),
      updated_at = now()
  where session.seller_id = auth.uid()
    and session.conversation_id = requested_conversation_id;

  return query select true, null::text, v_payload, v_status;
end;
$$;

create function public.complete_independent_training_turn(
  requested_conversation_id text,
  requested_request_id text,
  generated_text text,
  requested_training_ended boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_payload jsonb;
  v_messages jsonb;
begin
  if generated_text is null or length(btrim(generated_text)) not between 1 and 4000
  then raise exception 'invalid generated message'; end if;

  select session.payload into v_payload
  from public.independent_training_sessions as session
  where session.seller_id = auth.uid()
    and session.conversation_id = requested_conversation_id
  for update;
  if not found then raise exception 'training session not found'; end if;

  v_messages := case when jsonb_typeof(v_payload->'messages') = 'array'
    then v_payload->'messages' else '[]'::jsonb end;
  if not exists (
    select 1 from jsonb_array_elements(v_messages) as message(value)
    where message.value->>'from' = 'lead'
      and message.value->>'requestId' = requested_request_id
  ) then
    v_messages := v_messages || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'from', 'lead',
      'text', btrim(generated_text),
      'requestId', requested_request_id,
      'createdAt', now()
    ));
  end if;

  v_payload := jsonb_set(v_payload, '{messages}', v_messages, true);
  if coalesce(requested_training_ended, false) then
    v_payload := jsonb_set(v_payload, '{interfaceStage}', '"result"'::jsonb, true);
  end if;

  update public.independent_training_sessions as session
  set payload = v_payload,
      status = case when coalesce(requested_training_ended, false) then 'completed' else 'active' end,
      current_request_id = null,
      current_request_started_at = null,
      updated_at = now()
  where session.seller_id = auth.uid()
    and session.conversation_id = requested_conversation_id
    and session.current_request_id = requested_request_id;
  if not found then raise exception 'training turn is no longer current'; end if;

  return v_payload;
end;
$$;

create function public.fail_independent_training_turn(
  requested_conversation_id text,
  requested_request_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.independent_training_sessions as session
  set current_request_id = null,
      current_request_started_at = null,
      updated_at = now()
  where session.seller_id = auth.uid()
    and session.conversation_id = requested_conversation_id
    and session.current_request_id = requested_request_id;
end;
$$;

create function public.finish_independent_training_session(requested_conversation_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_payload jsonb;
begin
  update public.independent_training_sessions as session
  set payload = jsonb_set(session.payload, '{interfaceStage}', '"result"'::jsonb, true),
      status = 'completed',
      current_request_id = null,
      current_request_started_at = null,
      updated_at = now()
  where session.seller_id = auth.uid()
    and session.conversation_id = requested_conversation_id
  returning session.payload into v_payload;
  if v_payload is null then raise exception 'training session not found'; end if;
  return v_payload;
end;
$$;

revoke all on function public.start_independent_training_session(text,text,jsonb) from public, anon;
revoke all on function public.claim_independent_training_turn(text,text,text) from public, anon;
revoke all on function public.complete_independent_training_turn(text,text,text,boolean) from public, anon;
revoke all on function public.fail_independent_training_turn(text,text) from public, anon;
revoke all on function public.finish_independent_training_session(text) from public, anon;
grant execute on function public.start_independent_training_session(text,text,jsonb) to authenticated;
grant execute on function public.claim_independent_training_turn(text,text,text) to authenticated;
grant execute on function public.complete_independent_training_turn(text,text,text,boolean) to authenticated;
grant execute on function public.fail_independent_training_turn(text,text) to authenticated;
grant execute on function public.finish_independent_training_session(text) to authenticated;

notify pgrst, 'reload schema';

commit;
