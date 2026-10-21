begin;

create function public.admin_delete_team_member(member_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare caller_org uuid;
begin
  select organization_id into caller_org from public.profiles
  where id=auth.uid() and is_active and role='admin';
  if caller_org is null then raise exception 'admin required'; end if;
  if member_id=auth.uid() then raise exception 'you cannot delete your own account'; end if;
  if not exists(select 1 from public.profiles where id=member_id and organization_id=caller_org) then
    raise exception 'team member not found';
  end if;
  delete from auth.users where id=member_id;
end $$;

revoke all on function public.admin_delete_team_member(uuid) from public,anon;
grant execute on function public.admin_delete_team_member(uuid) to authenticated;

commit;
