-- AeroFly Tours Phase 8: travel applications, private documents and customer support.
-- Extends existing travel_applications/application_* tables; creates support tables only
-- because the inspected Phase 0-5 migrations do not define support tickets.

begin;

-- Connect legacy integer-user applications to Supabase Auth identities.
alter table public.travel_applications
  add column if not exists customer_auth_id uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_auth_id uuid references public.profiles(id) on delete set null,
  add column if not exists organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists visa_type text,
  add column if not exists application_data jsonb not null default '{}'::jsonb,
  add column if not exists submitted_at timestamptz,
  add column if not exists completed_at timestamptz;

update public.travel_applications a
set customer_auth_id = substring(u."openId" from 10)::uuid
from public.users u
where a.customer_auth_id is null
  and a."userId" = u.id
  and u."openId" ~ '^supabase:[0-9a-fA-F-]{36}$';

update public.travel_applications a
set assigned_auth_id = substring(u."openId" from 10)::uuid
from public.users u
where a.assigned_auth_id is null
  and a."assignedTo" = u.id
  and u."openId" ~ '^supabase:[0-9a-fA-F-]{36}$';

create index if not exists travel_applications_customer_auth_idx
  on public.travel_applications(customer_auth_id, "createdAt" desc);
create index if not exists travel_applications_assigned_auth_idx
  on public.travel_applications(assigned_auth_id, status);
create index if not exists travel_applications_org_status_idx
  on public.travel_applications(organization_id, status);

alter table public.application_checklist_items
  add column if not exists sort_order integer not null default 0,
  add column if not exists requested_from_customer boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

alter table public.application_documents
  add column if not exists storage_path text,
  add column if not exists uploaded_by uuid references public.profiles(id) on delete set null,
  add column if not exists version_number integer not null default 1,
  add column if not exists expires_on date,
  add column if not exists checksum_sha256 text,
  add column if not exists updated_at timestamptz not null default now();

-- Legacy application_documents.userId is an integer public.users ID; do not cast it to UUID.

alter table public.application_events
  add column if not exists customer_visible boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.travel_application_notes (
  id bigint generated always as identity primary key,
  application_id integer not null references public.travel_applications(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  note text not null check (length(trim(note)) between 1 and 10000),
  is_internal boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists travel_application_notes_app_idx
  on public.travel_application_notes(application_id, created_at desc);

create table if not exists public.application_document_versions (
  id bigint generated always as identity primary key,
  document_id integer not null references public.application_documents(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  storage_path text not null unique,
  file_name text not null check (length(trim(file_name)) between 1 and 255),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  checksum_sha256 text,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(document_id, version_number)
);
create index if not exists application_document_versions_document_idx
  on public.application_document_versions(document_id, version_number desc);

-- Support tickets do not exist in the inspected Phase 0-5 schema, so create them once here.
create table if not exists public.support_tickets (
  id bigint generated always as identity primary key,
  reference text not null unique default ('AT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  customer_auth_id uuid not null references public.profiles(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete set null,
  assigned_to uuid references public.profiles(id) on delete set null,
  application_id integer references public.travel_applications(id) on delete set null,
  booking_id integer references public.bookings(id) on delete set null,
  subject text not null check (length(trim(subject)) between 3 and 200),
  category text not null default 'general'
    check (category in ('general','booking','payment','visa','passport','documents','cancellation','complaint')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  status text not null default 'open'
    check (status in ('open','in_progress','waiting_customer','escalated','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint support_ticket_link_owner_check check (
    application_id is null or customer_auth_id is not null
  )
);
create index if not exists support_tickets_customer_idx
  on public.support_tickets(customer_auth_id, created_at desc);
create index if not exists support_tickets_assignment_idx
  on public.support_tickets(organization_id, assigned_to, status, priority);

create table if not exists public.support_ticket_messages (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.support_tickets(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (length(trim(body)) between 1 and 10000),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_messages_ticket_idx
  on public.support_ticket_messages(ticket_id, created_at);

create table if not exists public.support_ticket_events (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.support_tickets(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_events_ticket_idx
  on public.support_ticket_events(ticket_id, created_at desc);

-- Keep updated_at current.
create or replace function public.phase8_touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists support_tickets_touch_updated_at on public.support_tickets;
create trigger support_tickets_touch_updated_at before update on public.support_tickets
for each row execute function public.phase8_touch_updated_at();
drop trigger if exists application_checklist_touch_updated_at on public.application_checklist_items;
create trigger application_checklist_touch_updated_at before update on public.application_checklist_items
for each row execute function public.phase8_touch_updated_at();
drop trigger if exists application_documents_touch_updated_at on public.application_documents;
create trigger application_documents_touch_updated_at before update on public.application_documents
for each row execute function public.phase8_touch_updated_at();

-- Status transitions and audit events are performed atomically through RPCs.
create or replace function public.phase8_customer_owns_application(p_application_id integer, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.travel_applications a
    where a.id = p_application_id and a.customer_auth_id = p_user
  );
$$;
revoke all on function public.phase8_customer_owns_application(integer, uuid) from public;
grant execute on function public.phase8_customer_owns_application(integer, uuid) to authenticated;

create or replace function public.phase8_staff_can_access_application(p_application_id integer, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.travel_applications a
    where a.id = p_application_id
      and (
        public.has_any_role(array['owner','admin'], p_user)
        or a.assigned_auth_id = p_user
        or (a.organization_id is not null and public.is_organization_member(a.organization_id, p_user))
      )
      and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'], p_user)
  );
$$;
revoke all on function public.phase8_staff_can_access_application(integer, uuid) from public;
grant execute on function public.phase8_staff_can_access_application(integer, uuid) to authenticated;

create or replace function public.phase8_set_application_status(
  p_application_id integer,
  p_status public.travel_application_status,
  p_customer_message text default null
) returns public.travel_applications
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_app public.travel_applications; v_old text;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_app from public.travel_applications where id = p_application_id for update;
  if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
  v_old := v_app.status::text;
  if v_app.customer_auth_id = v_actor then
    if p_status not in ('submitted','cancelled') then
      raise exception 'Customers may only submit or cancel their own application' using errcode = '42501';
    end if;
    if v_app.status not in ('draft','action_required','submitted') then
      raise exception 'Application cannot transition from % to %', v_app.status, p_status using errcode = '22023';
    end if;
    if p_status = 'submitted' then
      update public.travel_applications set submitted_at = coalesce(submitted_at, now()) where id = p_application_id;
    end if;
  else
    if not public.phase8_staff_can_access_application(p_application_id, v_actor) then
      raise exception 'Not authorized for this application' using errcode = '42501';
    end if;
    if p_status = 'draft' then raise exception 'Staff cannot move an application back to draft' using errcode = '22023'; end if;
    if v_app.status in ('completed','cancelled','rejected') and p_status not in (v_app.status) then
      raise exception 'Terminal application status cannot be reopened by this operation' using errcode = '22023';
    end if;
    if p_status = 'completed' then
      update public.travel_applications set completed_at = now() where id = p_application_id;
    end if;
  end if;
  update public.travel_applications set status = p_status where id = p_application_id returning * into v_app;
  insert into public.application_events("applicationId", "actorId", "fromStatus", "toStatus", note, customer_visible)
  values (p_application_id, (select u.id from public.users u where u."openId" = 'supabase:' || v_actor::text limit 1), v_old, p_status::text,
    nullif(left(coalesce(p_customer_message,''),2000),''), p_customer_message is not null);
  return v_app;
end;
$$;
revoke all on function public.phase8_set_application_status(integer, public.travel_application_status, text) from public;
grant execute on function public.phase8_set_application_status(integer, public.travel_application_status, text) to authenticated;

-- Support ticket status changes, assignment, and audit log in one transaction.
create or replace function public.phase8_update_support_ticket(
  p_ticket_id bigint,
  p_status text default null,
  p_priority text default null,
  p_assigned_to uuid default null,
  p_organization_id uuid default null
) returns public.support_tickets
language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_ticket public.support_tickets; v_old text;
begin
  if v_actor is null or not public.has_any_role(array['owner','admin','manager','customer_care','staff'], v_actor) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_ticket from public.support_tickets where id = p_ticket_id for update;
  if not found then raise exception 'Ticket not found' using errcode = 'P0002'; end if;
  if not (public.has_any_role(array['owner','admin'], v_actor)
      or v_ticket.assigned_to = v_actor
      or (v_ticket.organization_id is not null and public.is_organization_member(v_ticket.organization_id, v_actor))) then
    raise exception 'Ticket outside your organization or assignment scope' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('open','in_progress','waiting_customer','escalated','resolved','closed') then
    raise exception 'Invalid ticket status' using errcode = '22023';
  end if;
  if p_priority is not null and p_priority not in ('low','normal','high','urgent') then
    raise exception 'Invalid ticket priority' using errcode = '22023';
  end if;
  if p_assigned_to is not null then
    if not public.has_any_role(array['owner','admin','manager','customer_care','staff'], p_assigned_to) then
      raise exception 'Assignee must have an active support staff role' using errcode = '22023';
    end if;
    if coalesce(p_organization_id, v_ticket.organization_id) is not null
       and not public.is_organization_member(coalesce(p_organization_id, v_ticket.organization_id), p_assigned_to) then
      raise exception 'Assignee must belong to the ticket organization' using errcode = '22023';
    end if;
  end if;
  if p_organization_id is not null and not public.has_any_role(array['owner','admin','manager'], v_actor) then
    raise exception 'Only managers can move a ticket between organizations' using errcode = '42501';
  end if;
  v_old := v_ticket.status;
  update public.support_tickets set
    status = coalesce(p_status, status),
    priority = coalesce(p_priority, priority),
    assigned_to = case when p_assigned_to is not null then p_assigned_to else assigned_to end,
    organization_id = coalesce(p_organization_id, organization_id),
    resolved_at = case when p_status = 'resolved' then now() when p_status in ('open','in_progress') then null else resolved_at end
  where id = p_ticket_id returning * into v_ticket;
  insert into public.support_ticket_events(ticket_id, actor_id, action, from_status, to_status, metadata)
  values (p_ticket_id, v_actor, 'ticket_updated', v_old, v_ticket.status,
    jsonb_build_object('priority', v_ticket.priority, 'assigned_to', v_ticket.assigned_to, 'organization_id', v_ticket.organization_id));
  return v_ticket;
end;
$$;
revoke all on function public.phase8_update_support_ticket(bigint, text, text, uuid, uuid) from public;
grant execute on function public.phase8_update_support_ticket(bigint, text, text, uuid, uuid) to authenticated;

-- RLS: customer-visible application rows are scoped by auth UUID; staff by assignment/org.
alter table public.travel_applications enable row level security;
alter table public.application_checklist_items enable row level security;
alter table public.application_documents enable row level security;
alter table public.application_events enable row level security;
alter table public.travel_application_notes enable row level security;
alter table public.application_document_versions enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_events enable row level security;

drop policy if exists phase8_application_customer_select on public.travel_applications;
create policy phase8_application_customer_select on public.travel_applications for select to authenticated
using (customer_auth_id = auth.uid());
drop policy if exists phase8_application_staff_select on public.travel_applications;
create policy phase8_application_staff_select on public.travel_applications for select to authenticated
using (public.phase8_staff_can_access_application(id));
-- Clients cannot directly alter application status or assignment; use RPC/Edge Function.
revoke insert, update, delete on public.travel_applications from anon, authenticated;

drop policy if exists phase8_checklist_customer_select on public.application_checklist_items;
create policy phase8_checklist_customer_select on public.application_checklist_items for select to authenticated
using (public.phase8_customer_owns_application("applicationId"));
drop policy if exists phase8_checklist_staff_select on public.application_checklist_items;
create policy phase8_checklist_staff_select on public.application_checklist_items for select to authenticated
using (public.phase8_staff_can_access_application("applicationId"));
revoke insert, update, delete on public.application_checklist_items from anon, authenticated;

drop policy if exists phase8_documents_customer_select on public.application_documents;
create policy phase8_documents_customer_select on public.application_documents for select to authenticated
using (public.phase8_customer_owns_application("applicationId"));
drop policy if exists phase8_documents_staff_select on public.application_documents;
create policy phase8_documents_staff_select on public.application_documents for select to authenticated
using (public.phase8_staff_can_access_application("applicationId"));
revoke insert, update, delete on public.application_documents from anon, authenticated;

drop policy if exists phase8_events_customer_select on public.application_events;
create policy phase8_events_customer_select on public.application_events for select to authenticated
using (customer_visible and public.phase8_customer_owns_application("applicationId"));
drop policy if exists phase8_events_staff_select on public.application_events;
create policy phase8_events_staff_select on public.application_events for select to authenticated
using (public.phase8_staff_can_access_application("applicationId"));
revoke insert, update, delete on public.application_events from anon, authenticated;

drop policy if exists phase8_application_notes_staff_select on public.travel_application_notes;
create policy phase8_application_notes_staff_select on public.travel_application_notes for select to authenticated
using (is_internal and public.phase8_staff_can_access_application(application_id));
revoke insert, update, delete on public.travel_application_notes from anon, authenticated;

drop policy if exists phase8_document_versions_customer_select on public.application_document_versions;
create policy phase8_document_versions_customer_select on public.application_document_versions for select to authenticated
using (exists (select 1 from public.application_documents d where d.id = document_id and public.phase8_customer_owns_application(d."applicationId")));
drop policy if exists phase8_document_versions_staff_select on public.application_document_versions;
create policy phase8_document_versions_staff_select on public.application_document_versions for select to authenticated
using (exists (select 1 from public.application_documents d where d.id = document_id and public.phase8_staff_can_access_application(d."applicationId")));
revoke insert, update, delete on public.application_document_versions from anon, authenticated;

-- Ticket access: customers see their tickets; staff see tickets in their org/assignment scope.
drop policy if exists phase8_tickets_select on public.support_tickets;
create policy phase8_tickets_select on public.support_tickets for select to authenticated
using (customer_auth_id = auth.uid() or public.has_any_role(array['owner','admin'], auth.uid())
  or (assigned_to = auth.uid() and public.has_any_role(array['owner','admin','manager','customer_care','staff'], auth.uid()))
  or (organization_id is not null and public.is_organization_member(organization_id, auth.uid())
      and public.has_any_role(array['manager','customer_care','staff'], auth.uid())));
drop policy if exists phase8_tickets_customer_insert on public.support_tickets;
create policy phase8_tickets_customer_insert on public.support_tickets for insert to authenticated
with check (customer_auth_id = auth.uid() and assigned_to is null and status = 'open'
  and (application_id is null or public.phase8_customer_owns_application(application_id))
  and (booking_id is null or exists (select 1 from public.bookings b where b.id = booking_id and b.customer_auth_id = auth.uid())));
revoke update, delete on public.support_tickets from anon, authenticated;

drop policy if exists phase8_ticket_messages_select on public.support_ticket_messages;
create policy phase8_ticket_messages_select on public.support_ticket_messages for select to authenticated
using (exists (select 1 from public.support_tickets t where t.id = ticket_id
  and ((t.customer_auth_id = auth.uid() and not is_internal)
    or public.has_any_role(array['owner','admin'], auth.uid())
    or (t.assigned_to = auth.uid() and public.has_any_role(array['owner','admin','manager','customer_care','staff'], auth.uid()))
    or (t.organization_id is not null and public.is_organization_member(t.organization_id, auth.uid())
      and public.has_any_role(array['manager','customer_care','staff'], auth.uid())))));
drop policy if exists phase8_ticket_messages_insert on public.support_ticket_messages;
create policy phase8_ticket_messages_insert on public.support_ticket_messages for insert to authenticated
with check (author_id = auth.uid() and exists (select 1 from public.support_tickets t where t.id = ticket_id
  and ((t.customer_auth_id = auth.uid() and not is_internal and t.status not in ('resolved','closed'))
    or (not (t.customer_auth_id = auth.uid()) and (public.has_any_role(array['owner','admin','manager','customer_care','staff'], auth.uid()))
      and (public.has_any_role(array['owner','admin'], auth.uid()) or t.assigned_to = auth.uid()
        or (t.organization_id is not null and public.is_organization_member(t.organization_id, auth.uid())))))));
revoke update, delete on public.support_ticket_messages from anon, authenticated;

drop policy if exists phase8_ticket_events_select on public.support_ticket_events;
create policy phase8_ticket_events_select on public.support_ticket_events for select to authenticated
using (exists (select 1 from public.support_tickets t where t.id = ticket_id
  and (t.customer_auth_id = auth.uid() or public.has_any_role(array['owner','admin'], auth.uid())
    or (t.assigned_to = auth.uid() and public.has_any_role(array['owner','admin','manager','customer_care','staff'], auth.uid()))
    or (t.organization_id is not null and public.is_organization_member(t.organization_id, auth.uid())
      and public.has_any_role(array['manager','customer_care','staff'], auth.uid())))));
revoke insert, update, delete on public.support_ticket_events from anon, authenticated;

-- Safe parser prevents malformed object names from raising cast errors in RLS.
create or replace function public.phase8_safe_int(p_value text)
returns integer language plpgsql immutable set search_path = public as $$
begin
  if p_value is null or p_value !~ '^[0-9]+$' then return null; end if;
  return p_value::integer;
exception when numeric_value_out_of_range then return null;
end;
$$;
revoke all on function public.phase8_safe_int(text) from public;
grant execute on function public.phase8_safe_int(text) to authenticated;

-- Private bucket. Paths: <customer-auth-uuid>/<application-id>/<document-id>/<generated-name>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('travel-documents', 'travel-documents', false, 10485760,
  array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists phase8_travel_docs_customer_read on storage.objects;
create policy phase8_travel_docs_customer_read on storage.objects for select to authenticated
using (bucket_id = 'travel-documents' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.application_documents d
    where d.id = public.phase8_safe_int((storage.foldername(name))[3])
      and d."applicationId" = public.phase8_safe_int((storage.foldername(name))[2])
      and d.storage_path = name and public.phase8_customer_owns_application(d."applicationId")));
drop policy if exists phase8_travel_docs_customer_insert on storage.objects;
create policy phase8_travel_docs_customer_insert on storage.objects for insert to authenticated
with check (bucket_id = 'travel-documents' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.application_documents d
    where d.id = public.phase8_safe_int((storage.foldername(name))[3])
      and d."applicationId" = public.phase8_safe_int((storage.foldername(name))[2])
      and d.storage_path = name and d.uploaded_by = auth.uid()
      and public.phase8_customer_owns_application(d."applicationId")));
drop policy if exists phase8_travel_docs_staff_read on storage.objects;
create policy phase8_travel_docs_staff_read on storage.objects for select to authenticated
using (bucket_id = 'travel-documents' and public.phase8_staff_can_access_application(
  public.phase8_safe_int((storage.foldername(name))[2])));
-- No browser UPDATE/DELETE policies: re-uploads create a new version/path.
commit;
