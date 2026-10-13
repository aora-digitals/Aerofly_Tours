-- Atomic privileged RBAC operations. Uses auth.uid() so actor identity is verified in Postgres.
begin;

create or replace function public.admin_assign_user_role(
  p_user_id uuid,
  p_role_key text,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.roles%rowtype;
  v_assignment public.user_roles%rowtype;
begin
  if v_actor is null or not public.has_permission('roles.manage', p_organization_id) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if p_user_id is null or p_role_key is null then
    raise exception 'User and role are required' using errcode = '22023';
  end if;
  if p_role_key = 'customer' then
    raise exception 'Customer role is assigned by the identity lifecycle and cannot be assigned here' using errcode = '42501';
  end if;
  if p_role_key in ('owner','admin') and not public.has_role('owner', v_actor) then
    raise exception 'Only an owner may assign owner or administrator roles' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('aerofly:admin-role-assignments'));
  select * into v_role from public.roles where key = p_role_key;
  if not found then raise exception 'Role does not exist' using errcode = '22023'; end if;
  if not exists (
    select 1 from public.organization_memberships om
    where om.user_id = p_user_id and om.status = 'active'
      and (p_organization_id is null or om.organization_id = p_organization_id)
  ) then
    raise exception 'Target must have an active employee membership in the selected organization' using errcode = '23514';
  end if;
  -- An employee identity cannot simultaneously retain the customer role.
  delete from public.user_roles customer_assignment
  using public.roles customer_role
  where customer_assignment.role_id = customer_role.id
    and customer_role.key = 'customer'
    and customer_assignment.user_id = p_user_id;
  insert into public.user_roles(user_id, role_id, organization_id)
  values (p_user_id, v_role.id, p_organization_id)
  on conflict do nothing;
  select * into v_assignment from public.user_roles ur
  where ur.user_id = p_user_id and ur.role_id = v_role.id
    and ur.organization_id is not distinct from p_organization_id
  limit 1;
  return jsonb_build_object('id',v_assignment.id,'user_id',v_assignment.user_id,'role_id',v_assignment.role_id,'organization_id',v_assignment.organization_id,'role_key',v_role.key);
end;
$$;

create or replace function public.admin_remove_user_role(
  p_user_id uuid,
  p_role_key text,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.roles%rowtype;
  v_remaining bigint;
begin
  if v_actor is null or not public.has_permission('roles.manage', p_organization_id) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if p_role_key = 'customer' then
    raise exception 'Customer role cannot be removed through employee role administration' using errcode = '42501';
  end if;
  if p_role_key in ('owner','admin') and not public.has_role('owner', v_actor) then
    raise exception 'Only an owner may remove owner or administrator roles' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('aerofly:admin-role-assignments'));
  select * into v_role from public.roles where key = p_role_key;
  if not found then raise exception 'Role does not exist' using errcode = '22023'; end if;
  if p_role_key in ('owner','admin') then
    select count(*) into v_remaining
    from public.user_roles ur join public.roles r on r.id=ur.role_id
    where r.key in ('owner','admin')
      and (p_organization_id is null or ur.organization_id is null or ur.organization_id=p_organization_id)
      and ur.user_id <> p_user_id
      and exists (
        select 1 from public.organization_memberships om
        where om.user_id=ur.user_id and om.status='active'
          and (p_organization_id is null or om.organization_id=p_organization_id)
      );
    if v_remaining = 0 then
      raise exception 'Cannot remove the last active administrator for this scope' using errcode = '23514';
    end if;
  end if;
  delete from public.user_roles ur
  where ur.user_id=p_user_id and ur.role_id=v_role.id
    and ur.organization_id is not distinct from p_organization_id;
  return jsonb_build_object('removed',true,'user_id',p_user_id,'role_key',p_role_key,'organization_id',p_organization_id);
end;
$$;

create or replace function public.admin_set_role_permission(
  p_role_key text,
  p_permission_key text,
  p_grant boolean,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.roles%rowtype;
  v_permission public.permissions%rowtype;
  v_sensitive boolean;
begin
  if v_actor is null or not public.has_permission('roles.manage', p_organization_id) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if p_role_key = 'customer' then
    raise exception 'Customer permissions cannot be edited through the admin ERP' using errcode = '42501';
  end if;
  v_sensitive := p_role_key in ('owner','admin') or p_permission_key in (
    'roles.manage','organization.manage','employees.manage','settings.manage',
    'finance.manage','refunds.manage','audit.read','finance.read','settings.read'
  );
  if v_sensitive and not public.has_role('owner', v_actor) then
    raise exception 'Only an owner may change sensitive role permissions' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('role-permission:' || p_role_key));
  select * into v_role from public.roles where key=p_role_key;
  if not found then raise exception 'Role does not exist' using errcode = '22023'; end if;
  select * into v_permission from public.permissions where key=p_permission_key;
  if not found then raise exception 'Permission does not exist' using errcode = '22023'; end if;
  if p_grant then
    insert into public.role_permissions(role_id,permission_id)
    values(v_role.id,v_permission.id) on conflict do nothing;
  else
    delete from public.role_permissions where role_id=v_role.id and permission_id=v_permission.id;
  end if;
  return jsonb_build_object('role_key',p_role_key,'permission_key',p_permission_key,'granted',p_grant);
end;
$$;

revoke all on function public.admin_assign_user_role(uuid,text,uuid) from public, anon;
revoke all on function public.admin_remove_user_role(uuid,text,uuid) from public, anon;
revoke all on function public.admin_set_role_permission(text,text,boolean,uuid) from public, anon;
grant execute on function public.admin_assign_user_role(uuid,text,uuid) to authenticated;
grant execute on function public.admin_remove_user_role(uuid,text,uuid) to authenticated;
grant execute on function public.admin_set_role_permission(text,text,boolean,uuid) to authenticated;


create or replace function public.admin_set_membership(
  p_user_id uuid,
  p_organization_id uuid,
  p_department_id uuid,
  p_status text,
  p_job_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_is_admin boolean;
  v_remaining bigint;
  v_row public.organization_memberships%rowtype;
begin
  if v_actor is null or not public.has_permission('employees.manage', p_organization_id) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if p_user_id is null or p_organization_id is null or p_status not in ('active','inactive','invited') then
    raise exception 'Invalid membership arguments' using errcode = '22023';
  end if;
  if p_department_id is not null and not exists (
    select 1 from public.departments d where d.id=p_department_id and d.organization_id=p_organization_id
  ) then
    raise exception 'Department does not belong to the organization' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtext('aerofly:admin-role-assignments'));
  select exists (
    select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
    where ur.user_id=p_user_id and r.key in ('owner','admin')
      and (ur.organization_id is null or ur.organization_id=p_organization_id)
  ) into v_is_admin;
  if p_status <> 'active' and v_is_admin then
    select count(distinct om.user_id) into v_remaining
    from public.organization_memberships om
    join public.user_roles ur on ur.user_id=om.user_id
    join public.roles r on r.id=ur.role_id
    where om.organization_id=p_organization_id and om.status='active'
      and om.user_id <> p_user_id and r.key in ('owner','admin')
      and (ur.organization_id is null or ur.organization_id=p_organization_id);
    if v_remaining=0 then
      raise exception 'Cannot deactivate the last active administrator in this organization' using errcode = '23514';
    end if;
  end if;
  insert into public.organization_memberships(user_id,organization_id,department_id,status,job_title,updated_by,deactivated_at)
  values(p_user_id,p_organization_id,p_department_id,p_status,nullif(trim(p_job_title),''),v_actor,
    case when p_status='active' then null else now() end)
  on conflict(user_id,organization_id) do update set
    department_id=excluded.department_id,
    status=excluded.status,
    job_title=excluded.job_title,
    updated_by=v_actor,
    deactivated_at=excluded.deactivated_at,
    updated_at=now()
  returning * into v_row;
  if p_status <> 'active' then
    update public.departments set manager_user_id=null
    where organization_id=p_organization_id and manager_user_id=p_user_id;
    update public.organization_memberships set reports_to_user_id=null, updated_by=v_actor, updated_at=now()
    where organization_id=p_organization_id and reports_to_user_id=p_user_id;
  end if;
  return jsonb_build_object(
    'user_id',v_row.user_id,'organization_id',v_row.organization_id,
    'department_id',v_row.department_id,'status',v_row.status,'job_title',v_row.job_title,
    'employee_code',v_row.employee_code,'employment_type',v_row.employment_type,
    'reports_to_user_id',v_row.reports_to_user_id,'joined_at',v_row.joined_at
  );
end;
$$;

revoke all on function public.admin_set_membership(uuid,uuid,uuid,text,text) from public, anon;
grant execute on function public.admin_set_membership(uuid,uuid,uuid,text,text) to authenticated;

commit;
