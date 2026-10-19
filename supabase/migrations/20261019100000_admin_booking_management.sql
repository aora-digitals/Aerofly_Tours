begin;

-- Soft archival preserves booking and financial history.
alter table public.quotations
  add column if not exists archived_at timestamptz;

alter table public.bookings
  add column if not exists archived_at timestamptz;

create index if not exists quotations_admin_booking_list_idx
  on public.quotations ("createdAt" desc);

create index if not exists bookings_admin_booking_list_idx
  on public.bookings ("createdAt" desc);

-- Update a staff-issued offer without deleting its previous activity.
create or replace function public.admin_update_booking_offer(
  p_quotation_id integer,
  p_destination text,
  p_travel_dates text,
  p_travellers integer,
  p_total numeric,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotations%rowtype;
  v_actor uuid := auth.uid();
begin
  if v_actor is null
     or not public.has_any_role(array['owner','admin','manager','sales','counsellor']) then
    raise exception 'You do not have permission to edit booking offers.';
  end if;

  if p_destination is null or length(trim(p_destination)) = 0
     or length(p_destination) > 300 then
    raise exception 'Enter a valid destination.';
  end if;

  if p_travel_dates is null or length(trim(p_travel_dates)) = 0
     or length(p_travel_dates) > 300 then
    raise exception 'Enter valid travel dates.';
  end if;

  if p_travellers < 1 or p_travellers > 100 then
    raise exception 'Travellers must be between 1 and 100.';
  end if;

  if p_total <= 0 then
    raise exception 'The offer total must be greater than zero.';
  end if;

  select *
    into v_quote
    from public.quotations
   where id = p_quotation_id
   for update;

  if not found then
    raise exception 'Booking offer not found.';
  end if;

  if v_quote.archived_at is not null
     or coalesce(v_quote.customer_response, 'awaiting_response')
          not in ('awaiting_response', 'changes_requested')
     or lower(coalesce(v_quote.status, '')) not in ('draft', 'sent', 'viewed') then
    raise exception 'Only active offers awaiting a customer response can be edited.';
  end if;

  -- Do not silently change a quote once a payment attempt exists.
  if exists (
    select 1
      from public.payments p
     where p.quotation_id = p_quotation_id
  ) then
    raise exception 'This offer has a payment record. Review it before editing.';
  end if;

  update public.quotations
     set destination = trim(p_destination),
         "travelDates" = trim(p_travel_dates),
         travellers = p_travellers,
         total = p_total,
         notes = nullif(trim(coalesce(p_notes, '')), ''),
         offer_version = offer_version + 1,
         customer_response = 'awaiting_response',
         customer_response_note = null,
         response_at = null,
         status = 'sent',
         proposal_status = 'ISSUED',
         "sentAt" = now(),
         issued_at = now()
   where id = p_quotation_id;

  insert into public.booking_offer_events (
    quotation_id,
    customer_auth_id,
    actor_id,
    actor_type,
    action,
    message,
    metadata
  )
  values (
    p_quotation_id,
    v_quote.customer_auth_id,
    v_actor,
    'staff',
    'reissued',
    'Booking offer edited and reissued by authorized staff.',
    jsonb_build_object(
      'previous_version', v_quote.offer_version,
      'new_version', v_quote.offer_version + 1,
      'destination', trim(p_destination),
      'travel_dates', trim(p_travel_dates),
      'travellers', p_travellers,
      'total', p_total
    )
  );

  return jsonb_build_object(
    'success', true,
    'quotation_id', p_quotation_id,
    'offer_version', v_quote.offer_version + 1
  );
end;
$$;

-- Cancel an offer or a confirmed booking.
create or replace function public.admin_cancel_booking_record(
  p_record_type text,
  p_record_id integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_customer uuid;
  v_quote_id integer;
  v_booking_id integer;
begin
  if v_actor is null
     or not public.has_any_role(array[
       'owner','admin','manager','sales','counsellor',
       'customer_care','operations'
     ]) then
    raise exception 'You do not have permission to cancel this record.';
  end if;

  if p_reason is null or length(trim(p_reason)) < 3
     or length(p_reason) > 1000 then
    raise exception 'Enter a cancellation reason between 3 and 1000 characters.';
  end if;

  if p_record_type = 'offer' then
    select customer_auth_id
      into v_customer
      from public.quotations
     where id = p_record_id
       and archived_at is null
     for update;

    if not found then
      raise exception 'Booking offer not found.';
    end if;

    update public.quotations
       set status = 'cancelled',
           customer_response = 'cancelled',
           customer_response_note = trim(p_reason),
           response_at = now(),
           withdrawn_at = now()
     where id = p_record_id;

    insert into public.booking_offer_events (
      quotation_id, customer_auth_id, actor_id,
      actor_type, action, message, metadata
    )
    values (
      p_record_id, v_customer, v_actor,
      'staff', 'cancelled', trim(p_reason),
      jsonb_build_object('cancelled_by_admin', true)
    );

    return jsonb_build_object(
      'success', true, 'record_type', 'offer', 'record_id', p_record_id
    );

  elsif p_record_type = 'booking' then
    select customer_auth_id
      into v_customer
      from public.bookings
     where id = p_record_id
       and archived_at is null
     for update;

    if not found then
      raise exception 'Booking not found.';
    end if;

    if exists (
      select 1
        from public.bookings
       where id = p_record_id
         and lower(coalesce("bookingStatus", '')) in ('cancelled', 'completed')
    ) then
      raise exception 'This booking is already cancelled or completed.';
    end if;

    update public.bookings
       set "bookingStatus" = 'cancelled',
           cancellation_reason = trim(p_reason)
     where id = p_record_id;

    select id into v_quote_id
      from public.quotations
     where "bookingId" = p_record_id
     order by "createdAt" desc
     limit 1;

    if v_quote_id is not null then
      insert into public.booking_offer_events (
        quotation_id, customer_auth_id, actor_id,
        actor_type, action, message, metadata
      )
      values (
        v_quote_id, v_customer, v_actor,
        'staff', 'cancelled', trim(p_reason),
        jsonb_build_object(
          'cancelled_by_admin', true,
          'booking_id', p_record_id
        )
      );
    end if;

    return jsonb_build_object(
      'success', true, 'record_type', 'booking', 'record_id', p_record_id
    );
  else
    raise exception 'Unsupported record type.';
  end if;
end;
$$;

-- Archive is reversible in the database and does not erase history.
create or replace function public.admin_archive_booking_record(
  p_record_type text,
  p_record_id integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not public.has_any_role(array['owner','admin','manager']) then
    raise exception 'Only authorized administrators can archive booking records.';
  end if;

  if p_record_type = 'offer' then
    update public.quotations
       set archived_at = now()
     where id = p_record_id
       and archived_at is null;

  elsif p_record_type = 'booking' then
    update public.bookings
       set archived_at = now()
     where id = p_record_id
       and archived_at is null;

  else
    raise exception 'Unsupported record type.';
  end if;

  if not found then
    raise exception 'Record not found or already archived.';
  end if;

  return jsonb_build_object(
    'success', true,
    'record_type', p_record_type,
    'record_id', p_record_id
  );
end;
$$;

revoke all on function public.admin_update_booking_offer(
  integer, text, text, integer, numeric, text
) from public, anon;

revoke all on function public.admin_cancel_booking_record(
  text, integer, text
) from public, anon;

revoke all on function public.admin_archive_booking_record(
  text, integer
) from public, anon;

grant execute on function public.admin_update_booking_offer(
  integer, text, text, integer, numeric, text
) to authenticated;

grant execute on function public.admin_cancel_booking_record(
  text, integer, text
) to authenticated;

grant execute on function public.admin_archive_booking_record(
  text, integer
) to authenticated;

commit;