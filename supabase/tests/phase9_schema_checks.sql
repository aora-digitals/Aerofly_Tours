-- Run in Supabase SQL Editor after both Phase 9 migrations have applied.
do $$
declare missing text[] := array[]::text[];
begin
  if to_regclass('public.notifications') is null then missing := array_append(missing,'public.notifications'); end if;
  if to_regclass('public.notification_preferences') is null then missing := array_append(missing,'public.notification_preferences'); end if;
  if to_regclass('public.notification_templates') is null then missing := array_append(missing,'public.notification_templates'); end if;
  if to_regclass('public.notification_deliveries') is null then missing := array_append(missing,'public.notification_deliveries'); end if;
  if to_regprocedure('public.phase9_enqueue_notification(uuid,text,text,text,text,text,text,text,jsonb)') is null then missing := array_append(missing,'phase9_enqueue_notification RPC'); end if;
  if to_regprocedure('public.phase9_claim_notification_deliveries(integer)') is null then missing := array_append(missing,'phase9_claim_notification_deliveries RPC'); end if;
  if to_regprocedure('public.phase9_mark_all_notifications_read()') is null then missing := array_append(missing,'phase9_mark_all_notifications_read RPC'); end if;
  if to_regprocedure('public.phase9_notify_uuid_assignment()') is null then missing := array_append(missing,'phase9_notify_uuid_assignment trigger function'); end if;
  if to_regprocedure('public.phase9_notify_refund_customer()') is null then missing := array_append(missing,'phase9_notify_refund_customer trigger function'); end if;
  if to_regprocedure('public.phase9_notify_quotation_invoice()') is null then missing := array_append(missing,'phase9_notify_quotation_invoice trigger function'); end if;
  if cardinality(missing) > 0 then raise exception 'Phase 9 missing objects: %', array_to_string(missing, ', '); end if;

  if not (select relrowsecurity from pg_class where oid='public.notifications'::regclass) then raise exception 'RLS is not enabled on notifications'; end if;
  if not (select relrowsecurity from pg_class where oid='public.notification_preferences'::regclass) then raise exception 'RLS is not enabled on notification_preferences'; end if;
  if not (select relrowsecurity from pg_class where oid='public.notification_deliveries'::regclass) then raise exception 'RLS is not enabled on notification_deliveries'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='notifications_recipient_event_unique') then raise exception 'Idempotency unique constraint/index is missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='phase9_notifications_booking_offer_events' and not tgisinternal) then raise exception 'Booking offer event trigger is missing'; end if;
  if not exists (select 1 from pg_trigger where tgname='phase9_notifications_support_ticket_messages' and not tgisinternal) then raise exception 'Support ticket reply trigger is missing'; end if;
  if to_regclass('public.refunds') is not null and not exists (select 1 from pg_trigger where tgname='phase9_refund_customer_notification' and not tgisinternal) then raise exception 'Refund notification trigger is missing'; end if;
  if to_regclass('public.invoices') is not null and not exists (select 1 from pg_trigger where tgname='phase9_quotation_invoice_notification' and not tgisinternal) then raise exception 'Quotation invoice notification trigger is missing'; end if;
  raise notice 'Phase 9 schema checks passed.';
end $$;
