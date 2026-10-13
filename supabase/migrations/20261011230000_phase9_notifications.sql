-- AeroFly Tours Phase 9: notifications, preferences, idempotent delivery outbox.
-- Apply after the Phase 8 migrations and the Phase 6/7 schema are present.
begin;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  event_key text not null,
  event_type text not null,
  template_key text not null default 'transactional_default',
  title text not null check (length(trim(title)) between 1 and 180),
  body text not null check (length(trim(body)) between 1 and 1200),
  entity_type text,
  entity_id text,
  action_path text,
  safe_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_metadata) = 'object'),
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_recipient_event_unique unique (recipient_user_id, event_key),
  constraint notifications_action_path_safe check (
    action_path is null or (
      left(action_path, 1) = '/' and left(action_path, 2) <> '//' and
      action_path !~* '^(https?:|javascript:|data:)'
    )
  ),
  constraint notifications_read_timestamp_consistent check (
    (is_read and read_at is not null) or (not is_read and read_at is null)
  )
);
create index if not exists notifications_recipient_created_idx
  on public.notifications(recipient_user_id, created_at desc, id desc);
create index if not exists notifications_recipient_unread_idx
  on public.notifications(recipient_user_id, created_at desc) where not is_read;

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  whatsapp_enabled boolean not null default false,
  marketing_email_enabled boolean not null default false,
  marketing_sms_enabled boolean not null default false,
  marketing_whatsapp_enabled boolean not null default false,
  sms_opted_out_at timestamptz,
  whatsapp_opted_out_at timestamptz,
  email_opted_out_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_templates (
  template_key text not null,
  channel text not null check (channel in ('email','sms','whatsapp')),
  subject_template text,
  html_template text,
  text_template text not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (template_key, channel)
);

create or replace function public.phase9_touch_preference_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists phase9_notification_preferences_touch on public.notification_preferences;
create trigger phase9_notification_preferences_touch before update on public.notification_preferences
for each row execute function public.phase9_touch_preference_updated_at();

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('email','sms','whatsapp')),
  template_key text not null default 'transactional_default',
  status text not null default 'pending'
    check (status in ('pending','processing','sent','delivered','failed','dead')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  provider_message_id text,
  last_error_code text,
  last_error_safe text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_delivery_channel_unique unique (notification_id, channel)
);
create index if not exists notification_deliveries_queue_idx
  on public.notification_deliveries(status, available_at, created_at)
  where status in ('pending','failed','processing');
create index if not exists notification_deliveries_recipient_idx
  on public.notification_deliveries(recipient_user_id, created_at desc);

alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_templates enable row level security;
alter table public.notification_deliveries enable row level security;

-- Remove any accidentally broad policies before adding owner-scoped policies.
drop policy if exists notifications_select_own on public.notifications;
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (recipient_user_id = auth.uid());
create policy notifications_update_own on public.notifications
  for update to authenticated using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

drop policy if exists notification_preferences_select_own on public.notification_preferences;
drop policy if exists notification_preferences_insert_own on public.notification_preferences;
drop policy if exists notification_preferences_update_own on public.notification_preferences;
create policy notification_preferences_select_own on public.notification_preferences
  for select to authenticated using (user_id = auth.uid());
create policy notification_preferences_insert_own on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid());
create policy notification_preferences_update_own on public.notification_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (is_read, read_at) on public.notifications to authenticated;
revoke all on public.notification_preferences from anon, authenticated;
grant select, insert on public.notification_preferences to authenticated;
grant update (email_enabled, sms_enabled, whatsapp_enabled, marketing_email_enabled,
  marketing_sms_enabled, marketing_whatsapp_enabled, sms_opted_out_at,
  whatsapp_opted_out_at, email_opted_out_at) on public.notification_preferences to authenticated;
revoke all on public.notification_templates from anon, authenticated;
revoke all on public.notification_deliveries from anon, authenticated;
grant select on public.notifications, public.notification_templates to service_role;
grant select, update on public.notification_deliveries to service_role;

-- Generic, private queue insert. Only database triggers/service code may create notification intent.
create or replace function public.phase9_enqueue_notification(
  p_recipient uuid,
  p_event_key text,
  p_event_type text,
  p_title text,
  p_body text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_action_path text default null,
  p_safe_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_notification_id uuid;
  v_pref public.notification_preferences%rowtype;
  v_email text;
  v_phone text;
  v_template text := 'transactional_default';
  v_essential boolean := false;
  v_staff_id uuid;
begin
  if p_recipient is null or p_event_key is null or length(p_event_key) > 300 then return null; end if;
  if not exists (select 1 from public.profiles p where p.id = p_recipient) then return null; end if;
  if p_action_path is not null and (left(p_action_path,1) <> '/' or left(p_action_path,2) = '//') then
    raise exception 'Unsafe notification action path';
  end if;

  insert into public.notifications(recipient_user_id,event_key,event_type,template_key,title,body,entity_type,entity_id,action_path,safe_metadata)
  values (p_recipient,p_event_key,p_event_type,v_template,left(trim(p_title),180),left(trim(p_body),1200),p_entity_type,p_entity_id,p_action_path,
    case when jsonb_typeof(coalesce(p_safe_metadata,'{}'::jsonb)) = 'object' then coalesce(p_safe_metadata,'{}'::jsonb) else '{}'::jsonb end)
  on conflict (recipient_user_id,event_key) do nothing
  returning id into v_notification_id;

  if v_notification_id is null then
    select n.id into v_notification_id from public.notifications n
    where n.recipient_user_id = p_recipient and n.event_key = p_event_key;
    return v_notification_id;
  end if;

  select * into v_pref from public.notification_preferences where user_id = p_recipient;
  v_essential := p_event_type = any(array[
    'welcome','enquiry_submitted','booking_proposal_issued','booking_proposal_revised',
    'booking_proposal_expired','booking_proposal_accepted','booking_proposal_rejected',
    'booking_edit_requested','payment_verified','payment_failed','refund_status_changed',
    'invoice_available','travel_information_requested','travel_application_status_updated',
    'support_ticket_reply','support_ticket_resolved','appointment_confirmed','appointment_cancelled'
  ]);
  select au.email, p.phone into v_email, v_phone
  from auth.users au left join public.profiles p on p.id = au.id where au.id = p_recipient;

  -- Email defaults on for transactional notices; SMS/WhatsApp require explicit opt-in.
  if (coalesce(v_pref.email_enabled,true) or v_essential) and v_email is not null and v_email <> ''
     and (v_pref.email_opted_out_at is null or v_essential) then
    insert into public.notification_deliveries(notification_id,recipient_user_id,channel,template_key)
    values(v_notification_id,p_recipient,'email',v_template) on conflict do nothing;
  end if;
  if coalesce(v_pref.sms_enabled,false) and v_pref.sms_opted_out_at is null and v_phone is not null and v_phone <> '' then
    insert into public.notification_deliveries(notification_id,recipient_user_id,channel,template_key)
    values(v_notification_id,p_recipient,'sms',v_template) on conflict do nothing;
  end if;
  if coalesce(v_pref.whatsapp_enabled,false) and v_pref.whatsapp_opted_out_at is null and v_phone is not null and v_phone <> '' then
    insert into public.notification_deliveries(notification_id,recipient_user_id,channel,template_key)
    values(v_notification_id,p_recipient,'whatsapp',v_template) on conflict do nothing;
  end if;
  return v_notification_id;
end;
$$;
revoke all on function public.phase9_enqueue_notification(uuid,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.phase9_enqueue_notification(uuid,text,text,text,text,text,text,text,jsonb) to service_role;

-- Business-event adapter. Values are intentionally generic; do not copy notes, passport data,
-- payment credentials, or customer message bodies into notifications.
create or replace function public.phase9_business_notification_trigger()
returns trigger language plpgsql security definer set search_path = public, auth
as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_id text := coalesce(n->>'id',n->>'reference','unknown');
  v_customer uuid;
  v_assigned uuid;
  v_staff_id uuid;
  v_actor uuid;
  v_event text;
  v_title text;
  v_body text;
  v_path text;
  v_entity text;
  v_status text;
  v_old_status text;
  v_event_key text;
  v_created timestamptz := now();
begin
  v_customer := nullif(n->>'customer_auth_id','')::uuid;
  v_assigned := nullif(n->>'assigned_auth_id','')::uuid;
  if v_assigned is null and coalesce(n->>'assigned_employee_id', n->>'assignedTo') ~ '^[0-9]+$' then
    select substring(u."openId" from 10)::uuid into v_assigned from public.users u
    where u.id = coalesce(n->>'assigned_employee_id', n->>'assignedTo')::integer
      and u."openId" ~ '^supabase:[0-9a-fA-F-]{36}$';
  end if;
  v_actor := nullif(n->>'actor_id','')::uuid;
  v_status := lower(coalesce(n->>'status', n->>'proposal_status', n->>'bookingStatus', n->>'paymentStatus',''));
  v_old_status := lower(coalesce(o->>'status', o->>'proposal_status', o->>'bookingStatus', o->>'paymentStatus',''));
  v_entity := case tg_table_name
    when 'enquiries' then 'enquiry' when 'appointments' then 'appointment'
    when 'callback_requests' then 'callback' when 'quotations' then 'quotation'
    when 'bookings' then 'booking' when 'payments' then 'payment'
    when 'travel_applications' then 'travel_application' when 'support_tickets' then 'support_ticket'
    when 'booking_cancellation_requests' then 'booking_cancellation' else tg_table_name end;

  -- Event log rows are immutable and carry the best idempotency key.
  if tg_table_name = 'booking_offer_events' then
    v_event := case coalesce(n->>'action','')
      when 'issued' then 'booking_proposal_issued'
      when 'reissued' then 'booking_proposal_revised'
      when 'accepted' then 'booking_proposal_accepted'
      when 'rejected' then 'booking_proposal_rejected'
      when 'changes_requested' then 'booking_edit_requested'
      when 'cancelled' then 'booking_proposal_cancelled'
      else null end;
    if v_event is null then return new; end if;
    v_customer := nullif(n->>'customer_auth_id','')::uuid;
    if n->>'actor_type' = 'customer' then
      select q.issued_by into v_assigned from public.quotations q where q.id = nullif(n->>'quotation_id','')::integer;
      if v_assigned is null then
        select substring(u."openId" from 10)::uuid into v_assigned
        from public.quotations q join public.enquiries e on e.id=q."enquiryId"
        join public.users u on u.id=e.assigned_employee_id
        where q.id=nullif(n->>'quotation_id','')::integer and u."openId" ~ '^supabase:[0-9a-fA-F-]{36}$';
      end if;
      v_customer := null;
    end if;
    v_title := case v_event when 'booking_proposal_issued' then 'A booking proposal is ready'
      when 'booking_proposal_revised' then 'Your booking proposal was revised'
      when 'booking_proposal_accepted' then 'Booking proposal accepted'
      when 'booking_proposal_rejected' then 'Booking proposal declined'
      when 'booking_edit_requested' then 'Booking changes requested' else 'Booking proposal updated' end;
    v_body := 'Proposal reference ' || coalesce((select q.reference from public.quotations q where q.id=nullif(n->>'quotation_id','')::integer), v_id) || ' has an update.';
    v_path := case when v_customer is not null then '/dashboard/offers' else '/admin/booking-offers/new' end;
    v_event_key := 'booking_offer_events:' || v_id || ':' || v_event;
    if v_customer is not null then perform public.phase9_enqueue_notification(v_customer,v_event_key,v_event,v_title,v_body,'quotation',n->>'quotation_id',v_path,'{}'::jsonb); end if;
    if v_assigned is not null then perform public.phase9_enqueue_notification(v_assigned,v_event_key || ':staff',v_event,v_title,v_body,'quotation',n->>'quotation_id','/admin/crm','{}'::jsonb); end if;
    return new;
  end if;

  if tg_table_name = 'profiles' then
    v_customer := nullif(n->>'id','')::uuid;
    if tg_op = 'INSERT' then
      v_event := 'welcome'; v_title := 'Welcome to AeroFly Tours'; v_body := 'Your AeroFly account is ready. You can track enquiries, bookings and support from your dashboard.'; v_path := '/dashboard';
    end if;
  elsif tg_table_name = 'enquiries' then
    if tg_op = 'INSERT' then
      v_event := 'enquiry_submitted'; v_title := 'Enquiry received'; v_body := 'Your AeroFly enquiry ' || coalesce(n->>'reference',v_id) || ' has been received.'; v_path := '/dashboard/enquiries';
    elsif coalesce(n->>'assigned_auth_id',n->>'assigned_employee_id',n->>'assignedTo','') is distinct from coalesce(o->>'assigned_auth_id',o->>'assigned_employee_id',o->>'assignedTo','') and v_assigned is not null then
      perform public.phase9_enqueue_notification(v_assigned,'enquiry-assigned:'||v_id||':'||coalesce(n->>'assigned_auth_id',n->>'assigned_employee_id',n->>'assignedTo',''), 'enquiry_assigned','Enquiry assigned to you','Enquiry '||coalesce(n->>'reference',v_id)||' is now in your queue.','enquiry',v_id,'/admin/crm','{}'::jsonb);
      v_event := null;
    elsif v_status is distinct from v_old_status then
      v_event := 'enquiry_status_updated'; v_title := 'Enquiry status updated'; v_body := 'Enquiry '||coalesce(n->>'reference',v_id)||' has a status update.'; v_path := '/dashboard/enquiries';
    end if;
  elsif tg_table_name = 'appointments' then
    if coalesce(n->>'assigned_auth_id',n->>'assigned_employee_id',n->>'assignedTo','') is distinct from coalesce(o->>'assigned_auth_id',o->>'assigned_employee_id',o->>'assignedTo','') and v_assigned is not null then
      perform public.phase9_enqueue_notification(v_assigned,'appointment-assigned:'||v_id||':'||coalesce(n->>'assigned_auth_id',n->>'assigned_employee_id',n->>'assignedTo',''),'appointment_assigned','Appointment assigned to you','Appointment '||coalesce(n->>'reference',v_id)||' is in your queue.','appointment',v_id,'/admin/crm','{}'::jsonb);
    end if;
    if v_status is distinct from v_old_status or n->>'appointmentAt' is distinct from o->>'appointmentAt' then
      v_event := case when v_status='confirmed' then 'appointment_confirmed' when v_status='cancelled' then 'appointment_cancelled' when n->>'appointmentAt' is distinct from o->>'appointmentAt' then 'appointment_rescheduled' else null end;
      v_title := case v_event when 'appointment_confirmed' then 'Appointment confirmed' when 'appointment_cancelled' then 'Appointment cancelled' when 'appointment_rescheduled' then 'Appointment rescheduled' else 'Appointment updated' end;
      v_body := 'Appointment '||coalesce(n->>'reference',v_id)||' has an update.'; v_path := '/dashboard/appointments';
    end if;
  elsif tg_table_name = 'callback_requests' then
    if coalesce(n->>'assigned_auth_id',n->>'assigned_employee_id',n->>'assignedTo','') is distinct from coalesce(o->>'assigned_auth_id',o->>'assigned_employee_id',o->>'assignedTo','') and v_assigned is not null then
      perform public.phase9_enqueue_notification(v_assigned,'callback-assigned:'||v_id||':'||coalesce(n->>'assigned_auth_id',n->>'assigned_employee_id',n->>'assignedTo',''),'callback_assigned','Callback assigned to you','Callback '||coalesce(n->>'reference',v_id)||' is in your queue.','callback',v_id,'/admin/crm','{}'::jsonb);
    end if;
    if v_status='completed' and v_status is distinct from v_old_status then
      v_event := 'callback_completed'; v_title := 'Callback completed'; v_body := 'Your callback request '||coalesce(n->>'reference',v_id)||' has been completed.'; v_path := '/dashboard/callbacks';
    end if;
  elsif tg_table_name = 'quotations' then
    if upper(coalesce(n->>'proposal_status','')) = 'EXPIRED'
       and upper(coalesce(o->>'proposal_status','')) is distinct from 'EXPIRED' then
      v_event := 'booking_proposal_expired'; v_title := 'Booking proposal expired';
      v_body := 'Proposal '||coalesce(n->>'reference',v_id)||' has expired.'; v_path := '/dashboard/offers';
    end if;
  elsif tg_table_name = 'bookings' then
    -- Payment state is notified from the payments ledger to avoid duplicate messages
    -- when a webhook updates both payments.status and bookings.paymentStatus.
    if coalesce(n->>'bookingStatus','') is distinct from coalesce(o->>'bookingStatus','') then
      v_event := 'booking_status_updated'; v_title := 'Booking status updated'; v_body := 'Booking '||coalesce(n->>'reference',v_id)||' has an update.'; v_path := '/dashboard/bookings';
    end if;
  elsif tg_table_name = 'payments' then
    if coalesce(n->>'status','') is distinct from coalesce(o->>'status','') then
      select b.customer_auth_id into v_customer from public.bookings b where b.id=nullif(n->>'bookingId','')::integer;
      if v_customer is null then select q.customer_auth_id into v_customer from public.quotations q where q.id=nullif(n->>'quotationId','')::integer; end if;
      v_event := case lower(n->>'status') when 'successful' then 'payment_verified' when 'failed' then 'payment_failed' else 'payment_status_updated' end;
      v_title := case v_event when 'payment_verified' then 'Payment confirmed' when 'payment_failed' then 'Payment failed' else 'Payment status updated' end;
      v_body := 'Payment '||coalesce(n->>'reference',v_id)||' has a status update.'; v_path := '/dashboard/payments';
    elsif coalesce(n->>'refund_status',n->>'refundStatus','') is distinct from coalesce(o->>'refund_status',o->>'refundStatus','') and coalesce(n->>'refund_status',n->>'refundStatus','') <> '' then
      select b.customer_auth_id into v_customer from public.bookings b where b.id=nullif(n->>'bookingId','')::integer;
      if v_customer is null then select q.customer_auth_id into v_customer from public.quotations q where q.id=nullif(n->>'quotationId','')::integer; end if;
      v_event := 'refund_status_changed'; v_title := 'Refund status updated'; v_body := 'There is an update to a refund associated with your AeroFly payment.'; v_path := '/dashboard/payments';
    end if;
  elsif tg_table_name = 'travel_applications' then
    if v_status is distinct from v_old_status then
      v_event := case when v_status='action_required' then 'travel_information_requested' else 'travel_application_status_updated' end;
      v_title := case when v_status='action_required' then 'Information needed for your travel application' else 'Travel application updated' end;
      v_body := 'Travel application '||coalesce(n->>'reference',v_id)||' has a status update.'; v_path := '/dashboard/travel-assistance';
    end if;
  elsif tg_table_name = 'support_tickets' then
    if coalesce(n->>'assigned_to','') is distinct from coalesce(o->>'assigned_to','') and nullif(n->>'assigned_to','') is not null then
      perform public.phase9_enqueue_notification((n->>'assigned_to')::uuid,'support-ticket-assigned:'||v_id||':'||(n->>'assigned_to'),'support_ticket_assigned','Support ticket assigned to you','Support ticket '||coalesce(n->>'reference',v_id)||' is in your queue.','support_ticket',v_id,'/admin/travel-support','{}'::jsonb);
    end if;
    if v_status is distinct from v_old_status and v_status in ('resolved','closed') then
      v_event := 'support_ticket_resolved'; v_title := 'Support ticket updated'; v_body := 'Support ticket '||coalesce(n->>'reference',v_id)||' has been resolved.'; v_path := '/dashboard/support';
    end if;
  elsif tg_table_name = 'booking_cancellation_requests' then
    if tg_op='INSERT' then
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='assigned_auth_id') then
        execute 'select assigned_auth_id from public.bookings where id = $1' into v_assigned using nullif(n->>'booking_id','')::integer;
      elsif exists (select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='assignedTo') then
        execute 'select substring(u."openId" from 10)::uuid from public.bookings b join public.users u on u.id=b."assignedTo" where b.id = $1 and u."openId" ~ ''^supabase:[0-9a-fA-F-]{36}$''' into v_assigned using nullif(n->>'booking_id','')::integer;
      end if;
      if v_assigned is not null then
        perform public.phase9_enqueue_notification(v_assigned,'booking-cancel-request:'||v_id,'booking_cancellation_requested','Booking cancellation requested','A customer has requested a booking cancellation.','booking_cancellation',v_id,'/admin','{}'::jsonb);
      else
        for v_staff_id in select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.key in ('owner','admin') loop
          perform public.phase9_enqueue_notification(v_staff_id,'booking-cancel-request:'||v_id,'booking_cancellation_requested','Booking cancellation requested','A customer has requested a booking cancellation.','booking_cancellation',v_id,'/admin','{}'::jsonb);
        end loop;
      end if;
      return new;
    elsif v_status is distinct from v_old_status then
      v_event := 'booking_cancellation_status_updated'; v_title := 'Cancellation request updated'; v_body := 'Your booking cancellation request has an update.'; v_path := '/dashboard/bookings';
    end if;
  elsif tg_table_name = 'support_ticket_messages' then
    if coalesce(n->>'is_internal','false')::boolean then return new; end if;
    select t.customer_auth_id,t.assigned_to into v_customer,v_assigned from public.support_tickets t where t.id=nullif(n->>'ticket_id','')::bigint;
    v_actor := nullif(n->>'author_id','')::uuid;
    if v_actor is not null and v_actor = v_customer then
      v_event := 'support_ticket_customer_reply'; v_title := 'Customer replied to a support ticket'; v_body := 'A customer has replied to ticket '||coalesce((select t.reference from public.support_tickets t where t.id=nullif(n->>'ticket_id','')::bigint),n->>'ticket_id')||'.'; v_path := '/admin/travel-support'; v_customer := null;
    else
      v_event := 'support_ticket_reply'; v_title := 'New reply from AeroFly support'; v_body := 'There is a new reply on your support ticket.'; v_path := '/dashboard/support'; v_assigned := null;
    end if;
    v_id := coalesce(n->>'id','unknown');
  elsif tg_table_name = 'application_events' then
    if coalesce(n->>'customer_visible','false')::boolean is not true then return new; end if;
    select a.customer_auth_id into v_customer from public.travel_applications a where a.id=nullif(n->>'applicationId','')::integer;
    if lower(coalesce(n->>'toStatus','')) = 'action_required' then
      v_event := 'travel_information_requested'; v_title := 'Information needed for your travel application'; v_body := 'Please review the requested information in your travel application.';
    else
      v_event := 'travel_application_status_updated'; v_title := 'Travel application updated'; v_body := 'There is a new update to your travel application.';
    end if;
    v_path := '/dashboard/travel-assistance';
  elsif tg_table_name in ('invoices','receipts') then
    if tg_op='INSERT' or (v_status is distinct from v_old_status and v_status in ('available','issued','sent','paid')) then
      v_event := 'invoice_available'; v_title := 'Your receipt is available'; v_body := 'A new receipt or invoice is available in your AeroFly account.'; v_path := '/dashboard/payments';
    else
      return new;
    end if;
    if v_customer is null and coalesce(n->>'booking_id',n->>'bookingId') ~ '^[0-9]+$' then
      select b.customer_auth_id into v_customer from public.bookings b where b.id=coalesce(n->>'booking_id',n->>'bookingId')::integer;
    end if;
  elsif tg_table_name in ('refunds','refund_requests','payment_refunds') then
    if tg_op='INSERT' or v_status is distinct from v_old_status then
      v_event := 'refund_status_changed'; v_title := 'Refund status updated'; v_body := 'There is an update to a refund associated with your AeroFly booking.'; v_path := '/dashboard/payments';
      if v_customer is null and coalesce(n->>'booking_id',n->>'bookingId') ~ '^[0-9]+$' then
        select b.customer_auth_id into v_customer from public.bookings b where b.id=coalesce(n->>'booking_id',n->>'bookingId')::integer;
      end if;
    end if;
  else
    return new;
  end if;

  if v_event is null then return new; end if;
  v_event_key := tg_table_name||':'||v_id||':'||v_event||':'||coalesce(n->>'updated_at',n->>'updatedAt',n->>'created_at',n->>'createdAt',n->>'status','event');
  if v_customer is not null then perform public.phase9_enqueue_notification(v_customer,v_event_key,v_event,coalesce(v_title,'AeroFly update'),coalesce(v_body,'There is an update to your AeroFly account.'),v_entity,v_id,v_path,'{}'::jsonb); end if;
  if v_assigned is not null and tg_table_name in ('support_ticket_messages') then
    perform public.phase9_enqueue_notification(v_assigned,v_event_key||':staff',v_event,coalesce(v_title,'AeroFly update'),coalesce(v_body,'There is an update to your AeroFly work queue.'),v_entity,v_id,v_path,'{}'::jsonb);
  end if;
  return new;
end;
$$;
revoke all on function public.phase9_business_notification_trigger() from public, anon, authenticated;

-- Install only on existing Phase 0-8 tables. Trigger logic uses JSON to tolerate optional phase columns.
do $$
declare t text;
begin
  foreach t in array array['profiles','enquiries','appointments','callback_requests','quotations','bookings','payments','booking_offer_events','booking_cancellation_requests','support_tickets','support_ticket_messages','application_events','invoices','receipts','refunds','refund_requests','payment_refunds'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists phase9_notifications_%I on public.%I',t,t);
      execute format('create trigger phase9_notifications_%I after insert or update on public.%I for each row execute function public.phase9_business_notification_trigger()',t,t);
    end if;
  end loop;
end $$;

-- Reusable provider-neutral defaults; content stays generic and contains no sensitive data.
insert into public.notification_templates(template_key,channel,subject_template,html_template,text_template)
values
('transactional_default','email','{{title}} | AeroFly Tours','<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#222"><div style="background:#f26b35;color:#fff;padding:22px;font-size:22px;font-weight:700">AeroFly Tours</div><div style="padding:24px"><h2>{{title}}</h2><p>{{body}}</p><p><a href="{{action_url}}" style="display:inline-block;background:#f26b35;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">View in AeroFly</a></p><p style="font-size:12px;color:#777">This is a transactional service message. Do not reply with passport or payment credentials.</p></div></div>','{{title}}\n\n{{body}}\n\nOpen AeroFly: {{action_url}}'),
('transactional_default','sms',null,null,'AeroFly Tours: {{title}}. {{body}}'),
('transactional_default','whatsapp',null,null,'*AeroFly Tours*\n{{title}}\n{{body}}\n{{action_url}}')
on conflict(template_key,channel) do nothing;

-- Workers claim a small batch using row locks and a stale-lock lease to recover from crashes.
create or replace function public.phase9_claim_notification_deliveries(p_batch_size integer default 20)
returns setof public.notification_deliveries
language plpgsql security definer set search_path = public
as $$
begin
  if p_batch_size < 1 or p_batch_size > 100 then raise exception 'Batch size must be between 1 and 100'; end if;
  update public.notification_deliveries
    set status='dead', locked_at=null, last_error_code='WORKER_LEASE_EXPIRED',
        last_error_safe='Worker lease expired after the final allowed attempt.', updated_at=now()
  where status='processing' and locked_at < now()-interval '10 minutes' and attempts >= max_attempts;

  return query
  with picked as (
    select d.id from public.notification_deliveries d
    where d.attempts < d.max_attempts
      and d.available_at <= now()
      and (d.status in ('pending','failed') or (d.status='processing' and d.locked_at < now()-interval '10 minutes'))
    order by d.available_at,d.created_at
    for update skip locked limit p_batch_size
  )
  update public.notification_deliveries d
    set status='processing', attempts=d.attempts+1, locked_at=now(), updated_at=now()
  from picked where d.id=picked.id
  returning d.*;
end;
$$;
revoke all on function public.phase9_claim_notification_deliveries(integer) from public, anon, authenticated;
grant execute on function public.phase9_claim_notification_deliveries(integer) to service_role;

-- Client-owned read state RPCs only modify the caller's own rows.
create or replace function public.phase9_mark_all_notifications_read()
returns integer language plpgsql security invoker set search_path = public
as $$
declare changed integer;
begin
  update public.notifications set is_read=true, read_at=now()
  where recipient_user_id=auth.uid() and not is_read;
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function public.phase9_mark_all_notifications_read() from public, anon;
grant execute on function public.phase9_mark_all_notifications_read() to authenticated;

commit;
