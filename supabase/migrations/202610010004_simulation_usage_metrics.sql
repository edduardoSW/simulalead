begin;

alter table public.simulation_generations
  add column if not exists provider_model text,
  add column if not exists provider_call_count integer not null default 0 check (provider_call_count >= 0),
  add column if not exists prompt_token_count bigint not null default 0 check (prompt_token_count >= 0),
  add column if not exists candidate_token_count bigint not null default 0 check (candidate_token_count >= 0),
  add column if not exists thought_token_count bigint not null default 0 check (thought_token_count >= 0),
  add column if not exists total_token_count bigint not null default 0 check (total_token_count >= 0),
  add column if not exists last_provider_status integer,
  add column if not exists last_quota_reason text;

create or replace function public.record_simulation_generation_usage(
  requested_conversation_id text,
  requested_batch_id text,
  requested_request_id text,
  requested_provider_model text,
  requested_provider_status integer,
  requested_quota_reason text,
  requested_prompt_tokens integer,
  requested_candidate_tokens integer,
  requested_thought_tokens integer,
  requested_total_tokens integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.simulation_generations g
  set provider_model = left(nullif(btrim(requested_provider_model), ''), 120),
      provider_call_count = g.provider_call_count + 1,
      prompt_token_count = g.prompt_token_count + greatest(coalesce(requested_prompt_tokens, 0), 0),
      candidate_token_count = g.candidate_token_count + greatest(coalesce(requested_candidate_tokens, 0), 0),
      thought_token_count = g.thought_token_count + greatest(coalesce(requested_thought_tokens, 0), 0),
      total_token_count = g.total_token_count + greatest(coalesce(requested_total_tokens, 0), 0),
      last_provider_status = requested_provider_status,
      last_quota_reason = left(nullif(btrim(requested_quota_reason), ''), 300),
      updated_at = now()
  where g.seller_id = auth.uid()
    and g.conversation_id = requested_conversation_id
    and g.batch_id = requested_batch_id
    and g.request_id = requested_request_id
    and g.status = 'processing';
end;
$$;

drop view if exists public.simulation_usage_by_conversation;
create view public.simulation_usage_by_conversation
with (security_invoker = true)
as
select
  organization_id,
  seller_id,
  conversation_id,
  max(provider_model) as provider_model,
  sum(provider_call_count)::bigint as provider_call_count,
  sum(prompt_token_count)::bigint as prompt_token_count,
  sum(candidate_token_count)::bigint as candidate_token_count,
  sum(thought_token_count)::bigint as thought_token_count,
  sum(total_token_count)::bigint as total_token_count,
  max(updated_at) as updated_at
from public.simulation_generations
group by organization_id, seller_id, conversation_id;

revoke all on function public.record_simulation_generation_usage(text,text,text,text,integer,text,integer,integer,integer,integer) from public, anon;
grant execute on function public.record_simulation_generation_usage(text,text,text,text,integer,text,integer,integer,integer,integer) to authenticated;
grant select on public.simulation_usage_by_conversation to authenticated;

notify pgrst, 'reload schema';

commit;
