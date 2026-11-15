begin;

-- Evaluations used to live in the organization-wide workspace payload. Copy
-- each evaluation into its owner-scoped simulation before removing the shared
-- copy. Unmatched legacy evaluations are retained to avoid destructive loss.
insert into public.user_simulations as simulation(
  organization_id, seller_id, conversation_id, payload, updated_at
)
select w.organization_id,
       p.id,
       legacy.value->>'id',
       jsonb_set(legacy.value, '{sellerId}', to_jsonb(p.id::text), true),
       w.updated_at
from public.workspace_states as w
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(w.payload->'conversations') = 'array' then w.payload->'conversations'
    else '[]'::jsonb
  end
) as legacy(value)
join public.profiles as p
  on p.organization_id = w.organization_id
 and p.id::text = legacy.value->>'sellerId'
where jsonb_typeof(legacy.value) = 'object'
  and length(legacy.value->>'id') between 1 and 160
  and legacy.value->>'id' ~ '^[A-Za-z0-9:_-]+$'
on conflict on constraint user_simulations_pkey do nothing;

with matched_evaluations as (
  select s.seller_id,
         s.conversation_id,
         evaluation.value as evaluation_payload
  from public.user_simulations as s
  join public.workspace_states as w
    on w.organization_id = s.organization_id
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(w.payload->'evaluations') = 'array' then w.payload->'evaluations'
      else '[]'::jsonb
    end
  ) as evaluation(value)
  where jsonb_typeof(evaluation.value) = 'object'
    and evaluation.value->>'conversationId' = s.conversation_id
)
update public.user_simulations as s
set payload = jsonb_set(s.payload, '{evaluation}', matched.evaluation_payload, true),
    updated_at = greatest(s.updated_at, now())
from matched_evaluations as matched
where s.seller_id = matched.seller_id
  and s.conversation_id = matched.conversation_id
  and not (s.payload ? 'evaluation');

update public.workspace_states as w
set payload = jsonb_set(
      w.payload,
      '{conversations}',
      coalesce((
        select jsonb_agg(legacy.value order by legacy.ordinal)
        from jsonb_array_elements(
          case
            when jsonb_typeof(w.payload->'conversations') = 'array' then w.payload->'conversations'
            else '[]'::jsonb
          end
        ) with ordinality as legacy(value, ordinal)
        where not exists (
          select 1
          from public.user_simulations as s
          where s.organization_id = w.organization_id
            and s.seller_id::text = legacy.value->>'sellerId'
            and s.conversation_id = legacy.value->>'id'
        )
      ), '[]'::jsonb),
      true
    ),
    updated_at = now()
where jsonb_typeof(w.payload) = 'object'
  and jsonb_typeof(w.payload->'conversations') = 'array';

update public.workspace_states as w
set payload = jsonb_set(
      w.payload,
      '{evaluations}',
      coalesce((
        select jsonb_agg(evaluation.value order by evaluation.ordinal)
        from jsonb_array_elements(
          case
            when jsonb_typeof(w.payload->'evaluations') = 'array' then w.payload->'evaluations'
            else '[]'::jsonb
          end
        ) with ordinality as evaluation(value, ordinal)
        where not exists (
          select 1
          from public.user_simulations as s
          where s.organization_id = w.organization_id
            and s.conversation_id = evaluation.value->>'conversationId'
            and s.payload->'evaluation' = evaluation.value
        )
      ), '[]'::jsonb),
      true
    ),
    updated_at = now()
where jsonb_typeof(w.payload) = 'object'
  and jsonb_typeof(w.payload->'evaluations') = 'array';

notify pgrst, 'reload schema';

commit;
