-- Phase 8 security hardening: do not expose legacy internalNotes, storage paths,
-- legacy reviewerNotes, or staff-only ticket event metadata via direct PostgREST reads.
begin;

-- Explicit user-id parameters are needed by trusted Edge Function calls, but must
-- not become an ownership/role oracle for browser callers who can supply another UUID.
create or replace function public.phase8_customer_owns_application(p_application_id integer, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select (p_user = auth.uid() or auth.role() = 'service_role') and exists (
    select 1 from public.travel_applications a
    where a.id = p_application_id and a.customer_auth_id = auth.uid()
  );
$$;
revoke all on function public.phase8_customer_owns_application(integer,uuid) from public;
grant execute on function public.phase8_customer_owns_application(integer,uuid) to authenticated, service_role;

create or replace function public.phase8_staff_can_access_application(p_application_id integer, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select (p_user = auth.uid() or auth.role() = 'service_role') and exists (
    select 1 from public.travel_applications a
    where a.id = p_application_id
      and (
        public.has_any_role(array['owner','admin'], p_user)
        or a.assigned_auth_id = p_user
        or (a.organization_id is not null and public.is_organization_member(a.organization_id, p_user))
        or (a.organization_id is null and public.has_any_role(array['owner','admin','manager'], p_user)
            and exists (select 1 from public.organization_memberships om where om.user_id=p_user and om.status='active'))
      )
      and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'], p_user)
  );
$$;
revoke all on function public.phase8_staff_can_access_application(integer,uuid) from public;
grant execute on function public.phase8_staff_can_access_application(integer,uuid) to authenticated, service_role;

-- A SECURITY DEFINER RPC returning a table composite would expose every column,
-- including legacy internalNotes. Keep the old implementation private and expose
-- safe JSON wrappers to authenticated callers instead.
revoke all on function public.phase8_create_travel_application(public.travel_application_type,text,text,text,text,text,text,text,jsonb,public.travel_application_urgency) from public, anon, authenticated;
revoke all on function public.phase8_set_application_status(integer,public.travel_application_status,text) from public, anon, authenticated;
revoke all on function public.phase8_staff_review_document(integer,public.document_status,text) from public, anon, authenticated;

create or replace function public.phase8_create_travel_application_safe(
  p_type public.travel_application_type,
  p_applicant_name text,
  p_destination_country text default null,
  p_visa_type text default null,
  p_phone text default null,
  p_nationality text default null,
  p_travel_date text default null,
  p_customer_notes text default null,
  p_application_data jsonb default '{}'::jsonb,
  p_urgency public.travel_application_urgency default 'standard'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_app public.travel_applications;
begin
  v_app := public.phase8_create_travel_application(p_type,p_applicant_name,p_destination_country,p_visa_type,p_phone,p_nationality,p_travel_date,p_customer_notes,p_application_data,p_urgency);
  return jsonb_build_object('id',v_app.id,'reference',v_app.reference,'type',v_app.type,'status',v_app.status,
    'applicantName',v_app."applicantName",'destinationCountry',v_app."destinationCountry",'visa_type',v_app.visa_type,
    'createdAt',v_app."createdAt",'submitted_at',v_app.submitted_at);
end;
$$;
revoke all on function public.phase8_create_travel_application_safe(public.travel_application_type,text,text,text,text,text,text,text,jsonb,public.travel_application_urgency) from public;
grant execute on function public.phase8_create_travel_application_safe(public.travel_application_type,text,text,text,text,text,text,text,jsonb,public.travel_application_urgency) to authenticated;

create or replace function public.phase8_set_application_status_safe(
  p_application_id integer,
  p_status public.travel_application_status,
  p_customer_message text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_app public.travel_applications;
begin
  v_app := public.phase8_set_application_status(p_application_id,p_status,p_customer_message);
  return jsonb_build_object('id',v_app.id,'reference',v_app.reference,'type',v_app.type,'status',v_app.status,
    'applicantName',v_app."applicantName",'destinationCountry',v_app."destinationCountry",
    'submitted_at',v_app.submitted_at,'completed_at',v_app.completed_at);
end;
$$;
revoke all on function public.phase8_set_application_status_safe(integer,public.travel_application_status,text) from public;
grant execute on function public.phase8_set_application_status_safe(integer,public.travel_application_status,text) to authenticated;

create or replace function public.phase8_staff_review_document_safe(
  p_document_id integer,
  p_status public.document_status,
  p_rejection_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_doc public.application_documents;
begin
  v_doc := public.phase8_staff_review_document(p_document_id,p_status,p_rejection_reason);
  return jsonb_build_object('id',v_doc.id,'applicationId',v_doc."applicationId",'documentType',v_doc."documentType",
    'fileName',v_doc."fileName",'status',v_doc.status,'version_number',v_doc.version_number,
    'expires_on',v_doc.expires_on,'rejection_reason',v_doc.rejection_reason);
end;
$$;
revoke all on function public.phase8_staff_review_document_safe(integer,public.document_status,text) from public;
grant execute on function public.phase8_staff_review_document_safe(integer,public.document_status,text) to authenticated;

-- Customer and staff UI queries must select explicitly granted safe columns.
revoke select on public.travel_applications from public, anon, authenticated;
grant select (
  id, reference, "userId", "assignedTo", type, "serviceType", "applicantName", email,
  phone, nationality, "destinationCountry", "travelDate", urgency, status,
  "customerNotes", "createdAt", "updatedAt", customer_auth_id, assigned_auth_id,
  organization_id, visa_type, application_data, submitted_at, completed_at
) on public.travel_applications to authenticated;

revoke select on public.application_documents from public, anon, authenticated;
grant select (
  id, "applicationId", "checklistItemId", "documentType", "fileName", "mimeType",
  "sizeBytes", status, "uploadedAt", "reviewedAt", version_number, expires_on,
  rejection_reason
) on public.application_documents to authenticated;

revoke select on public.application_events from public, anon, authenticated;
grant select (id, "applicationId", "fromStatus", "toStatus", note, "createdAt", customer_visible)
  on public.application_events to authenticated;

-- Document version table holds private object paths; display version numbers from
-- application_documents and use signed-download RPCs instead of exposing paths.
revoke select on public.application_document_versions from public, anon, authenticated;

-- Storage policies must not depend on columns whose SELECT privilege is deliberately
-- withheld from browsers. These SECURITY DEFINER predicates expose only booleans.
create or replace function public.phase8_customer_can_read_document_path(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.application_documents d
    join public.travel_applications a on a.id = d."applicationId"
    where d.storage_path = p_name
      and d.id = public.phase8_safe_int(split_part(p_name,'/',3))
      and a.id = public.phase8_safe_int(split_part(p_name,'/',2))
      and split_part(p_name,'/',1) = auth.uid()::text
      and a.customer_auth_id = auth.uid()
      and d.upload_completed_at is not null
  );
$$;
create or replace function public.phase8_customer_can_upload_document_path(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.application_documents d
    join public.travel_applications a on a.id = d."applicationId"
    where d.storage_path = p_name
      and d.id = public.phase8_safe_int(split_part(p_name,'/',3))
      and a.id = public.phase8_safe_int(split_part(p_name,'/',2))
      and split_part(p_name,'/',1) = auth.uid()::text
      and a.customer_auth_id = auth.uid()
      and d.uploaded_by = auth.uid()
      and d.upload_completed_at is null
  );
$$;
create or replace function public.phase8_staff_can_read_document_path(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.application_documents d
    where d.storage_path = p_name
      and d.id = public.phase8_safe_int(split_part(p_name,'/',3))
      and d."applicationId" = public.phase8_safe_int(split_part(p_name,'/',2))
      and d.upload_completed_at is not null
      and public.phase8_staff_can_access_application(d."applicationId", auth.uid())
  );
$$;
revoke all on function public.phase8_customer_can_read_document_path(text) from public;
revoke all on function public.phase8_customer_can_upload_document_path(text) from public;
revoke all on function public.phase8_staff_can_read_document_path(text) from public;
grant execute on function public.phase8_customer_can_read_document_path(text) to authenticated;
grant execute on function public.phase8_customer_can_upload_document_path(text) to authenticated;
grant execute on function public.phase8_staff_can_read_document_path(text) to authenticated;

drop policy if exists phase8_travel_docs_customer_read on storage.objects;
create policy phase8_travel_docs_customer_read on storage.objects for select to authenticated
using (bucket_id = 'travel-documents' and public.phase8_customer_can_read_document_path(name));
drop policy if exists phase8_travel_docs_customer_insert on storage.objects;
create policy phase8_travel_docs_customer_insert on storage.objects for insert to authenticated
with check (bucket_id = 'travel-documents' and public.phase8_customer_can_upload_document_path(name));
drop policy if exists phase8_travel_docs_staff_read on storage.objects;
create policy phase8_travel_docs_staff_read on storage.objects for select to authenticated
using (bucket_id = 'travel-documents' and public.phase8_staff_can_read_document_path(name));

-- Managers can triage unassigned tickets that have not yet been placed in an organization.
drop policy if exists phase8_tickets_select on public.support_tickets;
create policy phase8_tickets_select on public.support_tickets for select to authenticated
using (
  customer_auth_id = auth.uid()
  or public.has_any_role(array['owner','admin'], auth.uid())
  or (assigned_to = auth.uid() and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'], auth.uid()))
  or (organization_id is not null and public.is_organization_member(organization_id, auth.uid())
      and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'], auth.uid()))
  or (organization_id is null and public.has_any_role(array['owner','admin','manager'], auth.uid())
      and exists (select 1 from public.organization_memberships om where om.user_id=auth.uid() and om.status='active'))
);

drop policy if exists phase8_ticket_messages_select on public.support_ticket_messages;
create policy phase8_ticket_messages_select on public.support_ticket_messages for select to authenticated
using (exists (
  select 1 from public.support_tickets t where t.id=ticket_id and (
    (t.customer_auth_id=auth.uid() and not is_internal)
    or public.has_any_role(array['owner','admin'], auth.uid())
    or (t.assigned_to=auth.uid() and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'], auth.uid()))
    or (t.organization_id is not null and public.is_organization_member(t.organization_id, auth.uid())
        and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'], auth.uid()))
    or (t.organization_id is null and public.has_any_role(array['owner','admin','manager'], auth.uid())
        and exists (select 1 from public.organization_memberships om where om.user_id=auth.uid() and om.status='active'))
  )
));

-- Ticket event metadata contains assignee IDs and internal workflow information.
-- Customers can still see status and replies from support_tickets/messages, not audit internals.
drop policy if exists phase8_ticket_events_select on public.support_ticket_events;
create policy phase8_ticket_events_select on public.support_ticket_events for select to authenticated
using (exists (
  select 1 from public.support_tickets t
  where t.id = ticket_id and (
    public.has_any_role(array['owner','admin'], auth.uid())
    or (t.assigned_to = auth.uid() and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'], auth.uid()))
    or (t.organization_id is not null and public.is_organization_member(t.organization_id, auth.uid())
        and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'], auth.uid()))
    or (t.organization_id is null and public.has_any_role(array['owner','admin','manager'], auth.uid())
        and exists (select 1 from public.organization_memberships om where om.user_id=auth.uid() and om.status='active'))
  )
));

commit;
