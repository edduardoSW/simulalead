begin;

create type public.scenario_starter as enum ('seller_starts', 'lead_starts');
create type public.message_delivery_status as enum ('draft','sending','sent','processing','scheduled','delivered','read','failed','cancelled');
create type public.asset_visibility as enum ('profile_only','conversation_only','both');
create type public.asset_kind as enum ('color_palette','image','file','document','link','briefing','visual_identity','preferences','restrictions');
create type public.pending_response_status as enum ('processing','scheduled','delivered','failed','cancelled');

alter table public.training_scenarios
  add column conversation_starter public.scenario_starter not null default 'seller_starts',
  add column response_delay_config jsonb not null default '{"unit":"minutes","minutes":{"min":1,"max":5},"standard":{"min":10,"max":45},"hours":{"min":60,"max":240}}'::jsonb,
  add constraint valid_response_delay_config check (jsonb_typeof(response_delay_config)='object');

alter table public.lead_profiles
  add column secondary_objections jsonb not null default '["implementation_risk"]'::jsonb check (jsonb_typeof(secondary_objections)='array' and jsonb_array_length(secondary_objections) between 1 and 3),
  add column decision_barriers jsonb not null default '["approval_required"]'::jsonb check (jsonb_typeof(decision_barriers)='array'),
  add column meeting_acceptance_conditions jsonb not null default '["discovery_completed","value_demonstrated","main_objections_addressed"]'::jsonb check (jsonb_typeof(meeting_acceptance_conditions)='array'),
  add column allowed_outcomes jsonb not null default '["meeting","proposal","think","consult_partner","competitor","closed_lost"]'::jsonb check (jsonb_typeof(allowed_outcomes)='array');

alter table public.training_messages
  add column message_type text not null default 'text' check (message_type in ('text','image','palette','file','link','card','mixed')),
  add column delivery_status public.message_delivery_status not null default 'delivered',
  add column idempotency_key uuid,
  add column delivered_at timestamptz,
  add column read_at timestamptz,
  add column model_used text,
  add column processing_ms integer check (processing_ms is null or processing_ms >= 0),
  add constraint message_idempotency unique (session_id,idempotency_key);

create table public.lead_profile_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_profile_id uuid not null references public.lead_profiles(id) on delete cascade,
  kind public.asset_kind not null,
  visibility public.asset_visibility not null default 'profile_only',
  title text not null check (length(btrim(title)) between 1 and 180),
  content jsonb not null default '{}'::jsonb,
  storage_path text,
  alt_text text,
  created_at timestamptz not null default now(),
  check (kind <> 'color_palette' or jsonb_typeof(content->'colors')='array')
);

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id uuid not null references public.training_messages(id) on delete cascade,
  profile_asset_id uuid references public.lead_profile_assets(id) on delete set null,
  kind public.asset_kind not null,
  title text not null,
  content jsonb not null default '{}'::jsonb,
  storage_path text,
  alt_text text,
  created_at timestamptz not null default now()
);

create table public.pending_ai_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  trigger_message_id uuid not null references public.training_messages(id) on delete cascade,
  response_message_id uuid references public.training_messages(id) on delete set null,
  status public.pending_response_status not null default 'processing',
  idempotency_key uuid not null,
  available_at timestamptz,
  delivered_at timestamptz,
  attempts smallint not null default 0 check (attempts between 0 and 10),
  last_error_code text,
  model_used text,
  processing_ms integer check (processing_ms is null or processing_ms >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id,trigger_message_id),
  unique(organization_id,idempotency_key)
);

create table public.conversation_reads (
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  last_read_message_id uuid references public.training_messages(id) on delete set null,
  read_at timestamptz not null default now(),
  primary key(session_id,seller_id)
);

create table public.conversation_drafts (
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  seller_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  body text not null default '' check (length(body)<=10000),
  updated_at timestamptz not null default now(),
  primary key(session_id,seller_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  message_id uuid references public.training_messages(id) on delete cascade,
  kind text not null default 'lead_response',
  title text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(recipient_id,message_id,kind)
);

create index pending_ai_due_idx on public.pending_ai_responses(available_at) where status='scheduled';
create index notifications_recipient_unread_idx on public.notifications(recipient_id,created_at desc) where read_at is null;
create index lead_assets_profile_idx on public.lead_profile_assets(lead_profile_id,visibility);
create index attachments_message_idx on public.message_attachments(message_id);

do $$ declare t text; begin
  foreach t in array array['lead_profile_assets','message_attachments','pending_ai_responses','conversation_reads','conversation_drafts','notifications'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
  end loop;
end $$;

create policy lead_assets_read on public.lead_profile_assets for select to authenticated using (public.is_org_member(organization_id));
create policy attachments_read on public.message_attachments for select to authenticated using (public.is_org_member(organization_id) and exists(select 1 from public.training_messages m join public.training_sessions s on s.id=m.session_id where m.id=message_id and s.seller_id=auth.uid()));
create policy pending_read on public.pending_ai_responses for select to authenticated using (public.is_org_member(organization_id) and exists(select 1 from public.training_sessions s where s.id=session_id and s.seller_id=auth.uid()));
create policy reads_owner on public.conversation_reads for all to authenticated using (seller_id=auth.uid() and public.is_org_member(organization_id)) with check (seller_id=auth.uid() and public.is_org_member(organization_id));
create policy drafts_owner on public.conversation_drafts for all to authenticated using (seller_id=auth.uid() and public.is_org_member(organization_id)) with check (seller_id=auth.uid() and public.is_org_member(organization_id));
create policy notifications_owner on public.notifications for select to authenticated using (recipient_id=auth.uid() and public.is_org_member(organization_id));
create policy notifications_mark_read on public.notifications for update to authenticated using (recipient_id=auth.uid() and public.is_org_member(organization_id)) with check (recipient_id=auth.uid() and public.is_org_member(organization_id));

-- Sellers consume the curated catalog; direct lead rows contain confidential simulator fields.
drop policy if exists lead_profiles_org_read on public.lead_profiles;
create policy lead_profiles_staff_read on public.lead_profiles for select to authenticated using (public.is_org_member(organization_id) and public.has_role(array['admin','manager']::public.user_role[]));

-- No browser write policies for pending responses, lead assets, attachments, or notification creation.
-- A trusted worker creates AI messages and atomically claims due rows with FOR UPDATE SKIP LOCKED.
comment on table public.pending_ai_responses is 'Durable AI response queue. Workers must claim scheduled rows atomically and use both unique idempotency constraints.';

commit;
