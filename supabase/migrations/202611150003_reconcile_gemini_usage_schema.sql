begin;

-- 202611140002 was already recorded in the linked project before evaluation
-- usage support was appended to that migration locally. Reconcile the live
-- schema incrementally instead of rewriting applied migration history.
alter table public.gemini_usage_events
  add column if not exists operation_kind text not null default 'simulation'
  constraint gemini_usage_events_operation_kind_check
  check (operation_kind in ('simulation', 'evaluation'));

create or replace function public.record_gemini_evaluation_usage(
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

  delete from public.gemini_request_reservations as r
  where r.seller_id = requested_seller_id
    and r.request_id = requested_request_id;

  insert into public.gemini_usage_events as usage_event(
    organization_id, seller_id, conversation_id, batch_id, request_id, operation_kind,
    provider_model, provider_status, quota_reason, prompt_tokens,
    candidate_tokens, thought_tokens, cached_tokens, total_tokens, duration_ms
  ) values (
    v_caller_org, requested_seller_id, requested_conversation_id, 'evaluation', requested_request_id, 'evaluation',
    v_normalized_model, coalesce(requested_provider_status, 0), v_normalized_reason,
    greatest(coalesce(requested_prompt_tokens, 0), 0),
    greatest(coalesce(requested_candidate_tokens, 0), 0),
    greatest(coalesce(requested_thought_tokens, 0), 0),
    greatest(coalesce(requested_cached_tokens, 0), 0),
    greatest(coalesce(requested_total_tokens, 0), 0),
    greatest(coalesce(requested_duration_ms, 0), 0)
  );

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

revoke all on function public.record_gemini_evaluation_usage(uuid,text,text,text,integer,text,integer,integer,integer,integer,integer,integer)
from public, anon, authenticated;
grant execute on function public.record_gemini_evaluation_usage(uuid,text,text,text,integer,text,integer,integer,integer,integer,integer,integer)
to service_role;

-- The linked project originally had the legacy view shape, while a fresh
-- database already has operation_kind in the view. Recreate both views so this
-- migration is replayable in either state without column-order conflicts.
drop view if exists public.gemini_usage_by_user;
drop view if exists public.gemini_usage_by_simulation;

create view public.gemini_usage_by_user
with (security_invoker = true)
as
select e.organization_id,
       e.seller_id,
       coalesce(p.full_name, e.seller_id::text) as seller_name,
       e.operation_kind,
       e.provider_model,
       count(*)::bigint as provider_calls,
       sum(e.prompt_tokens)::bigint as prompt_tokens,
       sum(e.candidate_tokens)::bigint as candidate_tokens,
       sum(e.thought_tokens)::bigint as thought_tokens,
       sum(e.cached_tokens)::bigint as cached_tokens,
       sum(e.total_tokens)::bigint as total_tokens,
       sum(e.duration_ms)::bigint as duration_ms,
       count(*) filter (where e.provider_status = 429)::bigint as rate_limit_errors,
       max(e.created_at) as last_call_at
from public.gemini_usage_events as e
left join public.profiles as p
  on p.id = e.seller_id and p.organization_id = e.organization_id
group by e.organization_id, e.seller_id, p.full_name, e.provider_model, e.operation_kind;

create view public.gemini_usage_by_simulation
with (security_invoker = true)
as
select e.organization_id,
       e.seller_id,
       coalesce(p.full_name, e.seller_id::text) as seller_name,
       e.conversation_id,
       e.operation_kind,
       e.provider_model,
       count(*)::bigint as provider_calls,
       sum(e.prompt_tokens)::bigint as prompt_tokens,
       sum(e.candidate_tokens)::bigint as candidate_tokens,
       sum(e.thought_tokens)::bigint as thought_tokens,
       sum(e.cached_tokens)::bigint as cached_tokens,
       sum(e.total_tokens)::bigint as total_tokens,
       max(e.quota_reason) filter (where e.quota_reason is not null) as last_quota_reason,
       max(e.created_at) as last_call_at
from public.gemini_usage_events as e
left join public.profiles as p
  on p.id = e.seller_id and p.organization_id = e.organization_id
group by e.organization_id, e.seller_id, p.full_name, e.conversation_id, e.provider_model, e.operation_kind;

revoke all on public.gemini_usage_by_user, public.gemini_usage_by_simulation from public, anon;
grant select on public.gemini_usage_by_user, public.gemini_usage_by_simulation to authenticated;

notify pgrst, 'reload schema';

commit;
