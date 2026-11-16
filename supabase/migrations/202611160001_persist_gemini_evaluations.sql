begin;

create or replace function public.persist_gemini_evaluation(
  requested_seller_id uuid,
  requested_organization_id uuid,
  requested_conversation_id text,
  requested_evaluation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  conversation_payload jsonb;
  existing_evaluation jsonb;
begin
  if not exists (
    select 1 from public.profiles as profile
    where profile.id = requested_seller_id
      and profile.organization_id = requested_organization_id
      and profile.is_active
  ) then raise exception 'invalid evaluation owner'; end if;

  if requested_conversation_id is null
    or length(requested_conversation_id) not between 1 and 160
    or requested_conversation_id !~ '^[A-Za-z0-9:_-]+$'
  then raise exception 'invalid conversation id'; end if;
  if jsonb_typeof(requested_evaluation) <> 'object'
    or requested_evaluation->>'conversationId' <> requested_conversation_id
    or length(coalesce(requested_evaluation->>'id', '')) not between 1 and 160
    or coalesce(jsonb_typeof(requested_evaluation->'score') <> 'number', true)
    or coalesce(jsonb_typeof(requested_evaluation->'criteria') <> 'object', true)
    or coalesce(jsonb_typeof(requested_evaluation->'summary') <> 'string', true)
    or coalesce(jsonb_typeof(requested_evaluation->'strengths') <> 'array', true)
    or coalesce(jsonb_typeof(requested_evaluation->'improvements') <> 'array', true)
    or coalesce(jsonb_typeof(requested_evaluation->'recommendations') <> 'array', true)
  then raise exception 'invalid evaluation'; end if;

  select simulation.payload into conversation_payload
  from public.user_simulations as simulation
  where simulation.organization_id = requested_organization_id
    and simulation.seller_id = requested_seller_id
    and simulation.conversation_id = requested_conversation_id
  for update;
  if conversation_payload is null then raise exception 'simulation not found'; end if;
  if conversation_payload->>'status' <> 'completed' then raise exception 'simulation is not completed'; end if;

  existing_evaluation := conversation_payload->'evaluation';
  if jsonb_typeof(existing_evaluation) = 'object'
    and existing_evaluation->>'conversationId' = requested_conversation_id
  then return existing_evaluation; end if;

  update public.user_simulations as simulation
  set payload = jsonb_set(simulation.payload, '{evaluation}', requested_evaluation, true),
      updated_at = now()
  where simulation.organization_id = requested_organization_id
    and simulation.seller_id = requested_seller_id
    and simulation.conversation_id = requested_conversation_id;

  return requested_evaluation;
end;
$$;

revoke all on function public.persist_gemini_evaluation(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.persist_gemini_evaluation(uuid,uuid,text,jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
