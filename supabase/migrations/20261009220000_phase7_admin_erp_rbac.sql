-- AeroFly Tours Phase 7 — Admin ERP, organization, RBAC and audit foundation.
-- Reuses Phase 1 organizations/departments/organization_memberships/roles/permissions
-- and Phase 4 CRM audit structures. Apply after all Phase 0–6 migrations.
begin;

-- 1. Extend existing membership records into an employee directory.
alter table public.organization_memberships
  add column if not exists employee_code text,
  add column if not exists employment_type text not null default 'employee',
  add column if not exists reports_to_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists joined_at date,
  add column if not exists deactivated_at timestamptz,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

alter table public.organization_memberships
  drop constraint if exists organization_memberships_employment_type_check;
alter table public.organization_memberships
  add constraint organization_memberships_employment_type_check
  check (employment_type in ('employee','contractor','intern','director'));

alter table public.organization_memberships
  drop constraint if exists organization_memberships_employee_code_check;
alter table public.organization_memberships
  add constraint organization_memberships_employee_code_check
  check (employee_code is null or length(trim(employee_code)) between 1 and 64);

create index if not exists organization_memberships_reports_to_idx
  on public.organization_memberships(reports_to_user_id)
  where reports_to_user_id is not null;
create unique index if not exists organization_memberships_employee_code_uidx
  on public.organization_memberships(organization_id, employee_code)
  where employee_code is not null;

-- Department manager/head reuses the existing profiles identity.
alter table public.departments
  add column if not exists manager_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists is_active boolean not null default true;

create index if not exists departments_manager_idx
  on public.departments(manager_user_id) where manager_user_id is not null;

-- 2. Add permission keys to the existing permissions catalogue.
insert into public.permissions(key, description) values
 ('admin.dashboard.read', 'View the administrative dashboard'),
 ('organization.read', 'View organization and department records'),
 ('organization.manage', 'Create and update organizations and departments'),
 ('employees.read', 'View employee directory and assignments'),
 ('employees.manage', 'Manage employee records and department assignments'),
 ('roles.read', 'View roles and permission assignments'),
 ('roles.manage', 'Assign roles and manage role permissions'),
 ('audit.read', 'Read administrative audit events'),
 ('settings.read', 'Read organization and business settings'),
 ('settings.manage', 'Manage organization and business settings'),
 ('departures.read', 'View tour departure operations'),
 ('departures.manage', 'Manage tour departures'),
 ('enquiries.read', 'Read CRM enquiries'),
 ('enquiries.manage', 'Manage CRM enquiries'),
 ('finance.read', 'Read finance records and financial summaries'),
 ('reports.read', 'Read operational and financial reports')
on conflict (key) do update set description = excluded.description;

-- Owner/admin receive the full catalogue; managers receive operational access only.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key in ('owner','admin')
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in (
 'admin.dashboard.read','organization.read','employees.read',
 'departures.read','enquiries.read','finance.read','reports.read',
 'customers.read','tours.read','bookings.read','payments.read'
)
where r.key = 'manager'
on conflict do nothing;

-- 3. Permission helper is derived from database role assignments, never JWT/client role text.
create or replace function public.has_permission(
  requested_permission text,
  requested_organization uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid()
      and p.key = requested_permission
      and (
        requested_organization is null
        or ur.organization_id is null
        or ur.organization_id = requested_organization
      )
      and (
        r.key = 'customer'
        or exists (
          select 1 from public.organization_memberships om
          where om.user_id = ur.user_id
            and om.status = 'active'
            and (ur.organization_id is null or om.organization_id = ur.organization_id)
            and (requested_organization is null or om.organization_id = requested_organization)
        )
      )
  );
$$;
revoke all on function public.has_permission(text, uuid) from public;
grant execute on function public.has_permission(text, uuid) to authenticated;

-- Enforce active organization membership in the shared legacy role helpers too.
-- This closes the gap where an inactive employee retained a role assignment.
create or replace function public.has_role(
  requested_role text,
  requested_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = requested_user
      and r.key = requested_role
      and (
        r.key = 'customer'
        or exists (
          select 1 from public.organization_memberships om
          where om.user_id = ur.user_id and om.status = 'active'
            and (ur.organization_id is null or om.organization_id = ur.organization_id)
        )
      )
  );
$$;

create or replace function public.has_any_role(
  requested_roles text[],
  requested_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = requested_user
      and r.key = any(requested_roles)
      and (
        r.key = 'customer'
        or exists (
          select 1 from public.organization_memberships om
          where om.user_id = ur.user_id and om.status = 'active'
            and (ur.organization_id is null or om.organization_id = ur.organization_id)
        )
      )
  );
$$;

-- 4. Dedicated append-only administrative audit log; do not overload the CRM enum.
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint admin_audit_action_nonblank check (length(trim(action)) > 0),
  constraint admin_audit_entity_nonblank check (length(trim(entity_type)) > 0 and length(trim(entity_id)) > 0),
  constraint admin_audit_metadata_object check (jsonb_typeof(metadata) = 'object')
);
create index if not exists admin_audit_created_idx on public.admin_audit_log(created_at desc);
create index if not exists admin_audit_actor_idx on public.admin_audit_log(actor_id, created_at desc);
create index if not exists admin_audit_entity_idx on public.admin_audit_log(entity_type, entity_id, created_at desc);
create index if not exists admin_audit_org_idx on public.admin_audit_log(organization_id, created_at desc);
alter table public.admin_audit_log enable row level security;

 drop policy if exists admin_audit_read_permission on public.admin_audit_log;
create policy admin_audit_read_permission on public.admin_audit_log
for select to authenticated using (public.has_permission('audit.read', organization_id));
revoke insert, update, delete, truncate, references, trigger on public.admin_audit_log from anon, authenticated;

create or replace function public.audit_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_json jsonb;
  new_json jsonb;
  target_id text;
  org_id uuid;
  safe_metadata jsonb := '{}'::jsonb;
begin
  -- Edge Functions write their own actor-attributed audit event after a privileged change.
  -- Avoid duplicate null-actor rows when service-role operations fire this trigger.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op <> 'INSERT' then old_json := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_json := to_jsonb(new); end if;

  if tg_table_name = 'organizations' then
    target_id := coalesce(new_json->>'id', old_json->>'id');
  elsif tg_table_name = 'departments' then
    target_id := coalesce(new_json->>'id', old_json->>'id');
    org_id := nullif(coalesce(new_json->>'organization_id', old_json->>'organization_id'), '')::uuid;
  elsif tg_table_name = 'organization_memberships' then
    target_id := coalesce(new_json->>'user_id', old_json->>'user_id');
    org_id := nullif(coalesce(new_json->>'organization_id', old_json->>'organization_id'), '')::uuid;
  elsif tg_table_name = 'user_roles' then
    target_id := coalesce(new_json->>'user_id', old_json->>'user_id');
    org_id := nullif(coalesce(new_json->>'organization_id', old_json->>'organization_id'), '')::uuid;
    safe_metadata := jsonb_build_object(
      'role_id', coalesce(new_json->>'role_id', old_json->>'role_id'),
      'operation', tg_op
    );
  elsif tg_table_name = 'role_permissions' then
    target_id := coalesce(new_json->>'role_id', old_json->>'role_id');
    safe_metadata := jsonb_build_object(
      'permission_id', coalesce(new_json->>'permission_id', old_json->>'permission_id'),
      'operation', tg_op
    );
  else
    target_id := coalesce(new_json->>'id', old_json->>'id', 'unknown');
  end if;

  if tg_table_name in ('organizations','departments') then
    safe_metadata := jsonb_build_object(
      'name', coalesce(new_json->>'name', old_json->>'name'),
      'slug', coalesce(new_json->>'slug', old_json->>'slug'),
      'operation', tg_op
    );
  elsif tg_table_name = 'organization_memberships' then
    safe_metadata := jsonb_build_object(
      'department_id', coalesce(new_json->>'department_id', old_json->>'department_id'),
      'status', coalesce(new_json->>'status', old_json->>'status'),
      'job_title', coalesce(new_json->>'job_title', old_json->>'job_title'),
      'operation', tg_op
    );
  end if;

  insert into public.admin_audit_log(actor_id, action, entity_type, entity_id, organization_id, metadata)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(target_id, 'unknown'),
    org_id,
    safe_metadata
  );
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

-- These triggers record changes even when a privileged Edge Function uses the service role.
drop trigger if exists admin_audit_organizations on public.organizations;
create trigger admin_audit_organizations after insert or update or delete on public.organizations
for each row execute function public.audit_admin_change();
drop trigger if exists admin_audit_departments on public.departments;
create trigger admin_audit_departments after insert or update or delete on public.departments
for each row execute function public.audit_admin_change();
drop trigger if exists admin_audit_memberships on public.organization_memberships;
create trigger admin_audit_memberships after insert or update or delete on public.organization_memberships
for each row execute function public.audit_admin_change();
drop trigger if exists admin_audit_user_roles on public.user_roles;
create trigger admin_audit_user_roles after insert or update or delete on public.user_roles
for each row execute function public.audit_admin_change();
drop trigger if exists admin_audit_role_permissions on public.role_permissions;
create trigger admin_audit_role_permissions after insert or update or delete on public.role_permissions
for each row execute function public.audit_admin_change();

-- 5. RLS for organization and employee operations. Existing restrictive policies remain in place;
-- PostgreSQL permissive policies are OR-combined, so these policies add permission-based access.
drop policy if exists organizations_manage_permission on public.organizations;
drop policy if exists organizations_insert_permission on public.organizations;
create policy organizations_insert_permission on public.organizations
for insert to authenticated with check (public.has_permission('organization.manage'));
create policy organizations_manage_permission on public.organizations
for update to authenticated using (public.has_permission('organization.manage'))
with check (public.has_permission('organization.manage'));

drop policy if exists departments_read_permission on public.departments;
create policy departments_read_permission on public.departments
for select to authenticated using (public.has_permission('organization.read', organization_id));
drop policy if exists departments_manage_permission on public.departments;
drop policy if exists departments_insert_permission on public.departments;
create policy departments_insert_permission on public.departments
for insert to authenticated with check (public.has_permission('organization.manage', organization_id));
create policy departments_manage_permission on public.departments
for update to authenticated using (public.has_permission('organization.manage', organization_id))
with check (public.has_permission('organization.manage', organization_id));

drop policy if exists memberships_read_permission on public.organization_memberships;
create policy memberships_read_permission on public.organization_memberships
for select to authenticated
using (public.has_permission('employees.read', organization_id));
-- Membership mutations are routed through the admin-organization Edge Function.
revoke insert, update, delete on public.organization_memberships from anon, authenticated;
revoke insert, update, delete on public.user_roles from anon, authenticated;
revoke insert, update, delete on public.role_permissions from anon, authenticated;

-- 6. A server-checked dashboard RPC. Values come from the existing schema, not client calculations.
create or replace function public.admin_erp_overview(
  p_from timestamptz default (now() - interval '30 days'),
  p_to timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  from_at timestamptz := coalesce(p_from, now() - interval '30 days');
  to_at timestamptz := coalesce(p_to, now());
begin
  if auth.uid() is null or not public.has_permission('admin.dashboard.read') then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if to_at <= from_at or to_at - from_at > interval '366 days' then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'range', jsonb_build_object('from', from_at, 'to', to_at),
    'customers', (select count(*) from public.profiles p join public.user_roles ur on ur.user_id=p.id join public.roles r on r.id=ur.role_id where r.key='customer'),
    'active_employees', (select count(distinct om.user_id) from public.organization_memberships om where om.status='active'),
    'enquiries', (select count(*) from public.enquiries e where e."createdAt" >= from_at and e."createdAt" < to_at),
    'new_enquiries', (select count(*) from public.enquiries e where e."createdAt" >= from_at and e."createdAt" < to_at and e.status='new'),
    'bookings', (select count(*) from public.bookings b where b."createdAt" >= from_at and b."createdAt" < to_at),
    'confirmed_bookings', (select count(*) from public.bookings b where b."createdAt" >= from_at and b."createdAt" < to_at and b."bookingStatus"='confirmed'),
    'accepted_proposals', (select count(*) from public.quotations q where q.proposal_status='ACCEPTED' and q."createdAt" >= from_at and q."createdAt" < to_at),
    'departures_upcoming', (select count(*) from public.tour_departures d where d.departure_date >= current_date and d.status in ('available','limited')),
    'verified_revenue', case when public.has_permission('finance.read') then (select coalesce(sum(ft.amount),0) from public.finance_transactions ft join public.payments p on p.id=ft."paymentId" where ft.type='income' and p.status='successful' and ft."occurredAt" >= from_at and ft."occurredAt" < to_at) else null end,
    'outstanding_balance', case when public.has_permission('finance.read') then (select coalesce(sum(greatest(b.amount - coalesce(paid.total_paid,0),0)),0) from public.bookings b left join lateral (select sum(p.amount) as total_paid from public.payments p where p."bookingId"=b.id and p.status='successful') paid on true where b."bookingStatus" in ('pending','confirmed','in_progress')) else null end,
    'recent_activity', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'entity_type', a.entity_type, 'entity_id', a.entity_id, 'actor_id', a.actor_id, 'created_at', a.created_at, 'metadata', a.metadata) order by a.created_at desc) from (select * from public.admin_audit_log where public.has_permission('audit.read', organization_id) order by created_at desc limit 10) a), '[]'::jsonb),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'is_active', d.is_active, 'employee_count', (select count(*) from public.organization_memberships om where om.department_id=d.id and om.status='active')) order by d.name) from public.departments d where public.has_permission('organization.read', d.organization_id)), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.admin_erp_overview(timestamptz, timestamptz) from public;
grant execute on function public.admin_erp_overview(timestamptz, timestamptz) to authenticated;

commit;
