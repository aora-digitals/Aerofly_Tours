begin;

create or replace function public.staff_create_manual_tour_departure(
  p_tour_id integer,
  p_departure_date date,
  p_return_date date,
  p_departure_city text,
  p_adult_price numeric,
  p_child_price numeric,
  p_infant_price numeric,
  p_single_supplement numeric,
  p_capacity integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_departure_id integer;
begin
  if v_actor is null or not public.has_any_role(
    array['owner','admin','manager','customer_care','counsellor','staff']
  ) then
    raise exception 'Authorized CRM staff access required';
  end if;

  if p_tour_id is null or p_tour_id <= 0 then
    raise exception 'Select a valid tour';
  end if;

  if not exists (
    select 1 from public.tours where id = p_tour_id
  ) then
    raise exception 'The selected tour does not exist';
  end if;

  if p_departure_date is null or p_departure_date < current_date then
    raise exception 'Departure date must be today or later';
  end if;

  if p_return_date is not null and p_return_date < p_departure_date then
    raise exception 'Return date cannot be before departure';
  end if;

  if p_adult_price is null or p_adult_price <= 0
     or p_child_price is null or p_child_price < 0
     or p_infant_price is null or p_infant_price < 0
     or p_single_supplement is null or p_single_supplement < 0 then
    raise exception 'Enter valid prices for all traveller categories';
  end if;

  if p_capacity is null or p_capacity < 1 or p_capacity > 1000 then
    raise exception 'Capacity must be between 1 and 1000';
  end if;

  insert into public.tour_departures (
    "tourId",
    departure_date,
    return_date,
    departure_city,
    adult_price,
    child_price,
    infant_price,
    single_supplement,
    total_capacity,
    seats_available,
    status
  )
  values (
    p_tour_id,
    p_departure_date,
    p_return_date,
    nullif(trim(p_departure_city), ''),
    p_adult_price,
    p_child_price,
    p_infant_price,
    p_single_supplement,
    p_capacity,
    p_capacity,
    'available'
  )
  returning id into v_departure_id;

  return v_departure_id;
end;
$$;

revoke all on function public.staff_create_manual_tour_departure(
  integer, date, date, text, numeric, numeric, numeric, numeric, integer
) from public, anon;

grant execute on function public.staff_create_manual_tour_departure(
  integer, date, date, text, numeric, numeric, numeric, numeric, integer
) to authenticated;

commit;