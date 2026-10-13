-- Final Phase 7 operational RLS policies for tours, CRM follow-ups and internal notes.
begin;

-- Customer records are exposed to staff only when an accessible CRM relationship exists.
drop policy if exists profiles_customer_read_permission on public.profiles;
create policy profiles_customer_read_permission on public.profiles for select to authenticated
using (
  not public.crm_is_staff_profile(id)
  and exists (
    select 1 from public.enquiries e
    where e.customer_auth_id=profiles.id
      and public.has_permission('customers.read', public.crm_enquiry_organization(e.id))
      and public.crm_can_access_enquiry(e.id)
  )
);
drop policy if exists profiles_customer_update_permission on public.profiles;
create policy profiles_customer_update_permission on public.profiles for update to authenticated
using (
  not public.crm_is_staff_profile(id)
  and exists (
    select 1 from public.enquiries e
    where e.customer_auth_id=profiles.id
      and public.has_permission('customers.manage', public.crm_enquiry_organization(e.id))
      and public.crm_can_access_enquiry(e.id)
  )
)
with check (
  not public.crm_is_staff_profile(id)
  and exists (
    select 1 from public.enquiries e
    where e.customer_auth_id=profiles.id
      and public.has_permission('customers.manage', public.crm_enquiry_organization(e.id))
      and public.crm_can_access_enquiry(e.id)
  )
);

-- Tours and destination writes require explicit permission. Existing public read policies remain.
drop policy if exists destinations_staff_insert on public.destinations;
create policy destinations_staff_insert on public.destinations for insert to authenticated
with check (public.has_permission('tours.manage'));
drop policy if exists destinations_staff_update on public.destinations;
create policy destinations_staff_update on public.destinations for update to authenticated
using (public.has_permission('tours.manage')) with check (public.has_permission('tours.manage'));
drop policy if exists destinations_staff_delete on public.destinations;
create policy destinations_staff_delete on public.destinations for delete to authenticated
using (public.has_permission('tours.manage'));

drop policy if exists tours_staff_insert_permission on public.tours;
create policy tours_staff_insert_permission on public.tours for insert to authenticated
with check (public.has_permission('tours.manage'));
drop policy if exists tours_staff_update_permission on public.tours;
create policy tours_staff_update_permission on public.tours for update to authenticated
using (public.has_permission('tours.manage')) with check (public.has_permission('tours.manage'));
drop policy if exists tours_staff_delete_permission on public.tours;
create policy tours_staff_delete_permission on public.tours for delete to authenticated
using (public.has_permission('tours.manage'));

drop policy if exists itineraries_staff_insert_permission on public.tour_itineraries;
create policy itineraries_staff_insert_permission on public.tour_itineraries for insert to authenticated
with check (public.has_permission('tours.manage'));
drop policy if exists itineraries_staff_update_permission on public.tour_itineraries;
create policy itineraries_staff_update_permission on public.tour_itineraries for update to authenticated
using (public.has_permission('tours.manage')) with check (public.has_permission('tours.manage'));
drop policy if exists itineraries_staff_delete_permission on public.tour_itineraries;
create policy itineraries_staff_delete_permission on public.tour_itineraries for delete to authenticated
using (public.has_permission('tours.manage'));

drop policy if exists tour_departures_staff_insert_permission on public.tour_departures;
create policy tour_departures_staff_insert_permission on public.tour_departures for insert to authenticated
with check (public.has_permission('departures.manage', organization_id));
drop policy if exists tour_departures_staff_update_permission on public.tour_departures;
create policy tour_departures_staff_update_permission on public.tour_departures for update to authenticated
using (public.has_permission('departures.manage', organization_id))
with check (public.has_permission('departures.manage', organization_id));
drop policy if exists tour_departures_staff_delete_permission on public.tour_departures;
create policy tour_departures_staff_delete_permission on public.tour_departures for delete to authenticated
using (public.has_permission('departures.manage', organization_id));

-- Staff can see draft/unpublished tour records when their database permission allows it.
drop policy if exists tours_staff_read_permission on public.tours;
create policy tours_staff_read_permission on public.tours for select to authenticated
using (public.has_permission('tours.read') or public.has_permission('tours.manage'));
drop policy if exists tour_categories_staff_manage on public.tour_categories;
create policy tour_categories_staff_manage on public.tour_categories for all to authenticated
using (public.has_permission('tours.manage')) with check (public.has_permission('tours.manage'));

-- Scoped finance read is resolved through the booking's quotation/enquiry assignment.
drop policy if exists finance_transactions_staff_read_permission on public.finance_transactions;
create policy finance_transactions_staff_read_permission on public.finance_transactions for select to authenticated
using (
  public.has_permission('finance.read')
  or exists (
    select 1 from public.payments p join public.quotations q on q."bookingId"=p."bookingId"
    where p.id=finance_transactions."paymentId"
      and public.has_permission('finance.read', public.crm_quotation_organization(q.id))
  )
);

drop policy if exists tour_departures_staff_read_permission on public.tour_departures;
create policy tour_departures_staff_read_permission on public.tour_departures for select to authenticated
using (public.has_permission('departures.read', organization_id));

-- Resolve organization scope for CRM follow-up records through their enquiry assignment.
create or replace function public.crm_appointment_organization(p_appointment_id integer)
returns uuid language sql stable security definer set search_path=public as $$
  select public.crm_enquiry_organization(a."enquiryId") from public.appointments a where a.id=p_appointment_id;
$$;
create or replace function public.crm_callback_organization(p_callback_id integer)
returns uuid language sql stable security definer set search_path=public as $$
  select public.crm_enquiry_organization(c."enquiryId") from public.callback_requests c where c.id=p_callback_id;
$$;
revoke all on function public.crm_appointment_organization(integer) from public, anon;
revoke all on function public.crm_callback_organization(integer) from public, anon;
grant execute on function public.crm_appointment_organization(integer) to authenticated;
grant execute on function public.crm_callback_organization(integer) to authenticated;

-- Replace role-name-only staff policies with permission + existing assignment scope.
drop policy if exists appointments_staff_select on public.appointments;
create policy appointments_staff_select_phase7 on public.appointments for select to authenticated
using (public.has_permission('enquiries.read', public.crm_appointment_organization(id)) and public.crm_can_access_appointment(id));
drop policy if exists appointments_staff_update on public.appointments;
create policy appointments_staff_update_phase7 on public.appointments for update to authenticated
using (public.has_permission('enquiries.manage', public.crm_appointment_organization(id)) and public.crm_can_access_appointment(id))
with check (public.has_permission('enquiries.manage', public.crm_appointment_organization(id)) and public.crm_can_access_appointment(id));

drop policy if exists callbacks_staff_select on public.callback_requests;
create policy callbacks_staff_select_phase7 on public.callback_requests for select to authenticated
using (public.has_permission('enquiries.read', public.crm_callback_organization(id)) and public.crm_can_access_callback(id));
drop policy if exists callbacks_staff_update on public.callback_requests;
create policy callbacks_staff_update_phase7 on public.callback_requests for update to authenticated
using (public.has_permission('enquiries.manage', public.crm_callback_organization(id)) and public.crm_can_access_callback(id))
with check (public.has_permission('enquiries.manage', public.crm_callback_organization(id)) and public.crm_can_access_callback(id));

-- Internal notes require both record access and the appropriate permission.
drop policy if exists enquiry_notes_staff_select on public.enquiry_notes;
create policy enquiry_notes_staff_select_phase7 on public.enquiry_notes for select to authenticated
using (public.has_permission('enquiries.read', public.crm_enquiry_organization(enquiry_id)) and public.crm_can_access_enquiry(enquiry_id));
drop policy if exists enquiry_notes_staff_insert on public.enquiry_notes;
create policy enquiry_notes_staff_insert_phase7 on public.enquiry_notes for insert to authenticated
with check (author_id=auth.uid() and public.has_permission('enquiries.manage', public.crm_enquiry_organization(enquiry_id)) and public.crm_can_access_enquiry(enquiry_id));

drop policy if exists appointment_notes_staff_select on public.appointment_notes;
create policy appointment_notes_staff_select_phase7 on public.appointment_notes for select to authenticated
using (public.has_permission('enquiries.read', public.crm_appointment_organization(appointment_id)) and public.crm_can_access_appointment(appointment_id));
drop policy if exists appointment_notes_staff_insert on public.appointment_notes;
create policy appointment_notes_staff_insert_phase7 on public.appointment_notes for insert to authenticated
with check (author_id=auth.uid() and public.has_permission('enquiries.manage', public.crm_appointment_organization(appointment_id)) and public.crm_can_access_appointment(appointment_id));

drop policy if exists callback_notes_staff_select on public.callback_notes;
create policy callback_notes_staff_select_phase7 on public.callback_notes for select to authenticated
using (public.has_permission('enquiries.read', public.crm_callback_organization(callback_id)) and public.crm_can_access_callback(callback_id));
drop policy if exists callback_notes_staff_insert on public.callback_notes;
create policy callback_notes_staff_insert_phase7 on public.callback_notes for insert to authenticated
with check (author_id=auth.uid() and public.has_permission('enquiries.manage', public.crm_callback_organization(callback_id)) and public.crm_can_access_callback(callback_id));

-- Customer communication events remain inaccessible to customers; staff access is permission-scoped.
drop policy if exists communication_staff_select on public.communication_events;
create policy communication_staff_select_phase7 on public.communication_events for select to authenticated
using (
  (enquiry_id is not null and public.has_permission('enquiries.read', public.crm_enquiry_organization(enquiry_id)) and public.crm_can_access_enquiry(enquiry_id))
  or (appointment_id is not null and public.has_permission('enquiries.read', public.crm_appointment_organization(appointment_id)) and public.crm_can_access_appointment(appointment_id))
  or (callback_id is not null and public.has_permission('enquiries.read', public.crm_callback_organization(callback_id)) and public.crm_can_access_callback(callback_id))
);

drop policy if exists crm_audit_management_select on public.crm_audit_log;
create policy crm_audit_management_select_phase7 on public.crm_audit_log for select to authenticated
using (public.has_permission('audit.read'));

commit;
