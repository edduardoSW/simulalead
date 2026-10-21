begin;

alter table public.simulation_generations
  add column if not exists simulation_ended boolean not null default false;

drop function if exists public.complete_simulation_generation(text,text,text,text);

create function public.complete_simulation_generation(
  requested_conversation_id text,
  requested_batch_id text,
  requested_request_id text,
  generated_text text,
  requested_simulation_ended boolean
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
  next_payload jsonb;
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
      'endsSimulation', case when requested_simulation_ended then true else null end,
      'createdAt', now_text
    )));

    next_payload := jsonb_set(
      jsonb_set(
        jsonb_set(conversation_payload, '{messages}', next_messages, true),
        '{updatedAt}', to_jsonb(now_text), true
      ),
      '{unread}', to_jsonb(coalesce((conversation_payload->>'unread')::integer, 0) + 1), true
    );
    if requested_simulation_ended then
      next_payload := jsonb_set(next_payload, '{status}', '"completed"'::jsonb, true);
    end if;

    update public.user_simulations s
    set payload = next_payload, updated_at = now()
    where s.seller_id = auth.uid()
      and s.conversation_id = requested_conversation_id;
  end if;

  update public.simulation_generations g
  set status = 'completed', response_text = btrim(generated_text), error_message = null,
      simulation_ended = coalesce(requested_simulation_ended, false), updated_at = now()
  where g.seller_id = auth.uid()
    and g.conversation_id = requested_conversation_id
    and g.batch_id = requested_batch_id
    and g.request_id = requested_request_id;
end;
$$;

create or replace function public.reconcile_simulation_generation(
  requested_conversation_id text,
  requested_batch_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_org uuid;
  conversation_payload jsonb;
  conversation_messages jsonb;
  next_messages jsonb;
  response_message jsonb;
  response_request_id text;
  response_ended boolean;
begin
  select p.organization_id into caller_org
  from public.profiles p
  where p.id = auth.uid() and p.is_active;
  if caller_org is null then raise exception 'authentication required'; end if;

  select s.payload into conversation_payload
  from public.user_simulations s
  where s.seller_id = auth.uid()
    and s.organization_id = caller_org
    and s.conversation_id = requested_conversation_id
  for update;
  if conversation_payload is null then raise exception 'simulation not found'; end if;

  conversation_messages := case
    when jsonb_typeof(conversation_payload->'messages') = 'array' then conversation_payload->'messages'
    else '[]'::jsonb
  end;

  select message into response_message
  from jsonb_array_elements(conversation_messages) with ordinality as items(message, ordinal)
  where message->>'sender' = 'contact' and message->>'batchId' = requested_batch_id
  order by ordinal desc
  limit 1;
  if response_message is null then return false; end if;

  response_request_id := coalesce(nullif(response_message->>'requestId', ''), gen_random_uuid()::text);
  response_ended := coalesce((response_message->>'endsSimulation')::boolean, false);

  select coalesce(jsonb_agg(
    case
      when message->>'sender' = 'seller' and message->>'batchId' = requested_batch_id
        then message || jsonb_build_object('status', 'answered', 'requestId', response_request_id)
      else message
    end order by ordinal
  ), '[]'::jsonb)
  into next_messages
  from jsonb_array_elements(conversation_messages) with ordinality as items(message, ordinal);

  conversation_payload := jsonb_set(conversation_payload, '{messages}', next_messages, true);
  if response_ended then
    conversation_payload := jsonb_set(conversation_payload, '{status}', '"completed"'::jsonb, true);
  end if;
  update public.user_simulations s
  set payload = conversation_payload, updated_at = greatest(s.updated_at, now())
  where s.seller_id = auth.uid()
    and s.conversation_id = requested_conversation_id;

  insert into public.simulation_generations(
    organization_id, seller_id, conversation_id, batch_id, request_id,
    status, response_text, error_message, simulation_ended, updated_at
  ) values (
    caller_org, auth.uid(), requested_conversation_id, requested_batch_id, response_request_id,
    'completed', btrim(response_message->>'text'), null, response_ended, now()
  )
  on conflict (seller_id, conversation_id, batch_id) do update
  set request_id = excluded.request_id,
      status = 'completed',
      response_text = excluded.response_text,
      error_message = null,
      simulation_ended = excluded.simulation_ended,
      updated_at = now();

  return true;
end;
$$;

revoke all on function public.complete_simulation_generation(text,text,text,text,boolean) from public, anon;
revoke all on function public.reconcile_simulation_generation(text,text) from public, anon;
grant execute on function public.complete_simulation_generation(text,text,text,text,boolean) to authenticated;
grant execute on function public.reconcile_simulation_generation(text,text) to authenticated;

notify pgrst, 'reload schema';

commit;
