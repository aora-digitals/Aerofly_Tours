-- ============================================================
-- AeroFly Tours
-- Phase 1 — Supabase Foundation
-- Migration: 20261007113000_phase1_foundation.sql
-- ============================================================

begin;

-- ============================================================
-- EXTENSIONS
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- COMMON UPDATED_AT FUNCTION
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- ORGANIZATIONS
-- ============================================================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),

  name text not null,
  slug text not null unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint organizations_name_not_blank
    check (length(trim(name)) > 0),

  constraint organizations_slug_format
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

drop trigger if exists organizations_set_updated_at
on public.organizations;

create trigger organizations_set_updated_at
before update on public.organizations
for each row
execute function public.set_updated_at();

-- ============================================================
-- DEPARTMENTS
-- ============================================================

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations(id)
    on delete cascade,

  name text not null,
  slug text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint departments_name_not_blank
    check (length(trim(name)) > 0),

  constraint departments_slug_format
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),

  constraint departments_organization_slug_unique
    unique (organization_id, slug)
);

create index if not exists departments_organization_id_idx
on public.departments(organization_id);

drop trigger if exists departments_set_updated_at
on public.departments;

create trigger departments_set_updated_at
before update on public.departments
for each row
execute function public.set_updated_at();

-- ============================================================
-- PROFILES
-- Supabase auth.users is the identity source.
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key
    references auth.users(id)
    on delete cascade,

  full_name text,

  phone text,

  avatar_url text,

  date_of_birth date,

  preferred_language text not null default 'en',

  preferred_currency text not null default 'INR',

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  constraint profiles_preferred_language_not_blank
    check (length(trim(preferred_language)) > 0),

  constraint profiles_preferred_currency_format
    check (preferred_currency ~ '^[A-Z]{3}$')
);

create index if not exists profiles_preferred_language_idx
on public.profiles(preferred_language);

create index if not exists profiles_preferred_currency_idx
on public.profiles(preferred_currency);

drop trigger if exists profiles_set_updated_at
on public.profiles;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

-- ============================================================
-- ORGANIZATION MEMBERSHIPS
-- ============================================================

create table if not exists public.organization_memberships (
  user_id uuid not null
    references public.profiles(id)
    on delete cascade,

  organization_id uuid not null
    references public.organizations(id)
    on delete cascade,

  department_id uuid
    references public.departments(id)
    on delete set null,

  job_title text,

  status text not null default 'active',

  created_at timestamptz not null default now(),

  updated_at timestamptz not null default now(),

  primary key (user_id, organization_id),

  constraint organization_memberships_status_check
    check (status in ('active', 'inactive', 'invited'))
);

create index if not exists organization_memberships_org_idx
on public.organization_memberships(organization_id);

create index if not exists organization_memberships_department_idx
on public.organization_memberships(department_id);

create index if not exists organization_memberships_status_idx
on public.organization_memberships(status);

drop trigger if exists organization_memberships_set_updated_at
on public.organization_memberships;

create trigger organization_memberships_set_updated_at
before update on public.organization_memberships
for each row
execute function public.set_updated_at();

-- ============================================================
-- ROLES
-- ============================================================

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),

  key text not null unique,

  name text not null,

  description text,

  is_system boolean not null default true,

  created_at timestamptz not null default now(),

  constraint roles_key_format
    check (key ~ '^[a-z][a-z0-9_]*$')
);

-- ============================================================
-- PERMISSIONS
-- ============================================================

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),

  key text not null unique,

  description text,

  created_at timestamptz not null default now(),

  constraint permissions_key_format
    check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);

-- ============================================================
-- USER ROLES
-- organization_id is nullable because customer/global roles
-- do not require an organization membership.
-- ============================================================

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references public.profiles(id)
    on delete cascade,

  role_id uuid not null
    references public.roles(id)
    on delete restrict,

  organization_id uuid
    references public.organizations(id)
    on delete cascade,

  created_at timestamptz not null default now()
);

create index if not exists user_roles_user_id_idx
on public.user_roles(user_id);

create index if not exists user_roles_role_id_idx
on public.user_roles(role_id);

create index if not exists user_roles_organization_id_idx
on public.user_roles(organization_id);

create unique index if not exists user_roles_unique_assignment_idx
on public.user_roles(
  user_id,
  role_id,
  coalesce(
    organization_id,
    '00000000-0000-0000-0000-000000000000'::uuid
  )
);

-- ============================================================
-- ROLE PERMISSIONS
-- ============================================================

create table if not exists public.role_permissions (
  role_id uuid not null
    references public.roles(id)
    on delete cascade,

  permission_id uuid not null
    references public.permissions(id)
    on delete cascade,

  created_at timestamptz not null default now(),

  primary key (role_id, permission_id)
);

create index if not exists role_permissions_permission_id_idx
on public.role_permissions(permission_id);

-- ============================================================
-- AUTHORIZATION HELPER FUNCTIONS
-- ============================================================

create or replace function public.has_role(
  requested_role text,
  requested_user uuid default auth.uid()
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
    inner join public.roles r
      on r.id = ur.role_id
    where ur.user_id = requested_user
      and r.key = requested_role
  );
$$;

create or replace function public.has_any_role(
  requested_roles text[],
  requested_user uuid default auth.uid()
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
    inner join public.roles r
      on r.id = ur.role_id
    where ur.user_id = requested_user
      and r.key = any(requested_roles)
  );
$$;

create or replace function public.is_organization_member(
  requested_organization uuid,
  requested_user uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = requested_organization
      and om.user_id = requested_user
      and om.status = 'active'
  );
$$;

-- ============================================================
-- PROFILE CREATION
-- auth.users -> public.profiles
-- auth.users -> default customer role
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_role_id uuid;
  metadata_name text;
  metadata_phone text;
begin
  metadata_name :=
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');

  metadata_phone :=
    nullif(trim(new.raw_user_meta_data ->> 'phone'), '');

  insert into public.profiles (
    id,
    full_name,
    phone
  )
  values (
    new.id,
    metadata_name,
    metadata_phone
  )
  on conflict (id) do nothing;

  select id
  into customer_role_id
  from public.roles
  where key = 'customer'
  limit 1;

  if customer_role_id is not null then
    insert into public.user_roles (
      user_id,
      role_id
    )
    values (
      new.id,
      customer_role_id
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created
on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- ============================================================
-- SYSTEM ROLES
-- ============================================================

insert into public.roles (
  key,
  name,
  description,
  is_system
)
values
  (
    'customer',
    'Customer',
    'Authenticated AeroFly customer account',
    true
  ),
  (
    'owner',
    'Owner',
    'Company-wide control and governance',
    true
  ),
  (
    'admin',
    'Administrator',
    'Administrative control compatible with the legacy application',
    true
  ),
  (
    'manager',
    'Manager',
    'Operational management across teams',
    true
  ),
  (
    'marketing',
    'Marketing',
    'Marketing and public catalogue responsibilities',
    true
  ),
  (
    'customer_care',
    'Customer Care',
    'Customer service and follow-up responsibilities',
    true
  ),
  (
    'staff',
    'Staff',
    'General staff access',
    true
  ),
  (
    'counsellor',
    'Counsellor',
    'Lead qualification and quotation responsibilities',
    true
  )
on conflict (key) do update
set
  name = excluded.name,
  description = excluded.description;

-- ============================================================
-- PHASE 1 PERMISSIONS
-- Only foundational permissions are seeded.
-- ============================================================

insert into public.permissions (
  key,
  description
)
values
  ('profile.read', 'Read own profile'),
  ('profile.update', 'Update own profile'),

  ('customers.read', 'Read customer records'),
  ('customers.create', 'Create customer records'),
  ('customers.update', 'Update customer records'),

  ('tours.read', 'Read tour catalogue'),
  ('tours.create', 'Create tours'),
  ('tours.update', 'Update tours'),
  ('tours.delete', 'Delete tours'),

  ('bookings.read', 'Read bookings'),
  ('bookings.create', 'Create bookings'),
  ('bookings.update', 'Update bookings'),

  ('payments.read', 'Read payment records'),
  ('payments.create', 'Create payment records'),
  ('payments.refund', 'Refund payments'),

  ('finance.read', 'Read finance information'),
  ('reports.read', 'Read reports'),

  ('settings.manage', 'Manage system settings')
on conflict (key) do update
set
  description = excluded.description;

-- ============================================================
-- DEFAULT ORGANIZATION
-- System configuration, not demo customer/business data.
-- ============================================================

insert into public.organizations (
  name,
  slug
)
values (
  'AeroFly Tours',
  'aerofly-tours'
)
on conflict (slug) do nothing;

-- ============================================================
-- ROLE -> PERMISSION MAPPINGS
-- ============================================================

-- Customer
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'customer'
  and p.key in (
    'profile.read',
    'profile.update'
  )
on conflict do nothing;

-- Owner
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'owner'
on conflict do nothing;

-- Admin
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'admin'
on conflict do nothing;

-- Manager
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'manager'
  and p.key in (
    'profile.read',
    'profile.update',
    'customers.read',
    'customers.create',
    'customers.update',
    'tours.read',
    'tours.update',
    'bookings.read',
    'bookings.create',
    'bookings.update',
    'payments.read',
    'finance.read',
    'reports.read'
  )
on conflict do nothing;

-- Marketing
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'marketing'
  and p.key in (
    'profile.read',
    'profile.update',
    'tours.read',
    'tours.create',
    'tours.update',
    'reports.read'
  )
on conflict do nothing;

-- Customer Care
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'customer_care'
  and p.key in (
    'profile.read',
    'profile.update',
    'customers.read',
    'customers.create',
    'customers.update',
    'bookings.read',
    'bookings.update'
  )
on conflict do nothing;

-- Staff
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'staff'
  and p.key in (
    'profile.read',
    'profile.update',
    'customers.read',
    'bookings.read'
  )
on conflict do nothing;

-- Counsellor
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key = 'counsellor'
  and p.key in (
    'profile.read',
    'profile.update',
    'customers.read',
    'customers.create',
    'customers.update',
    'bookings.read'
  )
on conflict do nothing;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.organizations enable row level security;
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;

-- ============================================================
-- PROFILES POLICIES
-- ============================================================

drop policy if exists "profiles_select_own"
on public.profiles;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
);

drop policy if exists "profiles_insert_own"
on public.profiles;

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (
  id = auth.uid()
);

drop policy if exists "profiles_update_own"
on public.profiles;

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
)
with check (
  id = auth.uid()
);

-- ============================================================
-- ORGANIZATION POLICIES
-- ============================================================

drop policy if exists "organizations_select_member"
on public.organizations;

create policy "organizations_select_member"
on public.organizations
for select
to authenticated
using (
  public.is_organization_member(id)
  or public.has_any_role(
    array['owner', 'admin']
  )
);

drop policy if exists "organizations_insert_owner"
on public.organizations;

create policy "organizations_insert_owner"
on public.organizations
for insert
to authenticated
with check (
  public.has_any_role(
    array['owner', 'admin']
  )
);

drop policy if exists "organizations_update_owner"
on public.organizations;

create policy "organizations_update_owner"
on public.organizations
for update
to authenticated
using (
  public.has_any_role(
    array['owner', 'admin']
  )
)
with check (
  public.has_any_role(
    array['owner', 'admin']
  )
);

-- ============================================================
-- DEPARTMENT POLICIES
-- ============================================================

drop policy if exists "departments_select_member"
on public.departments;

create policy "departments_select_member"
on public.departments
for select
to authenticated
using (
  public.is_organization_member(organization_id)
  or public.has_any_role(
    array['owner', 'admin']
  )
);

drop policy if exists "departments_manage_owner"
on public.departments;

create policy "departments_manage_owner"
on public.departments
for all
to authenticated
using (
  public.has_any_role(
    array['owner', 'admin']
  )
)
with check (
  public.has_any_role(
    array['owner', 'admin']
  )
);

-- ============================================================
-- ORGANIZATION MEMBERSHIP POLICIES
-- ============================================================

drop policy if exists "organization_memberships_select"
on public.organization_memberships;

create policy "organization_memberships_select"
on public.organization_memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_organization_member(organization_id)
  or public.has_any_role(
    array['owner', 'admin']
  )
);

drop policy if exists "organization_memberships_manage"
on public.organization_memberships;

create policy "organization_memberships_manage"
on public.organization_memberships
for all
to authenticated
using (
  public.has_any_role(
    array['owner', 'admin']
  )
)
with check (
  public.has_any_role(
    array['owner', 'admin']
  )
);

-- ============================================================
-- ROLE CATALOG
-- Authenticated users may read role definitions.
-- Assignment remains privileged.
-- ============================================================

drop policy if exists "roles_select_authenticated"
on public.roles;

create policy "roles_select_authenticated"
on public.roles
for select
to authenticated
using (true);

drop policy if exists "roles_manage_admin"
on public.roles;

create policy "roles_manage_admin"
on public.roles
for all
to authenticated
using (
  public.has_any_role(
    array['owner', 'admin']
  )
)
with check (
  public.has_any_role(
    array['owner', 'admin']
  )
);

-- ============================================================
-- PERMISSION CATALOG
-- ============================================================

drop policy if exists "permissions_select_authenticated"
on public.permissions;

create policy "permissions_select_authenticated"
on public.permissions
for select
to authenticated
using (true);

drop policy if exists "permissions_manage_admin"
on public.permissions;

create policy "permissions_manage_admin"
on public.permissions
for all
to authenticated
using (
  public.has_any_role(
    array['owner', 'admin']
  )
)
with check (
  public.has_any_role(
    array['owner', 'admin']
  )
);

-- ============================================================
-- USER ROLES
-- ============================================================

drop policy if exists "user_roles_select"
on public.user_roles;

create policy "user_roles_select"
on public.user_roles
for select
to authenticated
using (
  user_id = auth.uid()
  or public.has_any_role(
    array['owner', 'admin']
  )
);

drop policy if exists "user_roles_manage"
on public.user_roles;

create policy "user_roles_manage"
on public.user_roles
for all
to authenticated
using (
  public.has_any_role(
    array['owner', 'admin']
  )
)
with check (
  public.has_any_role(
    array['owner', 'admin']
  )
);

-- ============================================================
-- ROLE PERMISSIONS
-- ============================================================

drop policy if exists "role_permissions_select_authenticated"
on public.role_permissions;

create policy "role_permissions_select_authenticated"
on public.role_permissions
for select
to authenticated
using (true);

drop policy if exists "role_permissions_manage_admin"
on public.role_permissions;

create policy "role_permissions_manage_admin"
on public.role_permissions
for all
to authenticated
using (
  public.has_any_role(
    array['owner', 'admin']
  )
)
with check (
  public.has_any_role(
    array['owner', 'admin']
  )
);

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================

insert into storage.buckets (
  id,
  name,
  public
)
values
  (
    'aerofly-public',
    'aerofly-public',
    true
  ),
  (
    'aerofly-private',
    'aerofly-private',
    false
  )
on conflict (id) do update
set
  public = excluded.public;

-- ============================================================
-- PUBLIC STORAGE
-- Public reads are allowed.
-- Upload/update/delete require staff-level access.
-- ============================================================

drop policy if exists "aerofly_public_read"
on storage.objects;

create policy "aerofly_public_read"
on storage.objects
for select
to public
using (
  bucket_id = 'aerofly-public'
);

drop policy if exists "aerofly_public_staff_insert"
on storage.objects;

create policy "aerofly_public_staff_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'aerofly-public'
  and public.has_any_role(
    array[
      'owner',
      'admin',
      'manager',
      'marketing'
    ]
  )
);

drop policy if exists "aerofly_public_staff_update"
on storage.objects;

create policy "aerofly_public_staff_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'aerofly-public'
  and public.has_any_role(
    array[
      'owner',
      'admin',
      'manager',
      'marketing'
    ]
  )
)
with check (
  bucket_id = 'aerofly-public'
  and public.has_any_role(
    array[
      'owner',
      'admin',
      'manager',
      'marketing'
    ]
  )
);

drop policy if exists "aerofly_public_staff_delete"
on storage.objects;

create policy "aerofly_public_staff_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'aerofly-public'
  and public.has_any_role(
    array[
      'owner',
      'admin',
      'manager',
      'marketing'
    ]
  )
);

-- ============================================================
-- PRIVATE STORAGE
--
-- Path convention:
--
-- users/{auth_user_id}/...
--
-- Users can access their own files.
-- Authorized staff can access private files for operations.
-- ============================================================

drop policy if exists "aerofly_private_select"
on storage.objects;

create policy "aerofly_private_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'aerofly-private'
  and (
    (
      split_part(name, '/', 1) = 'users'
      and split_part(name, '/', 2) = auth.uid()::text
    )
    or
    public.has_any_role(
      array[
        'owner',
        'admin',
        'manager',
        'customer_care',
        'staff',
        'counsellor'
      ]
    )
  )
);

drop policy if exists "aerofly_private_insert"
on storage.objects;

create policy "aerofly_private_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'aerofly-private'
  and (
    (
      split_part(name, '/', 1) = 'users'
      and split_part(name, '/', 2) = auth.uid()::text
    )
    or
    public.has_any_role(
      array[
        'owner',
        'admin',
        'manager',
        'customer_care',
        'staff',
        'counsellor'
      ]
    )
  )
);

drop policy if exists "aerofly_private_update"
on storage.objects;

create policy "aerofly_private_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'aerofly-private'
  and (
    (
      split_part(name, '/', 1) = 'users'
      and split_part(name, '/', 2) = auth.uid()::text
    )
    or
    public.has_any_role(
      array[
        'owner',
        'admin',
        'manager',
        'customer_care',
        'staff',
        'counsellor'
      ]
    )
  )
)
with check (
  bucket_id = 'aerofly-private'
  and (
    (
      split_part(name, '/', 1) = 'users'
      and split_part(name, '/', 2) = auth.uid()::text
    )
    or
    public.has_any_role(
      array[
        'owner',
        'admin',
        'manager',
        'customer_care',
        'staff',
        'counsellor'
      ]
    )
  )
);

drop policy if exists "aerofly_private_delete"
on storage.objects;

create policy "aerofly_private_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'aerofly-private'
  and (
    (
      split_part(name, '/', 1) = 'users'
      and split_part(name, '/', 2) = auth.uid()::text
    )
    or
    public.has_any_role(
      array[
        'owner',
        'admin',
        'manager',
        'customer_care',
        'staff',
        'counsellor'
      ]
    )
  )
);

commit;