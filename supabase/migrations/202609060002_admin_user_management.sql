begin;

alter table public.profiles add column email text;
update public.profiles p set email=lower(u.email) from auth.users u where u.id=p.id;
alter table public.profiles add constraint profiles_email_lowercase check(email is null or email=lower(email));
create unique index profiles_org_email_unique on public.profiles(organization_id,email) where email is not null;

drop function if exists public.create_team_member_profile(uuid,text,public.user_role);
create function public.create_team_member_profile(member_id uuid,member_name text,member_email text,member_role public.user_role)
returns void language plpgsql security definer set search_path='' as $$
declare caller_org uuid;
begin
  select organization_id into caller_org from public.profiles where id=auth.uid() and is_active and role='admin';
  if caller_org is null then raise exception 'admin required'; end if;
  if member_role not in ('admin','manager','seller') then raise exception 'invalid role'; end if;
  insert into public.profiles(id,organization_id,full_name,email,role)
  values(member_id,caller_org,btrim(member_name),lower(btrim(member_email)),member_role);
end $$;
revoke all on function public.create_team_member_profile(uuid,text,text,public.user_role) from public,anon;
grant execute on function public.create_team_member_profile(uuid,text,text,public.user_role) to authenticated;

create function public.admin_manage_team_member(member_id uuid,member_role public.user_role,member_active boolean)
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
end $$;
revoke all on function public.admin_manage_team_member(uuid,public.user_role,boolean) from public,anon;
grant execute on function public.admin_manage_team_member(uuid,public.user_role,boolean) to authenticated;

commit;
