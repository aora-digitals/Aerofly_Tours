-- AeroFly Tours — Phase 3 Customer Platform
-- Requires Phase 1 + Phase 2 migrations.
begin;

-- ============================================================
-- CUSTOMER PREFERENCES
-- ============================================================
create table if not exists public.customer_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  travel_scope text not null default 'both',
  preferred_destinations text[] not null default '{}',
  travel_styles text[] not null default '{}',
  budget_min numeric(12,2),
  budget_max numeric(12,2),
  duration_min_days integer,
  duration_max_days integer,
  preferred_language text not null default 'en',
  preferred_currency text not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_preferences_scope_check check (travel_scope in ('domestic','international','both')),
  constraint customer_preferences_budget_check check (budget_min is null or budget_max is null or budget_min <= budget_max),
  constraint customer_preferences_duration_check check (duration_min_days is null or duration_max_days is null or duration_min_days <= duration_max_days),
  constraint customer_preferences_language_check check (length(trim(preferred_language)) > 0),
  constraint customer_preferences_currency_check check (preferred_currency ~ '^[A-Z]{3}$')
);

create index if not exists customer_preferences_scope_idx on public.customer_preferences(travel_scope);
create index if not exists customer_preferences_currency_idx on public.customer_preferences(preferred_currency);

drop trigger if exists customer_preferences_updated_at on public.customer_preferences;
create trigger customer_preferences_updated_at
before update on public.customer_preferences
for each row execute function public.set_updated_at();

-- ============================================================
-- WISHLISTS
-- ============================================================
create table if not exists public.wishlists (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tour_id integer not null references public.tours(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint wishlists_user_tour_unique unique (user_id, tour_id)
);

create index if not exists wishlists_user_created_idx on public.wishlists(user_id, created_at desc);
create index if not exists wishlists_tour_idx on public.wishlists(tour_id);

-- ============================================================
-- CUSTOMER ACTIVITY / PERSONALIZATION FOUNDATION
-- ============================================================
create table if not exists public.customer_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  activity_type text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint customer_activity_type_check check (
    activity_type in (
      'tour_viewed',
      'destination_viewed',
      'wishlist_added',
      'wishlist_removed',
      'enquiry_started',
      'enquiry_submitted',
      'appointment_requested',
      'callback_requested'
    )
  ),
  constraint customer_activity_entity_type_check check (
    entity_type is null or entity_type in ('tour','destination','enquiry','appointment','callback')
  ),
  constraint customer_activity_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists customer_activity_user_created_idx
  on public.customer_activity(user_id, created_at desc);
create index if not exists customer_activity_user_type_created_idx
  on public.customer_activity(user_id, activity_type, created_at desc);
create index if not exists customer_activity_entity_idx
  on public.customer_activity(entity_type, entity_id);

-- Keep repeated tour views useful without creating an uncontrolled stream.
create index if not exists customer_activity_recent_tour_view_idx
  on public.customer_activity(user_id, entity_id, created_at desc)
  where activity_type = 'tour_viewed' and entity_type = 'tour';

create or replace function public.validate_customer_activity_metadata()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  key_name text;
begin
  for key_name in select jsonb_object_keys(new.metadata) loop
    if key_name not in ('source', 'entry_point', 'tour_id', 'destination_id') then
      raise exception 'Unsupported customer activity metadata field: %', key_name;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists customer_activity_metadata_validate on public.customer_activity;
create trigger customer_activity_metadata_validate
before insert or update on public.customer_activity
for each row execute function public.validate_customer_activity_metadata();

-- ============================================================
-- BRIDGE EXISTING LEGACY CUSTOMER RECORDS TO SUPABASE AUTH
-- ============================================================
alter table public.enquiries
  add column if not exists customer_auth_id uuid references public.profiles(id) on delete set null;

alter table public.callback_requests
  add column if not exists customer_auth_id uuid references public.profiles(id) on delete set null;

alter table public.appointments
  add column if not exists customer_auth_id uuid references public.profiles(id) on delete set null;

alter table public.bookings
  add column if not exists customer_auth_id uuid references public.profiles(id) on delete set null;

create index if not exists enquiries_customer_auth_idx
  on public.enquiries(customer_auth_id, "createdAt" desc);
create index if not exists callback_customer_auth_idx
  on public.callback_requests(customer_auth_id, "createdAt" desc);
create index if not exists appointment_customer_auth_idx
  on public.appointments(customer_auth_id, "appointmentAt" desc);
create index if not exists bookings_customer_auth_idx
  on public.bookings(customer_auth_id, "createdAt" desc);

-- Existing Supabase-bridged users use users.openId = supabase:<auth UUID>.
update public.enquiries e
set customer_auth_id = substring(u."openId" from 10)::uuid
from public.users u
where e.customer_auth_id is null
  and e."userId" = u.id
  and u."openId" ~ '^supabase:[0-9a-fA-F-]{36}$';

update public.callback_requests c
set customer_auth_id = substring(u."openId" from 10)::uuid
from public.users u
where c.customer_auth_id is null
  and c."userId" = u.id
  and u."openId" ~ '^supabase:[0-9a-fA-F-]{36}$';

update public.appointments a
set customer_auth_id = substring(u."openId" from 10)::uuid
from public.users u
where a.customer_auth_id is null
  and a."userId" = u.id
  and u."openId" ~ '^supabase:[0-9a-fA-F-]{36}$';

update public.bookings b
set customer_auth_id = substring(u."openId" from 10)::uuid
from public.users u
where b.customer_auth_id is null
  and b."userId" = u.id
  and u."openId" ~ '^supabase:[0-9a-fA-F-]{36}$';

-- ============================================================
-- CUSTOMER RLS
-- ============================================================
alter table public.customer_preferences enable row level security;
alter table public.wishlists enable row level security;
alter table public.customer_activity enable row level security;
alter table public.enquiries enable row level security;
alter table public.callback_requests enable row level security;
alter table public.appointments enable row level security;
alter table public.bookings enable row level security;

-- Preferences
 drop policy if exists customer_preferences_select_own on public.customer_preferences;
 create policy customer_preferences_select_own on public.customer_preferences
   for select to authenticated using (user_id = auth.uid());
 drop policy if exists customer_preferences_insert_own on public.customer_preferences;
 create policy customer_preferences_insert_own on public.customer_preferences
   for insert to authenticated with check (user_id = auth.uid());
 drop policy if exists customer_preferences_update_own on public.customer_preferences;
 create policy customer_preferences_update_own on public.customer_preferences
   for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
 drop policy if exists customer_preferences_delete_own on public.customer_preferences;
 create policy customer_preferences_delete_own on public.customer_preferences
   for delete to authenticated using (user_id = auth.uid());

-- Wishlist
 drop policy if exists wishlists_select_own on public.wishlists;
 create policy wishlists_select_own on public.wishlists
   for select to authenticated using (user_id = auth.uid());
 drop policy if exists wishlists_insert_own on public.wishlists;
 create policy wishlists_insert_own on public.wishlists
   for insert to authenticated with check (user_id = auth.uid());
 drop policy if exists wishlists_delete_own on public.wishlists;
 create policy wishlists_delete_own on public.wishlists
   for delete to authenticated using (user_id = auth.uid());

-- Activity
 drop policy if exists customer_activity_select_own on public.customer_activity;
 create policy customer_activity_select_own on public.customer_activity
   for select to authenticated using (user_id = auth.uid());
 drop policy if exists customer_activity_insert_own on public.customer_activity;
 create policy customer_activity_insert_own on public.customer_activity
   for insert to authenticated with check (user_id = auth.uid());
 -- Customers do not update/delete their activity history.
 drop policy if exists customer_activity_update_none on public.customer_activity;
 drop policy if exists customer_activity_delete_none on public.customer_activity;

-- Existing customer-facing operational records.
-- No broad SELECT/UPDATE policy is granted to customers; the policies below are ownership-only.
 drop policy if exists enquiries_customer_select_own on public.enquiries;
 create policy enquiries_customer_select_own on public.enquiries
   for select to authenticated using (customer_auth_id = auth.uid());

 drop policy if exists callback_customer_select_own on public.callback_requests;
 create policy callback_customer_select_own on public.callback_requests
   for select to authenticated using (customer_auth_id = auth.uid());

 drop policy if exists appointment_customer_select_own on public.appointments;
 create policy appointment_customer_select_own on public.appointments
   for select to authenticated using (customer_auth_id = auth.uid());

 drop policy if exists booking_customer_select_own on public.bookings;
 create policy booking_customer_select_own on public.bookings
   for select to authenticated using (customer_auth_id = auth.uid());

-- Customers may only cancel their own appointment/callback through controlled RPCs.
create or replace function public.cancel_customer_callback(request_id integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.callback_requests
  set status = 'cancelled', "updatedAt" = now()
  where id = request_id
    and customer_auth_id = auth.uid()
    and status in ('requested', 'scheduled');
  return found;
end;
$$;

create or replace function public.cancel_customer_appointment(request_id integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.appointments
  set status = 'cancelled', "updatedAt" = now()
  where id = request_id
    and customer_auth_id = auth.uid()
    and status in ('requested', 'confirmed');
  return found;
end;
$$;

revoke all on function public.cancel_customer_callback(integer) from public;
grant execute on function public.cancel_customer_callback(integer) to authenticated;
revoke all on function public.cancel_customer_appointment(integer) from public;
grant execute on function public.cancel_customer_appointment(integer) to authenticated;

-- Ensure customers cannot update the underlying operational records directly.
drop policy if exists enquiries_customer_update_own on public.enquiries;
drop policy if exists callback_customer_update_own on public.callback_requests;
drop policy if exists appointment_customer_update_own on public.appointments;
drop policy if exists booking_customer_update_own on public.bookings;

commit;
