begin;

create extension if not exists pgcrypto with schema extensions;

create type public.user_role as enum ('admin', 'manager', 'seller');
create type public.difficulty_level as enum ('beginner', 'intermediate', 'advanced');
create type public.profile_source_type as enum ('manual', 'imported', 'synthetic', 'anonymized');
create type public.validation_status as enum ('pending', 'validated', 'rejected');
create type public.rubric_status as enum ('draft', 'active', 'archived');
create type public.assignment_status as enum ('assigned', 'in_progress', 'completed', 'cancelled', 'expired');
create type public.session_status as enum ('created', 'in_progress', 'completed', 'cancelled', 'expired', 'interrupted', 'technical_failure');
create type public.commercial_outcome as enum ('sale_completed', 'meeting_scheduled', 'next_step_agreed', 'follow_up_required', 'lead_undecided', 'opportunity_lost', 'unqualified_lead');
create type public.message_sender_type as enum ('seller', 'lead', 'system', 'evaluator');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 160),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on update cascade on delete cascade,
  organization_id uuid not null references public.organizations(id) on update cascade on delete restrict,
  full_name text not null check (length(btrim(full_name)) between 2 and 160),
  role public.user_role not null default 'seller',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on update cascade on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 160),
  description text not null,
  value_proposition text,
  target_audience text,
  key_benefits jsonb not null default '[]'::jsonb check (jsonb_typeof(key_benefits) = 'array'),
  common_objections jsonb not null default '[]'::jsonb check (jsonb_typeof(common_objections) = 'array'),
  competitors jsonb not null default '[]'::jsonb check (jsonb_typeof(competitors) = 'array'),
  sales_guidelines text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on update cascade on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.lead_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on update cascade on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 160),
  age_range text, job_title text, business_segment text, company_size text, company_context text,
  personality text, communication_style text,
  pain_points jsonb not null default '[]'::jsonb check (jsonb_typeof(pain_points) = 'array'),
  needs jsonb not null default '[]'::jsonb check (jsonb_typeof(needs) = 'array'),
  visible_objections jsonb not null default '[]'::jsonb check (jsonb_typeof(visible_objections) = 'array'),
  hidden_objections jsonb not null default '[]'::jsonb check (jsonb_typeof(hidden_objections) = 'array'),
  buying_motivations jsonb not null default '[]'::jsonb check (jsonb_typeof(buying_motivations) = 'array'),
  decision_criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(decision_criteria) = 'array'),
  competitors_considered jsonb not null default '[]'::jsonb check (jsonb_typeof(competitors_considered) = 'array'),
  budget_context text, urgency_level smallint check (urgency_level between 1 and 5),
  decision_power smallint check (decision_power between 1 and 5),
  initial_interest_level smallint not null default 3 check (initial_interest_level between 1 and 5),
  difficulty_level public.difficulty_level not null,
  behavior_instructions text not null,
  reveal_conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(reveal_conditions) = 'array'),
  acceptance_conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(acceptance_conditions) = 'array'),
  refusal_conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(refusal_conditions) = 'array'),
  source_type public.profile_source_type not null default 'manual',
  external_source text, external_id text,
  imported_at timestamptz, imported_by uuid references public.profiles(id) on update cascade on delete set null,
  validation_status public.validation_status not null default 'validated',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on update cascade on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique nulls not distinct (organization_id, external_source, external_id),
  check ((source_type = 'imported' and imported_at is not null and external_source is not null) or source_type <> 'imported')
);

create table public.competencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on update cascade on delete cascade,
  code text not null check (code ~ '^[a-z0-9_]+$'),
  name text not null, description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, code), unique (organization_id, name)
);

create table public.evaluation_rubrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on update cascade on delete cascade,
  rubric_key uuid not null default gen_random_uuid(),
  name text not null, version integer not null check (version > 0), description text,
  minimum_score numeric(5,2) not null default 60 check (minimum_score between 0 and 100),
  status public.rubric_status not null default 'draft',
  created_by uuid references public.profiles(id) on update cascade on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, rubric_key, version)
);

create table public.rubric_criteria (
  id uuid primary key default gen_random_uuid(),
  rubric_id uuid not null references public.evaluation_rubrics(id) on update cascade on delete cascade,
  competency_id uuid not null references public.competencies(id) on update cascade on delete restrict,
  name text not null, description text not null, scoring_guidance text not null,
  weight numeric(8,4) not null check (weight >= 0), display_order integer not null check (display_order > 0),
  created_at timestamptz not null default now(),
  unique (rubric_id, competency_id), unique (rubric_id, display_order)
);

create table public.training_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on update cascade on delete cascade,
  product_id uuid not null references public.products(id) on update cascade on delete restrict,
  lead_profile_id uuid not null references public.lead_profiles(id) on update cascade on delete restrict,
  evaluation_rubric_id uuid not null references public.evaluation_rubrics(id) on update cascade on delete restrict,
  version integer not null default 1 check (version > 0),
  title text not null, description text not null, conversation_context text not null, training_objective text not null,
  difficulty_level public.difficulty_level not null,
  success_conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(success_conditions) = 'array'),
  failure_conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(failure_conditions) = 'array'),
  maximum_messages integer check (maximum_messages is null or maximum_messages > 0),
  time_limit_minutes integer check (time_limit_minutes is null or time_limit_minutes > 0),
  attempt_limit integer check (attempt_limit is null or attempt_limit > 0),
  system_instructions text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on update cascade on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, title, version)
);

create table public.training_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on update cascade on delete cascade,
  scenario_id uuid not null references public.training_scenarios(id) on update cascade on delete restrict,
  seller_id uuid not null references public.profiles(id) on update cascade on delete restrict,
  manager_id uuid references public.profiles(id) on update cascade on delete set null,
  due_at timestamptz, allowed_attempts integer not null default 1 check (allowed_attempts > 0),
  status public.assignment_status not null default 'assigned', completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((status = 'completed') = (completed_at is not null))
);

create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on update cascade on delete cascade,
  scenario_id uuid not null references public.training_scenarios(id) on update cascade on delete restrict,
  assignment_id uuid references public.training_assignments(id) on update cascade on delete set null,
  seller_id uuid not null references public.profiles(id) on update cascade on delete restrict,
  status public.session_status not null default 'created', started_at timestamptz, completed_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  commercial_outcome public.commercial_outcome, seller_self_assessment text,
  lead_state_snapshot jsonb not null,
  scenario_version_snapshot jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (completed_at is null or started_at is not null),
  check (completed_at is null or completed_at >= started_at),
  check (started_at is null or started_at >= created_at),
  check (status not in ('completed','cancelled','expired','interrupted','technical_failure') or completed_at is not null),
  check (status <> 'in_progress' or (started_at is not null and completed_at is null))
);

create table public.training_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on update cascade on delete cascade,
  session_id uuid not null references public.training_sessions(id) on update cascade on delete cascade,
  sender_type public.message_sender_type not null, content text not null check (length(btrim(content)) > 0),
  sequence_number integer not null check (sequence_number > 0), model_name text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0), output_tokens integer check (output_tokens is null or output_tokens >= 0),
  response_time_ms integer check (response_time_ms is null or response_time_ms >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(), unique (session_id, sequence_number)
);

create table public.session_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on update cascade on delete cascade,
  session_id uuid not null unique references public.training_sessions(id) on update cascade on delete cascade,
  rubric_id uuid not null references public.evaluation_rubrics(id) on update cascade on delete restrict,
  rubric_version integer not null check (rubric_version > 0), overall_score numeric(5,2) not null check (overall_score between 0 and 100),
  commercial_outcome public.commercial_outcome,
  summary text not null,
  strengths jsonb not null default '[]'::jsonb check (jsonb_typeof(strengths) = 'array'),
  improvement_points jsonb not null default '[]'::jsonb check (jsonb_typeof(improvement_points) = 'array'),
  critical_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(critical_errors) = 'array'),
  recommended_actions jsonb not null default '[]'::jsonb check (jsonb_typeof(recommended_actions) = 'array'),
  better_response_example text, model_name text not null, evaluation_prompt_version text not null,
  raw_evaluation jsonb not null check (jsonb_typeof(raw_evaluation) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.evaluation_scores (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references public.session_evaluations(id) on update cascade on delete cascade,
  rubric_criterion_id uuid not null references public.rubric_criteria(id) on update cascade on delete restrict,
  competency_id uuid not null references public.competencies(id) on update cascade on delete restrict,
  criterion_name_snapshot text not null,
  score numeric(5,2) not null check (score between 0 and 100), weight numeric(8,4) not null check (weight >= 0),
  justification text not null,
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  recommendations jsonb not null default '[]'::jsonb check (jsonb_typeof(recommendations) = 'array'),
  created_at timestamptz not null default now(), unique (evaluation_id, rubric_criterion_id)
);

comment on column public.training_sessions.lead_state_snapshot is 'Immutable effective lead persona/configuration used by the simulator; preserves historical meaning.';
comment on column public.training_sessions.scenario_version_snapshot is 'Immutable product, scenario, rubric reference and conditions effective when the session began.';
comment on table public.training_assignments is 'MVP assigns one scenario to one seller. Future team/org targeting should use a separate assignment_targets table.';
comment on column public.training_scenarios.system_instructions is 'Confidential simulator configuration; excluded from seller-facing RLS access.';
comment on column public.session_evaluations.raw_evaluation is 'Trusted backend audit payload; never writable by browser roles.';

commit;
