
begin;

-- =========================================================
-- 1. COUPON MANAGEMENT
-- =========================================================

create table if not exists public.coupons (
  id bigint generated always as identity primary key,
  code text not null unique,
  description text,
  discount_type text not null
    check (discount_type in ('percent', 'fixed')),
  discount_value numeric(12,2) not null
    check (discount_value > 0),
  max_discount numeric(12,2),
  min_subtotal numeric(12,2) not null default 0
    check (min_subtotal >= 0),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  usage_limit integer,
  per_customer_limit integer not null default 1
    check (per_customer_limit > 0),
  usage_count integer not null default 0
    check (usage_count >= 0),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (max_discount is null or max_discount >= 0),
  check (usage_limit is null or usage_limit > 0),
  check (expires_at is null or expires_at > starts_at),
  check (
    discount_type <> 'percent'
    or discount_value <= 100
  )
);

create table if not exists public.coupon_redemptions (
  id bigint generated always as identity primary key,
  coupon_id bigint not null
    references public.coupons(id) on delete restrict,
  customer_auth_id uuid not null
    references auth.users(id) on delete cascade,
  quotation_id integer not null
    references public.quotations(id) on delete cascade,
  booking_id integer
    references public.bookings(id) on delete set null,
  code_snapshot text not null,
  subtotal numeric(12,2) not null,
  discount_amount numeric(12,2) not null
    check (discount_amount >= 0),
  created_at timestamptz not null default now(),
  unique (quotation_id)
);

create index if not exists coupon_redemptions_customer_idx
  on public.coupon_redemptions(customer_auth_id, coupon_id);

create index if not exists coupon_redemptions_coupon_idx
  on public.coupon_redemptions(coupon_id, created_at desc);

alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

drop policy if exists coupons_admin_read on public.coupons;

create policy coupons_admin_read
on public.coupons
for select
to authenticated
using (public.has_any_role(array['owner', 'admin']));

drop policy if exists coupon_redemptions_admin_read
on public.coupon_redemptions;

create policy coupon_redemptions_admin_read
on public.coupon_redemptions
for select
to authenticated
using (public.has_any_role(array['owner', 'admin']));


-- =========================================================
-- 2. CREATE A DIRECT CUSTOMER BOOKING
-- =========================================================

CREATE OR REPLACE FUNCTION public.customer_create_direct_booking(
  p_tour_id integer,
  p_departure_id integer,
  p_name text,
  p_email text,
  p_phone text,
  p_adults integer,
  p_children integer DEFAULT 0,
  p_infants integer DEFAULT 0,
  p_traveller_names text[] DEFAULT '{}',
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_user_id integer;
  v_tour public.tours%rowtype;
  v_departure public.tour_departures%rowtype;
  v_enquiry_id integer;
  v_booking_id integer;
  v_quote_id integer;
  v_total_travellers integer;
  v_adult_price numeric(12,2);
  v_child_price numeric(12,2);
  v_infant_price numeric(12,2);
  v_subtotal numeric(12,2);
  v_booking_ref text;
  v_quote_ref text;
  v_enquiry_ref text;
  v_travel_dates text;
  v_details jsonb;
BEGIN
  -- Require an authenticated customer.
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to book a tour';
  END IF;

  -- Validate contact details.
  IF length(trim(coalesce(p_name, ''))) < 2
     OR length(trim(coalesce(p_phone, ''))) < 7
     OR coalesce(p_email, '') !~*
       '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
  THEN
    RAISE EXCEPTION 'Enter a valid name, email and phone number';
  END IF;

  -- Validate traveller counts, including NULL values.
  IF p_adults IS NULL
     OR p_children IS NULL
     OR p_infants IS NULL
     OR p_adults < 1
     OR p_children < 0
     OR p_infants < 0
     OR p_adults + p_children + p_infants > 30
  THEN
    RAISE EXCEPTION 'Traveller counts are invalid';
  END IF;

  -- Load a published tour.
  SELECT *
  INTO v_tour
  FROM public.tours
  WHERE id = p_tour_id
    AND status = 'published'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This tour is not currently available for booking';
  END IF;

  -- Resolve the customer's application profile.
  SELECT u.id
  INTO v_user_id
  FROM public.users u
  WHERE u."openId" = 'supabase:' || v_actor::text
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION
      'Your customer profile is not ready. Please sign out and sign in again.';
  END IF;

  v_total_travellers := p_adults + p_children + p_infants;
  v_adult_price := v_tour."priceFrom";
  v_child_price := v_tour."priceFrom";
  v_infant_price := 0;
  v_travel_dates := 'Date to be confirmed';

  -- Validate and reserve the requested departure.
  IF p_departure_id IS NOT NULL THEN
    SELECT *
    INTO v_departure
    FROM public.tour_departures
    WHERE id = p_departure_id
      AND "tourId" = p_tour_id
      AND status IN ('available', 'limited')
      AND departure_date >= current_date
      AND (booking_cutoff IS NULL OR booking_cutoff > now())
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Selected departure is no longer available';
    END IF;

    IF v_departure.seats_available IS NOT NULL
       AND v_departure.seats_available < v_total_travellers
    THEN
      RAISE EXCEPTION 'Not enough seats remain for this departure';
    END IF;

    v_adult_price := coalesce(
      v_departure.adult_price,
      v_departure.price_from,
      v_tour."priceFrom"
    );

    v_child_price := coalesce(
      v_departure.child_price,
      v_departure.price_from,
      v_tour."priceFrom"
    );

    v_infant_price := coalesce(v_departure.infant_price, 0);

    v_travel_dates :=
      v_departure.departure_date::text
      || CASE
        WHEN v_departure.return_date IS NOT NULL
        THEN ' to ' || v_departure.return_date::text
        ELSE ''
      END;

    IF v_departure.seats_available IS NOT NULL THEN
      UPDATE public.tour_departures
      SET seats_available = seats_available - v_total_travellers,
          status = CASE
            WHEN seats_available - v_total_travellers <= 0
            THEN 'sold_out'
            ELSE status
          END
      WHERE id = v_departure.id;
    END IF;
  END IF;

  -- Calculate booking total.
  v_subtotal := round(
    v_adult_price * p_adults
    + v_child_price * p_children
    + v_infant_price * p_infants,
    2
  );

  IF v_subtotal <= 0 THEN
    RAISE EXCEPTION 'This tour has no valid booking price';
  END IF;

  -- Create the enquiry.
  v_enquiry_ref :=
    'AF-' || upper(
      substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
    );

  INSERT INTO public.enquiries(
    reference,
    "userId",
    "tourId",
    customer_auth_id,
    name,
    email,
    phone,
    destination,
    "travelDates",
    travellers,
    "tripType",
    message,
    status
  )
  VALUES (
    v_enquiry_ref,
    v_user_id,
    p_tour_id,
    v_actor,
    trim(p_name),
    lower(trim(p_email)),
    trim(p_phone),
    v_tour.title,
    v_travel_dates,
    v_total_travellers,
    'direct_booking',
    nullif(trim(coalesce(p_notes, '')), ''),
    'confirmed'
  )
  RETURNING id INTO v_enquiry_id;

  -- Generate booking reference and details.
  v_booking_ref :=
    'BK-' || upper(
      substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
    );

  v_details := jsonb_build_object(
    'bookingType', 'direct',
    'bookingReference', v_booking_ref,
    'tourTitle', v_tour.title,
    'tourId', v_tour.id,
    'departureId', p_departure_id,
    'departureDate',
      CASE
        WHEN p_departure_id IS NOT NULL
        THEN v_departure.departure_date::text
        ELSE NULL
      END,
    'returnDate',
      CASE
        WHEN p_departure_id IS NOT NULL
        THEN v_departure.return_date::text
        ELSE NULL
      END,
    'adults', p_adults,
    'children', p_children,
    'infants', p_infants,
    'travellerNames',
      coalesce(to_jsonb(p_traveller_names), '[]'::jsonb),
    'contactName', trim(p_name),
    'contactEmail', lower(trim(p_email)),
    'contactPhone', trim(p_phone),
    'customerNotes', nullif(trim(coalesce(p_notes, '')), '')
  );

  -- FIX: Insert all traveller counts required by the CHECK constraint.
  INSERT INTO public.bookings(
    reference,
    "userId",
    "tourId",
    destination,
    "travelDates",
    travellers,
    adult_count,
    child_count,
    infant_count,
    single_rooms,
    amount,
    "bookingStatus",
    "paymentStatus",
    customer_auth_id,
    booking_details
  )
  VALUES (
    v_booking_ref,
    v_user_id,
    p_tour_id,
    v_tour.title,
    v_travel_dates,
    v_total_travellers,
    p_adults,
    p_children,
    p_infants,
    0,
    v_subtotal,
    'confirmed',
    'pending',
    v_actor,
    v_details
  )
  RETURNING id INTO v_booking_id;

  -- Create the accepted quotation.
  v_quote_ref :=
    'DIR-' || upper(
      substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
    );

  INSERT INTO public.quotations(
    reference,
    "enquiryId",
    "customerId",
    "createdBy",
    "bookingId",
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
    "acceptedAt",
    customer_auth_id,
    booking_details,
    customer_response,
    response_at,
    offer_version,
    proposal_status,
    tour_departure_id,
    issued_at
  )
  VALUES (
    v_quote_ref,
    v_enquiry_id,
    v_user_id,
    v_user_id,
    v_booking_id,
    v_tour.title,
    v_travel_dates,
    v_total_travellers,
    v_subtotal,
    0,
    0,
    v_subtotal,
    'INR',
    'accepted',
    'Direct customer booking',
    now() + interval '30 days',
    now(),
    now(),
    v_actor,
    v_details,
    'accepted',
    now(),
    1,
    'ACCEPTED',
    p_departure_id,
    now()
  )
  RETURNING id INTO v_quote_id;

  -- Add quotation line items.
  INSERT INTO public.quotation_items(
    "quotationId",
    description,
    quantity,
    "unitPrice",
    "lineTotal"
  )
  VALUES (
    v_quote_id,
    v_tour.title || ' - adults',
    p_adults,
    v_adult_price,
    round(v_adult_price * p_adults, 2)
  );

  IF p_children > 0 THEN
    INSERT INTO public.quotation_items(
      "quotationId",
      description,
      quantity,
      "unitPrice",
      "lineTotal"
    )
    VALUES (
      v_quote_id,
      v_tour.title || ' - children',
      p_children,
      v_child_price,
      round(v_child_price * p_children, 2)
    );
  END IF;

  IF p_infants > 0 THEN
    INSERT INTO public.quotation_items(
      "quotationId",
      description,
      quantity,
      "unitPrice",
      "lineTotal"
    )
    VALUES (
      v_quote_id,
      v_tour.title || ' - infants',
      p_infants,
      v_infant_price,
      round(v_infant_price * p_infants, 2)
    );
  END IF;

  -- Link the quotation to the booking details.
  UPDATE public.bookings
  SET booking_details =
    v_details || jsonb_build_object('quotationId', v_quote_id)
  WHERE id = v_booking_id;

  RETURN jsonb_build_object(
    'bookingId', v_booking_id,
    'bookingReference', v_booking_ref,
    'quotationId', v_quote_id,
    'quotationReference', v_quote_ref,
    'total', v_subtotal
  );
END;
$$;



-- =========================================================
-- 3. APPLY A COUPON TO AN ACCEPTED DIRECT BOOKING
-- =========================================================

create or replace function public.customer_apply_coupon(
  p_quotation_id integer,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_quote public.quotations%rowtype;
  v_coupon public.coupons%rowtype;
  v_subtotal numeric(12,2);
  v_discount numeric(12,2);
  v_total numeric(12,2);
  v_old_coupon_id bigint;
  v_user_count integer;
begin
  -- 1. Authenticate customer.
  if v_actor is null then
    raise exception 'Sign in to apply a coupon';
  end if;

  if p_code is null or trim(p_code) = '' then
    raise exception 'Enter a coupon code';
  end if;

  -- 2. Lock the customer's quotation to prevent concurrent
  -- coupon changes on the same booking.
  select *
  into v_quote
  from public.quotations
  where id = p_quotation_id
    and customer_auth_id = v_actor
  for update;

  if not found then
    raise exception 'Booking offer not found';
  end if;

  if v_quote.status <> 'accepted'
     or v_quote.proposal_status <> 'ACCEPTED'
  then
    raise exception
      'Coupon can only be applied to an accepted booking';
  end if;

  if coalesce(
    v_quote.booking_details->>'bookingType', ''
  ) <> 'direct' then
    raise exception
      'Coupons are available only for direct customer bookings';
  end if;

  if v_quote."validUntil" is not null
     and v_quote."validUntil" <= now()
  then
    raise exception 'This booking offer has expired';
  end if;

  if v_quote."bookingId" is null then
    raise exception 'No booking is associated with this offer';
  end if;

  -- 3. Find any existing redemption for this quotation.
  select cr.coupon_id
  into v_old_coupon_id
  from public.coupon_redemptions cr
  where cr.quotation_id = v_quote.id;

  -- 4. Lock and validate the requested coupon.
  select *
  into v_coupon
  from public.coupons
  where code = upper(trim(p_code))
  for update;

  if not found or not v_coupon.is_active then
    raise exception 'Coupon code is invalid or inactive';
  end if;

  if v_coupon.starts_at > now() then
    raise exception 'This coupon is not active yet';
  end if;

  if v_coupon.expires_at is not null
     and v_coupon.expires_at <= now()
  then
    raise exception 'This coupon has expired';
  end if;

  -- Reapplying the same coupon must not consume another use.
  if v_coupon.usage_limit is not null
     and v_coupon.usage_count >= v_coupon.usage_limit
     and v_old_coupon_id is distinct from v_coupon.id
  then
    raise exception
      'This coupon has reached its redemption limit';
  end if;

  -- 5. Count this customer's other redemptions.
  select count(*)
  into v_user_count
  from public.coupon_redemptions cr
  where cr.coupon_id = v_coupon.id
    and cr.customer_auth_id = v_actor
    and cr.quotation_id <> v_quote.id;

  if v_old_coupon_id is distinct from v_coupon.id
     and v_user_count >= v_coupon.per_customer_limit
  then
    raise exception
      'You have reached the usage limit for this coupon';
  end if;

  -- 6. Calculate the discount from the original subtotal.
  -- Do not subtract the previously applied discount again.
  v_subtotal := round(
    greatest(0, coalesce(v_quote.subtotal, 0))
    + greatest(0, coalesce(v_quote.taxes, 0)),
    2
  );

  if v_subtotal < v_coupon.min_subtotal then
    raise exception
      'Booking does not meet the minimum spend for this coupon';
  end if;

  v_discount := case
    when v_coupon.discount_type = 'percent'
    then round(
      v_subtotal * v_coupon.discount_value / 100,
      2
    )
    else v_coupon.discount_value
  end;

  if v_coupon.max_discount is not null then
    v_discount := least(
      v_discount,
      v_coupon.max_discount
    );
  end if;

  v_discount := least(
    v_subtotal,
    greatest(0, v_discount)
  );

  v_total := greatest(
    0,
    round(v_subtotal - v_discount, 2)
  );

  -- 7. Create or replace the redemption exactly once.
  if v_old_coupon_id is null then

    insert into public.coupon_redemptions (
      coupon_id,
      customer_auth_id,
      quotation_id,
      booking_id,
      code_snapshot,
      subtotal,
      discount_amount
    )
    values (
      v_coupon.id,
      v_actor,
      v_quote.id,
      v_quote."bookingId",
      v_coupon.code,
      v_subtotal,
      v_discount
    );

    update public.coupons
    set usage_count = usage_count + 1,
        updated_at = now()
    where id = v_coupon.id;

  elsif v_old_coupon_id = v_coupon.id then

    -- Same coupon: update the amount without changing
    -- the coupon's usage count.
    update public.coupon_redemptions
    set code_snapshot = v_coupon.code,
        subtotal = v_subtotal,
        discount_amount = v_discount,
        booking_id = v_quote."bookingId"
    where quotation_id = v_quote.id;

  else

    -- Different coupon: move the redemption to the new coupon.
    update public.coupon_redemptions
    set coupon_id = v_coupon.id,
        code_snapshot = v_coupon.code,
        subtotal = v_subtotal,
        discount_amount = v_discount,
        booking_id = v_quote."bookingId",
        created_at = now()
    where quotation_id = v_quote.id;

    update public.coupons
    set usage_count = greatest(0, usage_count - 1),
        updated_at = now()
    where id = v_old_coupon_id;

    update public.coupons
    set usage_count = usage_count + 1,
        updated_at = now()
    where id = v_coupon.id;

  end if;

  -- 8. Update the authoritative quotation total.
  update public.quotations
  set discount = v_discount,
      total = v_total,
      booking_details =
        coalesce(booking_details, '{}'::jsonb)
        || jsonb_build_object(
          'couponCode', v_coupon.code,
          'couponDiscount', v_discount
        )
  where id = v_quote.id;

  -- 9. Synchronize the associated booking amount.
  update public.bookings
  set amount = v_total,
      booking_details =
        coalesce(booking_details, '{}'::jsonb)
        || jsonb_build_object(
          'couponCode', v_coupon.code,
          'couponDiscount', v_discount
        )
  where id = v_quote."bookingId";

  -- 10. Return the server-calculated amount.
  return jsonb_build_object(
    'success', true,
    'code', v_coupon.code,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'total', v_total,
    'currency', v_quote.currency
  );
end;
$$;



-- =========================================================
-- 4. ADMIN COUPON MANAGEMENT RPCs
-- =========================================================

create or replace function public.admin_list_coupons()
returns setof public.coupons
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null
     or not public.has_any_role(array['owner', 'admin'])
  then
    raise exception 'Owner/admin access required';
  end if;

  return query
  select *
  from public.coupons
  order by created_at desc;
end;
$$;

create or replace function public.admin_upsert_coupon(
  p_id bigint,
  p_code text,
  p_description text,
  p_discount_type text,
  p_discount_value numeric,
  p_max_discount numeric,
  p_min_subtotal numeric,
  p_starts_at timestamptz,
  p_expires_at timestamptz,
  p_usage_limit integer,
  p_per_customer_limit integer,
  p_is_active boolean
)
returns public.coupons
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_coupon public.coupons%rowtype;
begin
  if auth.uid() is null
     or not public.has_any_role(array['owner', 'admin'])
  then
    raise exception 'Owner/admin access required';
  end if;

  if p_discount_type not in ('percent', 'fixed')
     or p_discount_value <= 0
     or (p_discount_type = 'percent' and p_discount_value > 100)
  then
    raise exception 'Invalid discount configuration';
  end if;

  if p_expires_at is not null
     and p_expires_at <= p_starts_at
  then
    raise exception 'Expiry must be after start date';
  end if;

  if p_id is null then
    insert into public.coupons(
      code, description, discount_type, discount_value,
      max_discount, min_subtotal, starts_at, expires_at,
      usage_limit, per_customer_limit, is_active, created_by
    )
    values (
      upper(trim(p_code)),
      nullif(trim(p_description), ''),
      p_discount_type,
      p_discount_value,
      p_max_discount,
      greatest(0, p_min_subtotal),
      p_starts_at,
      p_expires_at,
      p_usage_limit,
      p_per_customer_limit,
      p_is_active,
      auth.uid()
    )
    returning * into v_coupon;
  else
    update public.coupons
    set code = upper(trim(p_code)),
        description = nullif(trim(p_description), ''),
        discount_type = p_discount_type,
        discount_value = p_discount_value,
        max_discount = p_max_discount,
        min_subtotal = greatest(0, p_min_subtotal),
        starts_at = p_starts_at,
        expires_at = p_expires_at,
        usage_limit = p_usage_limit,
        per_customer_limit = p_per_customer_limit,
        is_active = p_is_active,
        updated_at = now()
    where id = p_id
    returning * into v_coupon;

    if not found then
      raise exception 'Coupon not found';
    end if;
  end if;

  return v_coupon;
end;
$$;

create or replace function public.admin_set_coupon_active(
  p_id bigint,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null
     or not public.has_any_role(array['owner', 'admin'])
  then
    raise exception 'Owner/admin access required';
  end if;

  update public.coupons
  set is_active = p_is_active,
      updated_at = now()
  where id = p_id;

  if not found then
    raise exception 'Coupon not found';
  end if;
end;
$$;


-- =========================================================
-- 5. FUNCTION EXECUTION PERMISSIONS
-- =========================================================

revoke all on function public.customer_create_direct_booking(
  integer, integer, text, text, text, integer, integer, integer, text[], text
) from public, anon;

grant execute on function public.customer_create_direct_booking(
  integer, integer, text, text, text, integer, integer, integer, text[], text
) to authenticated;

revoke all on function public.customer_apply_coupon(integer, text)
  from public, anon;

grant execute on function public.customer_apply_coupon(integer, text)
  to authenticated;

revoke all on function public.admin_list_coupons()
  from public, anon;

grant execute on function public.admin_list_coupons()
  to authenticated;

revoke all on function public.admin_upsert_coupon(
  bigint, text, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, integer, integer, boolean
) from public, anon;

grant execute on function public.admin_upsert_coupon(
  bigint, text, text, text, numeric, numeric, numeric,
  timestamptz, timestamptz, integer, integer, boolean
) to authenticated;

revoke all on function public.admin_set_coupon_active(bigint, boolean)
  from public, anon;

grant execute on function public.admin_set_coupon_active(bigint, boolean)
  to authenticated;

commit;
