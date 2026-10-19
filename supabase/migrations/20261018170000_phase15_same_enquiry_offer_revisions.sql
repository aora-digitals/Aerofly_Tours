
begin;

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
as $function$
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
  v_is_revision boolean := false;
  v_items jsonb;
begin
  -- Authorization.
  if v_actor is null or not public.has_any_role(
    array['owner','admin','manager','customer_care','counsellor','staff']
  ) then
    raise exception 'Authorized CRM staff access required';
  end if;

  -- Validate traveller counts.
  if p_adults is null or p_adults < 1
     or p_children is null or p_children < 0
     or p_infants is null or p_infants < 0
     or p_single_rooms is null or p_single_rooms < 0 then
    raise exception 'Traveller counts are invalid';
  end if;

  v_travellers := p_adults + p_children + p_infants;

  if v_travellers > 100 then
    raise exception 'Traveller count exceeds the permitted limit';
  end if;

  -- Validate price adjustments.
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

  -- Lock the enquiry to serialize offer issuance for this enquiry.
  select *
  into v_enquiry
  from public.enquiries
  where id = p_enquiry_id
  for update;

  if not found then
    raise exception 'Enquiry not found';
  end if;

  -- Resolve the customer account.
  select p.id
  into v_customer_id
  from public.profiles p
  where lower(p.email) = lower(trim(v_enquiry.email))
  order by p.created_at desc
  limit 1;

  if v_customer_id is null then
    raise exception
      'The customer must register using the enquiry email before an online proposal can be issued';
  end if;

  select u.id
  into v_legacy_user_id
  from public.users u
  where lower(u.email) = lower(trim(v_enquiry.email))
  order by u.id desc
  limit 1;

  -- Lock and validate the departure.
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

  -- Calculate the offer.
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

  -- Reuse the quotation when the customer has requested changes.
  select q.id, q.reference
  into v_quote_id, v_reference
  from public.quotations q
  where q."enquiryId" = v_enquiry.id
    and q.customer_auth_id = v_customer_id
    and q.customer_response = 'changes_requested'
    and q.status in ('sent', 'viewed')
    and q."bookingId" is null
    and q.proposal_status in ('ISSUED','EDIT_REQUESTED')
  order by q.offer_version desc, q.id desc
  limit 1
  for update;

  v_is_revision := found;

  if v_is_revision then
    -- The existing quotation and reference remain unchanged.
    -- Its prior version snapshot remains immutable.
    update public.quotations
    set
      "createdBy" = (
        select u.id
        from public.users u
        where u."openId" = 'supabase:' || v_actor::text
        limit 1
      ),
      destination = coalesce(
        v_tour.title, v_enquiry.destination, 'Custom trip'
      ),
      "travelDates" = v_departure.departure_date::text
        || case
             when v_departure.return_date is not null
             then ' to ' || v_departure.return_date::text
             else ''
           end,
      travellers = v_travellers,
      subtotal = v_subtotal,
      taxes = v_tax,
      discount = coalesce(p_discount, 0),
      total = v_total,
      currency = 'INR',
      status = 'sent',
      notes = p_customer_notes,
      "validUntil" = p_expiry,
      "sentAt" = now(),
      customer_auth_id = v_customer_id,
      booking_details = jsonb_build_object(
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
      customer_response = 'awaiting_response',
      customer_response_note = null,
      response_at = null,
      offer_version = coalesce(offer_version, 1) + 1,
      proposal_status = 'ISSUED',
      tour_departure_id = v_departure.id,
      issued_by = v_actor,
      issued_at = now()
    where id = v_quote_id;

    delete from public.quotation_items
    where "quotationId" = v_quote_id;

  else
    -- First issuance creates a new quotation.
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
  end if;

  -- Create the current version's line items.
  insert into public.quotation_items (
    "quotationId", description, quantity, "unitPrice", "lineTotal"
  )
  values
    (
      v_quote_id, 'Adult travellers', p_adults,
      v_departure.adult_price,
      round(p_adults * v_departure.adult_price, 2)
    ),
    (
      v_quote_id, 'Child travellers', p_children,
      v_departure.child_price,
      round(p_children * v_departure.child_price, 2)
    ),
    (
      v_quote_id, 'Infant travellers', p_infants,
      v_departure.infant_price,
      round(p_infants * v_departure.infant_price, 2)
    );

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

  -- Version numbers follow both the quotation counter and stored history.
  select greatest(
    coalesce(q.offer_version, 1),
    coalesce((
      select max(v.version_number) + 1
      from public.booking_offer_versions v
      where v.quotation_id = q.id
    ), 1)
  )
  into v_version
  from public.quotations q
  where q.id = v_quote_id;

  -- Include the exact line items in every newly created snapshot.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'description', qi.description,
        'quantity', qi.quantity,
        'unitPrice', qi."unitPrice",
        'lineTotal', qi."lineTotal"
      )
      order by qi.id
    ),
    '[]'::jsonb
  )
  into v_items
  from public.quotation_items qi
  where qi."quotationId" = v_quote_id;

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
    'items', v_items,
    'issuedAt', now(),
    'expiresAt', p_expiry
  );

  insert into public.booking_offer_versions (
    quotation_id, version_number, created_by, snapshot
  )
  values (
    v_quote_id, v_version, v_actor, v_snapshot
  );

  -- Audit both initial issuance and revision.
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
    case when v_is_revision then 'reissued' else 'issued' end,
    jsonb_build_object(
      'reference', v_reference,
      'version', v_version,
      'departure_id', v_departure.id,
      'total', v_total,
      'enquiry_id', v_enquiry.id
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
    'currency', 'INR',
    'revised', v_is_revision
  );
end;
$function$;

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

commit;
