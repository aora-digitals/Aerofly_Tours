-- AeroFly Tours Phase 7 completion migration.
-- Extends Phase 1 RBAC and Phase 7 foundation. No duplicate organization/RBAC tables.
begin;

-- Organization/company settings are scoped to an existing organization.
create table if not exists public.organization_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  setting_key text not null check (setting_key ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  setting_value jsonb not null default '{}'::jsonb check (jsonb_typeof(setting_value) in ('object','array','string','number','boolean','null')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, setting_key)
);
create index if not exists organization_settings_org_idx on public.organization_settings(organization_id, setting_key);
alter table public.organization_settings enable row level security;
drop policy if exists organization_settings_read on public.organization_settings;
create policy organization_settings_read on public.organization_settings
  for select to authenticated using (public.has_permission('settings.read', organization_id));
revoke insert, update, delete, truncate, references, trigger on public.organization_settings from anon, authenticated;

-- Complete the permission catalogue. Existing keys are retained; inserts are idempotent.
insert into public.permissions(key, description) values
 ('customers.read','View customer records'),
 ('customers.manage','Create and update customer records'),
 ('tours.read','View tour catalogue records'),
 ('tours.manage','Create and update tours and destinations'),
 ('enquiries.read','View enquiries within permitted organizational scope'),
 ('enquiries.manage','Assign and update enquiries within permitted organizational scope'),
 ('bookings.read','View bookings within permitted organizational scope'),
 ('bookings.manage','Manage bookings within permitted organizational scope'),
 ('departures.read','View tour departures'),
 ('departures.manage','Manage tour departures and capacity'),
 ('payments.read','View payment status and payment history'),
 ('finance.read','View verified financial records and balances'),
 ('finance.manage','Perform authorized finance operations'),
 ('refunds.manage','Review and initiate authorized refunds'),
 ('employees.read','View employee directory'),
 ('employees.manage','Manage employee records and organization membership'),
 ('organization.read','View organization structure'),
 ('organization.manage','Manage organization and departments'),
 ('roles.read','View roles and permission catalogue'),
 ('roles.manage','Assign roles and manage role permissions'),
 ('audit.read','View append-only administrative audit events'),
 ('reports.read','View operational reports'),
 ('settings.read','View organization settings'),
 ('settings.manage','Manage organization settings'),
 ('admin.dashboard.read','View administrative ERP dashboard')
on conflict (key) do update set description = excluded.description;

-- Customer role is intentionally excluded from all admin ERP permissions.
-- Owner receives the full catalogue; admin receives broad but not owner-governance permissions.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.key = 'owner'
on conflict do nothing;
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
 'admin.dashboard.read','organization.read','organization.manage',
 'employees.read','employees.manage','roles.read','roles.manage','audit.read',
 'settings.read','settings.manage','departures.read','departures.manage',
 'enquiries.read','enquiries.manage','customers.read','customers.manage',
 'tours.read','tours.manage','bookings.read','bookings.manage',
 'payments.read','finance.read','finance.manage','refunds.manage','reports.read'
) where r.key = 'admin'
on conflict do nothing;
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
 'admin.dashboard.read','organization.read','employees.read','departures.read',
 'enquiries.read','enquiries.manage','customers.read','tours.read','bookings.read',
 'payments.read','finance.read','reports.read'
) where r.key = 'manager'
on conflict do nothing;
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
 'admin.dashboard.read','enquiries.read','enquiries.manage','customers.read','bookings.read'
) where r.key in ('customer_care','counsellor')
on conflict do nothing;
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
 'tours.read','departures.read'
) where r.key = 'marketing'
on conflict do nothing;
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
 'enquiries.read','bookings.read'
) where r.key = 'staff'
on conflict do nothing;

-- The permission helper is a backend authorization primitive, not a UI convenience.
-- Customer role can never satisfy administrative permission checks, even if misconfigured.
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
      and r.key <> 'customer'
      and p.key = requested_permission
      and (
        (requested_organization is null and ur.organization_id is null)
        or (requested_organization is not null and (ur.organization_id is null or ur.organization_id = requested_organization))
      )
      and exists (
        select 1 from public.organization_memberships om
        where om.user_id = ur.user_id
          and om.status = 'active'
          and (ur.organization_id is null or om.organization_id = ur.organization_id)
          and (requested_organization is null or om.organization_id = requested_organization)
      )
  );
$$;
revoke all on function public.has_permission(text, uuid) from public, anon;
grant execute on function public.has_permission(text, uuid) to authenticated;

-- The assignment tables are readable only through the appropriate permission/RLS.
-- All writes go through the Edge Function with actor checks and audit records.
revoke insert, update, delete, truncate, references, trigger on public.user_roles from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.role_permissions from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.roles from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.permissions from anon, authenticated;

-- Department manager must belong to the same organization and be active.
create or replace function public.validate_department_manager()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.manager_user_id is not null and not exists (
    select 1 from public.organization_memberships om
    where om.user_id = new.manager_user_id
      and om.organization_id = new.organization_id
      and om.status = 'active'
  ) then
    raise exception 'Department manager must be an active member of the same organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists departments_validate_manager on public.departments;
create trigger departments_validate_manager before insert or update of manager_user_id, organization_id
on public.departments for each row execute function public.validate_department_manager();

-- Reporting manager must be a different active member of the same organization.
create or replace function public.validate_membership_reporting_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reports_to_user_id is not null then
    if new.reports_to_user_id = new.user_id then
      raise exception 'An employee cannot report to themselves' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.organization_memberships manager
      where manager.user_id = new.reports_to_user_id
        and manager.organization_id = new.organization_id
        and manager.status = 'active'
    ) then
      raise exception 'Reporting manager must be an active member of the same organization'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists memberships_validate_reporting_line on public.organization_memberships;
create trigger memberships_validate_reporting_line before insert or update of reports_to_user_id, organization_id, user_id
on public.organization_memberships for each row execute function public.validate_membership_reporting_line();

-- A single permission-checked report endpoint, built only from existing tables.
create or replace function public.admin_erp_reports(
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
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_result jsonb;
begin
  if auth.uid() is null or not public.has_permission('reports.read') then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if v_to <= v_from or v_to - v_from > interval '366 days' then
    raise exception 'Invalid report date range' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'enquiry_count', (select count(*) from public.enquiries e where e."createdAt" >= v_from and e."createdAt" < v_to),
    'new_enquiries', (select count(*) from public.enquiries e where e."createdAt" >= v_from and e."createdAt" < v_to and e.status::text = 'new'),
    'accepted_proposals', (select count(*) from public.quotations q where q.proposal_status = 'ACCEPTED' and q."createdAt" >= v_from and q."createdAt" < v_to),
    'bookings_created', (select count(*) from public.bookings b where b."createdAt" >= v_from and b."createdAt" < v_to),
    'confirmed_bookings', (select count(*) from public.bookings b where b."bookingStatus"::text = 'confirmed' and b."createdAt" >= v_from and b."createdAt" < v_to),
    'departures_upcoming', (select count(*) from public.tour_departures d where d.departure_date >= current_date and d.status in ('available','limited')),
    'verified_income', case when public.has_permission('finance.read') then (select coalesce(sum(ft.amount),0) from public.finance_transactions ft join public.payments p on p.id=ft."paymentId" where ft.type::text='income' and p.status::text='successful' and ft."occurredAt" >= v_from and ft."occurredAt" < v_to) else null end,
    'refunds_recorded', case when public.has_permission('finance.read') then (select coalesce(sum(ft.amount),0) from public.finance_transactions ft where ft.type::text='refund' and ft."occurredAt" >= v_from and ft."occurredAt" < v_to) else null end,
    'department_headcount', coalesce((select jsonb_agg(jsonb_build_object('department_id',d.id,'department',d.name,'active_employees',(select count(*) from public.organization_memberships om where om.department_id=d.id and om.status='active')) order by d.name) from public.departments d where public.has_permission('organization.read',d.organization_id)), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.admin_erp_reports(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_erp_reports(timestamptz, timestamptz) to authenticated;

-- Ensure financial summary RPC cannot be invoked anonymously.
revoke all on function public.admin_erp_overview(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_erp_overview(timestamptz, timestamptz) to authenticated;

commit;
