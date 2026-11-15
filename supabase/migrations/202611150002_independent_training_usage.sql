begin;

create or replace function public.record_independent_training_usage(
  requested_seller_id uuid,
  requested_conversation_id text,
  requested_request_id text,
  requested_provider_model text,
  requested_provider_status integer,
  requested_quota_reason text,
  requested_prompt_tokens integer,
  requested_candidate_tokens integer,
  requested_thought_tokens integer,
  requested_cached_tokens integer,
  requested_total_tokens integer,
  requested_duration_ms integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict error
declare
  v_caller_org uuid;
  v_normalized_model text := left(coalesce(nullif(btrim(requested_provider_model), ''), 'unknown'), 120);
  v_normalized_reason text := left(nullif(btrim(requested_quota_reason), ''), 300);
begin
  select p.organization_id into v_caller_org
  from public.profiles as p
  where p.id = requested_seller_id and p.is_active;
  if v_caller_org is null then raise exception 'authentication required'; end if;
  if requested_conversation_id is null or length(requested_conversation_id) not between 1 and 160
    or requested_conversation_id !~ '^[A-Za-z0-9:_-]+$'
  then raise exception 'invalid conversation id'; end if;
  if requested_request_id is null or length(requested_request_id) not between 1 and 160
    or requested_request_id !~ '^[A-Za-z0-9:_-]+$'
  then raise exception 'invalid request id'; end if;

  delete from public.gemini_request_reservations as r
  where r.seller_id = requested_seller_id and r.request_id = requested_request_id;

  if not exists (
    select 1 from public.gemini_usage_events as e
    where e.seller_id = requested_seller_id
      and e.request_id = requested_request_id
      and e.operation_kind = 'simulation'
  ) then
    insert into public.gemini_usage_events(
      organization_id, seller_id, conversation_id, batch_id, request_id, operation_kind,
      provider_model, provider_status, quota_reason, prompt_tokens,
      candidate_tokens, thought_tokens, cached_tokens, total_tokens, duration_ms
    ) values (
      v_caller_org, requested_seller_id, requested_conversation_id, 'independent-training', requested_request_id, 'simulation',
      v_normalized_model, coalesce(requested_provider_status, 0), v_normalized_reason,
      greatest(coalesce(requested_prompt_tokens, 0), 0),
      greatest(coalesce(requested_candidate_tokens, 0), 0),
      greatest(coalesce(requested_thought_tokens, 0), 0),
      greatest(coalesce(requested_cached_tokens, 0), 0),
      greatest(coalesce(requested_total_tokens, 0), 0),
      greatest(coalesce(requested_duration_ms, 0), 0)
    );
  end if;

  if requested_provider_status = 429
    and coalesce(v_normalized_reason, '') ~* '(daily|per.day|requestsperday|quota_exceeded)'
  then
    insert into public.gemini_provider_quota_state as quota(provider_model, blocked_until, reason, updated_at)
    values(
      v_normalized_model,
      (date_trunc('day', now() at time zone 'America/Los_Angeles') + interval '1 day') at time zone 'America/Los_Angeles',
      v_normalized_reason,
      now()
    )
    on conflict on constraint gemini_provider_quota_state_pkey do update
    set blocked_until = excluded.blocked_until,
        reason = excluded.reason,
        updated_at = excluded.updated_at;
  end if;
end;
$$;

revoke all on function public.record_independent_training_usage(uuid,text,text,text,integer,text,integer,integer,integer,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.record_independent_training_usage(uuid,text,text,text,integer,text,integer,integer,integer,integer,integer,integer) to service_role;

notify pgrst, 'reload schema';
commit;
