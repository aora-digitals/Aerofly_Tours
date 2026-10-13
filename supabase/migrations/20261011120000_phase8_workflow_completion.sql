-- Phase 8 completion: guarded application transitions, checklist/document review,
-- customer-visible case timeline and atomic ticket message auditing.
-- Apply after 20261010220000_phase8_travel_documents_support.sql.
begin;

alter table public.application_documents
  add column if not exists reviewer_auth_id uuid references public.profiles(id) on delete set null,
  add column if not exists rejection_reason text,
  add column if not exists current_version integer not null default 1,
  add column if not exists upload_completed_at timestamptz;

create index if not exists application_documents_reviewer_idx
  on public.application_documents(reviewer_auth_id, status, "uploadedAt" desc);

-- Managers can triage unassigned cases with no organization yet; once assigned,
-- normal assignment/organization scoping applies.
create or replace function public.phase8_staff_can_access_application(p_application_id integer, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
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
grant execute on function public.phase8_staff_can_access_application(integer,uuid) to authenticated;

-- Tighten the status machine. Customers can only submit or cancel their own cases;
-- staff transitions are explicit and terminal states cannot be reopened here.
create or replace function public.phase8_set_application_status(
  p_application_id integer,
  p_status public.travel_application_status,
  p_customer_message text default null
) returns public.travel_applications
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_app public.travel_applications;
  v_old text;
  v_customer boolean;
  v_allowed boolean := false;
  v_message text := nullif(left(trim(coalesce(p_customer_message, '')), 2000), '');
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_app from public.travel_applications where id = p_application_id for update;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  v_old := v_app.status::text;
  v_customer := v_app.customer_auth_id = v_actor;

  if v_customer then
    v_allowed := (v_old = 'draft' and p_status in ('submitted','cancelled'))
      or (v_old = 'action_required' and p_status in ('submitted','cancelled'))
      or (v_old = 'submitted' and p_status = 'cancelled');
    if not v_allowed then
      raise exception 'Customer transition % -> % is not permitted', v_old, p_status using errcode = '42501';
    end if;
  else
    if not public.phase8_staff_can_access_application(p_application_id, v_actor) then
      raise exception 'Not authorized for this application' using errcode = '42501';
    end if;
    v_allowed :=
      (v_old = 'draft' and p_status in ('submitted','cancelled')) or
      (v_old = 'submitted' and p_status in ('under_review','action_required','rejected','cancelled')) or
      (v_old = 'under_review' and p_status in ('action_required','approved','rejected','completed','cancelled')) or
      (v_old = 'action_required' and p_status in ('under_review','rejected','cancelled')) or
      (v_old = 'approved' and p_status in ('completed','cancelled'));
    if not v_allowed then
      raise exception 'Staff transition % -> % is not permitted', v_old, p_status using errcode = '22023';
    end if;
    if not public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'], v_actor) then
      raise exception 'Staff permission required' using errcode = '42501';
    end if;
  end if;

  update public.travel_applications set
    status = p_status,
    submitted_at = case when p_status = 'submitted' then coalesce(submitted_at, now()) else submitted_at end,
    completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) when p_status in ('cancelled','rejected') then completed_at else completed_at end
  where id = p_application_id returning * into v_app;

  insert into public.application_events("applicationId", "actorId", "fromStatus", "toStatus", note, customer_visible, metadata)
  values (
    p_application_id,
    (select u.id from public.users u where u."openId" = 'supabase:' || v_actor::text limit 1),
    v_old, p_status::text,
    coalesce(v_message, case when v_customer then 'Customer updated application status' else 'Travel assistance status updated' end),
    v_customer or v_message is not null,
    jsonb_build_object('actor_auth_id', v_actor, 'actor_type', case when v_customer then 'customer' else 'staff' end)
  );
  return v_app;
end;
$$;
revoke all on function public.phase8_set_application_status(integer, public.travel_application_status, text) from public;
grant execute on function public.phase8_set_application_status(integer, public.travel_application_status, text) to authenticated;

-- Checklist completion/review is server-side and audited. Customers cannot mark
-- checklist items approved; they submit evidence and staff decide the outcome.
create or replace function public.phase8_staff_update_checklist_item(
  p_checklist_item_id integer,
  p_status public.checklist_status,
  p_notes text default null
) returns public.application_checklist_items
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_item public.application_checklist_items; v_app_id integer;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_item from public.application_checklist_items where id = p_checklist_item_id for update;
  if not found then raise exception 'Checklist item not found' using errcode = 'P0002'; end if;
  v_app_id := v_item."applicationId";
  if not public.phase8_staff_can_access_application(v_app_id, v_actor)
    or not public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'], v_actor) then
    raise exception 'Not authorized to update this checklist item' using errcode = '42501';
  end if;
  if p_status = 'approved' and exists (
    select 1 from public.application_documents d
    where d."checklistItemId" = p_checklist_item_id and d.status <> 'approved'
  ) then
    raise exception 'All linked documents must be approved first' using errcode = '22023';
  end if;
  update public.application_checklist_items set status = p_status,
    notes = case when p_notes is null then notes else left(trim(p_notes), 2000) end
  where id = p_checklist_item_id returning * into v_item;
  insert into public.application_events("applicationId", "actorId", "fromStatus", "toStatus", note, customer_visible, metadata)
  values (v_app_id, (select u.id from public.users u where u."openId" = 'supabase:' || v_actor::text limit 1),
    null, null, 'Checklist item status updated', true,
    jsonb_build_object('checklist_item_id', p_checklist_item_id, 'status', p_status::text));
  return v_item;
end;
$$;
revoke all on function public.phase8_staff_update_checklist_item(integer, public.checklist_status, text) from public;
grant execute on function public.phase8_staff_update_checklist_item(integer, public.checklist_status, text) to authenticated;

-- Document review requires staff case access. Reviewer comments are customer-visible
-- only when rejecting a document; private operational notes belong in notes table.
create or replace function public.phase8_staff_review_document(
  p_document_id integer,
  p_status public.document_status,
  p_rejection_reason text default null
) returns public.application_documents
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_doc public.application_documents; v_app_status text;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_status not in ('under_review','approved','rejected') then
    raise exception 'Invalid document review status' using errcode = '22023';
  end if;
  select * into v_doc from public.application_documents where id = p_document_id for update;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if not public.phase8_staff_can_access_application(v_doc."applicationId", v_actor)
    or not public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'], v_actor) then
    raise exception 'Not authorized to review this document' using errcode = '42501';
  end if;
  if v_doc.storage_path is null or v_doc.storage_path = 'pending' or v_doc.upload_completed_at is null then
    raise exception 'Document upload has not completed' using errcode = '22023';
  end if;
  if p_status = 'rejected' and length(trim(coalesce(p_rejection_reason,''))) < 3 then
    raise exception 'A customer-visible rejection reason is required' using errcode = '22023';
  end if;
  update public.application_documents set status = p_status,
    reviewer_auth_id = v_actor, "reviewedAt" = now(),
    "reviewerNotes" = case when p_status = 'rejected' then left(trim(p_rejection_reason), 2000) else null end,
    rejection_reason = case when p_status = 'rejected' then left(trim(p_rejection_reason), 2000) else null end
  where id = p_document_id returning * into v_doc;

  if v_doc."checklistItemId" is not null then
    update public.application_checklist_items set status = case
      when p_status = 'approved' then 'approved'::public.checklist_status
      when p_status = 'rejected' then 'rejected'::public.checklist_status
      else 'received'::public.checklist_status end
    where id = v_doc."checklistItemId";
  end if;
  select status::text into v_app_status from public.travel_applications where id = v_doc."applicationId";
  insert into public.application_events("applicationId", "actorId", "fromStatus", "toStatus", note, customer_visible, metadata)
  values (v_doc."applicationId", (select u.id from public.users u where u."openId" = 'supabase:' || v_actor::text limit 1),
    v_app_status, v_app_status,
    case when p_status = 'rejected' then 'A document needs attention: ' || left(trim(p_rejection_reason), 1500)
         when p_status = 'approved' then 'A submitted document has been approved'
         else 'A submitted document is under review' end,
    true, jsonb_build_object('document_id', p_document_id, 'document_status', p_status::text));
  return v_doc;
end;
$$;
revoke all on function public.phase8_staff_review_document(integer, public.document_status, text) from public;
grant execute on function public.phase8_staff_review_document(integer, public.document_status, text) to authenticated;

-- Append an audit event for every message; message body is intentionally omitted.
create or replace function public.phase8_audit_ticket_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.support_tickets set updated_at = now() where id = new.ticket_id;
  insert into public.support_ticket_events(ticket_id, actor_id, action, metadata)
  values (new.ticket_id, new.author_id,
    case when new.is_internal then 'internal_note_added' else 'message_added' end,
    jsonb_build_object('message_id', new.id, 'internal', new.is_internal));
  return new;
end;
$$;
drop trigger if exists phase8_ticket_message_audit on public.support_ticket_messages;
create trigger phase8_ticket_message_audit after insert on public.support_ticket_messages
for each row execute function public.phase8_audit_ticket_message();

-- Internal notes cannot be inserted through ordinary browser clients; edge function
-- uses the service role only after checking the actor and case scope.
revoke insert, update, delete on public.travel_application_notes from anon, authenticated;
revoke insert, update, delete on public.application_document_versions from anon, authenticated;
revoke insert, update, delete on public.support_ticket_events from anon, authenticated;

commit;
