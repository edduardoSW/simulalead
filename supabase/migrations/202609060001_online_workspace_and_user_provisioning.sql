begin;

create table public.workspace_states (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

alter table public.workspace_states enable row level security;
alter table public.workspace_states force row level security;

create policy workspace_states_read on public.workspace_states
for select to authenticated using (public.is_org_member(organization_id));

create policy workspace_states_write on public.workspace_states
for all to authenticated
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id) and updated_by = auth.uid());

create or replace function public.create_team_member_profile(member_id uuid, member_name text, member_role public.user_role)
returns void language plpgsql security definer set search_path='' as $$
declare caller_org uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select organization_id into caller_org from public.profiles
    where id=auth.uid() and is_active and role='admin';
  if caller_org is null then raise exception 'admin required'; end if;
  if member_role not in ('admin','manager','seller') then raise exception 'invalid role'; end if;
  insert into public.profiles(id,organization_id,full_name,role)
  values(member_id,caller_org,btrim(member_name),member_role);
end $$;

revoke all on function public.create_team_member_profile(uuid,text,public.user_role) from public,anon;
grant execute on function public.create_team_member_profile(uuid,text,public.user_role) to authenticated;

commit;
