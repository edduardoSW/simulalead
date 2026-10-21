begin;

create type public.buying_role as enum ('gatekeeper','user','influencer','champion','technical_evaluator','financial_approver','decision_maker','executive_sponsor');
create type public.contact_status as enum ('unknown','identified','contacted','engaged','blocked','referred','inactive');
create type public.handoff_status as enum ('requested','approved','declined','completed','cancelled');
create type public.invitation_status as enum ('pending','accepted','expired','revoked');

create table public.simulated_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check(length(btrim(name)) between 2 and 180),
  segment text not null,
  size_band text not null check(size_band in ('micro','small','medium','large','enterprise')),
  public_profile jsonb not null default '{}'::jsonb check(jsonb_typeof(public_profile)='object'),
  private_scenario_context jsonb not null default '{}'::jsonb check(jsonb_typeof(private_scenario_context)='object'),
  is_template boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,name)
);

create table public.simulated_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  simulated_account_id uuid not null references public.simulated_accounts(id) on delete cascade,
  name text not null,
  job_title text not null,
  department text,
  buying_role public.buying_role not null,
  influence_level smallint not null default 1 check(influence_level between 0 and 5),
  decision_power smallint not null default 0 check(decision_power between 0 and 5),
  interest_level smallint not null default 1 check(interest_level between 0 and 5),
  resistance_level smallint not null default 2 check(resistance_level between 0 and 5),
  problem_knowledge smallint not null default 1 check(problem_knowledge between 0 and 5),
  decision_maker_access smallint not null default 0 check(decision_maker_access between 0 and 5),
  communication_preference text,
  public_information jsonb not null default '{}'::jsonb check(jsonb_typeof(public_information)='object'),
  private_information jsonb not null default '{}'::jsonb check(jsonb_typeof(private_information)='object'),
  private_objections jsonb not null default '[]'::jsonb check(jsonb_typeof(private_objections)='array'),
  availability_config jsonb not null default '{}'::jsonb check(jsonb_typeof(availability_config)='object'),
  initial_contact boolean not null default false,
  display_order smallint not null default 1 check(display_order>0),
  created_at timestamptz not null default now(),
  unique(simulated_account_id,name),
  unique(simulated_account_id,display_order)
);

alter table public.training_scenarios add column simulated_account_id uuid references public.simulated_accounts(id) on delete restrict;

create table public.conversation_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  contact_id uuid not null references public.simulated_contacts(id) on delete restrict,
  status public.contact_status not null default 'unknown',
  discovered_at timestamptz,
  first_contacted_at timestamptz,
  last_interaction_at timestamptz,
  relationship_level smallint not null default 0 check(relationship_level between 0 and 5),
  known_role text,
  next_action text,
  discovered_information jsonb not null default '{}'::jsonb check(jsonb_typeof(discovered_information)='object'),
  created_at timestamptz not null default now(),
  unique(session_id,contact_id),
  check(status='unknown' or discovered_at is not null)
);

create table public.contact_handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  from_contact_id uuid not null references public.simulated_contacts(id) on delete restrict,
  to_contact_id uuid references public.simulated_contacts(id) on delete restrict,
  requested_by text not null check(requested_by in ('seller','contact','system')),
  status public.handoff_status not null default 'requested',
  reason text not null,
  refusal_reason text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  check((status='requested' and resolved_at is null) or (status<>'requested' and resolved_at is not null))
);

alter table public.training_messages add column simulated_contact_id uuid references public.simulated_contacts(id) on delete restrict;

alter table public.session_evaluations add column decision_process_scores jsonb not null default '{"interlocutor_identification":null,"gatekeeper_respect":null,"opening_clarity":null,"decision_process_discovery":null,"influencer_mapping":null,"decision_maker_discovery":null,"handoff_ability":null,"role_personalization":null,"next_step_registration":null,"ethical_conduct":null}'::jsonb check(jsonb_typeof(decision_process_scores)='object');

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check(email=lower(email)),
  role public.user_role not null check(role in ('manager','seller')),
  token_hash text not null unique,
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check(expires_at>created_at),
  check((status='accepted')=(accepted_at is not null))
);

create index simulated_accounts_org_idx on public.simulated_accounts(organization_id,size_band);
create index simulated_contacts_account_idx on public.simulated_contacts(simulated_account_id,display_order);
create unique index one_initial_contact_per_account on public.simulated_contacts(simulated_account_id) where initial_contact;
create index participants_session_status_idx on public.conversation_participants(session_id,status);
create index handoffs_session_time_idx on public.contact_handoffs(session_id,requested_at desc);
create index invitations_pending_idx on public.organization_invitations(organization_id,expires_at) where status='pending';

do $$ declare t text; begin
  foreach t in array array['simulated_accounts','simulated_contacts','conversation_participants','contact_handoffs','organization_invitations'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
  end loop;
end $$;

create policy simulated_accounts_staff on public.simulated_accounts for all to authenticated using(public.is_org_member(organization_id) and public.has_role(array['admin','manager']::public.user_role[])) with check(public.is_org_member(organization_id) and public.has_role(array['admin','manager']::public.user_role[]));
create policy simulated_contacts_staff on public.simulated_contacts for all to authenticated using(public.is_org_member(organization_id) and public.has_role(array['admin','manager']::public.user_role[])) with check(public.is_org_member(organization_id) and public.has_role(array['admin','manager']::public.user_role[]));
create policy participants_read on public.conversation_participants for select to authenticated using(public.is_org_member(organization_id) and exists(select 1 from public.training_sessions s where s.id=session_id and (s.seller_id=auth.uid() or public.has_role(array['admin','manager']::public.user_role[]))));
create policy handoffs_read on public.contact_handoffs for select to authenticated using(public.is_org_member(organization_id) and exists(select 1 from public.training_sessions s where s.id=session_id and (s.seller_id=auth.uid() or public.has_role(array['admin','manager']::public.user_role[]))));
create policy invitations_admin on public.organization_invitations for all to authenticated using(public.is_org_member(organization_id) and public.has_role(array['admin']::public.user_role[])) with check(public.is_org_member(organization_id) and public.has_role(array['admin']::public.user_role[]));
-- Participants, handoffs and lead messages are written only by the trusted simulation service.

create or replace function public.create_organization_with_admin(org_name text,org_slug text,admin_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare new_org_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'profile already exists'; end if;
  insert into public.organizations(name,slug) values(btrim(org_name),lower(btrim(org_slug))) returning id into new_org_id;
  insert into public.profiles(id,organization_id,full_name,role) values(auth.uid(),new_org_id,btrim(admin_name),'admin');
  return new_org_id;
end $$;
revoke all on function public.create_organization_with_admin(text,text,text) from public,anon;
grant execute on function public.create_organization_with_admin(text,text,text) to authenticated;

create view public.seller_contact_map with(security_barrier=true) as
select cp.session_id,cp.status,cp.discovered_at,cp.last_interaction_at,cp.relationship_level,cp.known_role,cp.next_action,
       case when cp.status='unknown' then null else c.id end contact_id,
       case when cp.status='unknown' then null else c.name end contact_name,
       case when cp.status='unknown' then null else c.job_title end job_title,
       case when cp.status='unknown' then null else c.department end department
from public.conversation_participants cp
join public.simulated_contacts c on c.id=cp.contact_id and c.organization_id=cp.organization_id
join public.training_sessions s on s.id=cp.session_id and s.organization_id=cp.organization_id
where s.seller_id=auth.uid() and cp.organization_id=public.current_organization_id();
revoke all on public.seller_contact_map from public,anon;
grant select on public.seller_contact_map to authenticated;

commit;
