-- AeroFly Tours Phase 5: enquiry-first, staff-issued booking offers.
-- Uses existing enquiries, quotations, quotation_items, bookings, and payments.
-- No direct public booking endpoint is introduced.
begin;

-- ------------------------------------------------------------
-- A. Departure pricing and capacity
-- ------------------------------------------------------------

alter table public.tour_departures
  add column if not exists departure_city text,
  add column if not exists adult_price numeric(12,2),
  add column if not exists child_price numeric(12,2),
  add column if not exists infant_price numeric(12,2),
  add column if not exists single_supplement numeric(12,2)
    not null default 0,
  add column if not exists booking_cutoff timestamptz,
  add column if not exists total_capacity integer;

alter table public.tour_departures
  drop constraint if exists tour_departures_phase5_pricing_check;

alter table public.tour_departures
  add constraint tour_departures_phase5_pricing_check
  check (
    (adult_price is null or adult_price >= 0)
    and (child_price is null or child_price >= 0)
    and (infant_price is null or infant_price >= 0)
    and single_supplement >= 0
    and (total_capacity is null or total_capacity >= 0)
  );

-- ------------------------------------------------------------
-- B. Proposal lifecycle
-- ------------------------------------------------------------

alter table public.quotations
  add column if not exists proposal_status text not null default 'DRAFT',
  add column if not exists tour_departure_id integer
    references public.tour_departures(id),
  add column if not exists issued_by uuid references public.profiles(id),
  add column if not exists issued_at timestamptz,
  add column if not exists withdrawn_at timestamptz;


-- Phase 5 prerequisite columns must exist before policies and functions
-- reference them. The same columns are added later in the migration;
-- IF NOT EXISTS makes that later statement safe.

alter table public.quotations
  add column if not exists customer_auth_id uuid
    references public.profiles(id) on delete set null,
  add column if not exists booking_details jsonb
    not null default '{}'::jsonb,
  add column if not exists customer_response text
    not null default 'awaiting_response',
  add column if not exists customer_response_note text,
  add column if not exists response_at timestamptz,
  add column if not exists offer_version integer
    not null default 1;

alter table public.bookings
  add column if not exists customer_auth_id uuid
    references public.profiles(id) on delete set null,
  add column if not exists booking_details jsonb
    not null default '{}'::jsonb,
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists cancellation_reason text;


alter table public.quotations
  drop constraint if exists quotations_phase5_proposal_status_check;

alter table public.quotations
  add constraint quotations_phase5_proposal_status_check
  check (
    proposal_status in (
      'DRAFT',
      'ISSUED',
      'EDIT_REQUESTED',
      'ACCEPTED',
      'REJECTED',
      'EXPIRED',
      'WITHDRAWN'
    )
  );

alter table public.bookings
  add column if not exists tour_departure_id integer
    references public.tour_departures(id),
  add column if not exists adult_count integer not null default 0,
  add column if not exists child_count integer not null default 0,
  add column if not exists infant_count integer not null default 0,
  add column if not exists single_rooms integer not null default 0;

alter table public.bookings
  drop constraint if exists bookings_phase5_traveller_counts_check;

alter table public.bookings
  add constraint bookings_phase5_traveller_counts_check
  check (
    adult_count >= 0
    and child_count >= 0
    and infant_count >= 0
    and single_rooms >= 0
    and travellers = adult_count + child_count + infant_count
  );

create index if not exists quotations_phase5_departure_idx
  on public.quotations(tour_departure_id, proposal_status);

create index if not exists bookings_phase5_departure_idx
  on public.bookings(tour_departure_id, "bookingStatus");

-- ------------------------------------------------------------
-- C. Immutable proposal versions
-- ------------------------------------------------------------

create table if not exists public.booking_offer_versions (
  id bigint generated always as identity primary key,
  quotation_id integer not null
    references public.quotations(id) on delete restrict,
  version_number integer not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  snapshot jsonb not null,
  constraint booking_offer_versions_snapshot_check
    check (jsonb_typeof(snapshot) = 'object'),
  constraint booking_offer_versions_unique
    unique (quotation_id, version_number)
);

create index if not exists booking_offer_versions_lookup_idx
  on public.booking_offer_versions(quotation_id, version_number desc);

create or replace function public.prevent_offer_version_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Issued proposal snapshots are immutable';
end;
$$;

drop trigger if exists booking_offer_versions_immutable
  on public.booking_offer_versions;

create trigger booking_offer_versions_immutable
before update or delete on public.booking_offer_versions
for each row execute function public.prevent_offer_version_mutation();

alter table public.booking_offer_versions enable row level security;

drop policy if exists booking_offer_versions_customer_select
  on public.booking_offer_versions;

create policy booking_offer_versions_customer_select
on public.booking_offer_versions
for select to authenticated
using (
  exists (
    select 1
    from public.quotations q
    where q.id = quotation_id
      and q.customer_auth_id = auth.uid()
      and q.proposal_status <> 'DRAFT'
  )
);

drop policy if exists booking_offer_versions_staff_select
  on public.booking_offer_versions;

create policy booking_offer_versions_staff_select
on public.booking_offer_versions
for select to authenticated
using (
  public.has_any_role(
    array['owner','admin','manager','customer_care','counsellor','staff']
  )
  and exists (
    select 1
    from public.quotations q
    where q.id = quotation_id
      and (
        public.has_any_role(array['owner','admin','manager'])
        or (
          q."enquiryId" is not null
          and public.crm_can_access_enquiry(q."enquiryId")
        )
      )
  )
);

revoke insert, update, delete
on public.booking_offer_versions
from anon, authenticated;

-- ------------------------------------------------------------
-- D. Cancellation requests
-- ------------------------------------------------------------

create table if not exists public.booking_cancellation_requests (
  id bigint generated always as identity primary key,
  booking_id integer not null
    references public.bookings(id) on delete restrict,
  customer_auth_id uuid not null
    references public.profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  reason text,
  status text not null default 'REQUESTED',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  staff_response text,
  constraint booking_cancellation_status_check
    check (status in ('REQUESTED','APPROVED','REJECTED')),
  constraint booking_cancellation_reason_check
    check (reason is null or length(reason) <= 2000),
  constraint booking_cancellation_response_check
    check (staff_response is null or length(staff_response) <= 2000)
);

create index if not exists booking_cancellation_customer_idx
  on public.booking_cancellation_requests(customer_auth_id, requested_at desc);

create index if not exists booking_cancellation_booking_idx
  on public.booking_cancellation_requests(booking_id, status);

alter table public.booking_cancellation_requests enable row level security;

drop policy if exists booking_cancellation_customer_select
  on public.booking_cancellation_requests;

create policy booking_cancellation_customer_select
on public.booking_cancellation_requests
for select to authenticated
using (customer_auth_id = auth.uid());

drop policy if exists booking_cancellation_staff_select
  on public.booking_cancellation_requests;

create policy booking_cancellation_staff_select
on public.booking_cancellation_requests
for select to authenticated
using (
  public.has_any_role(
    array['owner','admin','manager','customer_care','counsellor','staff']
  )
);

revoke insert, update, delete
on public.booking_cancellation_requests
from anon, authenticated;

-- ------------------------------------------------------------
-- E. Staff issues a priced proposal.
-- All pricing and inserts happen in one database transaction.
-- No capacity is consumed when a proposal is issued.
-- ------------------------------------------------------------

create or replace function public.staff_issue_booking_offer(
  p_enquiry_id integer,
  p_departure_id integer,
  p_adults integer,
  p_children integer,
  p_infants integer,
  p_single_rooms integer default 0,
  p_discount numeric default 0,
  p_additional_fees numeric default 0,
  p_tax_rate numeric default 0,
  p_expiry timestamptz default null,
  p_inclusions jsonb default '[]'::jsonb,
  p_exclusions jsonb default '[]'::jsonb,
  p_special_conditions text default null,
  p_payment_terms text default null,
  p_cancellation_terms text default null,
  p_customer_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_enquiry public.enquiries%rowtype;
  v_departure public.tour_departures%rowtype;
  v_tour public.tours%rowtype;
  v_quote_id integer;
  v_reference text;
  v_customer_id uuid;
  v_legacy_user_id integer;
  v_travellers integer;
  v_subtotal numeric(12,2);
  v_tax numeric(12,2);
  v_total numeric(12,2);
  v_snapshot jsonb;
  v_version integer;
begin
  if v_actor is null or not public.has_any_role(
    array['owner','admin','manager','customer_care','counsellor','staff']
  ) then
    raise exception 'Authorized CRM staff access required';
  end if;

  if p_adults < 1
     or p_children < 0
     or p_infants < 0
     or p_single_rooms < 0 then
    raise exception 'Traveller counts are invalid';
  end if;

  v_travellers := p_adults + p_children + p_infants;

  if v_travellers > 100 then
    raise exception 'Traveller count exceeds the permitted limit';
  end if;

  if coalesce(p_discount, 0) < 0
     or coalesce(p_additional_fees, 0) < 0
     or coalesce(p_tax_rate, 0) < 0
     or coalesce(p_tax_rate, 0) > 100 then
    raise exception 'Discount, fees or tax rate is invalid';
  end if;

  if coalesce(p_discount, 0) > 0
     and not public.has_any_role(array['owner','admin','manager']) then
    raise exception 'Only a manager or administrator can approve discounts';
  end if;

  if p_expiry is null or p_expiry <= now() then
    raise exception 'Proposal expiry must be in the future';
  end if;

  if length(coalesce(p_special_conditions,'')) > 3000
     or length(coalesce(p_payment_terms,'')) > 2000
     or length(coalesce(p_cancellation_terms,'')) > 3000
     or length(coalesce(p_customer_notes,'')) > 3000 then
    raise exception 'Proposal terms exceed the permitted length';
  end if;

  if jsonb_typeof(coalesce(p_inclusions, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_exclusions, '[]'::jsonb)) <> 'array' then
    raise exception 'Inclusions and exclusions must be arrays';
  end if;

  if not public.crm_can_access_enquiry(p_enquiry_id)
     and not public.has_any_role(array['owner','admin','manager']) then
    raise exception 'Enquiry is outside your CRM access';
  end if;

  select *
  into v_enquiry
  from public.enquiries
  where id = p_enquiry_id
  for update;

  if not found then
    raise exception 'Enquiry not found';
  end if;

  -- Reuse the existing enquiry/customer account bridge.
  select p.id into v_customer_id
  from public.profiles p
  where lower(p.email) = lower(trim(v_enquiry.email))
  order by p.created_at desc
  limit 1;

  if v_customer_id is null then
    raise exception
      'The customer must register using the enquiry email before an online proposal can be issued';
  end if;

  select u.id into v_legacy_user_id
  from public.users u
  where lower(u.email) = lower(trim(v_enquiry.email))
  order by u.id desc
  limit 1;

  -- Lock the departure while checking status, cutoff and prices.
  select *
  into v_departure
  from public.tour_departures
  where id = p_departure_id
  for update;

  if not found or v_departure."tourId" is null then
    raise exception 'Departure not found';
  end if;

  if v_departure.status not in ('available','limited') then
    raise exception 'This departure is not available';
  end if;

  if v_departure.booking_cutoff is not null
     and v_departure.booking_cutoff <= now() then
    raise exception 'The booking cutoff for this departure has passed';
  end if;

  if v_departure.adult_price is null
     or v_departure.child_price is null
     or v_departure.infant_price is null then
    raise exception 'Configure all departure prices before issuing an offer';
  end if;

  if v_departure.seats_available is null then
    raise exception 'Set departure capacity before issuing an offer';
  end if;

  if v_travellers > v_departure.seats_available then
    raise exception 'The departure does not have enough available seats';
  end if;

  select *
  into v_tour
  from public.tours
  where id = v_departure."tourId";

  if not found then
    raise exception 'Tour not found';
  end if;

  v_subtotal := round(
    p_adults * v_departure.adult_price
    + p_children * v_departure.child_price
    + p_infants * v_departure.infant_price
    + p_single_rooms * v_departure.single_supplement
    + coalesce(p_additional_fees, 0),
    2
  );

  if coalesce(p_discount, 0) > v_subtotal then
    raise exception 'Discount cannot exceed the subtotal';
  end if;

  v_tax := round(
    (v_subtotal - coalesce(p_discount, 0))
      * coalesce(p_tax_rate, 0) / 100,
    2
  );

  v_total := v_subtotal - coalesce(p_discount, 0) + v_tax;

  if v_total <= 0 then
    raise exception 'Proposal total must be greater than zero';
  end if;

  v_reference := 'QT-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.quotations (
    reference,
    "enquiryId",
    "customerId",
    "createdBy",
    destination,
    "travelDates",
    travellers,
    subtotal,
    taxes,
    discount,
    total,
    currency,
    status,
    notes,
    "validUntil",
    "sentAt",
    customer_auth_id,
    booking_details,
    customer_response,
    offer_version,
    proposal_status,
    tour_departure_id,
    issued_by,
    issued_at
  )
  values (
    v_reference,
    v_enquiry.id,
    v_legacy_user_id,
    (
      select u.id
      from public.users u
      where u."openId" = 'supabase:' || v_actor::text
      limit 1
    ),
    coalesce(v_tour.title, v_enquiry.destination, 'Custom trip'),
    v_departure.departure_date::text
      || case
           when v_departure.return_date is not null
           then ' to ' || v_departure.return_date::text
           else ''
         end,
    v_travellers,
    v_subtotal,
    v_tax,
    coalesce(p_discount, 0),
    v_total,
    'INR',
    'sent',
    p_customer_notes,
    p_expiry,
    now(),
    v_customer_id,
    jsonb_build_object(
      'tourId', v_tour.id,
      'tourTitle', v_tour.title,
      'departureId', v_departure.id,
      'departureCity', v_departure.departure_city,
      'departureDate', v_departure.departure_date,
      'returnDate', v_departure.return_date,
      'adults', p_adults,
      'children', p_children,
      'infants', p_infants,
      'singleRooms', p_single_rooms,
      'additionalFees', coalesce(p_additional_fees, 0),
      'taxRate', coalesce(p_tax_rate, 0),
      'inclusions', coalesce(p_inclusions, '[]'::jsonb),
      'exclusions', coalesce(p_exclusions, '[]'::jsonb),
      'specialConditions', p_special_conditions,
      'paymentTerms', p_payment_terms,
      'cancellationTerms', p_cancellation_terms
    ),
    'awaiting_response',
    1,
    'ISSUED',
    v_departure.id,
    v_actor,
    now()
  )
  returning id into v_quote_id;

  insert into public.quotation_items (
    "quotationId", description, quantity, "unitPrice", "lineTotal"
  )
  values
    (v_quote_id, 'Adult travellers', p_adults,
      v_departure.adult_price,
      round(p_adults * v_departure.adult_price, 2)),
    (v_quote_id, 'Child travellers', p_children,
      v_departure.child_price,
      round(p_children * v_departure.child_price, 2)),
    (v_quote_id, 'Infant travellers', p_infants,
      v_departure.infant_price,
      round(p_infants * v_departure.infant_price, 2));

  if p_single_rooms > 0 then
    insert into public.quotation_items (
      "quotationId", description, quantity, "unitPrice", "lineTotal"
    )
    values (
      v_quote_id,
      'Single-room supplement',
      p_single_rooms,
      v_departure.single_supplement,
      round(p_single_rooms * v_departure.single_supplement, 2)
    );
  end if;

  if coalesce(p_additional_fees, 0) > 0 then
    insert into public.quotation_items (
      "quotationId", description, quantity, "unitPrice", "lineTotal"
    )
    values (
      v_quote_id,
      'Additional approved fees',
      1,
      p_additional_fees,
      p_additional_fees
    );
  end if;

  if coalesce(p_discount, 0) > 0 then
    insert into public.quotation_items (
      "quotationId", description, quantity, "unitPrice", "lineTotal"
    )
    values (
      v_quote_id,
      'Approved discount',
      1,
      -p_discount,
      -p_discount
    );
  end if;

  if v_tax > 0 then
    insert into public.quotation_items (
      "quotationId", description, quantity, "unitPrice", "lineTotal"
    )
    values (v_quote_id, 'Tax', 1, v_tax, v_tax);
  end if;

  select coalesce(max(version_number), 0) + 1
  into v_version
  from public.booking_offer_versions
  where quotation_id = v_quote_id;

  v_snapshot := jsonb_build_object(
    'reference', v_reference,
    'version', v_version,
    'currency', 'INR',
    'tour', jsonb_build_object(
      'id', v_tour.id,
      'title', v_tour.title
    ),
    'departure', jsonb_build_object(
      'id', v_departure.id,
      'city', v_departure.departure_city,
      'departureDate', v_departure.departure_date,
      'returnDate', v_departure.return_date
    ),
    'travellers', jsonb_build_object(
      'adults', p_adults,
      'children', p_children,
      'infants', p_infants,
      'singleRooms', p_single_rooms
    ),
    'pricing', jsonb_build_object(
      'adultUnitPrice', v_departure.adult_price,
      'childUnitPrice', v_departure.child_price,
      'infantUnitPrice', v_departure.infant_price,
      'singleSupplement', v_departure.single_supplement,
      'subtotal', v_subtotal,
      'additionalFees', coalesce(p_additional_fees, 0),
      'discount', coalesce(p_discount, 0),
      'taxRate', coalesce(p_tax_rate, 0),
      'tax', v_tax,
      'total', v_total
    ),
    'terms', jsonb_build_object(
      'inclusions', coalesce(p_inclusions, '[]'::jsonb),
      'exclusions', coalesce(p_exclusions, '[]'::jsonb),
      'specialConditions', p_special_conditions,
      'paymentTerms', p_payment_terms,
      'cancellationTerms', p_cancellation_terms,
      'customerNotes', p_customer_notes
    ),
    'issuedAt', now(),
    'expiresAt', p_expiry
  );

  insert into public.booking_offer_versions (
    quotation_id, version_number, created_by, snapshot
  )
  values (v_quote_id, v_version, v_actor, v_snapshot);

  insert into public.booking_offer_events (
    quotation_id,
    customer_auth_id,
    actor_id,
    actor_type,
    action,
    metadata
  )
  values (
    v_quote_id,
    v_customer_id,
    v_actor,
    'staff',
    'issued',
    jsonb_build_object(
      'reference', v_reference,
      'version', v_version,
      'departure_id', v_departure.id,
      'total', v_total
    )
  );

  return jsonb_build_object(
    'id', v_quote_id,
    'reference', v_reference,
    'version', v_version,
    'subtotal', v_subtotal,
    'tax', v_tax,
    'discount', coalesce(p_discount, 0),
    'total', v_total,
    'currency', 'INR'
  );
end;
$$;

revoke all on function public.staff_issue_booking_offer(
  integer, integer, integer, integer, integer, integer,
  numeric, numeric, numeric, timestamptz, jsonb, jsonb,
  text, text, text, text
) from public, anon;

grant execute on function public.staff_issue_booking_offer(
  integer, integer, integer, integer, integer, integer,
  numeric, numeric, numeric, timestamptz, jsonb, jsonb,
  text, text, text, text
) to authenticated;

-- ------------------------------------------------------------
-- F. Customer response: accept/reject/request edits/cancel.
-- Acceptance revalidates capacity atomically.
-- ------------------------------------------------------------

create or replace function public.customer_respond_to_booking_offer(
  p_quotation_id integer,
  p_action text,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_quote public.quotations%rowtype;
  v_departure public.tour_departures%rowtype;
  v_booking public.bookings%rowtype;
  v_booking_id integer;
  v_booking_reference text;
  v_details jsonb;
  v_adults integer;
  v_children integer;
  v_infants integer;
  v_total integer;
  v_request_id bigint;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  if p_action not in ('accept','reject','request_changes','cancel') then
    raise exception 'Unsupported response';
  end if;

  if length(coalesce(p_message,'')) > 2000 then
    raise exception 'Response is too long';
  end if;

  select *
  into v_quote
  from public.quotations
  where id = p_quotation_id
    and customer_auth_id = v_actor
  for update;

  if not found then
    raise exception 'Proposal not found';
  end if;

  if v_quote."validUntil" is not null
   and v_quote."validUntil" <= now()
   and v_quote.proposal_status in ('ISSUED','EDIT_REQUESTED') then

  update public.quotations
     set proposal_status = 'EXPIRED',
         status = 'expired'
   where id = v_quote.id;

  insert into public.booking_offer_events (
    quotation_id,
    customer_auth_id,
    actor_id,
    actor_type,
    action,
    message
  )
  values (
    v_quote.id,
    v_actor,
    v_actor,
    'customer',
    'viewed',
    'Expired offer response attempted'
  );

  return jsonb_build_object(
    'success', false,
    'action', 'expired',
    'message', 'This proposal has expired'
  );
end if;

  if p_action = 'request_changes' then
    if v_quote.proposal_status not in ('ISSUED','EDIT_REQUESTED') then
      raise exception 'This proposal cannot be edited now';
    end if;

    if nullif(trim(p_message),'') is null then
      raise exception 'Please describe the requested changes';
    end if;

    update public.quotations
       set proposal_status = 'EDIT_REQUESTED',
           customer_response = 'changes_requested',
           customer_response_note = trim(p_message),
           response_at = now()
     where id = v_quote.id;

    insert into public.booking_offer_events (
      quotation_id, customer_auth_id, actor_id,
      actor_type, action, message
    )
    values (
      v_quote.id, v_actor, v_actor,
      'customer', 'changes_requested', trim(p_message)
    );

    return jsonb_build_object('success', true, 'action', 'changes_requested');
  end if;

  if p_action = 'reject' then
    if v_quote.proposal_status not in ('ISSUED','EDIT_REQUESTED') then
      raise exception 'This proposal cannot be rejected now';
    end if;

    update public.quotations
       set proposal_status = 'REJECTED',
           customer_response = 'rejected',
           customer_response_note = nullif(trim(p_message),''),
           response_at = now(),
           status = 'rejected'
     where id = v_quote.id;

    insert into public.booking_offer_events (
      quotation_id, customer_auth_id, actor_id,
      actor_type, action, message
    )
    values (
      v_quote.id, v_actor, v_actor,
      'customer', 'rejected', nullif(trim(p_message),'')
    );

    return jsonb_build_object('success', true, 'action', 'rejected');
  end if;

  if p_action = 'cancel' then
    if v_quote.proposal_status in ('ISSUED','EDIT_REQUESTED') then
      update public.quotations
         set proposal_status = 'WITHDRAWN',
             customer_response = 'cancelled',
             customer_response_note = nullif(trim(p_message),''),
             response_at = now(),
             status = 'rejected'
       where id = v_quote.id;

      insert into public.booking_offer_events (
        quotation_id, customer_auth_id, actor_id,
        actor_type, action, message
      )
      values (
        v_quote.id, v_actor, v_actor,
        'customer', 'cancelled', nullif(trim(p_message),'')
      );

      return jsonb_build_object('success', true, 'action', 'offer_withdrawn');
    end if;

    if v_quote.proposal_status <> 'ACCEPTED'
       or v_quote."bookingId" is null then
      raise exception 'This proposal or booking cannot be cancelled';
    end if;

    select *
    into v_booking
    from public.bookings
    where id = v_quote."bookingId"
      and customer_auth_id = v_actor
    for update;

    if not found then
      raise exception 'Booking not found';
    end if;

    if v_booking."bookingStatus" in ('cancelled','completed') then
      raise exception 'This booking cannot be cancelled';
    end if;

    if exists (
      select 1
      from public.booking_cancellation_requests r
      where r.booking_id = v_booking.id
        and r.status = 'REQUESTED'
    ) then
      raise exception 'A cancellation request is already pending';
    end if;

    insert into public.booking_cancellation_requests (
      booking_id, customer_auth_id, reason
    )
    values (
      v_booking.id, v_actor, nullif(trim(p_message),'')
    )
    returning id into v_request_id;

    update public.bookings
       set cancellation_requested_at = now(),
           cancellation_reason = nullif(trim(p_message),'')
     where id = v_booking.id;

    insert into public.booking_offer_events (
      quotation_id, customer_auth_id, actor_id,
      actor_type, action, message, metadata
    )
    values (
      v_quote.id, v_actor, v_actor,
      'customer', 'cancelled',
      'Cancellation requested; booking is not yet cancelled.',
      jsonb_build_object('cancellation_request_id', v_request_id)
    );

    return jsonb_build_object(
      'success', true,
      'action', 'cancellation_requested',
      'request_id', v_request_id
    );
  end if;

  -- Accept proposal.
  if v_quote.proposal_status not in ('ISSUED','EDIT_REQUESTED') then
    raise exception 'This proposal is no longer available';
  end if;

  if v_quote."validUntil" is not null and v_quote."validUntil" <= now() then
    raise exception 'This proposal has expired';
  end if;

  if v_quote.total <= 0 or v_quote.tour_departure_id is null then
    raise exception 'The proposal is missing valid pricing or departure data';
  end if;

  v_details := v_quote.booking_details;
  v_adults := coalesce((v_details->>'adults')::integer, 0);
  v_children := coalesce((v_details->>'children')::integer, 0);
  v_infants := coalesce((v_details->>'infants')::integer, 0);
  v_total := v_adults + v_children + v_infants;

  if v_total <> v_quote.travellers or v_total < 1 then
    raise exception 'Proposal traveller counts are invalid';
  end if;

  -- Serialize acceptance for this departure.
  select *
  into v_departure
  from public.tour_departures
  where id = v_quote.tour_departure_id
  for update;

  if not found
     or v_departure.status not in ('available','limited') then
    raise exception 'Departure is no longer available';
  end if;

  if v_departure.booking_cutoff is not null
     and v_departure.booking_cutoff <= now() then
    raise exception 'Departure booking cutoff has passed';
  end if;

  if v_departure.seats_available is null
     or v_departure.seats_available < v_total then
    raise exception 'Not enough seats remain for this departure';
  end if;

  v_booking_reference := 'BK-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  insert into public.bookings (
    reference,
    "userId",
    "tourId",
    destination,
    "travelDates",
    travellers,
    amount,
    "bookingStatus",
    "paymentStatus",
    customer_auth_id,
    booking_details,
    tour_departure_id,
    adult_count,
    child_count,
    infant_count,
    single_rooms
  )
  values (
    v_booking_reference,
    v_quote."customerId",
    v_departure."tourId",
    v_quote.destination,
    v_quote."travelDates",
    v_total,
    v_quote.total,
    'confirmed',
    'pending',
    v_actor,
    v_details,
    v_departure.id,
    v_adults,
    v_children,
    v_infants,
    coalesce((v_details->>'singleRooms')::integer, 0)
  )
  returning id into v_booking_id;

  -- Capacity is consumed only at acceptance, in this same transaction.
  update public.tour_departures
     set seats_available = seats_available - v_total,
         status = case
           when seats_available - v_total <= 0 then 'sold_out'
           when seats_available - v_total <= 5 then 'limited'
           else 'available'
         end
   where id = v_departure.id;

  update public.quotations
     set "bookingId" = v_booking_id,
         "acceptedAt" = now(),
         status = 'accepted',
         proposal_status = 'ACCEPTED',
         customer_response = 'accepted',
         response_at = now(),
         customer_response_note = null
   where id = v_quote.id;

  insert into public.booking_offer_events (
    quotation_id, customer_auth_id, actor_id,
    actor_type, action, metadata
  )
  values (
    v_quote.id, v_actor, v_actor,
    'customer', 'accepted',
    jsonb_build_object(
      'booking_id', v_booking_id,
      'booking_reference', v_booking_reference,
      'departure_id', v_departure.id
    )
  );

  return jsonb_build_object(
    'success', true,
    'action', 'accepted',
    'booking_id', v_booking_id,
    'booking_reference', v_booking_reference,
    'payment_status', 'pending'
  );
end;
$$;

revoke all on function public.customer_respond_to_booking_offer(
  integer, text, text
) from public, anon;

grant execute on function public.customer_respond_to_booking_offer(
  integer, text, text
) to authenticated;


alter table public.quotations
  add column if not exists customer_auth_id uuid references public.profiles(id) on delete set null,
  add column if not exists booking_details jsonb not null default '{}'::jsonb,
  add column if not exists customer_response text not null default 'awaiting_response',
  add column if not exists customer_response_note text,
  add column if not exists response_at timestamptz,
  add column if not exists offer_version integer not null default 1;

alter table public.bookings
  add column if not exists customer_auth_id uuid references public.profiles(id) on delete set null,
  add column if not exists booking_details jsonb not null default '{}'::jsonb,
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists cancellation_reason text;

update public.quotations q
set customer_auth_id = e.customer_auth_id
from public.enquiries e
where q.customer_auth_id is null
  and q."enquiryId" = e.id
  and e.customer_auth_id is not null;

-- Also bridge older quotations through the legacy users.openId mapping.
update public.quotations q
set customer_auth_id = substring(u."openId" from 9)::uuid
from public.users u
where q.customer_auth_id is null
  and q."customerId" = u.id
  and u."openId" ~ '^supabase:[0-9a-fA-F-]{36}$';

update public.bookings b
set customer_auth_id = q.customer_auth_id,
    booking_details = q.booking_details
from public.quotations q
where q."bookingId" = b.id
  and b.customer_auth_id is null
  and q.customer_auth_id is not null;

alter table public.quotations
  drop constraint if exists quotations_customer_response_check;
alter table public.quotations
  add constraint quotations_customer_response_check
  check (customer_response in ('awaiting_response','changes_requested','accepted','rejected','cancelled'));

alter table public.quotations
  drop constraint if exists quotations_booking_details_object_check;
alter table public.quotations
  add constraint quotations_booking_details_object_check
  check (jsonb_typeof(booking_details) = 'object');

update public.quotations
set customer_response = case
  when status = 'accepted' then 'accepted'
  when status = 'rejected' then 'rejected'
  else 'awaiting_response'
end,
response_at = coalesce(response_at, "acceptedAt")
where customer_response = 'awaiting_response';

alter table public.bookings
  drop constraint if exists bookings_booking_details_object_check;
alter table public.bookings
  add constraint bookings_booking_details_object_check
  check (jsonb_typeof(booking_details) = 'object');

create index if not exists quotations_customer_auth_idx
  on public.quotations(customer_auth_id, "createdAt" desc);
create index if not exists quotations_customer_response_idx
  on public.quotations(customer_response, "createdAt" desc);
create index if not exists bookings_customer_auth_phase5_idx
  on public.bookings(customer_auth_id, "createdAt" desc);

create table if not exists public.booking_offer_events (
  id bigint generated always as identity primary key,
  quotation_id integer not null references public.quotations(id) on delete cascade,
  customer_auth_id uuid references public.profiles(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_type text not null check (actor_type in ('customer','staff','system')),
  action text not null check (action in ('issued','viewed','accepted','rejected','changes_requested','cancelled','reissued','payment_started')),
  message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists booking_offer_events_quote_idx
  on public.booking_offer_events(quotation_id, created_at desc);
create index if not exists booking_offer_events_customer_idx
  on public.booking_offer_events(customer_auth_id, created_at desc);

alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;
alter table public.booking_offer_events enable row level security;

-- Customers can read only offers linked to their own Supabase profile.
drop policy if exists quotations_customer_select_own on public.quotations;
create policy quotations_customer_select_own on public.quotations
  for select to authenticated using (customer_auth_id = auth.uid() and status <> 'draft');

drop policy if exists quotation_items_customer_select_own on public.quotation_items;
create policy quotation_items_customer_select_own on public.quotation_items
  for select to authenticated using (
    exists (
      select 1 from public.quotations q
      where q.id = "quotationId" and q.customer_auth_id = auth.uid()
    )
  );

-- Staff can read/create/update quotes only within their role/CRM scope.
drop policy if exists quotations_staff_select_phase5 on public.quotations;
create policy quotations_staff_select_phase5 on public.quotations
  for select to authenticated using (
    public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'])
    and (
      public.has_any_role(array['owner','admin','manager'])
      or ("enquiryId" is not null and public.crm_can_access_enquiry("enquiryId"))
    )
  );

drop policy if exists quotations_staff_insert_phase5 on public.quotations;
create policy quotations_staff_insert_phase5 on public.quotations
  for insert to authenticated with check (
    public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'])
    and (
      public.has_any_role(array['owner','admin','manager'])
      or ("enquiryId" is not null and customer_auth_id is not null
          and customer_auth_id = (select e.customer_auth_id from public.enquiries e where e.id = "enquiryId")
          and public.crm_can_access_enquiry("enquiryId"))
    )
  );

drop policy if exists quotations_staff_update_phase5 on public.quotations;
create policy quotations_staff_update_phase5 on public.quotations
  for update to authenticated using (
    public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'])
    and (public.has_any_role(array['owner','admin','manager']) or ("enquiryId" is not null and customer_auth_id is not null
      and customer_auth_id = (select e.customer_auth_id from public.enquiries e where e.id = "enquiryId")
      and public.crm_can_access_enquiry("enquiryId")))
  ) with check (
    public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'])
    and (public.has_any_role(array['owner','admin','manager']) or ("enquiryId" is not null and customer_auth_id is not null
      and customer_auth_id = (select e.customer_auth_id from public.enquiries e where e.id = "enquiryId")
      and public.crm_can_access_enquiry("enquiryId")))
  );

drop policy if exists quotation_items_staff_select_phase5 on public.quotation_items;
create policy quotation_items_staff_select_phase5 on public.quotation_items
  for select to authenticated using (
    exists (select 1 from public.quotations q where q.id = "quotationId"
      and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'])
      and (public.has_any_role(array['owner','admin','manager']) or (q."enquiryId" is not null and public.crm_can_access_enquiry(q."enquiryId")))
    )
  );
drop policy if exists quotation_items_staff_insert_phase5 on public.quotation_items;
create policy quotation_items_staff_insert_phase5 on public.quotation_items
  for insert to authenticated with check (
    exists (select 1 from public.quotations q where q.id = "quotationId"
      and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'])
      and (public.has_any_role(array['owner','admin','manager']) or (q."enquiryId" is not null and public.crm_can_access_enquiry(q."enquiryId")))
    )
  );
drop policy if exists quotation_items_staff_update_phase5 on public.quotation_items;
create policy quotation_items_staff_update_phase5 on public.quotation_items
  for update to authenticated using (
    exists (select 1 from public.quotations q where q.id = "quotationId"
      and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'])
      and (public.has_any_role(array['owner','admin','manager']) or (q."enquiryId" is not null and public.crm_can_access_enquiry(q."enquiryId")))
    )
  ) with check (
    exists (select 1 from public.quotations q where q.id = "quotationId"
      and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'])
      and (public.has_any_role(array['owner','admin','manager']) or (q."enquiryId" is not null and public.crm_can_access_enquiry(q."enquiryId")))
    )
  );

drop policy if exists booking_offer_events_customer_select_own on public.booking_offer_events;
create policy booking_offer_events_customer_select_own on public.booking_offer_events
  for select to authenticated using (customer_auth_id = auth.uid());
drop policy if exists booking_offer_events_staff_insert on public.booking_offer_events;
create policy booking_offer_events_staff_insert on public.booking_offer_events
  for insert to authenticated with check (
    actor_type = 'staff' and actor_id = auth.uid()
    and public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'])
    and exists (select 1 from public.quotations q where q.id = quotation_id
      and (public.has_any_role(array['owner','admin','manager']) or (q."enquiryId" is not null and public.crm_can_access_enquiry(q."enquiryId")))
    )
  );
drop policy if exists booking_offer_events_staff_select on public.booking_offer_events;
create policy booking_offer_events_staff_select on public.booking_offer_events
  for select to authenticated using (
    public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff'])
    and exists (select 1 from public.quotations q where q.id = quotation_id
      and (public.has_any_role(array['owner','admin','manager']) or (q."enquiryId" is not null and public.crm_can_access_enquiry(q."enquiryId")))
    )
  );

-- Staff can record phone calls, office visits, and walk-in enquiries in the same CRM pipeline.
create or replace function public.crm_record_enquiry(
  p_name text,
  p_email text,
  p_phone text,
  p_destination text default null,
  p_travel_dates text default null,
  p_travellers integer default 2,
  p_budget text default null,
  p_trip_type text default null,
  p_message text default null,
  p_tour_id integer default null,
  p_source text default 'office'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id integer;
  v_reference text := 'AF-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  v_customer_id uuid;
  v_legacy_user_id integer;
  v_department_id uuid;
  v_source text := coalesce(p_source, 'office');
begin
  if auth.uid() is null or not public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff']) then
    raise exception 'CRM staff access required';
  end if;
  if length(trim(coalesce(p_name,''))) < 2 or length(trim(coalesce(p_email,''))) < 5 or length(trim(coalesce(p_phone,''))) < 7 then
    raise exception 'Customer name, email, and phone are required';
  end if;
  if p_travellers < 1 or p_travellers > 100 then raise exception 'Traveller count must be between 1 and 100'; end if;
  if v_source not in ('website','phone','office','callback','appointment','other') then raise exception 'Unsupported enquiry source'; end if;

  select p.id into v_customer_id from public.profiles p where lower(p.email) = lower(trim(p_email)) order by p.created_at desc limit 1;
  select u.id into v_legacy_user_id from public.users u where lower(u.email) = lower(trim(p_email)) order by u.id desc limit 1;
  select om.department_id into v_department_id from public.organization_memberships om where om.user_id = auth.uid() and om.status = 'active' limit 1;

  insert into public.enquiries (
    reference, "userId", "tourId", name, email, phone, destination, "travelDates", travellers,
    budget, "tripType", message, status, priority, source, assigned_employee_id,
    assigned_department_id, customer_auth_id
  ) values (
    v_reference, v_legacy_user_id, p_tour_id, trim(p_name), lower(trim(p_email)), trim(p_phone), nullif(trim(p_destination),''),
    nullif(trim(p_travel_dates),''), coalesce(p_travellers,2), nullif(trim(p_budget),''), nullif(trim(p_trip_type),''),
    nullif(trim(p_message),''), 'assigned', 'normal', v_source, auth.uid(), v_department_id, v_customer_id
  ) returning id into v_id;

  insert into public.communication_events(customer_auth_id,enquiry_id,actor_id,event_type,summary,metadata)
  values (v_customer_id,v_id,auth.uid(),'enquiry_submitted','Enquiry recorded by staff',jsonb_build_object('source',v_source));

  return jsonb_build_object('id',v_id,'reference',v_reference,'customer_linked',v_customer_id is not null);
end;
$$;
revoke all on function public.crm_record_enquiry(text,text,text,text,text,integer,text,text,text,integer,text) from public;
grant execute on function public.crm_record_enquiry(text,text,text,text,text,integer,text,text,text,integer,text) to authenticated;

-- Link an enquiry to an existing customer account by the enquiry email.
-- This lets phone/office/guest enquiries receive offers in their profile after they register.
create or replace function public.crm_link_enquiry_customer_by_email(p_enquiry_id integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enquiry public.enquiries%rowtype;
  v_customer_id uuid;
  v_legacy_user_id integer;
begin
  if auth.uid() is null or not public.has_any_role(array['owner','admin','manager','customer_care','counsellor','staff']) then
    raise exception 'CRM staff access required';
  end if;
  if not public.crm_can_access_enquiry(p_enquiry_id) then
    raise exception 'Enquiry not found or outside your CRM access';
  end if;
  select * into v_enquiry from public.enquiries where id = p_enquiry_id for update;
  if not found then raise exception 'Enquiry not found'; end if;
  if v_enquiry.customer_auth_id is not null then return v_enquiry.customer_auth_id; end if;
  select p.id into v_customer_id
  from public.profiles p
  where lower(p.email) = lower(trim(v_enquiry.email))
  order by p.created_at desc
  limit 1;
  if v_customer_id is null then return null; end if;
  select u.id into v_legacy_user_id from public.users u where lower(u.email) = lower(trim(v_enquiry.email)) order by u.id desc limit 1;
  update public.enquiries
  set customer_auth_id = v_customer_id,
      "userId" = coalesce("userId", v_legacy_user_id)
  where id = p_enquiry_id;
  return v_customer_id;
end;
$$;
revoke all on function public.crm_link_enquiry_customer_by_email(integer) from public;
grant execute on function public.crm_link_enquiry_customer_by_email(integer) to authenticated;

create or replace function public.crm_review_booking_cancellation(
  p_request_id bigint,
  p_decision text,
  p_response text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_request public.booking_cancellation_requests%rowtype;
  v_booking public.bookings%rowtype;
  v_departure public.tour_departures%rowtype;
  v_new_seats integer;
begin
  if v_actor is null
     or not public.has_any_role(
       array['owner','admin','manager','customer_care']
     ) then
    raise exception 'Authorized cancellation-review access required';
  end if;

  if p_decision not in ('approve','reject') then
    raise exception 'Decision must be approve or reject';
  end if;

  if length(coalesce(p_response, '')) > 2000 then
    raise exception 'Response must not exceed 2000 characters';
  end if;

  select *
    into v_request
    from public.booking_cancellation_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'Cancellation request not found';
  end if;

  if v_request.status <> 'REQUESTED' then
    raise exception 'This request has already been reviewed';
  end if;

  select *
    into v_booking
    from public.bookings
   where id = v_request.booking_id
   for update;

  if not found then
    raise exception 'Booking not found';
  end if;

  if p_decision = 'approve' then
    if v_booking."bookingStatus" in ('cancelled', 'completed') then
      raise exception 'This booking cannot be cancelled';
    end if;

    if v_booking.tour_departure_id is not null then
      select *
        into v_departure
        from public.tour_departures
       where id = v_booking.tour_departure_id
       for update;

      if found then
        v_new_seats :=
          coalesce(v_departure.seats_available, 0)
          + v_booking.travellers;

        if v_departure.total_capacity is not null then
          v_new_seats := least(
            v_new_seats,
            v_departure.total_capacity
          );
        end if;

        update public.tour_departures
           set seats_available = v_new_seats,
               status = case
                 when v_new_seats <= 0 then 'sold_out'
                 when v_new_seats <= 5 then 'limited'
                 else 'available'
               end
         where id = v_departure.id;
      end if;
    end if;

    update public.bookings
       set "bookingStatus" = 'cancelled',
           cancellation_requested_at = now(),
           cancellation_reason = coalesce(
             nullif(trim(p_response), ''),
             cancellation_reason
           )
     where id = v_booking.id;

    update public.booking_cancellation_requests
       set status = 'APPROVED',
           reviewed_by = v_actor,
           reviewed_at = now(),
           staff_response = nullif(trim(p_response), '')
     where id = v_request.id;

  else
    update public.bookings
       set cancellation_requested_at = null,
           cancellation_reason = null
     where id = v_booking.id;

    update public.booking_cancellation_requests
       set status = 'REJECTED',
           reviewed_by = v_actor,
           reviewed_at = now(),
           staff_response = coalesce(
             nullif(trim(p_response), ''),
             'Cancellation request rejected'
           )
     where id = v_request.id;
  end if;

  return jsonb_build_object(
    'success', true,
    'request_id', v_request.id,
    'decision', p_decision,
    'booking_id', v_booking.id
  );
end;
$$;

revoke all on function public.crm_review_booking_cancellation(
  bigint, text, text
) from public, anon;

grant execute on function public.crm_review_booking_cancellation(
  bigint, text, text
) to authenticated;


commit;
