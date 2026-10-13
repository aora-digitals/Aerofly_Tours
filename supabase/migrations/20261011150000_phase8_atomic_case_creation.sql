-- Atomic case/ticket creation so the initial timeline/message cannot be orphaned.
begin;

create or replace function public.phase8_create_travel_application(
  p_type public.travel_application_type,
  p_applicant_name text,
  p_destination_country text default null,
  p_visa_type text default null,
  p_phone text default null,
  p_nationality text default null,
  p_travel_date text default null,
  p_customer_notes text default null,
  p_application_data jsonb default '{}'::jsonb,
  p_urgency public.travel_application_urgency default 'standard'
) returns public.travel_applications
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_legacy_user integer;
  v_app public.travel_applications;
  v_reference text;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if length(trim(coalesce(p_applicant_name,''))) < 2 or length(trim(p_applicant_name)) > 160 then
    raise exception 'Applicant name must be 2-160 characters' using errcode = '22023';
  end if;
  if p_type = 'visa' and length(trim(coalesce(p_destination_country,''))) < 2 then
    raise exception 'Destination country is required for visa assistance' using errcode = '22023';
  end if;
  select id into v_legacy_user from public.users where "openId" = 'supabase:' || v_actor::text limit 1;
  v_reference := 'TA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.travel_applications(
    reference, "userId", customer_auth_id, type, "serviceType", "applicantName", email,
    phone, nationality, "destinationCountry", "travelDate", urgency, status,
    "customerNotes", visa_type, application_data
  ) values (
    v_reference, v_legacy_user, v_actor, p_type,
    case when p_type = 'visa' then coalesce(nullif(left(trim(coalesce(p_visa_type,'')),120),''),'visa assistance') else 'passport assistance' end,
    trim(p_applicant_name), (select email from auth.users where id = v_actor),
    nullif(left(trim(coalesce(p_phone,'')),40),''), nullif(left(trim(coalesce(p_nationality,'')),120),''),
    case when p_type = 'visa' then nullif(left(trim(coalesce(p_destination_country,'')),160),'') else null end,
    nullif(left(trim(coalesce(p_travel_date,'')),120),''), coalesce(p_urgency,'standard'), 'draft',
    nullif(left(trim(coalesce(p_customer_notes,'')),4000),''),
    case when p_type = 'visa' then nullif(left(trim(coalesce(p_visa_type,'')),120),'') else null end,
    case when jsonb_typeof(coalesce(p_application_data,'{}'::jsonb)) = 'object' then coalesce(p_application_data,'{}'::jsonb) else '{}'::jsonb end
  ) returning * into v_app;
  insert into public.application_events("applicationId", "actorId", "fromStatus", "toStatus", note, customer_visible, metadata)
  values (v_app.id, v_legacy_user, null, 'draft', 'Travel assistance request created', true,
    jsonb_build_object('actor_auth_id',v_actor,'application_type',p_type::text));
  return v_app;
end;
$$;
revoke all on function public.phase8_create_travel_application(public.travel_application_type,text,text,text,text,text,text,text,jsonb,public.travel_application_urgency) from public;
grant execute on function public.phase8_create_travel_application(public.travel_application_type,text,text,text,text,text,text,text,jsonb,public.travel_application_urgency) to authenticated;

create or replace function public.phase8_create_support_ticket(
  p_subject text,
  p_message text,
  p_category text default 'general',
  p_priority text default 'normal',
  p_application_id integer default null,
  p_booking_id integer default null
) returns public.support_tickets
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_ticket public.support_tickets;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if length(trim(coalesce(p_subject,''))) not between 3 and 200 then raise exception 'Subject must be 3-200 characters' using errcode = '22023'; end if;
  if length(trim(coalesce(p_message,''))) not between 1 and 10000 then raise exception 'Message is required' using errcode = '22023'; end if;
  if coalesce(p_category,'general') not in ('general','booking','payment','visa','passport','documents','cancellation','complaint') then raise exception 'Invalid ticket category' using errcode = '22023'; end if;
  if coalesce(p_priority,'normal') not in ('low','normal','high') then raise exception 'Invalid customer priority' using errcode = '22023'; end if;
  if p_application_id is not null then
    if not public.phase8_customer_owns_application(p_application_id,v_actor) then raise exception 'Application link is not owned by customer' using errcode = '42501'; end if;
    select organization_id into v_org from public.travel_applications where id = p_application_id;
  end if;
  if p_booking_id is not null and not exists (
    select 1 from public.bookings b where b.id = p_booking_id and b.customer_auth_id = v_actor
  ) then raise exception 'Booking link is not owned by customer' using errcode = '42501'; end if;
  insert into public.support_tickets(customer_auth_id,organization_id,application_id,booking_id,subject,category,priority,status)
  values (v_actor,v_org,p_application_id,p_booking_id,trim(p_subject),coalesce(p_category,'general'),coalesce(p_priority,'normal'),'open')
  returning * into v_ticket;
  insert into public.support_ticket_messages(ticket_id,author_id,body,is_internal)
  values (v_ticket.id,v_actor,trim(p_message),false);
  insert into public.support_ticket_events(ticket_id,actor_id,action,to_status,metadata)
  values (v_ticket.id,v_actor,'ticket_created','open',jsonb_build_object('category',v_ticket.category,'priority',v_ticket.priority));
  return v_ticket;
end;
$$;
revoke all on function public.phase8_create_support_ticket(text,text,text,text,integer,integer) from public;
grant execute on function public.phase8_create_support_ticket(text,text,text,text,integer,integer) to authenticated;

commit;
