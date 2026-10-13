-- Phase 7 access-scope hardening for existing tables. Does not recreate tables.
begin;

-- Replace broad Phase 1 membership read policy: a department colleague should not
-- automatically receive the entire employee directory merely by sharing an org.
drop policy if exists "organization_memberships_select" on public.organization_memberships;
drop policy if exists memberships_read_permission on public.organization_memberships;
create policy organization_memberships_scoped_select
on public.organization_memberships for select to authenticated
using (
  user_id = auth.uid()
  or public.has_permission('employees.read', organization_id)
);

-- Let users with roles.read view assignments within the scope they are allowed to manage.
drop policy if exists user_roles_select_permission on public.user_roles;
create policy user_roles_select_permission
on public.user_roles for select to authenticated
using (
  user_id = auth.uid()
  or public.has_permission('roles.read', organization_id)
  or public.has_permission('roles.manage', organization_id)
);

-- Staff with employees.read can resolve profile labels for permitted employee records.
drop policy if exists profiles_employee_directory_permission on public.profiles;
create policy profiles_employee_directory_permission
on public.profiles for select to authenticated
using (
  public.has_permission('employees.read')
  and public.crm_is_staff_profile(id)
);

-- Read access to departures is permission-controlled for authenticated staff;
-- public catalogue policy remains in place for the public site.
drop policy if exists tour_departures_staff_read_permission on public.tour_departures;
create policy tour_departures_staff_read_permission
on public.tour_departures for select to authenticated
using (public.has_permission('departures.read'));

-- Core operational write paths use the existing staff-issued booking-offer functions
-- and trusted server operations. Prevent direct client writes to booking/finance records.
revoke insert, update, delete on public.bookings from anon, authenticated;
revoke insert, update, delete on public.quotations from anon, authenticated;
revoke insert, update, delete on public.quotation_items from anon, authenticated;
revoke insert, update, delete on public.booking_offer_versions from anon, authenticated;
revoke insert, update, delete on public.booking_cancellation_requests from anon, authenticated;
revoke insert, update, delete on public.finance_transactions from anon, authenticated;

-- Customer-visible booking/quotation reads are still governed by existing RLS policies.
-- Staff read policies are permission-based and do not grant writes.
drop policy if exists bookings_staff_read_permission on public.bookings;
create policy bookings_staff_read_permission
on public.bookings for select to authenticated
using (public.has_permission('bookings.read'));
drop policy if exists quotations_staff_read_permission on public.quotations;
create policy quotations_staff_read_permission
on public.quotations for select to authenticated
using (public.has_permission('bookings.read') or public.has_permission('bookings.manage'));

-- Financial records can be read by staff only with explicit finance permissions.
drop policy if exists finance_transactions_staff_read_permission on public.finance_transactions;
create policy finance_transactions_staff_read_permission
on public.finance_transactions for select to authenticated
using (public.has_permission('finance.read'));

-- The admin dashboard counts customers once even when they have multiple role assignments.
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
  v_from timestamptz := coalesce(p_from, now() - interval '30 days');
  v_to timestamptz := coalesce(p_to, now());
  v_result jsonb;
begin
  if auth.uid() is null or not public.has_permission('admin.dashboard.read') then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if v_to <= v_from or v_to - v_from > interval '366 days' then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'range', jsonb_build_object('from',v_from,'to',v_to),
    'customers', (select count(distinct ur.user_id) from public.user_roles ur join public.roles r on r.id=ur.role_id where r.key='customer'),
    'active_employees', (select count(distinct om.user_id) from public.organization_memberships om where om.status='active'),
    'enquiries', (select count(*) from public.enquiries e where e."createdAt" >= v_from and e."createdAt" < v_to),
    'new_enquiries', (select count(*) from public.enquiries e where e."createdAt" >= v_from and e."createdAt" < v_to and e.status::text='new'),
    'bookings', (select count(*) from public.bookings b where b."createdAt" >= v_from and b."createdAt" < v_to),
    'confirmed_bookings', (select count(*) from public.bookings b where b."createdAt" >= v_from and b."createdAt" < v_to and b."bookingStatus"::text='confirmed'),
    'accepted_proposals', (select count(*) from public.quotations q where q.proposal_status='ACCEPTED' and q."createdAt" >= v_from and q."createdAt" < v_to),
    'departures_upcoming', (select count(*) from public.tour_departures d where d.departure_date >= current_date and d.status in ('available','limited')),
    'verified_revenue', case when public.has_permission('finance.read') then (select coalesce(sum(ft.amount),0) from public.finance_transactions ft join public.payments p on p.id=ft."paymentId" where ft.type::text='income' and p.status::text='successful' and ft."occurredAt" >= v_from and ft."occurredAt" < v_to) else null end,
    'outstanding_balance', case when public.has_permission('finance.read') then (select coalesce(sum(greatest(b.amount-coalesce(paid.total_paid,0),0)),0) from public.bookings b left join lateral (select sum(p.amount) total_paid from public.payments p where p."bookingId"=b.id and p.status::text='successful') paid on true where b."bookingStatus"::text in ('pending','confirmed','in_progress')) else null end,
    'recent_activity', case when public.has_permission('audit.read') then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'entity_type',a.entity_type,'entity_id',a.entity_id,'actor_id',a.actor_id,'created_at',a.created_at,'metadata',a.metadata) order by a.created_at desc) from (select * from public.admin_audit_log order by created_at desc limit 10) a), '[]'::jsonb) else '[]'::jsonb end,
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'is_active',d.is_active,'employee_count',(select count(*) from public.organization_memberships om where om.department_id=d.id and om.status='active')) order by d.name) from public.departments d where public.has_permission('organization.read',d.organization_id)), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.admin_erp_overview(timestamptz,timestamptz) from public, anon;
grant execute on function public.admin_erp_overview(timestamptz,timestamptz) to authenticated;

commit;
