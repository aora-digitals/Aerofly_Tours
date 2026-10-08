-- ============================================================
-- AeroFly Tours — Phase 2 Public Tourism Platform
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Destination map metadata
-- ------------------------------------------------------------
alter table public.destinations
  add column if not exists is_active boolean not null default true,
  add column if not exists latitude numeric(9,6),
  add column if not exists longitude numeric(9,6),
  add column if not exists meta_title text,
  add column if not exists meta_description text;

create index if not exists destinations_region_idx
  on public.destinations(region);

create index if not exists destinations_kind_featured_idx
  on public.destinations(kind, featured);

create index if not exists destinations_active_idx
  on public.destinations(is_active);

-- ------------------------------------------------------------
-- Tour presentation / SEO fields
-- ------------------------------------------------------------
alter table public.tours
  add column if not exists important_info text,
  add column if not exists terms text,
  add column if not exists meta_title text,
  add column if not exists meta_description text,
  add column if not exists is_seasonal boolean not null default false,
  add column if not exists season_label text;

create index if not exists tours_status_created_idx
  on public.tours(status, "createdAt" desc);

create index if not exists tours_price_idx
  on public.tours("priceFrom");

create index if not exists tours_duration_idx
  on public.tours("durationDays");

create index if not exists tours_seasonal_idx
  on public.tours(is_seasonal)
  where status = 'published';

-- ------------------------------------------------------------
-- Structured tour media
-- Public media belongs in aerofly-public storage.
-- ------------------------------------------------------------
create table if not exists public.tour_media (
  id integer generated always as identity primary key,
  "tourId" integer not null references public.tours(id) on delete cascade,
  media_type text not null default 'gallery',
  storage_path text,
  public_url text,
  alt_text text not null,
  sort_order integer not null default 0,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),

  constraint tour_media_type_check
    check (media_type in ('cover', 'gallery', 'itinerary')),
  constraint tour_media_source_check
    check (storage_path is not null or public_url is not null)
);

create index if not exists tour_media_tour_idx
  on public.tour_media("tourId", sort_order);

create index if not exists tour_media_public_idx
  on public.tour_media("tourId", is_public);

-- Backfill the existing cover/gallery URLs into structured media rows.
insert into public.tour_media ("tourId", media_type, public_url, alt_text, sort_order, is_public)
select t.id, 'cover', t."imageUrl", t.title || ' cover image', 0, true
from public.tours t
where t."imageUrl" is not null
on conflict do nothing;

insert into public.tour_media ("tourId", media_type, public_url, alt_text, sort_order, is_public)
select t.id, 'gallery', gallery_url, t.title || ' gallery image', row_number() over (partition by t.id order by gallery_url)::integer, true
from public.tours t
cross join lateral unnest(coalesce(t."galleryUrls", '{}'::text[])) as gallery_url
where gallery_url is not null and gallery_url <> ''
on conflict do nothing;

-- ------------------------------------------------------------
-- Structured tour departures
-- ------------------------------------------------------------
create table if not exists public.tour_departures (
  id integer generated always as identity primary key,
  "tourId" integer not null references public.tours(id) on delete cascade,
  departure_date date not null,
  return_date date,
  label text,
  price_from numeric(12,2),
  seats_available integer,
  status text not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tour_departures_status_check
    check (status in ('available', 'limited', 'sold_out', 'cancelled')),
  constraint tour_departures_dates_check
    check (return_date is null or return_date >= departure_date),
  constraint tour_departures_seats_check
    check (seats_available is null or seats_available >= 0)
);

create index if not exists tour_departures_tour_date_idx
  on public.tour_departures("tourId", departure_date);

create index if not exists tour_departures_status_idx
  on public.tour_departures(status, departure_date);

-- ------------------------------------------------------------
-- Rich itinerary fields
-- ------------------------------------------------------------
alter table public.tour_itineraries
  add column if not exists activities text[],
  add column if not exists accommodation text,
  add column if not exists location text,
  add column if not exists image_url text,
  add column if not exists latitude numeric(9,6),
  add column if not exists longitude numeric(9,6);

-- ------------------------------------------------------------
-- Destination attractions
-- ------------------------------------------------------------
create table if not exists public.destination_attractions (
  id integer generated always as identity primary key,
  "destinationId" integer not null references public.destinations(id) on delete cascade,
  name text not null,
  description text,
  image_url text,
  sort_order integer not null default 0,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists destination_attractions_destination_idx
  on public.destination_attractions("destinationId", sort_order);

-- ------------------------------------------------------------
-- Public services catalogue
-- ------------------------------------------------------------
alter table public.tour_categories
  add column if not exists is_active boolean not null default true;

create index if not exists tour_categories_active_idx
  on public.tour_categories(is_active);

create table if not exists public.services (
  id integer generated always as identity primary key,
  slug text not null unique,
  title text not null,
  intro text not null,
  description text not null,
  icon_key text,
  image_url text,
  bullets text[] not null default '{}',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  meta_title text,
  meta_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint services_slug_format
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists services_active_order_idx
  on public.services(is_active, sort_order);

-- ------------------------------------------------------------
-- Lightweight catalogue metrics
-- ------------------------------------------------------------
create table if not exists public.tour_metrics (
  "tourId" integer primary key references public.tours(id) on delete cascade,
  views bigint not null default 0,
  enquiries bigint not null default 0,
  bookings bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint tour_metrics_non_negative
    check (views >= 0 and enquiries >= 0 and bookings >= 0)
);

-- Initialise metrics for existing tours.
insert into public.tour_metrics ("tourId")
select id from public.tours
on conflict ("tourId") do nothing;

create or replace function public.increment_tour_view(requested_tour_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tour_metrics ("tourId", views, updated_at)
  values (requested_tour_id, 1, now())
  on conflict ("tourId") do update
    set views = public.tour_metrics.views + 1,
        updated_at = now();
end;
$$;

revoke all on function public.increment_tour_view(integer) from public;
grant execute on function public.increment_tour_view(integer) to anon, authenticated;

-- Keep timestamps current for managed public catalogue records.
drop trigger if exists tour_departures_set_updated_at on public.tour_departures;
create trigger tour_departures_set_updated_at
before update on public.tour_departures
for each row execute function public.set_updated_at();

drop trigger if exists services_set_updated_at on public.services;
create trigger services_set_updated_at
before update on public.services
for each row execute function public.set_updated_at();

-- Increment enquiry popularity only when a tour is explicitly attached.
create or replace function public.bump_tour_enquiry_metric()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new."tourId" is not null then
    insert into public.tour_metrics ("tourId", enquiries, updated_at)
    values (new."tourId", 1, now())
    on conflict ("tourId") do update
      set enquiries = public.tour_metrics.enquiries + 1,
          updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists enquiries_bump_tour_metric on public.enquiries;
create trigger enquiries_bump_tour_metric
after insert on public.enquiries
for each row execute function public.bump_tour_enquiry_metric();

create or replace function public.bump_tour_booking_metric()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new."tourId" is not null then
    insert into public.tour_metrics ("tourId", bookings, updated_at)
    values (new."tourId", 1, now())
    on conflict ("tourId") do update
      set bookings = public.tour_metrics.bookings + 1,
          updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_bump_tour_metric on public.bookings;
create trigger bookings_bump_tour_metric
after insert on public.bookings
for each row execute function public.bump_tour_booking_metric();

-- ------------------------------------------------------------
-- Public RLS
-- ------------------------------------------------------------
alter table public.destinations enable row level security;
alter table public.tour_categories enable row level security;
alter table public.tours enable row level security;
alter table public.tour_itineraries enable row level security;
alter table public.tour_media enable row level security;
alter table public.tour_departures enable row level security;
alter table public.destination_attractions enable row level security;
alter table public.services enable row level security;
alter table public.tour_metrics enable row level security;

-- Catalog reads: only public/active records.
drop policy if exists destinations_public_select on public.destinations;
create policy destinations_public_select
on public.destinations for select
to anon, authenticated
using (true);

drop policy if exists tour_categories_public_select on public.tour_categories;
create policy tour_categories_public_select
on public.tour_categories for select
to anon, authenticated
using (true);

drop policy if exists tours_public_select on public.tours;
create policy tours_public_select
on public.tours for select
to anon, authenticated
using (status = 'published');

drop policy if exists tour_itineraries_public_select on public.tour_itineraries;
create policy tour_itineraries_public_select
on public.tour_itineraries for select
to anon, authenticated
using (
  exists (
    select 1 from public.tours t
    where t.id = public.tour_itineraries."tourId"
      and t.status = 'published'
  )
);

drop policy if exists tour_media_public_select on public.tour_media;
create policy tour_media_public_select
on public.tour_media for select
to anon, authenticated
using (
  is_public = true
  and exists (
    select 1 from public.tours t
    where t.id = public.tour_media."tourId"
      and t.status = 'published'
  )
);

drop policy if exists tour_departures_public_select on public.tour_departures;
create policy tour_departures_public_select
on public.tour_departures for select
to anon, authenticated
using (
  status <> 'cancelled'
  and exists (
    select 1 from public.tours t
    where t.id = public.tour_departures."tourId"
      and t.status = 'published'
  )
);

drop policy if exists destination_attractions_public_select on public.destination_attractions;
create policy destination_attractions_public_select
on public.destination_attractions for select
to anon, authenticated
using (is_public = true);

drop policy if exists services_public_select on public.services;
create policy services_public_select
on public.services for select
to anon, authenticated
using (is_active = true);

drop policy if exists tour_metrics_public_select on public.tour_metrics;
create policy tour_metrics_public_select
on public.tour_metrics for select
to anon, authenticated
using (
  exists (
    select 1 from public.tours t
    where t.id = public.tour_metrics."tourId"
      and t.status = 'published'
  )
);

-- Staff management stays privileged through the existing server/admin path.
create policy tour_media_staff_manage
on public.tour_media for all
to authenticated
using (public.has_any_role(array['owner','admin','manager','marketing']))
with check (public.has_any_role(array['owner','admin','manager','marketing']));

create policy tour_departures_staff_manage
on public.tour_departures for all
to authenticated
using (public.has_any_role(array['owner','admin','manager','marketing']))
with check (public.has_any_role(array['owner','admin','manager','marketing']));

create policy destination_attractions_staff_manage
on public.destination_attractions for all
to authenticated
using (public.has_any_role(array['owner','admin','manager','marketing']))
with check (public.has_any_role(array['owner','admin','manager','marketing']));

create policy services_staff_manage
on public.services for all
to authenticated
using (public.has_any_role(array['owner','admin','manager','marketing']))
with check (public.has_any_role(array['owner','admin','manager','marketing']));

-- Existing catalogue tables need staff write policies after RLS is enabled.
drop policy if exists destinations_staff_manage on public.destinations;
create policy destinations_staff_manage
on public.destinations for all
to authenticated
using (public.has_any_role(array['owner','admin','manager','marketing']))
with check (public.has_any_role(array['owner','admin','manager','marketing']));

drop policy if exists tour_categories_staff_manage on public.tour_categories;
create policy tour_categories_staff_manage
on public.tour_categories for all
to authenticated
using (public.has_any_role(array['owner','admin','manager','marketing']))
with check (public.has_any_role(array['owner','admin','manager','marketing']));

drop policy if exists tours_staff_manage on public.tours;
create policy tours_staff_manage
on public.tours for all
to authenticated
using (public.has_any_role(array['owner','admin','manager','marketing']))
with check (public.has_any_role(array['owner','admin','manager','marketing']));

drop policy if exists tour_itineraries_staff_manage on public.tour_itineraries;
create policy tour_itineraries_staff_manage
on public.tour_itineraries for all
to authenticated
using (public.has_any_role(array['owner','admin','manager','marketing']))
with check (public.has_any_role(array['owner','admin','manager','marketing']));

-- Service seed. Existing hardcoded service copy moves into Supabase.
insert into public.services
(slug, title, intro, description, icon_key, bullets, sort_order)
values
('visa-assistance', 'Visa assistance', 'A clear checklist and a human point of contact when requirements move.', 'We help you understand the document journey, prepare a practical checklist and keep the next step visible. Visa requirements may change—always verify current requirements with the relevant official authority before travel.', 'FileCheck2', array['Tourist, business and transit visa guidance','Document checklist and review','Application guidance and follow-up support'], 10),
('flight-assistance', 'Flight assistance', 'Domestic, international, group and multi-city bookings through an agent-assisted desk.', 'We begin with your route, not a fake availability screen. Your travel consultant will confirm options and fares once a legitimate booking source is connected or the request is handled by the travel desk.', 'Plane', array['Domestic and international routes','Group and corporate travel','Multi-city itinerary coordination'], 20),
('hotel-assistance', 'Hotel assistance', 'A stay that makes sense for the route, the budget and the way you like to travel.', 'From practical 3-star stays to considered luxury, we curate hotel options around your dates and preferred pace. Availability and final rates are confirmed before any booking is treated as final.', 'Hotel', array['Budget, 3-star, 4-star, 5-star and luxury','Rooming and special-request coordination','Stay recommendations by neighbourhood'], 30),
('ground-services', 'Ground services', 'Airport pickups, local transfers, private cars and the practical details between places.', 'A good itinerary feels easy in motion. We coordinate airport pickup and drop, private cars, coaches, tempo travellers and local transfers where available.', 'CarFront', array['Airport pickup and drop','Private cars and coaches','Local transport and activity transfers'], 40),
('travel-protection', 'Travel protection', 'Insurance and travel-readiness support, explained clearly.', 'Travel insurance options and document requirements depend on your destination and provider. We’ll help you navigate the practical questions and point you to the right official information.', 'ShieldCheck', array['Travel insurance assistance','Travel documents checklist','Pre-trip readiness review'], 50),
('travel-design', 'Custom trip design', 'A route built around your pace, not a template.', 'Tell us about the trip you’re picturing—who’s travelling, what matters and what you want to avoid. We’ll build a flexible starting point from there.', 'Sparkles', array['Personalised itineraries','Family, honeymoon, corporate and private routes','One travel desk for the moving pieces'], 60)
on conflict (slug) do update set
  title = excluded.title,
  intro = excluded.intro,
  description = excluded.description,
  icon_key = excluded.icon_key,
  bullets = excluded.bullets,
  sort_order = excluded.sort_order,
  updated_at = now();

commit;
