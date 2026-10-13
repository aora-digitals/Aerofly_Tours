do $$
begin
  if to_regclass('public.marketing_campaigns') is null then raise exception 'marketing_campaigns missing'; end if;
  if to_regclass('public.marketing_campaign_recipients') is null then raise exception 'marketing_campaign_recipients missing'; end if;
  if to_regclass('public.marketing_campaign_events') is null then raise exception 'marketing_campaign_events missing'; end if;
  if to_regclass('public.marketing_unsubscribe_tokens') is null then raise exception 'marketing_unsubscribe_tokens missing'; end if;
  if not exists (select 1 from pg_attribute where attrelid='public.notification_preferences'::regclass and attname='marketing_consent_at' and not attisdropped) then raise exception 'marketing_consent_at missing'; end if;
  if not exists (select 1 from pg_attribute where attrelid='public.notifications'::regclass and attname='in_app_visible' and not attisdropped) then raise exception 'in_app_visible missing'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase9_marketing_eligible_recipients') then raise exception 'eligible recipient RPC missing'; end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='phase9_queue_marketing_campaign_recipient') then raise exception 'queue recipient RPC missing'; end if;
  if not (select relrowsecurity from pg_class where oid='public.marketing_campaigns'::regclass) then raise exception 'campaign RLS disabled'; end if;
  if not (select relrowsecurity from pg_class where oid='public.marketing_campaign_recipients'::regclass) then raise exception 'recipient RLS disabled'; end if;
end $$;
