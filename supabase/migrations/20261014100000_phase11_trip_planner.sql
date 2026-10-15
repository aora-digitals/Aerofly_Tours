
begin;

create table if not exists public.trip_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title varchar(160) not null default 'My travel plan',
  preferences jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'enquiry_submitted')),
  current_version integer not null default 1
    check (current_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_plans_title_length
    check (char_length(title) between 1 and 160),
  constraint trip_plans_preferences_object
    check (jsonb_typeof(preferences) = 'object')
);

create index if not exists trip_plans_owner_updated_idx
  on public.trip_plans(owner_id, updated_at desc);

create table if not exists public.trip_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null
    references public.trip_plans(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  itinerary jsonb not null,
  budget_estimate jsonb not null default '{}'::jsonb,
  change_summary text,
  created_at timestamptz not null default now(),
  constraint trip_plan_versions_unique
    unique (plan_id, version_number),
  constraint trip_plan_versions_itinerary_object
    check (jsonb_typeof(itinerary) = 'object'),
  constraint trip_plan_versions_budget_object
    check (jsonb_typeof(budget_estimate) = 'object')
);

create index if not exists trip_plan_versions_plan_created_idx
  on public.trip_plan_versions(plan_id, created_at desc);

alter table public.trip_plans enable row level security;
alter table public.trip_plan_versions enable row level security;

drop policy if exists trip_plans_select_own on public.trip_plans;
create policy trip_plans_select_own
  on public.trip_plans for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists trip_plans_insert_own on public.trip_plans;
create policy trip_plans_insert_own
  on public.trip_plans for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists trip_plans_update_own on public.trip_plans;
create policy trip_plans_update_own
  on public.trip_plans for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists trip_plans_delete_own on public.trip_plans;
create policy trip_plans_delete_own
  on public.trip_plans for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists trip_plan_versions_select_own
  on public.trip_plan_versions;
create policy trip_plan_versions_select_own
  on public.trip_plan_versions for select to authenticated
  using (
    exists (
      select 1
      from public.trip_plans p
      where p.id = trip_plan_versions.plan_id
        and p.owner_id = (select auth.uid())
    )
  );

-- Trip versions are written by the trusted Edge Function.
-- Do not grant browser users direct version-write permissions.
revoke insert, update, delete
  on public.trip_plan_versions from anon, authenticated;

commit;
