begin;

alter table public.workspace_states
  add column if not exists version bigint not null default 1 check (version > 0);

alter table public.user_simulations
  add column if not exists version bigint not null default 1 check (version > 0);

create or replace function public.validate_workspace_state_tenant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.updated_by and p.organization_id = new.organization_id
  ) then raise exception 'workspace editor must belong to organization'; end if;
  return new;
end;
$$;

drop trigger if exists validate_workspace_state_tenant on public.workspace_states;
create trigger validate_workspace_state_tenant
before insert or update on public.workspace_states
for each row execute function public.validate_workspace_state_tenant();
revoke all on function public.validate_workspace_state_tenant() from public, anon, authenticated;

create or replace function public.validate_simulation_tenant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.seller_id and p.organization_id = new.organization_id
  ) then raise exception 'simulation owner must belong to organization'; end if;
  return new;
end;
$$;

drop trigger if exists validate_user_simulation_tenant on public.user_simulations;
create trigger validate_user_simulation_tenant
before insert or update on public.user_simulations
for each row execute function public.validate_simulation_tenant();

drop trigger if exists validate_generation_tenant on public.simulation_generations;
create trigger validate_generation_tenant
before insert or update on public.simulation_generations
for each row execute function public.validate_simulation_tenant();
revoke all on function public.validate_simulation_tenant() from public, anon, authenticated;

create or replace function public.bump_user_simulation_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

drop trigger if exists bump_user_simulation_version on public.user_simulations;
create trigger bump_user_simulation_version
before update on public.user_simulations
for each row execute function public.bump_user_simulation_version();
revoke all on function public.bump_user_simulation_version() from public, anon, authenticated;

create or replace function public.save_workspace_and_simulations(
  requested_workspace_payload jsonb,
  requested_conversations jsonb,
  requested_conversation_versions jsonb,
  expected_workspace_version bigint
)
returns table (workspace_version bigint, workspace_updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  caller_org uuid;
  current_version bigint;
  current_payload jsonb;
  current_conversation_version bigint;
  expected_conversation_version bigint;
  next_version bigint;
  saved_at timestamptz := clock_timestamp();
  conversation jsonb;
  conversation_id text;
  conversation_ids text[] := array[]::text[];
begin
  select p.organization_id into caller_org
  from public.profiles p
  where p.id = auth.uid() and p.is_active;

  if caller_org is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(requested_workspace_payload) <> 'object' then raise exception 'workspace payload must be an object'; end if;
  if jsonb_typeof(requested_conversations) <> 'array' then raise exception 'conversations payload must be an array'; end if;
  if jsonb_typeof(requested_conversation_versions) <> 'object' then raise exception 'conversation versions must be an object'; end if;
  if expected_workspace_version is null or expected_workspace_version < 0 then raise exception 'invalid workspace version'; end if;

  select w.version, w.payload into current_version, current_payload
  from public.workspace_states w
  where w.organization_id = caller_org
  for update;

  if found then
    if current_payload is distinct from requested_workspace_payload and current_version <> expected_workspace_version then
      raise exception using errcode = '40001', message = 'workspace changed by another user; reload before saving';
    end if;
    if current_payload is distinct from requested_workspace_payload then
      next_version := current_version + 1;
      update public.workspace_states w
      set payload = requested_workspace_payload,
          updated_by = auth.uid(),
          updated_at = saved_at,
          version = next_version
      where w.organization_id = caller_org;
    else
      next_version := current_version;
    end if;
  else
    if expected_workspace_version <> 0 then
      raise exception using errcode = '40001', message = 'workspace state no longer matches the loaded version';
    end if;
    next_version := 1;
    insert into public.workspace_states(organization_id, payload, updated_by, updated_at, version)
    values(caller_org, requested_workspace_payload, auth.uid(), saved_at, next_version);
  end if;

  for conversation in select value from jsonb_array_elements(requested_conversations)
  loop
    if jsonb_typeof(conversation) <> 'object' then raise exception 'conversation must be an object'; end if;
    conversation_id := nullif(btrim(conversation->>'id'), '');
    if conversation_id is null or length(conversation_id) > 160 or conversation_id !~ '^[A-Za-z0-9:_-]+$'
    then raise exception 'invalid conversation id'; end if;
    if conversation_id = any(conversation_ids) then raise exception 'duplicate conversation id'; end if;
    conversation_ids := array_append(conversation_ids, conversation_id);

    begin
      expected_conversation_version := coalesce((requested_conversation_versions->>conversation_id)::bigint, 0);
    exception when invalid_text_representation then
      raise exception 'invalid conversation version';
    end;

    select s.version into current_conversation_version
    from public.user_simulations s
    where s.seller_id = auth.uid() and s.conversation_id = conversation_id
    for update;

    if found and current_conversation_version <> expected_conversation_version then
      raise exception using errcode = '40001', message = 'conversation changed while it was being edited';
    elsif not found and expected_conversation_version <> 0 then
      raise exception using errcode = '40001', message = 'conversation state no longer matches the loaded version';
    end if;

    insert into public.user_simulations(organization_id, seller_id, conversation_id, payload, updated_at)
    values(
      caller_org,
      auth.uid(),
      conversation_id,
      jsonb_set(conversation, '{sellerId}', to_jsonb(auth.uid()::text), true),
      saved_at
    )
    on conflict (seller_id, conversation_id) do update
    set organization_id = excluded.organization_id,
        payload = excluded.payload,
        updated_at = excluded.updated_at;
  end loop;

  if exists (
    select 1 from public.user_simulations s
    where s.seller_id = auth.uid()
      and s.organization_id = caller_org
      and not (s.conversation_id = any(conversation_ids))
      and (
        not (requested_conversation_versions ? s.conversation_id)
        or (requested_conversation_versions->>s.conversation_id)::bigint <> s.version
      )
  ) then
    raise exception using errcode = '40001', message = 'conversation changed before it could be deleted';
  end if;

  delete from public.user_simulations s
  where s.seller_id = auth.uid()
    and s.organization_id = caller_org
    and not (s.conversation_id = any(conversation_ids));

  return query select next_version, saved_at;
end;
$$;

revoke all on function public.save_workspace_and_simulations(jsonb,jsonb,jsonb,bigint) from public, anon;
grant execute on function public.save_workspace_and_simulations(jsonb,jsonb,jsonb,bigint) to authenticated;

revoke all on public.workspace_states, public.user_simulations, public.simulation_generations from authenticated;
grant select on public.workspace_states, public.user_simulations, public.simulation_generations to authenticated;

revoke execute on function public.create_team_member_profile(uuid,text,text,public.user_role) from authenticated;

create table if not exists public.organization_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (length(event_type) between 3 and 120),
  target_user_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists organization_audit_events_org_time_idx
  on public.organization_audit_events(organization_id, created_at desc);

alter table public.organization_audit_events enable row level security;
alter table public.organization_audit_events force row level security;
revoke all on public.organization_audit_events from public, anon, authenticated;
grant select on public.organization_audit_events to authenticated;

create policy organization_audit_events_admin_read
on public.organization_audit_events for select to authenticated
using (public.is_org_member(organization_id) and public.has_role(array['admin']::public.user_role[]));

create or replace function public.admin_manage_team_member(
  member_id uuid,
  member_role public.user_role,
  member_active boolean
)
returns void language plpgsql security definer set search_path='' as $$
declare caller_org uuid;
begin
  select organization_id into caller_org from public.profiles where id=auth.uid() and is_active and role='admin';
  if caller_org is null then raise exception 'admin required'; end if;
  if member_id=auth.uid() then raise exception 'you cannot change your own access'; end if;
  if member_role not in ('admin','manager','seller') then raise exception 'invalid role'; end if;
  update public.profiles set role=member_role,is_active=member_active,updated_at=now()
  where id=member_id and organization_id=caller_org;
  if not found then raise exception 'team member not found'; end if;
  insert into public.organization_audit_events(organization_id,actor_id,event_type,target_user_id,metadata)
  values(caller_org,auth.uid(),'team_member.access_changed',member_id,jsonb_build_object('role',member_role,'active',member_active));
end $$;

create or replace function public.admin_delete_team_member(member_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare caller_org uuid;
begin
  select organization_id into caller_org from public.profiles where id=auth.uid() and is_active and role='admin';
  if caller_org is null then raise exception 'admin required'; end if;
  if member_id=auth.uid() then raise exception 'you cannot delete your own account'; end if;
  if not exists(select 1 from public.profiles where id=member_id and organization_id=caller_org) then
    raise exception 'team member not found';
  end if;
  insert into public.organization_audit_events(organization_id,actor_id,event_type,target_user_id)
  values(caller_org,auth.uid(),'team_member.deleted',member_id);
  delete from auth.users where id=member_id;
end $$;

revoke all on function public.admin_manage_team_member(uuid,public.user_role,boolean) from public,anon;
revoke all on function public.admin_delete_team_member(uuid) from public,anon;
grant execute on function public.admin_manage_team_member(uuid,public.user_role,boolean) to authenticated;
grant execute on function public.admin_delete_team_member(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
