-- AeroFly Tours Phase 9 follow-up: align notifications with the existing Phase 4/6 schema.
-- Safe to apply after 20261011230000_phase9_notifications.sql.
begin;

-- Add UUID-based staff assignment notifications. Phase 4's assigned_employee_id is a
-- profile UUID, while the legacy assignedTo column points to public.users(integer).
create or replace function public.phase9_notify_uuid_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_raw text;
  v_old_raw text;
  v_assignee uuid;
  v_row_id text := coalesce(n->>'id', n->>'reference', 'unknown');
  v_reference text := coalesce(n->>'reference', n->>'id', 'record');
  v_updated text := coalesce(n->>'updated_at', n->>'updatedAt', n->>'created_at', n->>'createdAt', clock_timestamp()::text);
  v_event text;
  v_title text;
  v_body text;
begin
  -- Let the existing adapter handle assigned_auth_id and legacy integer assignments.
  if nullif(n->>'assigned_auth_id', '') is not null then return new; end if;
  v_raw := nullif(n->>'assigned_employee_id', '');
  if v_raw is null or v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;
  v_old_raw := coalesce(o->>'assigned_auth_id', o->>'assigned_employee_id', '');
  if tg_op = 'UPDATE' and v_raw is not distinct from v_old_raw then return new; end if;
  v_assignee := v_raw::uuid;

  if tg_table_name = 'enquiries' then
    v_event := 'enquiry_assigned'; v_title := 'Enquiry assigned to you';
    v_body := 'Enquiry ' || v_reference || ' is now in your queue.';
  elsif tg_table_name = 'appointments' then
    v_event := 'appointment_assigned'; v_title := 'Appointment assigned to you';
    v_body := 'Appointment ' || v_reference || ' is now in your queue.';
  elsif tg_table_name = 'callback_requests' then
    v_event := 'callback_assigned'; v_title := 'Callback assigned to you';
    v_body := 'Callback ' || v_reference || ' is now in your queue.';
  else
    return new;
  end if;

  perform public.phase9_enqueue_notification(
    v_assignee,
    'uuid-assignment:' || tg_table_name || ':' || v_row_id || ':' || v_raw || ':' || v_updated,
    v_event, v_title, v_body,
    case tg_table_name when 'enquiries' then 'enquiry' when 'appointments' then 'appointment' else 'callback' end,
    v_row_id, '/admin/crm', '{}'::jsonb
  );
  return new;
end;
$$;
revoke all on function public.phase9_notify_uuid_assignment() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['enquiries','appointments','callback_requests'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists phase9_uuid_assignment_%I on public.%I', t, t);
      execute format('create trigger phase9_uuid_assignment_%I after insert or update on public.%I for each row execute function public.phase9_notify_uuid_assignment()', t, t);
    end if;
  end loop;
end $$;

-- Phase 6 refunds reference payments via payment_id. Resolve the actual customer through
-- the payment's booking/quotation instead of assuming refunds have booking_id/customer_auth_id.
create or replace function public.phase9_notify_refund_customer()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_customer uuid;
  v_status text := lower(coalesce(to_jsonb(new)->>'status', ''));
  v_old_status text := case when tg_op = 'UPDATE' then lower(coalesce(to_jsonb(old)->>'status', '')) else '' end;
  v_refund_id text := coalesce(to_jsonb(new)->>'id', 'unknown');
  v_payment_id text := coalesce(to_jsonb(new)->>'payment_id', '');
begin
  if tg_op = 'UPDATE' and v_status is not distinct from v_old_status then return new; end if;
  if v_payment_id !~ '^[0-9]+$' then return new; end if;

  select b.customer_auth_id into v_customer
  from public.payments p join public.bookings b on b.id = p."bookingId"
  where p.id = v_payment_id::integer;
  if v_customer is null then
    select q.customer_auth_id into v_customer
    from public.payments p join public.quotations q on q.id = p."quotationId"
    where p.id = v_payment_id::integer;
  end if;

  if v_customer is not null then
    perform public.phase9_enqueue_notification(
      v_customer,
      'phase9-refund:' || v_refund_id || ':' || v_status,
      'refund_status_changed',
      'Refund status updated',
      'There is an update to a refund associated with your AeroFly payment.',
      'refund', v_refund_id, '/dashboard/payments', '{}'::jsonb
    );
  end if;
  return new;
end;
$$;
revoke all on function public.phase9_notify_refund_customer() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.refunds') is not null then
    drop trigger if exists phase9_refund_customer_notification on public.refunds;
    create trigger phase9_refund_customer_notification
      after insert or update on public.refunds
      for each row execute function public.phase9_notify_refund_customer();
  end if;
end $$;

-- Phase 6 invoices can reference either a booking or a quotation. The original adapter
-- resolves booking-linked invoices; this handles quotation-only invoices without duplicating it.
create or replace function public.phase9_notify_quotation_invoice()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_customer uuid;
  v_status text := lower(coalesce(n->>'status', ''));
  v_old_status text := lower(coalesce(o->>'status', ''));
  v_invoice_id text := coalesce(n->>'id', 'unknown');
  v_quotation_id text := coalesce(n->>'quotation_id', '');
begin
  if v_status <> 'issued' then return new; end if;
  if tg_op = 'UPDATE' and v_status is not distinct from v_old_status then return new; end if;
  -- Existing adapter resolves booking-linked invoices, so only handle quotation-only invoices.
  if nullif(n->>'booking_id', '') is not null or v_quotation_id !~ '^[0-9]+$' then return new; end if;

  select customer_auth_id into v_customer from public.quotations where id = v_quotation_id::integer;
  if v_customer is not null then
    perform public.phase9_enqueue_notification(
      v_customer,
      'phase9-quotation-invoice:' || v_invoice_id || ':' || v_status,
      'invoice_available', 'Your invoice is available',
      'A new invoice is available in your AeroFly account.',
      'invoice', v_invoice_id, '/dashboard/payments', '{}'::jsonb
    );
  end if;
  return new;
end;
$$;
revoke all on function public.phase9_notify_quotation_invoice() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.invoices') is not null then
    drop trigger if exists phase9_quotation_invoice_notification on public.invoices;
    create trigger phase9_quotation_invoice_notification
      after insert or update on public.invoices
      for each row execute function public.phase9_notify_quotation_invoice();
  end if;
end $$;

-- Enable notification realtime refresh when the standard Supabase publication exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

commit;
