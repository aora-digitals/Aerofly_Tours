-- AeroFly Tours — Phase 4 CRM & Customer Operations
-- Extends Phase 1–3. Does not recreate existing tables.

begin;

-- ============================================================
-- STATUS EXTENSIONS
-- ============================================================

do $$ begin
  alter type public.enquiry_status add value if not exists 'assigned';
  alter type public.enquiry_status add value if not exists 'follow_up';
  alter type public.enquiry_status add value if not exists 'qualified';
  alter type public.enquiry_status add value if not exists 'converted';
  alter type public.enquiry_status add value if not exists 'lost';
  alter type public.enquiry_status add value if not exists 'closed';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.appointment_status add value if not exists 'rescheduled';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.callback_status add value if not exists 'pending';
  alter type public.callback_status add value if not exists 'assigned';
  alter type public.callback_status add value if not exists 'in_progress';
exception when duplicate_object then null; end $$;

-- ============================================================
-- DEFAULT CRM DEPARTMENTS
-- ============================================================

insert into public.departments(organization_id, name, slug)
select o.id, d.name, d.slug
from public.organizations o
cross join (values
  ('Sales & Counselling', 'sales-counselling'),
  ('Customer Care', 'customer-care'),
  ('Operations', 'operations'),
  ('Marketing', 'marketing')
) as d(name, slug)
where o.slug = 'aerofly-tours'
on conflict (organization_id, slug) do nothing;

-- Keep the customer email available to CRM without exposing auth.users directly.
alter table public.profiles
  add column if not exists email text;

create index if not exists profiles_email_idx
  on public.profiles(email);

update public.profiles p
set email = au.email
from auth.users au
where au.id = p.id
  and p.email is distinct from au.email;

create or replace function public.sync_profile_auth_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set email = new.email
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row execute function public.sync_profile_auth_email();

-- ============================================================
-- CRM FIELDS ON EXISTING OPERATIONAL TABLES
-- ============================================================

alter table public.enquiries
  add column if not exists source text not null default 'website',
  add column if not exists "followUpAt" timestamptz,
  add column if not exists assigned_employee_id uuid
    references public.profiles(id) on delete set null,
  add column if not exists assigned_department_id uuid
    references public.departments(id) on delete set null,
  add column if not exists destination_id integer
    references public.destinations(id) on delete set null;

alter table public.callback_requests
  add column if not exists priority public.enquiry_priority not null default 'normal',
  add column if not exists assigned_employee_id uuid
    references public.profiles(id) on delete set null,
  add column if not exists assigned_department_id uuid
    references public.departments(id) on delete set null;

alter table public.appointments
  add column if not exists assigned_employee_id uuid
    references public.profiles(id) on delete set null,
  add column if not exists assigned_department_id uuid
    references public.departments(id) on delete set null,
  add column if not exists "followUpAt" timestamptz;

create index if not exists enquiries_follow_up_idx
  on public.enquiries("followUpAt");
create index if not exists enquiries_assignment_idx
  on public.enquiries(assigned_employee_id, assigned_department_id);
create index if not exists enquiries_customer_auth_idx
  on public.enquiries(customer_auth_id);
create index if not exists enquiries_destination_idx
  on public.enquiries(destination_id);
create index if not exists callback_assignment_idx
  on public.callback_requests(assigned_employee_id, assigned_department_id);
create index if not exists appointment_assignment_idx
  on public.appointments(assigned_employee_id, assigned_department_id);
create index if not exists appointment_follow_up_idx
  on public.appointments("followUpAt");

-- ============================================================
-- ASSIGNMENT HISTORY
-- ============================================================

create table if not exists public.enquiry_assignments (
  id uuid primary key default gen_random_uuid(),
  enquiry_id integer not null references public.enquiries(id) on delete cascade,
  assigned_employee_id uuid references public.profiles(id) on delete set null,
  assigned_department_id uuid references public.departments(id) on delete set null,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz
);

create index if not exists enquiry_assignments_enquiry_idx
  on public.enquiry_assignments(enquiry_id, assigned_at desc);
create index if not exists enquiry_assignments_employee_idx
  on public.enquiry_assignments(assigned_employee_id, assigned_at desc);
create index if not exists enquiry_assignments_department_idx
  on public.enquiry_assignments(assigned_department_id, assigned_at desc);
create unique index if not exists enquiry_assignments_one_current_idx
  on public.enquiry_assignments(enquiry_id)
  where unassigned_at is null;

-- ============================================================
-- INTERNAL NOTES
-- ============================================================

create table if not exists public.enquiry_notes (
  id uuid primary key default gen_random_uuid(),
  enquiry_id integer not null references public.enquiries(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enquiry_notes_body_check check (length(trim(body)) between 1 and 5000)
);

create table if not exists public.appointment_notes (
  id uuid primary key default gen_random_uuid(),
  appointment_id integer not null references public.appointments(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_notes_body_check check (length(trim(body)) between 1 and 5000)
);

create table if not exists public.callback_notes (
  id uuid primary key default gen_random_uuid(),
  callback_id integer not null references public.callback_requests(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint callback_notes_body_check check (length(trim(body)) between 1 and 5000)
);

create index if not exists enquiry_notes_enquiry_idx
  on public.enquiry_notes(enquiry_id, created_at desc);
create index if not exists appointment_notes_appointment_idx
  on public.appointment_notes(appointment_id, created_at desc);
create index if not exists callback_notes_callback_idx
  on public.callback_notes(callback_id, created_at desc);

drop trigger if exists enquiry_notes_updated_at on public.enquiry_notes;
create trigger enquiry_notes_updated_at
before update on public.enquiry_notes
for each row execute function public.set_updated_at();

drop trigger if exists appointment_notes_updated_at on public.appointment_notes;
create trigger appointment_notes_updated_at
before update on public.appointment_notes
for each row execute function public.set_updated_at();

drop trigger if exists callback_notes_updated_at on public.callback_notes;
create trigger callback_notes_updated_at
before update on public.callback_notes
for each row execute function public.set_updated_at();

-- ============================================================
-- COMMUNICATION HISTORY
-- ============================================================

create table if not exists public.communication_events (
  id uuid primary key default gen_random_uuid(),
  customer_auth_id uuid references public.profiles(id) on delete set null,
  enquiry_id integer references public.enquiries(id) on delete cascade,
  appointment_id integer references public.appointments(id) on delete cascade,
  callback_id integer references public.callback_requests(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint communication_event_entity_check check (
    ((enquiry_id is not null)::integer +
     (appointment_id is not null)::integer +
     (callback_id is not null)::integer) = 1
  ),
  constraint communication_event_type_check check (
    event_type in (
      'enquiry_submitted',
      'staff_contacted_customer',
      'appointment_created',
      'appointment_updated',
      'callback_created',
      'callback_completed',
      'quotation_requested',
      'status_changed'
    )
  ),
  constraint communication_event_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists communication_events_customer_idx
  on public.communication_events(customer_auth_id, created_at desc);
create index if not exists communication_events_enquiry_idx
  on public.communication_events(enquiry_id, created_at desc);
create index if not exists communication_events_appointment_idx
  on public.communication_events(appointment_id, created_at desc);
create index if not exists communication_events_callback_idx
  on public.communication_events(callback_id, created_at desc);

-- ============================================================
-- AUDIT LOG
-- ============================================================

create table if not exists public.crm_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  changed_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint crm_audit_entity_type_check check (
    entity_type in ('enquiry','appointment','callback','assignment','note')
  ),
  constraint crm_audit_action_check check (
    action in (
      'ENQUIRY_CREATED',
      'ENQUIRY_ASSIGNED',
      'ENQUIRY_STATUS_CHANGED',
      'ENQUIRY_UPDATED',
      'APPOINTMENT_CREATED',
      'APPOINTMENT_UPDATED',
      'CALLBACK_CREATED',
      'CALLBACK_ASSIGNED',
      'CALLBACK_UPDATED',
      'NOTE_CREATED'
    )
  ),
  constraint crm_audit_changed_fields_object_check check (jsonb_typeof(changed_fields) = 'object')
);

create index if not exists crm_audit_entity_idx
  on public.crm_audit_log(entity_type, entity_id, created_at desc);
create index if not exists crm_audit_actor_idx
  on public.crm_audit_log(actor_id, created_at desc);

-- ============================================================
-- RBAC PERMISSIONS
-- ============================================================

insert into public.permissions(key, description)
values
  ('crm.dashboard.read', 'Read CRM operational dashboard'),
  ('crm.customers.read', 'Read permitted customer CRM records'),
  ('crm.customers.update', 'Update permitted customer CRM records'),
  ('crm.enquiries.read', 'Read permitted enquiries'),
  ('crm.enquiries.create', 'Create CRM enquiries'),
  ('crm.enquiries.update', 'Update enquiry operational fields'),
  ('crm.assign', 'Assign and reassign CRM work'),
  ('crm.notes.read', 'Read internal CRM notes'),
  ('crm.notes.create', 'Create internal CRM notes'),
  ('crm.appointments.read', 'Read permitted appointments'),
  ('crm.appointments.update', 'Update appointment workflow'),
  ('crm.callbacks.read', 'Read permitted callbacks'),
  ('crm.callbacks.update', 'Update callback workflow'),
  ('crm.communication.read', 'Read customer communication history'),
  ('crm.audit.read', 'Read CRM audit history')
on conflict(key) do update set description = excluded.description;

-- Owner/admin: all CRM permissions.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key in ('owner','admin')
  and p.key like 'crm.%'
on conflict do nothing;

-- Manager: company-wide operational CRM.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key = 'manager'
  and p.key in (
    'crm.dashboard.read','crm.customers.read','crm.customers.update',
    'crm.enquiries.read','crm.enquiries.create','crm.enquiries.update',
    'crm.assign','crm.notes.read','crm.notes.create',
    'crm.appointments.read','crm.appointments.update',
    'crm.callbacks.read','crm.callbacks.update',
    'crm.communication.read','crm.audit.read'
  )
on conflict do nothing;

-- Customer care: department/assignment scoped.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key = 'customer_care'
  and p.key in (
    'crm.dashboard.read','crm.customers.read','crm.customers.update',
    'crm.enquiries.read','crm.enquiries.create','crm.enquiries.update',
    'crm.assign','crm.notes.read','crm.notes.create',
    'crm.appointments.read','crm.appointments.update',
    'crm.callbacks.read','crm.callbacks.update',
    'crm.communication.read'
  )
on conflict do nothing;

-- Counsellor: lead/customer workflow, without assignment authority.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key = 'counsellor'
  and p.key in (
    'crm.dashboard.read','crm.customers.read','crm.customers.update',
    'crm.enquiries.read','crm.enquiries.create','crm.enquiries.update',
    'crm.notes.read','crm.notes.create',
    'crm.appointments.read','crm.callbacks.read',
    'crm.communication.read'
  )
on conflict do nothing;

-- Staff: assigned work only.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key = 'staff'
  and p.key in (
    'crm.dashboard.read','crm.customers.read',
    'crm.enquiries.read','crm.enquiries.update',
    'crm.notes.read','crm.notes.create',
    'crm.appointments.read','crm.appointments.update',
    'crm.callbacks.read','crm.callbacks.update',
    'crm.communication.read'
  )
on conflict do nothing;

-- ============================================================
-- CRM ACCESS HELPERS
-- SECURITY DEFINER avoids RLS recursion while evaluating ownership.
-- The functions do not return row data.
-- ============================================================

create or replace function public.crm_is_staff_profile(
  p_user uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = p_user
      and r.key in ('owner','admin','manager','customer_care','counsellor','staff')
  );
$$;

-- ============================================================
-- ASSIGNMENT VALIDATION
-- ============================================================

create or replace function public.validate_crm_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_employee_id is not null
     and not public.crm_is_staff_profile(new.assigned_employee_id) then
    raise exception 'Assigned employee is not an active CRM staff account';
  end if;

  if new.assigned_department_id is not null
     and not exists (select 1 from public.departments where id = new.assigned_department_id) then
    raise exception 'Assigned department does not exist';
  end if;

  return new;
end;
$$;

drop trigger if exists enquiries_validate_crm_assignment on public.enquiries;
create trigger enquiries_validate_crm_assignment
before insert or update of assigned_employee_id, assigned_department_id on public.enquiries
for each row execute function public.validate_crm_assignment();

drop trigger if exists appointments_validate_crm_assignment on public.appointments;
create trigger appointments_validate_crm_assignment
before insert or update of assigned_employee_id, assigned_department_id on public.appointments
for each row execute function public.validate_crm_assignment();

drop trigger if exists callbacks_validate_crm_assignment on public.callback_requests;
create trigger callbacks_validate_crm_assignment
before insert or update of assigned_employee_id, assigned_department_id on public.callback_requests
for each row execute function public.validate_crm_assignment();

create or replace function public.crm_can_access_enquiry(
  p_enquiry_id integer,
  p_user uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e record;
begin
  select customer_auth_id, assigned_employee_id, assigned_department_id
  into e
  from public.enquiries
  where id = p_enquiry_id;

  if not found then return false; end if;
  if p_user = e.customer_auth_id then return true; end if;
  if public.has_any_role(array['owner','admin','manager'], p_user) then return true; end if;

  return (
    e.assigned_employee_id = p_user
    or exists (
      select 1
      from public.organization_memberships om
      where om.user_id = p_user
        and om.status = 'active'
        and om.department_id = e.assigned_department_id
    )
  );
end;
$$;

create or replace function public.crm_can_operate_enquiry(
  p_enquiry_id integer,
  p_user uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.has_any_role(array['owner','admin','manager'], p_user) then return true; end if;
  return public.crm_can_access_enquiry(p_enquiry_id, p_user)
    and public.has_any_role(array['customer_care','counsellor','staff'], p_user);
end;
$$;

create or replace function public.crm_can_manage_assignment(
  p_enquiry_id integer,
  p_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role(array['owner','admin','manager','customer_care'], p_user)
    and public.crm_can_access_enquiry(p_enquiry_id, p_user);
$$;

create or replace function public.crm_can_access_customer(
  p_customer uuid,
  p_user uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_customer = p_user then return true; end if;
  if public.has_any_role(array['owner','admin','manager'], p_user) then return true; end if;

  return exists (
    select 1 from public.enquiries e
    where e.customer_auth_id = p_customer
      and public.crm_can_access_enquiry(e.id, p_user)
  )
  or exists (
    select 1 from public.appointments a
    where a.customer_auth_id = p_customer
      and (
        a.assigned_employee_id = p_user
        or public.has_any_role(array['customer_care','counsellor','staff'], p_user)
        and exists (
          select 1 from public.organization_memberships om
          where om.user_id = p_user and om.status = 'active'
            and om.department_id = a.assigned_department_id
        )
      )
  )
  or exists (
    select 1 from public.callback_requests c
    where c.customer_auth_id = p_customer
      and (
        c.assigned_employee_id = p_user
        or public.has_any_role(array['customer_care','staff'], p_user)
        and exists (
          select 1 from public.organization_memberships om
          where om.user_id = p_user and om.status = 'active'
            and om.department_id = c.assigned_department_id
        )
      )
  );
end;
$$;

create or replace function public.crm_can_access_appointment(
  p_appointment_id integer,
  p_user uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare a record;
begin
  select customer_auth_id, assigned_employee_id, assigned_department_id into a
  from public.appointments where id = p_appointment_id;
  if not found then return false; end if;
  if p_user = a.customer_auth_id then return true; end if;
  if public.has_any_role(array['owner','admin','manager'], p_user) then return true; end if;
  return (
    a.assigned_employee_id = p_user
    or exists (
      select 1 from public.organization_memberships om
      where om.user_id = p_user and om.status = 'active'
        and om.department_id = a.assigned_department_id
    )
  ) and public.has_any_role(array['customer_care','staff','counsellor'], p_user);
end;
$$;

create or replace function public.crm_can_access_callback(
  p_callback_id integer,
  p_user uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare c record;
begin
  select customer_auth_id, assigned_employee_id, assigned_department_id into c
  from public.callback_requests where id = p_callback_id;
  if not found then return false; end if;
  if p_user = c.customer_auth_id then return true; end if;
  if public.has_any_role(array['owner','admin','manager'], p_user) then return true; end if;
  return (
    c.assigned_employee_id = p_user
    or exists (
      select 1 from public.organization_memberships om
      where om.user_id = p_user and om.status = 'active'
        and om.department_id = c.assigned_department_id
    )
  ) and public.has_any_role(array['customer_care','staff'], p_user);
end;
$$;

-- ============================================================
-- RLS
-- ============================================================

alter table public.enquiries enable row level security;
alter table public.callback_requests enable row level security;
alter table public.appointments enable row level security;
alter table public.profiles enable row level security;
alter table public.enquiry_assignments enable row level security;
alter table public.enquiry_notes enable row level security;
alter table public.appointment_notes enable row level security;
alter table public.callback_notes enable row level security;
alter table public.communication_events enable row level security;
alter table public.crm_audit_log enable row level security;

drop policy if exists departments_crm_select on public.departments;
create policy departments_crm_select
on public.departments for select to authenticated
using (
  public.has_any_role(array['owner','admin','manager'])
  or public.is_organization_member(organization_id)
);

-- Profiles: customers keep own access; CRM staff get only permitted customer records.
drop policy if exists profiles_staff_crm_select on public.profiles;
create policy profiles_staff_crm_select
on public.profiles for select to authenticated
using (
  public.has_any_role(array['owner','admin','manager'])
  or public.crm_can_access_customer(id)
);

drop policy if exists profiles_staff_directory_select on public.profiles;
create policy profiles_staff_directory_select
on public.profiles for select to authenticated
using (
  public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'])
  and public.crm_is_staff_profile(id)
);

-- Customer profile data is read-only to CRM staff.
-- Profile ownership updates remain customer-controlled.


-- Enquiries: customer read/insert own; staff read/update permitted records.
drop policy if exists enquiries_customer_select_own on public.enquiries;
create policy enquiries_customer_select_own
on public.enquiries for select to authenticated
using (customer_auth_id = auth.uid());

drop policy if exists enquiries_customer_insert_own on public.enquiries;
create policy enquiries_customer_insert_own
on public.enquiries for insert to authenticated
with check (
  customer_auth_id = auth.uid()
  and status = 'new'
  and assigned_employee_id is null
  and assigned_department_id is null
);

drop policy if exists enquiries_staff_select on public.enquiries;
create policy enquiries_staff_select
on public.enquiries for select to authenticated
using (
  public.crm_can_access_enquiry(id)
  and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'])
);

drop policy if exists enquiries_staff_update on public.enquiries;
create policy enquiries_staff_update
on public.enquiries for update to authenticated
using (public.crm_can_operate_enquiry(id))
with check (public.crm_can_operate_enquiry(id));

-- Assignment history: only authorized operational staff.
drop policy if exists enquiry_assignments_staff_select on public.enquiry_assignments;
create policy enquiry_assignments_staff_select
on public.enquiry_assignments for select to authenticated
using (public.crm_can_access_enquiry(enquiry_id));

drop policy if exists enquiry_assignments_staff_insert on public.enquiry_assignments;
create policy enquiry_assignments_staff_insert
on public.enquiry_assignments for insert to authenticated
with check (public.crm_can_manage_assignment(enquiry_id) and assigned_by = auth.uid());

-- Internal notes.
drop policy if exists enquiry_notes_staff_select on public.enquiry_notes;
create policy enquiry_notes_staff_select
on public.enquiry_notes for select to authenticated
using (public.crm_can_access_enquiry(enquiry_id) and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff']));

drop policy if exists enquiry_notes_staff_insert on public.enquiry_notes;
create policy enquiry_notes_staff_insert
on public.enquiry_notes for insert to authenticated
with check (public.crm_can_access_enquiry(enquiry_id) and author_id = auth.uid() and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff']));

drop policy if exists appointment_notes_staff_select on public.appointment_notes;
create policy appointment_notes_staff_select
on public.appointment_notes for select to authenticated
using (public.crm_can_access_appointment(appointment_id) and public.has_any_role(array['owner','admin','manager','customer_care','staff']));

drop policy if exists appointment_notes_staff_insert on public.appointment_notes;
create policy appointment_notes_staff_insert
on public.appointment_notes for insert to authenticated
with check (public.crm_can_access_appointment(appointment_id) and author_id = auth.uid() and public.has_any_role(array['owner','admin','manager','customer_care','staff']));

drop policy if exists callback_notes_staff_select on public.callback_notes;
create policy callback_notes_staff_select
on public.callback_notes for select to authenticated
using (public.crm_can_access_callback(callback_id) and public.has_any_role(array['owner','admin','manager','customer_care','staff']));

drop policy if exists callback_notes_staff_insert on public.callback_notes;
create policy callback_notes_staff_insert
on public.callback_notes for insert to authenticated
with check (public.crm_can_access_callback(callback_id) and author_id = auth.uid() and public.has_any_role(array['owner','admin','manager','customer_care','staff']));

-- Appointments.
drop policy if exists appointments_customer_select_own on public.appointments;
create policy appointments_customer_select_own
on public.appointments for select to authenticated
using (customer_auth_id = auth.uid());

drop policy if exists appointments_customer_insert_own on public.appointments;
create policy appointments_customer_insert_own
on public.appointments for insert to authenticated
with check (
  customer_auth_id = auth.uid()
  and status = 'requested'
  and assigned_employee_id is null
  and assigned_department_id is null
);

drop policy if exists appointments_staff_select on public.appointments;
create policy appointments_staff_select
on public.appointments for select to authenticated
using (public.crm_can_access_appointment(id) and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff']));

drop policy if exists appointments_staff_update on public.appointments;
create policy appointments_staff_update
on public.appointments for update to authenticated
using (public.crm_can_access_appointment(id) and public.has_any_role(array['owner','admin','manager','customer_care','staff']))
with check (public.crm_can_access_appointment(id) and public.has_any_role(array['owner','admin','manager','customer_care','staff']));

-- Callbacks.
drop policy if exists callbacks_customer_select_own on public.callback_requests;
create policy callbacks_customer_select_own
on public.callback_requests for select to authenticated
using (customer_auth_id = auth.uid());

drop policy if exists callbacks_customer_insert_own on public.callback_requests;
create policy callbacks_customer_insert_own
on public.callback_requests for insert to authenticated
with check (
  customer_auth_id = auth.uid()
  and status = 'requested'
  and assigned_employee_id is null
  and assigned_department_id is null
);

drop policy if exists callbacks_staff_select on public.callback_requests;
create policy callbacks_staff_select
on public.callback_requests for select to authenticated
using (public.crm_can_access_callback(id) and public.has_any_role(array['owner','admin','manager','customer_care','staff']));

drop policy if exists callbacks_staff_update on public.callback_requests;
create policy callbacks_staff_update
on public.callback_requests for update to authenticated
using (public.crm_can_access_callback(id) and public.has_any_role(array['owner','admin','manager','customer_care','staff']))
with check (public.crm_can_access_callback(id) and public.has_any_role(array['owner','admin','manager','customer_care','staff']));

-- Communication history is staff-only. Customers never receive this table.
drop policy if exists communication_staff_select on public.communication_events;
create policy communication_staff_select
on public.communication_events for select to authenticated
using (
  public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'])
  and (
    (enquiry_id is not null and public.crm_can_access_enquiry(enquiry_id))
    or (appointment_id is not null and public.crm_can_access_appointment(appointment_id))
    or (callback_id is not null and public.crm_can_access_callback(callback_id))
  )
);

-- Audit log is management-only.
drop policy if exists crm_audit_management_select on public.crm_audit_log;
create policy crm_audit_management_select
on public.crm_audit_log for select to authenticated
using (public.has_any_role(array['owner','admin','manager']));

-- No direct update/delete policies for notes, communication events, or audit log.

-- ============================================================
-- AUDIT / COMMUNICATION TRIGGERS
-- ============================================================

create or replace function public.write_crm_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_changed_fields jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.crm_audit_log(actor_id, action, entity_type, entity_id, changed_fields)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_changed_fields, '{}'::jsonb));
end;
$$;

create or replace function public.audit_enquiry_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare changed jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.write_crm_audit('ENQUIRY_CREATED','enquiry',new.id::text,'{}'::jsonb);
    if new.customer_auth_id is not null then
      insert into public.communication_events(customer_auth_id,enquiry_id,actor_id,event_type,summary)
      values(new.customer_auth_id,new.id,auth.uid(),'enquiry_submitted','Enquiry submitted');
    end if;
    return new;
  end if;

  if old.status is distinct from new.status then
    changed := jsonb_build_object('status', jsonb_build_object('from', old.status::text, 'to', new.status::text));
    perform public.write_crm_audit('ENQUIRY_STATUS_CHANGED','enquiry',new.id::text,changed);
    insert into public.communication_events(customer_auth_id,enquiry_id,actor_id,event_type,summary,metadata)
    values(new.customer_auth_id,new.id,auth.uid(),'status_changed','Enquiry status changed',changed);
  elsif old.assigned_employee_id is distinct from new.assigned_employee_id
     or old.assigned_department_id is distinct from new.assigned_department_id then
    changed := jsonb_build_object('assigned_employee_id', new.assigned_employee_id, 'assigned_department_id', new.assigned_department_id);
    perform public.write_crm_audit('ENQUIRY_ASSIGNED','enquiry',new.id::text,changed);
  else
    perform public.write_crm_audit('ENQUIRY_UPDATED','enquiry',new.id::text,'{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists enquiry_crm_audit on public.enquiries;
create trigger enquiry_crm_audit
after insert or update on public.enquiries
for each row execute function public.audit_enquiry_change();

create or replace function public.audit_appointment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_crm_audit('APPOINTMENT_CREATED','appointment',new.id::text,'{}'::jsonb);
    insert into public.communication_events(customer_auth_id,appointment_id,actor_id,event_type,summary)
    values(new.customer_auth_id,new.id,auth.uid(),'appointment_created','Appointment created');
  else
    perform public.write_crm_audit('APPOINTMENT_UPDATED','appointment',new.id::text,'{}'::jsonb);
    insert into public.communication_events(customer_auth_id,appointment_id,actor_id,event_type,summary)
    values(new.customer_auth_id,new.id,auth.uid(),'appointment_updated','Appointment updated');
  end if;
  return new;
end;
$$;

drop trigger if exists appointment_crm_audit on public.appointments;
create trigger appointment_crm_audit
after insert or update on public.appointments
for each row execute function public.audit_appointment_change();

create or replace function public.audit_callback_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_crm_audit('CALLBACK_CREATED','callback',new.id::text,'{}'::jsonb);
    insert into public.communication_events(customer_auth_id,callback_id,actor_id,event_type,summary)
    values(new.customer_auth_id,new.id,auth.uid(),'callback_created','Callback requested');
  else
    if old.assigned_employee_id is distinct from new.assigned_employee_id then
      perform public.write_crm_audit('CALLBACK_ASSIGNED','callback',new.id::text,jsonb_build_object('assigned_employee_id',new.assigned_employee_id));
    else
      perform public.write_crm_audit('CALLBACK_UPDATED','callback',new.id::text,'{}'::jsonb);
    end if;
    if old.status is distinct from new.status and new.status = 'completed' then
      insert into public.communication_events(customer_auth_id,callback_id,actor_id,event_type,summary)
      values(new.customer_auth_id,new.id,auth.uid(),'callback_completed','Callback completed');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists callback_crm_audit on public.callback_requests;
create trigger callback_crm_audit
after insert or update on public.callback_requests
for each row execute function public.audit_callback_change();

create or replace function public.audit_note_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_crm_audit('NOTE_CREATED','note',new.id::text,jsonb_build_object('note_type',tg_table_name));
  end if;
  return new;
end;
$$;

drop trigger if exists enquiry_note_audit on public.enquiry_notes;
create trigger enquiry_note_audit after insert on public.enquiry_notes for each row execute function public.audit_note_change();
drop trigger if exists appointment_note_audit on public.appointment_notes;
create trigger appointment_note_audit after insert on public.appointment_notes for each row execute function public.audit_note_change();
drop trigger if exists callback_note_audit on public.callback_notes;
create trigger callback_note_audit after insert on public.callback_notes for each row execute function public.audit_note_change();


-- ============================================================
-- ATOMIC ENQUIRY ASSIGNMENT
-- ============================================================

create or replace function public.assign_crm_enquiry(
  p_enquiry_id integer,
  p_employee_id uuid,
  p_department_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.crm_can_manage_assignment(p_enquiry_id, auth.uid()) then
    raise exception 'You are not authorized to assign this enquiry';
  end if;

  if not public.crm_is_staff_profile(p_employee_id) then
    raise exception 'Selected employee is not an active CRM staff account';
  end if;

  if not exists (select 1 from public.departments where id = p_department_id) then
    raise exception 'Selected department does not exist';
  end if;

  update public.enquiry_assignments
  set unassigned_at = now()
  where enquiry_id = p_enquiry_id
    and unassigned_at is null;

  insert into public.enquiry_assignments(
    enquiry_id,
    assigned_employee_id,
    assigned_department_id,
    assigned_by
  )
  values(
    p_enquiry_id,
    p_employee_id,
    p_department_id,
    auth.uid()
  );

  update public.enquiries
  set
    assigned_employee_id = p_employee_id,
    assigned_department_id = p_department_id,
    status = case when status = 'new' then 'assigned'::public.enquiry_status else status end,
    "updatedAt" = now()
  where id = p_enquiry_id;

  return found;
end;
$$;

revoke all on function public.assign_crm_enquiry(integer, uuid, uuid) from public;
grant execute on function public.assign_crm_enquiry(integer, uuid, uuid) to authenticated;

commit;
