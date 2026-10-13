-- Permission and organizational scoping for Phase 4/5 operational tables.
begin;

-- The existing public departure catalogue remains public. The organization field is for staff scope.
alter table public.tour_departures
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
create index if not exists tour_departures_organization_status_idx
  on public.tour_departures(organization_id, status, departure_date);

create or replace function public.crm_enquiry_organization(p_enquiry_id integer)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select d.organization_id from public.enquiries e join public.departments d on d.id=e.assigned_department_id where e.id=p_enquiry_id),
    (select om.organization_id from public.enquiries e join public.organization_memberships om on om.user_id=e.assigned_employee_id and om.status='active' where e.id=p_enquiry_id order by om.created_at limit 1)
  );
$$;
revoke all on function public.crm_enquiry_organization(integer) from public, anon;
grant execute on function public.crm_enquiry_organization(integer) to authenticated;

create or replace function public.crm_quotation_organization(p_quotation_id integer)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.crm_enquiry_organization(q."enquiryId")
  from public.quotations q where q.id=p_quotation_id;
$$;
revoke all on function public.crm_quotation_organization(integer) from public, anon;
grant execute on function public.crm_quotation_organization(integer) to authenticated;

-- Phase 4 used role-name-only policies. Replace staff enquiry policies with permission checks.
drop policy if exists enquiries_staff_select on public.enquiries;
create policy enquiries_staff_select on public.enquiries for select to authenticated
using (
  public.has_permission('enquiries.read', public.crm_enquiry_organization(id))
  and public.crm_can_access_enquiry(id)
);
drop policy if exists enquiries_staff_update on public.enquiries;
create policy enquiries_staff_update on public.enquiries for update to authenticated
using (
  public.has_permission('enquiries.manage', public.crm_enquiry_organization(id))
  and public.crm_can_operate_enquiry(id)
)
with check (
  public.has_permission('enquiries.manage', public.crm_enquiry_organization(id))
  and public.crm_can_operate_enquiry(id)
);

-- Replace broad Phase 5 staff quotation policies. Customer-owned select policies remain.
drop policy if exists quotations_staff_select_phase5 on public.quotations;
create policy quotations_staff_select_phase7 on public.quotations for select to authenticated
using (
  public.has_permission('bookings.read', public.crm_quotation_organization(id))
  or public.has_permission('bookings.manage', public.crm_quotation_organization(id))
);
drop policy if exists quotations_staff_insert_phase5 on public.quotations;
drop policy if exists quotations_staff_update_phase5 on public.quotations;
-- All quotation mutations are performed through the existing SECURITY DEFINER Phase 5 functions
-- or trusted server operations; direct client writes were revoked in the previous migration.

drop policy if exists quotation_items_staff_select_phase5 on public.quotation_items;
create policy quotation_items_staff_select_phase7 on public.quotation_items for select to authenticated
using (
  exists (select 1 from public.quotations q where q.id="quotationId" and (
    public.has_permission('bookings.read', public.crm_quotation_organization(q.id))
    or public.has_permission('bookings.manage', public.crm_quotation_organization(q.id))
  ))
);
drop policy if exists quotation_items_staff_insert_phase5 on public.quotation_items;
drop policy if exists quotation_items_staff_update_phase5 on public.quotation_items;

-- Customer-owned booking reads plus staff reads scoped through the linked quotation/enquiry.
drop policy if exists bookings_customer_select_own on public.bookings;
create policy bookings_customer_select_own on public.bookings for select to authenticated
using (customer_auth_id = auth.uid());
drop policy if exists bookings_staff_read_permission on public.bookings;
create policy bookings_staff_read_permission on public.bookings for select to authenticated
using (
  exists (select 1 from public.quotations q where q."bookingId"=bookings.id and (
    public.has_permission('bookings.read', public.crm_quotation_organization(q.id))
    or public.has_permission('bookings.manage', public.crm_quotation_organization(q.id))
  ))
);

-- Scoped overview: non-global managers only see operational rows assigned to their organization.
create or replace function public.admin_erp_overview_scoped(
  p_from timestamptz default (now() - interval '30 days'),
  p_to timestamptz default now(),
  p_organization_id uuid default null
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
  if auth.uid() is null or not public.has_permission('admin.dashboard.read', p_organization_id) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if v_to <= v_from or v_to-v_from > interval '366 days' then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'range',jsonb_build_object('from',v_from,'to',v_to),
    'customers', (select count(distinct e.customer_auth_id) from public.enquiries e where e.customer_auth_id is not null and (p_organization_id is null or public.crm_enquiry_organization(e.id)=p_organization_id)),
    'active_employees', (select count(distinct om.user_id) from public.organization_memberships om where om.status='active' and (p_organization_id is null or om.organization_id=p_organization_id)),
    'enquiries', (select count(*) from public.enquiries e where e."createdAt">=v_from and e."createdAt"<v_to and (p_organization_id is null or public.crm_enquiry_organization(e.id)=p_organization_id)),
    'new_enquiries', (select count(*) from public.enquiries e where e."createdAt">=v_from and e."createdAt"<v_to and e.status::text='new' and (p_organization_id is null or public.crm_enquiry_organization(e.id)=p_organization_id)),
    'bookings', (select count(distinct b.id) from public.bookings b where b."createdAt">=v_from and b."createdAt"<v_to and (p_organization_id is null or exists (select 1 from public.quotations q where q."bookingId"=b.id and public.crm_quotation_organization(q.id)=p_organization_id))),
    'confirmed_bookings', (select count(distinct b.id) from public.bookings b where b."createdAt">=v_from and b."createdAt"<v_to and b."bookingStatus"::text='confirmed' and (p_organization_id is null or exists (select 1 from public.quotations q where q."bookingId"=b.id and public.crm_quotation_organization(q.id)=p_organization_id))),
    'accepted_proposals', (select count(*) from public.quotations q where q.proposal_status='ACCEPTED' and q."createdAt">=v_from and q."createdAt"<v_to and (p_organization_id is null or public.crm_quotation_organization(q.id)=p_organization_id)),
    'departures_upcoming', (select count(*) from public.tour_departures d where d.departure_date>=current_date and d.status in ('available','limited') and (p_organization_id is null or d.organization_id=p_organization_id)),
    'verified_revenue', case when public.has_permission('finance.read',p_organization_id) then (select coalesce(sum(ft.amount),0) from public.finance_transactions ft join public.payments p on p.id=ft."paymentId" where ft.type::text='income' and p.status::text='successful' and ft."occurredAt">=v_from and ft."occurredAt"<v_to and (p_organization_id is null or exists (select 1 from public.quotations q where q."bookingId"=p."bookingId" and public.crm_quotation_organization(q.id)=p_organization_id))) else null end,
    'outstanding_balance', case when public.has_permission('finance.read',p_organization_id) then (select coalesce(sum(greatest(b.amount-coalesce(paid.total_paid,0),0)),0) from public.bookings b left join lateral (select sum(p.amount) total_paid from public.payments p where p."bookingId"=b.id and p.status::text='successful') paid on true where b."bookingStatus"::text in ('pending','confirmed','in_progress') and (p_organization_id is null or exists (select 1 from public.quotations q where q."bookingId"=b.id and public.crm_quotation_organization(q.id)=p_organization_id))) else null end,
    'recent_activity', case when public.has_permission('audit.read',p_organization_id) then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'entity_type',a.entity_type,'entity_id',a.entity_id,'actor_id',a.actor_id,'created_at',a.created_at,'metadata',a.metadata) order by a.created_at desc) from (select * from public.admin_audit_log where p_organization_id is null or organization_id=p_organization_id order by created_at desc limit 10) a),'[]'::jsonb) else '[]'::jsonb end,
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'is_active',d.is_active,'employee_count',(select count(*) from public.organization_memberships om where om.department_id=d.id and om.status='active')) order by d.name) from public.departments d where (p_organization_id is null or d.organization_id=p_organization_id) and public.has_permission('organization.read',d.organization_id)),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.admin_erp_overview_scoped(timestamptz,timestamptz,uuid) from public, anon;
grant execute on function public.admin_erp_overview_scoped(timestamptz,timestamptz,uuid) to authenticated;

commit;
