begin;

-- Keep the public RPC argument names stable for PostgREST callers. Local
-- variables use a v_ prefix, and named constraints avoid PL/pgSQL trying to
-- resolve conflict-target identifiers as variables or output fields.
create or replace function public.save_workspace_and_simulations(
  requested_workspace_payload jsonb,
  requested_conversations jsonb,
  requested_conversation_versions jsonb,
  expected_workspace_version bigint
)
returns table (workspace_version bigint, workspace_updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict error
declare
  v_caller_org uuid;
  v_current_workspace_version bigint;
  v_current_workspace_payload jsonb;
  v_current_conversation_version bigint;
  v_expected_conversation_version bigint;
  v_next_workspace_version bigint;
  v_saved_at timestamptz := clock_timestamp();
  v_conversation jsonb;
  v_conversation_id text;
  v_conversation_ids text[] := array[]::text[];
begin
  select p.organization_id into v_caller_org
  from public.profiles as p
  where p.id = auth.uid() and p.is_active;

  if v_caller_org is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(requested_workspace_payload) <> 'object' then raise exception 'workspace payload must be an object'; end if;
  if jsonb_typeof(requested_conversations) <> 'array' then raise exception 'conversations payload must be an array'; end if;
  if jsonb_typeof(requested_conversation_versions) <> 'object' then raise exception 'conversation versions must be an object'; end if;
  if expected_workspace_version is null or expected_workspace_version < 0 then raise exception 'invalid workspace version'; end if;

  select w.version, w.payload into v_current_workspace_version, v_current_workspace_payload
  from public.workspace_states as w
  where w.organization_id = v_caller_org
  for update;

  if found then
    if v_current_workspace_payload is distinct from requested_workspace_payload
      and v_current_workspace_version <> expected_workspace_version
    then
      raise exception using errcode = '40001', message = 'workspace changed by another user; reload before saving';
    end if;
    if v_current_workspace_payload is distinct from requested_workspace_payload then
      v_next_workspace_version := v_current_workspace_version + 1;
      update public.workspace_states as w
      set payload = requested_workspace_payload,
          updated_by = auth.uid(),
          updated_at = v_saved_at,
          version = v_next_workspace_version
      where w.organization_id = v_caller_org;
    else
      v_next_workspace_version := v_current_workspace_version;
    end if;
  else
    if expected_workspace_version <> 0 then
      raise exception using errcode = '40001', message = 'workspace state no longer matches the loaded version';
    end if;
    v_next_workspace_version := 1;
    insert into public.workspace_states(organization_id, payload, updated_by, updated_at, version)
    values(v_caller_org, requested_workspace_payload, auth.uid(), v_saved_at, v_next_workspace_version);
  end if;

  for v_conversation in select element.value from jsonb_array_elements(requested_conversations) as element(value)
  loop
    if jsonb_typeof(v_conversation) <> 'object' then raise exception 'conversation must be an object'; end if;
    v_conversation_id := nullif(btrim(v_conversation->>'id'), '');
    if v_conversation_id is null or length(v_conversation_id) > 160 or v_conversation_id !~ '^[A-Za-z0-9:_-]+$'
    then raise exception 'invalid conversation id'; end if;
    if v_conversation_id = any(v_conversation_ids) then raise exception 'duplicate conversation id'; end if;
    v_conversation_ids := array_append(v_conversation_ids, v_conversation_id);

    begin
      v_expected_conversation_version := coalesce((requested_conversation_versions->>v_conversation_id)::bigint, 0);
    exception when invalid_text_representation then
      raise exception 'invalid conversation version';
    end;

    select s.version into v_current_conversation_version
    from public.user_simulations as s
    where s.seller_id = auth.uid() and s.conversation_id = v_conversation_id
    for update;

    if found and v_current_conversation_version <> v_expected_conversation_version then
      raise exception using errcode = '40001', message = 'conversation changed while it was being edited';
    elsif not found and v_expected_conversation_version <> 0 then
      raise exception using errcode = '40001', message = 'conversation state no longer matches the loaded version';
    end if;

    insert into public.user_simulations as simulation(organization_id, seller_id, conversation_id, payload, updated_at)
    values(
      v_caller_org,
      auth.uid(),
      v_conversation_id,
      jsonb_set(v_conversation, '{sellerId}', to_jsonb(auth.uid()::text), true),
      v_saved_at
    )
    on conflict on constraint user_simulations_pkey do update
    set organization_id = excluded.organization_id,
        payload = excluded.payload,
        updated_at = excluded.updated_at;
  end loop;

  if exists (
    select 1 from public.user_simulations as s
    where s.seller_id = auth.uid()
      and s.organization_id = v_caller_org
      and not (s.conversation_id = any(v_conversation_ids))
      and (
        not (requested_conversation_versions ? s.conversation_id)
        or (requested_conversation_versions->>s.conversation_id)::bigint <> s.version
      )
  ) then
    raise exception using errcode = '40001', message = 'conversation changed before it could be deleted';
  end if;

  delete from public.user_simulations as s
  where s.seller_id = auth.uid()
    and s.organization_id = v_caller_org
    and not (s.conversation_id = any(v_conversation_ids));

  return query select v_next_workspace_version, v_saved_at;
end;
$$;

revoke all on function public.save_workspace_and_simulations(jsonb,jsonb,jsonb,bigint) from public, anon;
grant execute on function public.save_workspace_and_simulations(jsonb,jsonb,jsonb,bigint) to authenticated;

-- This recovery RPC had the same conflict-target pattern. It is hardened in
-- the same migration so retry/reconciliation cannot regress with the same
-- identifier collision after a generated response.
create or replace function public.reconcile_simulation_generation(
  requested_conversation_id text,
  requested_batch_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_caller_org uuid;
  v_conversation_payload jsonb;
  v_conversation_messages jsonb;
  v_next_messages jsonb;
  v_response_message jsonb;
  v_response_request_id text;
  v_response_ended boolean;
begin
  select p.organization_id into v_caller_org
  from public.profiles as p
  where p.id = auth.uid() and p.is_active;
  if v_caller_org is null then raise exception 'authentication required'; end if;

  select s.payload into v_conversation_payload
  from public.user_simulations as s
  where s.seller_id = auth.uid()
    and s.organization_id = v_caller_org
    and s.conversation_id = requested_conversation_id
  for update;
  if v_conversation_payload is null then raise exception 'simulation not found'; end if;

  v_conversation_messages := case
    when jsonb_typeof(v_conversation_payload->'messages') = 'array' then v_conversation_payload->'messages'
    else '[]'::jsonb
  end;

  select items.message into v_response_message
  from jsonb_array_elements(v_conversation_messages) with ordinality as items(message, ordinal)
  where items.message->>'sender' = 'contact' and items.message->>'batchId' = requested_batch_id
  order by items.ordinal desc
  limit 1;
  if v_response_message is null then return false; end if;

  v_response_request_id := coalesce(nullif(v_response_message->>'requestId', ''), gen_random_uuid()::text);
  v_response_ended := coalesce((v_response_message->>'endsSimulation')::boolean, false);

  select coalesce(jsonb_agg(
    case
      when items.message->>'sender' = 'seller' and items.message->>'batchId' = requested_batch_id
        then items.message || jsonb_build_object('status', 'answered', 'requestId', v_response_request_id)
      else items.message
    end order by items.ordinal
  ), '[]'::jsonb)
  into v_next_messages
  from jsonb_array_elements(v_conversation_messages) with ordinality as items(message, ordinal);

  v_conversation_payload := jsonb_set(v_conversation_payload, '{messages}', v_next_messages, true);
  if v_response_ended then
    v_conversation_payload := jsonb_set(v_conversation_payload, '{status}', '"completed"'::jsonb, true);
  end if;
  update public.user_simulations as s
  set payload = v_conversation_payload, updated_at = greatest(s.updated_at, now())
  where s.seller_id = auth.uid()
    and s.conversation_id = requested_conversation_id;

  insert into public.simulation_generations as generation(
    organization_id, seller_id, conversation_id, batch_id, request_id,
    status, response_text, error_message, simulation_ended, updated_at
  ) values (
    v_caller_org, auth.uid(), requested_conversation_id, requested_batch_id, v_response_request_id,
    'completed', btrim(v_response_message->>'text'), null, v_response_ended, now()
  )
  on conflict on constraint simulation_generations_pkey do update
  set request_id = excluded.request_id,
      status = 'completed',
      response_text = excluded.response_text,
      error_message = null,
      simulation_ended = excluded.simulation_ended,
      updated_at = now();

  return true;
end;
$$;

revoke all on function public.reconcile_simulation_generation(text,text) from public, anon;
grant execute on function public.reconcile_simulation_generation(text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
