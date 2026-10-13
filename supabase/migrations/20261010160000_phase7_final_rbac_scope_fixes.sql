-- Final least-privilege corrections: remove legacy permissive role-only policies.
begin;

-- Organizations are visible only through active membership or scoped organization.read.
drop policy if exists "organizations_select_member" on public.organizations;
drop policy if exists "organizations_insert_owner" on public.organizations;
drop policy if exists "organizations_update_owner" on public.organizations;
drop policy if exists organizations_insert_permission on public.organizations;
drop policy if exists organizations_manage_permission on public.organizations;
create policy organizations_phase7_select on public.organizations for select to authenticated
using (public.is_organization_member(id) or public.has_permission('organization.read', id));
create policy organizations_phase7_insert on public.organizations for insert to authenticated
with check (public.has_permission('organization.manage'));
create policy organizations_phase7_update on public.organizations for update to authenticated
using (public.has_permission('organization.manage', id)) with check (public.has_permission('organization.manage', id));
revoke insert, update, delete on public.organizations from anon, authenticated;

-- All membership writes go through the audited Edge Function/database RPC.
drop policy if exists "organization_memberships_manage" on public.organization_memberships;
revoke insert, update, delete on public.organization_memberships from anon, authenticated;

-- Departments are readable by members of the organization, but all mutations use the Edge Function.
drop policy if exists departments_manage_owner on public.departments;
revoke insert, update, delete on public.departments from anon, authenticated;

-- Remove old broad user-role select policy; the permission-scoped policy from Phase 7 remains.
drop policy if exists "user_roles_select" on public.user_roles;

-- Remove Phase 4's broad profile policies that allowed any manager to read all profiles.
drop policy if exists profiles_staff_crm_select on public.profiles;
drop policy if exists profiles_staff_directory_select on public.profiles;
drop policy if exists profiles_employee_directory_permission on public.profiles;
drop policy if exists profiles_customer_read_permission on public.profiles;
create policy profiles_staff_directory_select_phase7 on public.profiles for select to authenticated
using (
  exists (
    select 1
    from public.organization_memberships target
    join public.organization_memberships actor_membership
      on actor_membership.organization_id = target.organization_id
     and actor_membership.user_id = auth.uid()
     and actor_membership.status = 'active'
    where target.user_id = profiles.id
      and target.status = 'active'
      and public.has_permission('employees.read', target.organization_id)
  )
);
create policy profiles_customer_read_permission_phase7 on public.profiles for select to authenticated
using (
  not public.crm_is_staff_profile(id)
  and exists (
    select 1 from public.enquiries e
    where e.customer_auth_id=profiles.id
      and public.has_permission('customers.read', public.crm_enquiry_organization(e.id))
      and public.crm_can_access_enquiry(e.id)
  )
);

-- Assignment history is permission-scoped and remains immutable to customers.
drop policy if exists enquiry_assignments_staff_select on public.enquiry_assignments;
create policy enquiry_assignments_staff_select_phase7 on public.enquiry_assignments for select to authenticated
using (public.has_permission('enquiries.read', public.crm_enquiry_organization(enquiry_id)) and public.crm_can_access_enquiry(enquiry_id));
drop policy if exists enquiry_assignments_staff_insert on public.enquiry_assignments;
create policy enquiry_assignments_staff_insert_phase7 on public.enquiry_assignments for insert to authenticated
with check (assigned_by=auth.uid() and public.has_permission('enquiries.manage', public.crm_enquiry_organization(enquiry_id)) and public.crm_can_manage_assignment(enquiry_id));

-- Booking offer snapshots/events and cancellation records are scoped to the related enquiry.
drop policy if exists booking_offer_versions_staff_select on public.booking_offer_versions;
create policy booking_offer_versions_staff_select_phase7 on public.booking_offer_versions for select to authenticated
using (
  exists (select 1 from public.quotations q where q.id=quotation_id and (
    public.has_permission('bookings.read', public.crm_quotation_organization(q.id))
    or public.has_permission('bookings.manage', public.crm_quotation_organization(q.id))
  ))
);
drop policy if exists booking_offer_events_staff_select on public.booking_offer_events;
create policy booking_offer_events_staff_select_phase7 on public.booking_offer_events for select to authenticated
using (
  exists (select 1 from public.quotations q where q.id=quotation_id and (
    public.has_permission('bookings.read', public.crm_quotation_organization(q.id))
    or public.has_permission('bookings.manage', public.crm_quotation_organization(q.id))
  ))
);
drop policy if exists booking_offer_events_staff_insert on public.booking_offer_events;
create policy booking_offer_events_staff_insert_phase7 on public.booking_offer_events for insert to authenticated
with check (
  actor_type='staff' and actor_id=auth.uid()
  and exists (select 1 from public.quotations q where q.id=quotation_id
    and public.has_permission('bookings.manage', public.crm_quotation_organization(q.id)))
);
drop policy if exists booking_cancellation_staff_select on public.booking_cancellation_requests;
create policy booking_cancellation_staff_select_phase7 on public.booking_cancellation_requests for select to authenticated
using (
  exists (select 1 from public.bookings b join public.quotations q on q."bookingId"=b.id
    where b.id=booking_id and (
      public.has_permission('bookings.manage', public.crm_quotation_organization(q.id))
      or public.has_permission('refunds.manage', public.crm_quotation_organization(q.id))
    ))
);

-- A role-scoped staff member cannot see or manage all organization settings.
-- The organization_settings table already has settings.read RLS and no direct client writes.

commit;
