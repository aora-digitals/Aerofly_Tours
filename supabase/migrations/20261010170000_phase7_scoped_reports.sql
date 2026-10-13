-- Scoped reports for staff whose permissions are limited to one organization.
begin;

create or replace function public.admin_erp_reports_scoped(
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
  if auth.uid() is null or not public.has_permission('reports.read', p_organization_id) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if v_to <= v_from or v_to-v_from > interval '366 days' then
    raise exception 'Invalid report date range' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'from',v_from,'to',v_to,
    'enquiry_count',(select count(*) from public.enquiries e where e."createdAt">=v_from and e."createdAt"<v_to and (p_organization_id is null or public.crm_enquiry_organization(e.id)=p_organization_id)),
    'new_enquiries',(select count(*) from public.enquiries e where e."createdAt">=v_from and e."createdAt"<v_to and e.status::text='new' and (p_organization_id is null or public.crm_enquiry_organization(e.id)=p_organization_id)),
    'accepted_proposals',(select count(*) from public.quotations q where q.proposal_status='ACCEPTED' and q."createdAt">=v_from and q."createdAt"<v_to and (p_organization_id is null or public.crm_quotation_organization(q.id)=p_organization_id)),
    'bookings_created',(select count(distinct b.id) from public.bookings b where b."createdAt">=v_from and b."createdAt"<v_to and (p_organization_id is null or exists(select 1 from public.quotations q where q."bookingId"=b.id and public.crm_quotation_organization(q.id)=p_organization_id))),
    'confirmed_bookings',(select count(distinct b.id) from public.bookings b where b."bookingStatus"::text='confirmed' and b."createdAt">=v_from and b."createdAt"<v_to and (p_organization_id is null or exists(select 1 from public.quotations q where q."bookingId"=b.id and public.crm_quotation_organization(q.id)=p_organization_id))),
    'departures_upcoming',(select count(*) from public.tour_departures d where d.departure_date>=current_date and d.status in ('available','limited') and (p_organization_id is null or d.organization_id=p_organization_id)),
    'verified_income',case when public.has_permission('finance.read',p_organization_id) then (select coalesce(sum(ft.amount),0) from public.finance_transactions ft join public.payments p on p.id=ft."paymentId" where ft.type::text='income' and p.status::text='successful' and ft."occurredAt">=v_from and ft."occurredAt"<v_to and (p_organization_id is null or exists(select 1 from public.quotations q where q."bookingId"=p."bookingId" and public.crm_quotation_organization(q.id)=p_organization_id))) else null end,
    'refunds_recorded',case when public.has_permission('finance.read',p_organization_id) then (select coalesce(sum(ft.amount),0) from public.finance_transactions ft where ft.type::text='refund' and ft."occurredAt">=v_from and ft."occurredAt"<v_to and (p_organization_id is null or exists(select 1 from public.payments p join public.quotations q on q."bookingId"=p."bookingId" where p.id=ft."paymentId" and public.crm_quotation_organization(q.id)=p_organization_id))) else null end,
    'department_headcount',coalesce((select jsonb_agg(jsonb_build_object('department_id',d.id,'department',d.name,'active_employees',(select count(*) from public.organization_memberships om where om.department_id=d.id and om.status='active')) order by d.name) from public.departments d where (p_organization_id is null or d.organization_id=p_organization_id) and public.has_permission('organization.read',d.organization_id)),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.admin_erp_reports_scoped(timestamptz,timestamptz,uuid) from public, anon;
grant execute on function public.admin_erp_reports_scoped(timestamptz,timestamptz,uuid) to authenticated;

commit;
