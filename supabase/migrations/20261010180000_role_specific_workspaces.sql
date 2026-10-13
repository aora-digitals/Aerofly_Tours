-- AeroFly Phase 7 follow-up: database-backed role-specific workspace grants.
-- Additive and idempotent. Existing organization/RBAC tables are reused.
begin;

insert into public.roles(key, name, description, is_system) values
  ('sales', 'Sales / CRM', 'Enquiries, customer relationships and booking proposals', true),
  ('finance', 'Finance', 'Verified payments, refunds, invoices and reconciliation', true),
  ('operations', 'Tour Operations', 'Departures, itineraries and traveller operations', true),
  ('support', 'Customer Support', 'Customer care, callbacks and service requests', true),
  ('department_manager', 'Department Manager', 'Department team and organization-scoped reports', true)
on conflict (key) do update set name=excluded.name, description=excluded.description, is_system=true;

insert into public.permissions(key, description) values
  ('sales.read', 'View sales pipeline and proposal workspace'),
  ('marketing.read', 'View marketing and catalogue performance workspace'),
  ('marketing.manage', 'Manage marketing campaigns and promotional content'),
  ('operations.read', 'View organization-scoped tour operations'),
  ('support.read', 'View customer support queues'),
  ('work.read', 'View the signed-in employee work queue')
on conflict (key) do update set description=excluded.description;

-- Owner and admin keep broad access. Customer is never granted administrative permissions.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key in ('owner','admin')
on conflict do nothing;

-- Sales / CRM: no finance, refunds, employee, roles, or settings privileges.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'admin.dashboard.read','sales.read','enquiries.read','enquiries.manage','customers.read','customers.manage',
  'bookings.read','bookings.manage','reports.read','work.read'
) where r.key in ('sales','counsellor')
on conflict do nothing;

-- Finance: financial read and permitted finance operations; no role or employee administration.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'admin.dashboard.read','finance.read','finance.manage','payments.read','refunds.manage',
  'bookings.read','reports.read','work.read'
) where r.key='finance'
on conflict do nothing;

-- Tour operations: departures and booking execution; no payment/refund privileges.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'admin.dashboard.read','departures.read','departures.manage','tours.read',
  'bookings.read','bookings.manage','reports.read','operations.read','work.read'
) where r.key='operations'
on conflict do nothing;

-- Support: customer contact and assigned CRM work, no financial administration.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'admin.dashboard.read','enquiries.read','enquiries.manage','customers.read','bookings.read',
  'support.read','reports.read','work.read'
) where r.key in ('support','customer_care')
on conflict do nothing;

-- Marketing: catalogue read and marketing-specific operations; no customer financial data.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'admin.dashboard.read','tours.read','departures.read','marketing.read','marketing.manage',
  'reports.read','work.read'
) where r.key='marketing'
on conflict do nothing;

-- Department managers receive scoped employee/department visibility, not global role governance.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'admin.dashboard.read','organization.read','employees.read','enquiries.read','enquiries.manage',
  'customers.read','bookings.read','tours.read','departures.read','reports.read','work.read'
) where r.key in ('department_manager','manager')
on conflict do nothing;

-- Existing general staff gets only assigned-work read permissions; no finance or organization access.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.key in (
  'admin.dashboard.read','enquiries.read','bookings.read','work.read'
) where r.key='staff'
on conflict do nothing;

commit;
