begin;

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;

comment on function public.set_updated_at() is 'Security-invoker trigger; clients cannot choose updated_at.';

do $$
declare t text;
begin
  foreach t in array array['organizations','profiles','products','lead_profiles','competencies','evaluation_rubrics','training_scenarios','training_assignments','training_sessions','session_evaluations'] loop
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.organization_id from public.profiles p where p.id = auth.uid() and p.is_active;
$$;

create or replace function public.current_user_role()
returns public.user_role language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active;
$$;

create or replace function public.is_org_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target_organization_id = public.current_organization_id();
$$;

create or replace function public.has_role(allowed_roles public.user_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_role() = any(allowed_roles), false);
$$;

revoke all on function public.current_organization_id() from public;
revoke all on function public.current_user_role() from public;
revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_role(public.user_role[]) from public;
grant execute on function public.current_organization_id(), public.current_user_role(), public.is_org_member(uuid), public.has_role(public.user_role[]) to authenticated;

comment on function public.current_organization_id() is 'SECURITY DEFINER avoids recursive profiles RLS; fixed empty search_path and no arguments prevent privilege escalation.';

create or replace function public.guard_profile_security_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.organization_id is distinct from new.organization_id or old.role is distinct from new.role then
    if auth.uid() = old.id or not public.has_role(array['admin']::public.user_role[]) or old.organization_id <> public.current_organization_id() then
      raise exception 'organization_id and role may only be changed by another administrator in the same organization';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_profile_security_fields before update on public.profiles for each row execute function public.guard_profile_security_fields();
revoke all on function public.guard_profile_security_fields() from public, anon, authenticated;

create or replace function public.validate_tenant_references()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'products' and new.created_by is not null and not exists (select 1 from public.profiles p where p.id=new.created_by and p.organization_id=new.organization_id) then raise exception 'cross-organization created_by'; end if;
  if tg_table_name = 'lead_profiles' then
    if new.created_by is not null and not exists (select 1 from public.profiles p where p.id=new.created_by and p.organization_id=new.organization_id) then raise exception 'cross-organization created_by'; end if;
    if new.imported_by is not null and not exists (select 1 from public.profiles p where p.id=new.imported_by and p.organization_id=new.organization_id) then raise exception 'cross-organization imported_by'; end if;
  end if;
  if tg_table_name = 'evaluation_rubrics' and new.created_by is not null and not exists (select 1 from public.profiles p where p.id=new.created_by and p.organization_id=new.organization_id) then raise exception 'cross-organization created_by'; end if;
  if tg_table_name = 'training_scenarios' then
    if not exists (select 1 from public.products x where x.id=new.product_id and x.organization_id=new.organization_id) then raise exception 'cross-organization product'; end if;
    if not exists (select 1 from public.lead_profiles x where x.id=new.lead_profile_id and x.organization_id=new.organization_id) then raise exception 'cross-organization lead profile'; end if;
    if not exists (select 1 from public.evaluation_rubrics x where x.id=new.evaluation_rubric_id and x.organization_id=new.organization_id) then raise exception 'cross-organization rubric'; end if;
    if new.created_by is not null and not exists (select 1 from public.profiles x where x.id=new.created_by and x.organization_id=new.organization_id) then raise exception 'cross-organization creator'; end if;
  end if;
  if tg_table_name = 'training_assignments' then
    if not exists (select 1 from public.training_scenarios x where x.id=new.scenario_id and x.organization_id=new.organization_id) then raise exception 'cross-organization scenario'; end if;
    if not exists (select 1 from public.profiles x where x.id=new.seller_id and x.organization_id=new.organization_id and x.role='seller') then raise exception 'seller must belong to organization'; end if;
    if new.manager_id is not null and not exists (select 1 from public.profiles x where x.id=new.manager_id and x.organization_id=new.organization_id and x.role in ('admin','manager')) then raise exception 'manager must belong to organization'; end if;
  end if;
  if tg_table_name = 'training_sessions' then
    if not exists (select 1 from public.training_scenarios x where x.id=new.scenario_id and x.organization_id=new.organization_id) then raise exception 'cross-organization scenario'; end if;
    if not exists (select 1 from public.profiles x where x.id=new.seller_id and x.organization_id=new.organization_id and x.role='seller') then raise exception 'seller must belong to organization'; end if;
    if new.assignment_id is not null and not exists (select 1 from public.training_assignments x where x.id=new.assignment_id and x.organization_id=new.organization_id and x.scenario_id=new.scenario_id and x.seller_id=new.seller_id) then raise exception 'assignment does not match session'; end if;
  end if;
  if tg_table_name = 'training_messages' and not exists (select 1 from public.training_sessions x where x.id=new.session_id and x.organization_id=new.organization_id) then raise exception 'cross-organization session'; end if;
  if tg_table_name = 'session_evaluations' then
    if not exists (select 1 from public.training_sessions x where x.id=new.session_id and x.organization_id=new.organization_id) then raise exception 'cross-organization session'; end if;
    if not exists (select 1 from public.evaluation_rubrics x where x.id=new.rubric_id and x.organization_id=new.organization_id and x.version=new.rubric_version) then raise exception 'rubric/version mismatch'; end if;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['products','lead_profiles','evaluation_rubrics','training_scenarios','training_assignments','training_sessions','training_messages','session_evaluations'] loop
    execute format('create trigger validate_%I_tenant before insert or update on public.%I for each row execute function public.validate_tenant_references()', t, t);
  end loop;
end $$;
revoke all on function public.validate_tenant_references() from public, anon, authenticated;

create or replace function public.validate_rubric_criterion_tenant()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.evaluation_rubrics r join public.competencies c on c.id=new.competency_id and c.organization_id=r.organization_id where r.id=new.rubric_id) then raise exception 'rubric and competency must share organization'; end if;
  return new;
end $$;
create trigger validate_rubric_criterion_tenant before insert or update on public.rubric_criteria for each row execute function public.validate_rubric_criterion_tenant();
revoke all on function public.validate_rubric_criterion_tenant() from public, anon, authenticated;

create or replace function public.validate_evaluation_score()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.session_evaluations e join public.rubric_criteria rc on rc.id=new.criterion_id and rc.rubric_id=e.rubric_id where e.id=new.evaluation_id and rc.competency_id=new.competency_id) then raise exception 'criterion does not belong to evaluation rubric'; end if;
  return new;
end $$;
-- Correct column name is rubric_criterion_id; keep trigger logic explicit.
create or replace function public.validate_evaluation_score()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from public.session_evaluations e join public.rubric_criteria rc on rc.id=new.rubric_criterion_id and rc.rubric_id=e.rubric_id where e.id=new.evaluation_id and rc.competency_id=new.competency_id) then raise exception 'criterion does not belong to evaluation rubric'; end if;
  return new;
end $$;
create trigger validate_evaluation_score before insert or update on public.evaluation_scores for each row execute function public.validate_evaluation_score();
revoke all on function public.validate_evaluation_score() from public, anon, authenticated;

create index profiles_organization_role_idx on public.profiles (organization_id, role) where is_active;
create index products_org_active_idx on public.products (organization_id, is_active);
create index lead_profiles_org_difficulty_idx on public.lead_profiles (organization_id, difficulty_level) where is_active;
create index competencies_org_active_idx on public.competencies (organization_id, is_active);
create index rubrics_org_status_idx on public.evaluation_rubrics (organization_id, status, created_at desc);
create index rubric_criteria_rubric_idx on public.rubric_criteria (rubric_id, display_order);
create index scenarios_org_active_idx on public.training_scenarios (organization_id, is_active, difficulty_level);
create index assignments_seller_status_idx on public.training_assignments (seller_id, status, due_at);
create index assignments_org_scenario_idx on public.training_assignments (organization_id, scenario_id, status);
create index sessions_seller_period_idx on public.training_sessions (seller_id, created_at desc);
create index sessions_org_status_period_idx on public.training_sessions (organization_id, status, created_at desc);
create index sessions_scenario_period_idx on public.training_sessions (scenario_id, created_at desc);
create index messages_session_time_idx on public.training_messages (session_id, created_at);
create index evaluations_org_period_idx on public.session_evaluations (organization_id, created_at desc);
create index evaluation_scores_evaluation_idx on public.evaluation_scores (evaluation_id);

do $$ declare t text; begin
  foreach t in array array['organizations','profiles','products','lead_profiles','competencies','evaluation_rubrics','rubric_criteria','training_scenarios','training_assignments','training_sessions','training_messages','session_evaluations','evaluation_scores'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

create policy organizations_read on public.organizations for select to authenticated using (public.is_org_member(id));
create policy organizations_admin_update on public.organizations for update to authenticated using (public.is_org_member(id) and public.has_role(array['admin']::public.user_role[])) with check (public.is_org_member(id) and public.has_role(array['admin']::public.user_role[]));

create policy profiles_read on public.profiles for select to authenticated using (public.is_org_member(organization_id) and (id=auth.uid() or public.has_role(array['admin','manager']::public.user_role[])));
create policy profiles_admin_insert on public.profiles for insert to authenticated with check (public.is_org_member(organization_id) and public.has_role(array['admin']::public.user_role[]));
create policy profiles_update on public.profiles for update to authenticated using (public.is_org_member(organization_id) and (id=auth.uid() or public.has_role(array['admin']::public.user_role[]))) with check (public.is_org_member(organization_id));

do $$ declare t text; begin
  foreach t in array array['products','lead_profiles','competencies','evaluation_rubrics'] loop
    execute format('create policy %I_org_read on public.%I for select to authenticated using (public.is_org_member(organization_id))', t, t);
    execute format('create policy %I_admin_write on public.%I for all to authenticated using (public.is_org_member(organization_id) and public.has_role(array[''admin'']::public.user_role[])) with check (public.is_org_member(organization_id) and public.has_role(array[''admin'']::public.user_role[]))', t, t);
  end loop;
end $$;

create policy rubric_criteria_read on public.rubric_criteria for select to authenticated using (exists (select 1 from public.evaluation_rubrics r where r.id=rubric_id and public.is_org_member(r.organization_id)));
create policy rubric_criteria_admin_write on public.rubric_criteria for all to authenticated using (exists (select 1 from public.evaluation_rubrics r where r.id=rubric_id and public.is_org_member(r.organization_id)) and public.has_role(array['admin']::public.user_role[])) with check (exists (select 1 from public.evaluation_rubrics r where r.id=rubric_id and public.is_org_member(r.organization_id)) and public.has_role(array['admin']::public.user_role[]));

create policy scenarios_staff_read on public.training_scenarios for select to authenticated using (public.is_org_member(organization_id) and public.has_role(array['admin','manager']::public.user_role[]));
create policy scenarios_staff_write on public.training_scenarios for all to authenticated using (public.is_org_member(organization_id) and public.has_role(array['admin','manager']::public.user_role[])) with check (public.is_org_member(organization_id) and public.has_role(array['admin','manager']::public.user_role[]));

create policy assignments_read on public.training_assignments for select to authenticated using (public.is_org_member(organization_id) and (seller_id=auth.uid() or public.has_role(array['admin','manager']::public.user_role[])));
create policy assignments_staff_write on public.training_assignments for all to authenticated using (public.is_org_member(organization_id) and public.has_role(array['admin','manager']::public.user_role[])) with check (public.is_org_member(organization_id) and public.has_role(array['admin','manager']::public.user_role[]));

create policy sessions_read on public.training_sessions for select to authenticated using (public.is_org_member(organization_id) and (seller_id=auth.uid() or public.has_role(array['admin','manager']::public.user_role[])));
create policy sessions_seller_insert on public.training_sessions for insert to authenticated with check (public.is_org_member(organization_id) and seller_id=auth.uid() and status='created' and (assignment_id is null or exists (select 1 from public.training_assignments a where a.id=assignment_id and a.seller_id=auth.uid() and a.status in ('assigned','in_progress'))));
create policy sessions_seller_update on public.training_sessions for update to authenticated using (seller_id=auth.uid() and public.is_org_member(organization_id) and status in ('created','in_progress')) with check (seller_id=auth.uid() and public.is_org_member(organization_id));

create policy messages_read on public.training_messages for select to authenticated using (exists (select 1 from public.training_sessions s where s.id=session_id and (s.seller_id=auth.uid() or public.has_role(array['admin','manager']::public.user_role[]))));
create policy messages_seller_insert on public.training_messages for insert to authenticated with check (sender_type='seller' and organization_id=public.current_organization_id() and exists (select 1 from public.training_sessions s where s.id=session_id and s.seller_id=auth.uid() and s.organization_id=organization_id and s.status='in_progress'));

create policy evaluations_read on public.session_evaluations for select to authenticated using (public.is_org_member(organization_id) and exists (select 1 from public.training_sessions s where s.id=session_id and (s.seller_id=auth.uid() or public.has_role(array['admin','manager']::public.user_role[]))));
create policy scores_read on public.evaluation_scores for select to authenticated using (exists (select 1 from public.session_evaluations e join public.training_sessions s on s.id=e.session_id where e.id=evaluation_id and public.is_org_member(e.organization_id) and (s.seller_id=auth.uid() or public.has_role(array['admin','manager']::public.user_role[]))));

-- Deliberately no INSERT/UPDATE policies for lead/system messages or evaluations.
-- A trusted backend using service_role owns those future writes.

create view public.seller_training_catalog with (security_barrier=true) as
select a.id assignment_id, a.seller_id, a.due_at, a.allowed_attempts, a.status assignment_status,
       s.id scenario_id, s.title, s.description, s.training_objective, s.difficulty_level,
       s.maximum_messages, s.time_limit_minutes, s.attempt_limit,
       p.name product_name, p.description product_description, p.value_proposition
from public.training_assignments a
join public.training_scenarios s on s.id=a.scenario_id and s.organization_id=a.organization_id
join public.products p on p.id=s.product_id and p.organization_id=a.organization_id
where a.seller_id=auth.uid() and a.organization_id=public.current_organization_id() and s.is_active;

revoke all on public.seller_training_catalog from public, anon;
grant select on public.seller_training_catalog to authenticated;
comment on view public.seller_training_catalog is 'Safe seller catalog; excludes system instructions, hidden lead data, rubric internals and snapshots.';

commit;
