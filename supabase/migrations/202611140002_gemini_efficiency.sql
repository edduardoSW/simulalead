begin;

alter table public.simulation_generations
  add column if not exists cached_token_count bigint not null default 0 check (cached_token_count >= 0),
  add column if not exists provider_duration_ms bigint not null default 0 check (provider_duration_ms >= 0);

create table public.gemini_usage_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  seller_id uuid not null,
  conversation_id text not null,
  batch_id text not null,
  request_id text not null,
  provider_model text not null,
  provider_status integer not null,
  quota_reason text,
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  candidate_tokens integer not null default 0 check (candidate_tokens >= 0),
  thought_tokens integer not null default 0 check (thought_tokens >= 0),
  cached_tokens integer not null default 0 check (cached_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  created_at timestamptz not null default now()
);

create index gemini_usage_events_seller_model_time_idx
  on public.gemini_usage_events(seller_id, provider_model, created_at desc);
create index gemini_usage_events_org_time_idx
  on public.gemini_usage_events(organization_id, created_at desc);
create index gemini_usage_events_errors_idx
  on public.gemini_usage_events(provider_status, created_at desc)
  where provider_status >= 400;

alter table public.gemini_usage_events enable row level security;
alter table public.gemini_usage_events force row level security;

create policy gemini_usage_events_read
on public.gemini_usage_events for select to authenticated
using (
  public.is_org_member(organization_id)
  and (seller_id = auth.uid() or public.has_role(array['admin','manager']::public.user_role[]))
);

create table public.gemini_provider_quota_state (
  provider_model text primary key,
  blocked_until timestamptz not null,
  reason text not null,
  updated_at timestamptz not null default now()
);

alter table public.gemini_provider_quota_state enable row level security;
alter table public.gemini_provider_quota_state force row level security;
revoke all on public.gemini_provider_quota_state from public, anon, authenticated;

create table public.gemini_request_reservations (
  seller_id uuid not null,
  request_id text not null,
  provider_model text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes',
  primary key (seller_id, request_id)
);

create index gemini_request_reservations_expiry_idx on public.gemini_request_reservations(expires_at);
alter table public.gemini_request_reservations enable row level security;
alter table public.gemini_request_reservations force row level security;
revoke all on public.gemini_request_reservations from public, anon, authenticated;

revoke all on function public.record_simulation_generation_usage(text,text,text,text,integer,text,integer,integer,integer,integer) from public, anon, authenticated;
drop function public.record_simulation_generation_usage(text,text,text,text,integer,text,integer,integer,integer,integer);

create function public.record_simulation_generation_usage(
  requested_seller_id uuid,
  requested_conversation_id text,
  requested_batch_id text,
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
declare
  caller_org uuid;
  affected_rows integer;
  normalized_model text := left(coalesce(nullif(btrim(requested_provider_model), ''), 'unknown'), 120);
  normalized_reason text := left(nullif(btrim(requested_quota_reason), ''), 300);
begin
  select p.organization_id into caller_org
  from public.profiles p
  where p.id = requested_seller_id and p.is_active;
  if caller_org is null then raise exception 'authentication required'; end if;

  update public.simulation_generations g
  set provider_model = normalized_model,
      provider_call_count = g.provider_call_count + 1,
      prompt_token_count = g.prompt_token_count + greatest(coalesce(requested_prompt_tokens, 0), 0),
      candidate_token_count = g.candidate_token_count + greatest(coalesce(requested_candidate_tokens, 0), 0),
      thought_token_count = g.thought_token_count + greatest(coalesce(requested_thought_tokens, 0), 0),
      cached_token_count = g.cached_token_count + greatest(coalesce(requested_cached_tokens, 0), 0),
      total_token_count = g.total_token_count + greatest(coalesce(requested_total_tokens, 0), 0),
      provider_duration_ms = g.provider_duration_ms + greatest(coalesce(requested_duration_ms, 0), 0),
      last_provider_status = requested_provider_status,
      last_quota_reason = normalized_reason,
      updated_at = now()
  where g.organization_id = caller_org
    and g.seller_id = requested_seller_id
    and g.conversation_id = requested_conversation_id
    and g.batch_id = requested_batch_id
    and g.request_id = requested_request_id
    and g.status = 'processing';

  get diagnostics affected_rows = row_count;
  if affected_rows = 0 then return; end if;

  delete from public.gemini_request_reservations r
  where r.seller_id = requested_seller_id and r.request_id = requested_request_id;

  insert into public.gemini_usage_events(
    organization_id, seller_id, conversation_id, batch_id, request_id,
    provider_model, provider_status, quota_reason, prompt_tokens,
    candidate_tokens, thought_tokens, cached_tokens, total_tokens, duration_ms
  ) values (
    caller_org, requested_seller_id, requested_conversation_id, requested_batch_id, requested_request_id,
    normalized_model, coalesce(requested_provider_status, 0), normalized_reason,
    greatest(coalesce(requested_prompt_tokens, 0), 0),
    greatest(coalesce(requested_candidate_tokens, 0), 0),
    greatest(coalesce(requested_thought_tokens, 0), 0),
    greatest(coalesce(requested_cached_tokens, 0), 0),
    greatest(coalesce(requested_total_tokens, 0), 0),
    greatest(coalesce(requested_duration_ms, 0), 0)
  );

  if requested_provider_status = 429
    and coalesce(normalized_reason, '') ~* '(daily|per.day|requestsperday|quota_exceeded)'
  then
    insert into public.gemini_provider_quota_state(provider_model, blocked_until, reason, updated_at)
    values(
      normalized_model,
      (date_trunc('day', now() at time zone 'America/Los_Angeles') + interval '1 day') at time zone 'America/Los_Angeles',
      normalized_reason,
      now()
    )
    on conflict (provider_model) do update
    set blocked_until = excluded.blocked_until,
        reason = excluded.reason,
        updated_at = excluded.updated_at;
  end if;
end;
$$;

create function public.check_gemini_usage_limit(
  requested_provider_model text,
  requested_request_id text,
  requested_rpm_limit integer,
  requested_daily_request_limit integer,
  requested_daily_token_limit bigint
)
returns table (
  allowed boolean,
  limit_reason text,
  retry_after_seconds integer,
  requests_last_minute bigint,
  requests_today bigint,
  tokens_today bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_org uuid;
  normalized_model text := left(coalesce(nullif(btrim(requested_provider_model), ''), 'unknown'), 120);
  minute_start timestamptz := now() - interval '1 minute';
  day_start timestamptz := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  next_day timestamptz := (date_trunc('day', now() at time zone 'America/Los_Angeles') + interval '1 day') at time zone 'America/Los_Angeles';
  provider_blocked_until timestamptz;
  minute_oldest timestamptz;
  reservation_oldest timestamptz;
  reserved_last_minute bigint;
  reserved_today bigint;
begin
  if requested_rpm_limit not between 1 and 1000
    or requested_daily_request_limit not between 1 and 1000000
    or requested_daily_token_limit not between 1 and 10000000000
  then raise exception 'invalid usage limit'; end if;

  select p.organization_id into caller_org
  from public.profiles p
  where p.id = auth.uid() and p.is_active;
  if caller_org is null then raise exception 'authentication required'; end if;
  if requested_request_id is null or length(requested_request_id) not between 1 and 160
    or requested_request_id !~ '^[A-Za-z0-9:_-]+$'
  then raise exception 'invalid request id'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':' || normalized_model, 0));

  delete from public.gemini_request_reservations r where r.expires_at <= now();

  if exists (
    select 1 from public.gemini_request_reservations r
    where r.seller_id = auth.uid() and r.request_id = requested_request_id and r.expires_at > now()
  ) then
    return query select true, null::text, 0, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  select q.blocked_until into provider_blocked_until
  from public.gemini_provider_quota_state q
  where q.provider_model = normalized_model and q.blocked_until > now();

  select count(*), min(e.created_at)
  into requests_last_minute, minute_oldest
  from public.gemini_usage_events e
  where e.seller_id = auth.uid()
    and e.provider_model = normalized_model
    and e.created_at >= minute_start;

  select count(*), min(r.created_at)
  into reserved_last_minute, reservation_oldest
  from public.gemini_request_reservations r
  where r.seller_id = auth.uid()
    and r.provider_model = normalized_model
    and r.created_at >= minute_start;
  requests_last_minute := requests_last_minute + reserved_last_minute;
  minute_oldest := least(
    coalesce(minute_oldest, reservation_oldest),
    coalesce(reservation_oldest, minute_oldest)
  );

  select count(*), coalesce(sum(e.total_tokens), 0)
  into requests_today, tokens_today
  from public.gemini_usage_events e
  where e.seller_id = auth.uid()
    and e.provider_model = normalized_model
    and e.created_at >= day_start;

  select count(*) into reserved_today
  from public.gemini_request_reservations r
  where r.seller_id = auth.uid()
    and r.provider_model = normalized_model
    and r.created_at >= day_start;
  requests_today := requests_today + reserved_today;

  if provider_blocked_until is not null then
    return query select false, 'PROJECT_DAILY_QUOTA', greatest(1, ceil(extract(epoch from provider_blocked_until - now()))::integer), requests_last_minute, requests_today, tokens_today;
  elsif requests_last_minute >= requested_rpm_limit then
    return query select false, 'USER_RPM_LIMIT', greatest(1, ceil(extract(epoch from minute_oldest + interval '1 minute' - now()))::integer), requests_last_minute, requests_today, tokens_today;
  elsif requests_today >= requested_daily_request_limit then
    return query select false, 'USER_DAILY_REQUEST_LIMIT', greatest(1, ceil(extract(epoch from next_day - now()))::integer), requests_last_minute, requests_today, tokens_today;
  elsif tokens_today >= requested_daily_token_limit then
    return query select false, 'USER_DAILY_TOKEN_LIMIT', greatest(1, ceil(extract(epoch from next_day - now()))::integer), requests_last_minute, requests_today, tokens_today;
  else
    insert into public.gemini_request_reservations(seller_id,request_id,provider_model)
    values(auth.uid(),requested_request_id,normalized_model);
    return query select true, null::text, 0, requests_last_minute, requests_today, tokens_today;
  end if;
end;
$$;

revoke all on function public.record_simulation_generation_usage(uuid,text,text,text,text,integer,text,integer,integer,integer,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.record_simulation_generation_usage(uuid,text,text,text,text,integer,text,integer,integer,integer,integer,integer,integer) to service_role;
revoke all on function public.check_gemini_usage_limit(text,text,integer,integer,bigint) from public, anon;
grant execute on function public.check_gemini_usage_limit(text,text,integer,integer,bigint) to authenticated;

revoke all on public.gemini_usage_events from public, anon, authenticated;
grant select on public.gemini_usage_events to authenticated;

create view public.gemini_usage_by_user
with (security_invoker = true)
as
select e.organization_id, e.seller_id, coalesce(p.full_name, e.seller_id::text) seller_name, e.provider_model,
       count(*)::bigint provider_calls,
       sum(e.prompt_tokens)::bigint prompt_tokens,
       sum(e.candidate_tokens)::bigint candidate_tokens,
       sum(e.thought_tokens)::bigint thought_tokens,
       sum(e.cached_tokens)::bigint cached_tokens,
       sum(e.total_tokens)::bigint total_tokens,
       sum(e.duration_ms)::bigint duration_ms,
       count(*) filter (where e.provider_status = 429)::bigint rate_limit_errors,
       max(e.created_at) last_call_at
from public.gemini_usage_events e
left join public.profiles p on p.id = e.seller_id and p.organization_id = e.organization_id
group by e.organization_id, e.seller_id, p.full_name, e.provider_model;

create view public.gemini_usage_by_simulation
with (security_invoker = true)
as
select e.organization_id, e.seller_id, coalesce(p.full_name, e.seller_id::text) seller_name, e.conversation_id, e.provider_model,
       count(*)::bigint provider_calls,
       sum(e.prompt_tokens)::bigint prompt_tokens,
       sum(e.candidate_tokens)::bigint candidate_tokens,
       sum(e.thought_tokens)::bigint thought_tokens,
       sum(e.cached_tokens)::bigint cached_tokens,
       sum(e.total_tokens)::bigint total_tokens,
       max(e.quota_reason) filter (where e.quota_reason is not null) last_quota_reason,
       max(e.created_at) last_call_at
from public.gemini_usage_events e
left join public.profiles p on p.id = e.seller_id and p.organization_id = e.organization_id
group by e.organization_id, e.seller_id, p.full_name, e.conversation_id, e.provider_model;

revoke all on public.gemini_usage_by_user, public.gemini_usage_by_simulation from public, anon;
grant select on public.gemini_usage_by_user, public.gemini_usage_by_simulation to authenticated;

notify pgrst, 'reload schema';
commit;
