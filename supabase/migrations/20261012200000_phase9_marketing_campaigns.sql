-- AeroFly Tours: consent-aware Promotions & Campaigns module.
-- Additive migration; does not replace existing transactional notifications.
begin;

alter table public.notification_preferences
  add column if not exists marketing_in_app_enabled boolean not null default false,
  add column if not exists marketing_consent_at timestamptz,
  add column if not exists marketing_consent_source text,
  add column if not exists marketing_unsubscribed_at timestamptz,
  add column if not exists marketing_email_opted_out_at timestamptz,
  add column if not exists marketing_sms_opted_out_at timestamptz,
  add column if not exists marketing_whatsapp_opted_out_at timestamptz;

alter table public.notifications
  add column if not exists in_app_visible boolean not null default true;

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict,
  name text not null check (length(trim(name)) between 3 and 120),
  title text not null check (length(trim(title)) between 3 and 180),
  subject text not null check (length(trim(subject)) between 3 and 180),
  body text not null check (length(trim(body)) between 10 and 1200),
  action_path text,
  channels text[] not null default array['in_app']::text[],
  audience_segment text not null default 'consented_customers'
    check (audience_segment in ('consented_customers','domestic_interest','international_interest','wishlist_travelers','recently_active')),
  status text not null default 'draft'
    check (status in ('draft','scheduled','processing','completed','cancelled','failed')),
  template_key text not null unique,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  total_recipients integer not null default 0,
  sent_count integer not null default 0,
  delivered_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_campaign_channels_valid check (
    cardinality(channels) between 1 and 4 and
    channels <@ array['in_app','email','sms','whatsapp']::text[]
  ),
  constraint marketing_campaign_action_path_safe check (
    action_path is null or
    (left(action_path,1)='/' and left(action_path,2)<>'//' and
     action_path !~* '^(javascript|data|https?):')
  )
);

create index if not exists marketing_campaigns_status_schedule_idx
  on public.marketing_campaigns(status, scheduled_at)
  where status in ('scheduled','processing');
create index if not exists marketing_campaigns_created_idx
  on public.marketing_campaigns(created_at desc);

create table if not exists public.marketing_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','failed','skipped')),
  queued_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, recipient_user_id)
);
create index if not exists marketing_campaign_recipients_campaign_idx
  on public.marketing_campaign_recipients(campaign_id, status);

create table if not exists public.marketing_campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_key text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(campaign_id, event_key)
);
create index if not exists marketing_campaign_events_campaign_idx
  on public.marketing_campaign_events(campaign_id, created_at desc);

create table if not exists public.marketing_unsubscribe_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('email','sms','whatsapp','all')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists marketing_unsubscribe_tokens_user_idx
  on public.marketing_unsubscribe_tokens(user_id, expires_at desc);

alter table public.marketing_campaigns enable row level security;
alter table public.marketing_campaign_recipients enable row level security;
alter table public.marketing_campaign_events enable row level security;
alter table public.marketing_unsubscribe_tokens enable row level security;

-- Marketing UI reads campaign summaries. Writes go through the authenticated Edge Function.
drop policy if exists marketing_campaigns_staff_read on public.marketing_campaigns;
create policy marketing_campaigns_staff_read on public.marketing_campaigns
  for select to authenticated
  using (public.has_any_role(array['owner','admin','manager','marketing']::text[], auth.uid()));
drop policy if exists marketing_campaign_recipients_staff_read on public.marketing_campaign_recipients;
create policy marketing_campaign_recipients_staff_read on public.marketing_campaign_recipients
  for select to authenticated
  using (public.has_any_role(array['owner','admin','manager','marketing']::text[], auth.uid()));
drop policy if exists marketing_campaign_events_staff_read on public.marketing_campaign_events;
create policy marketing_campaign_events_staff_read on public.marketing_campaign_events
  for select to authenticated
  using (public.has_any_role(array['owner','admin','manager','marketing']::text[], auth.uid()));

revoke all on public.marketing_campaigns from anon, authenticated;
revoke all on public.marketing_campaign_recipients from anon, authenticated;
revoke all on public.marketing_campaign_events from anon, authenticated;
revoke all on public.marketing_unsubscribe_tokens from anon, authenticated;
grant select on public.marketing_campaigns, public.marketing_campaign_recipients,
  public.marketing_campaign_events to authenticated;
grant select, insert, update, delete on public.marketing_campaigns,
  public.marketing_campaign_recipients, public.marketing_campaign_events,
  public.marketing_unsubscribe_tokens to service_role;

-- Capture explicit preference changes made by the signed-in customer in the preference centre.
create or replace function public.phase9_marketing_preference_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_any boolean;
  v_previously_any boolean := false;
begin
  v_any := coalesce(new.marketing_in_app_enabled,false)
    or coalesce(new.marketing_email_enabled,false)
    or coalesce(new.marketing_sms_enabled,false)
    or coalesce(new.marketing_whatsapp_enabled,false);
  if tg_op = 'UPDATE' then
    v_previously_any := coalesce(old.marketing_in_app_enabled,false)
      or coalesce(old.marketing_email_enabled,false)
      or coalesce(old.marketing_sms_enabled,false)
      or coalesce(old.marketing_whatsapp_enabled,false);
  end if;
  if v_any and (not v_previously_any or new.marketing_consent_at is null) then
    new.marketing_consent_at := now();
    new.marketing_consent_source := coalesce(new.marketing_consent_source,'preferences_center');
    new.marketing_unsubscribed_at := null;
  elsif not v_any and v_previously_any then
    new.marketing_unsubscribed_at := now();
  elsif v_any then
    new.marketing_unsubscribed_at := null;
  end if;
  if tg_op = 'UPDATE' then
    if old.marketing_email_enabled and not new.marketing_email_enabled then new.marketing_email_opted_out_at := now();
    elsif new.marketing_email_enabled then new.marketing_email_opted_out_at := null; end if;
    if old.marketing_sms_enabled and not new.marketing_sms_enabled then new.marketing_sms_opted_out_at := now();
    elsif new.marketing_sms_enabled then new.marketing_sms_opted_out_at := null; end if;
    if old.marketing_whatsapp_enabled and not new.marketing_whatsapp_enabled then new.marketing_whatsapp_opted_out_at := now();
    elsif new.marketing_whatsapp_enabled then new.marketing_whatsapp_opted_out_at := null; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists phase9_marketing_preference_audit on public.notification_preferences;
create trigger phase9_marketing_preference_audit
before insert or update
on public.notification_preferences
for each row execute function public.phase9_marketing_preference_audit();

-- The authenticated user can update only their own marketing preference columns.
grant update (marketing_in_app_enabled, marketing_email_enabled, marketing_sms_enabled,
  marketing_whatsapp_enabled) on public.notification_preferences to authenticated;

-- Return only consented customer IDs eligible for at least one selected campaign channel.
create or replace function public.phase9_marketing_eligible_recipients(
  p_campaign_id uuid,
  p_after_user_id uuid default null,
  p_limit integer default 200
) returns table(user_id uuid)
language sql stable security definer set search_path = public, auth as $$
  select distinct p.id
  from public.marketing_campaigns c
  join public.notification_preferences np on true
  join public.profiles p on p.id = np.user_id
  join public.user_roles ur on ur.user_id = p.id
  join public.roles r on r.id = ur.role_id and r.key = 'customer'
  where c.id = p_campaign_id
    and c.status = 'processing'
    and np.marketing_consent_at is not null
    and np.marketing_unsubscribed_at is null
    and (p_after_user_id is null or p.id > p_after_user_id)
    and (
      ('in_app' = any(c.channels) and np.marketing_in_app_enabled)
      or ('email' = any(c.channels) and np.marketing_email_enabled and np.marketing_email_opted_out_at is null)
      or ('sms' = any(c.channels) and np.marketing_sms_enabled and np.marketing_sms_opted_out_at is null)
      or ('whatsapp' = any(c.channels) and np.marketing_whatsapp_enabled and np.marketing_whatsapp_opted_out_at is null)
    )
    and (
      c.audience_segment = 'consented_customers'
      or (c.audience_segment = 'domestic_interest' and exists (select 1 from public.customer_preferences cp where cp.user_id=p.id and cp.travel_scope in ('domestic','both')))
      or (c.audience_segment = 'international_interest' and exists (select 1 from public.customer_preferences cp where cp.user_id=p.id and cp.travel_scope in ('international','both')))
      or (c.audience_segment = 'wishlist_travelers' and exists (select 1 from public.wishlists w where w.user_id=p.id))
      or (c.audience_segment = 'recently_active' and exists (select 1 from public.customer_activity ca where ca.user_id=p.id and ca.created_at >= now() - interval '90 days'))
    )
    and not exists (
      select 1 from public.marketing_campaign_recipients cr
      where cr.campaign_id = c.id and cr.recipient_user_id = p.id
    )
  order by p.id
  limit least(greatest(coalesce(p_limit,200),1),500);
$$;
revoke all on function public.phase9_marketing_eligible_recipients(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.phase9_marketing_eligible_recipients(uuid,uuid,integer) to service_role;

-- Queue a single campaign recipient atomically. No arbitrary customer-supplied recipient IDs
-- can call this RPC; only the server-side service role may execute it.
create or replace function public.phase9_queue_marketing_campaign_recipient(
  p_campaign_id uuid,
  p_recipient_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  c public.marketing_campaigns%rowtype;
  np public.notification_preferences%rowtype;
  v_notification_id uuid;
  v_in_app boolean := false;
  v_email boolean := false;
  v_sms boolean := false;
  v_whatsapp boolean := false;
  v_existing uuid;
begin
  select * into c from public.marketing_campaigns where id = p_campaign_id for update;
  if not found or c.status <> 'processing' then
    raise exception 'Campaign is not processing';
  end if;
  select * into np from public.notification_preferences where user_id = p_recipient_user_id;
  if not found or np.marketing_consent_at is null or np.marketing_unsubscribed_at is not null then
    insert into public.marketing_campaign_recipients(campaign_id,recipient_user_id,status)
    values (p_campaign_id,p_recipient_user_id,'skipped') on conflict (campaign_id,recipient_user_id) do nothing;
    return jsonb_build_object('status','skipped');
  end if;
  if not exists (
    select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
    where ur.user_id=p_recipient_user_id and r.key='customer'
  ) then
    return jsonb_build_object('status','skipped');
  end if;

  v_in_app := 'in_app'=any(c.channels) and np.marketing_in_app_enabled;
  v_email := 'email'=any(c.channels) and np.marketing_email_enabled and np.marketing_email_opted_out_at is null;
  v_sms := 'sms'=any(c.channels) and np.marketing_sms_enabled and np.marketing_sms_opted_out_at is null;
  v_whatsapp := 'whatsapp'=any(c.channels) and np.marketing_whatsapp_enabled and np.marketing_whatsapp_opted_out_at is null;
  if not (v_in_app or v_email or v_sms or v_whatsapp) then
    insert into public.marketing_campaign_recipients(campaign_id,recipient_user_id,status)
    values (p_campaign_id,p_recipient_user_id,'skipped') on conflict (campaign_id,recipient_user_id) do nothing;
    return jsonb_build_object('status','skipped');
  end if;

  insert into public.notifications(
    recipient_user_id,event_key,event_type,template_key,title,body,entity_type,entity_id,
    action_path,safe_metadata,in_app_visible
  ) values (
    p_recipient_user_id,'marketing-campaign:'||p_campaign_id::text,'marketing_campaign',c.template_key,
    c.title,c.body,'marketing_campaign',p_campaign_id::text,c.action_path,
    jsonb_build_object('campaign_id',p_campaign_id,'in_app_enabled',v_in_app),v_in_app
  ) on conflict (recipient_user_id,event_key) do nothing returning id into v_notification_id;

  if v_notification_id is null then
    select id into v_notification_id from public.notifications
    where recipient_user_id=p_recipient_user_id and event_key='marketing-campaign:'||p_campaign_id::text;
  end if;
  if v_email then
    insert into public.notification_deliveries(notification_id,recipient_user_id,channel,template_key)
    values(v_notification_id,p_recipient_user_id,'email',c.template_key) on conflict do nothing;
  end if;
  if v_sms then
    insert into public.notification_deliveries(notification_id,recipient_user_id,channel,template_key)
    values(v_notification_id,p_recipient_user_id,'sms',c.template_key) on conflict do nothing;
  end if;
  if v_whatsapp then
    insert into public.notification_deliveries(notification_id,recipient_user_id,channel,template_key)
    values(v_notification_id,p_recipient_user_id,'whatsapp',c.template_key) on conflict do nothing;
  end if;
  insert into public.marketing_campaign_recipients(campaign_id,recipient_user_id,notification_id,status)
  values(p_campaign_id,p_recipient_user_id,v_notification_id,case when v_in_app and not (v_email or v_sms or v_whatsapp) then 'delivered' else 'queued' end)
  on conflict(campaign_id,recipient_user_id) do nothing;
  update public.marketing_campaigns c set
    total_recipients=(select count(*) from public.marketing_campaign_recipients cr where cr.campaign_id=p_campaign_id),
    sent_count=(select count(*) from public.marketing_campaign_recipients cr where cr.campaign_id=p_campaign_id and cr.status in ('sent','delivered')) ,
    delivered_count=(select count(*) from public.marketing_campaign_recipients cr where cr.campaign_id=p_campaign_id and cr.status='delivered'),
    failed_count=(select count(*) from public.marketing_campaign_recipients cr where cr.campaign_id=p_campaign_id and cr.status='failed'),
    updated_at=now() where c.id=p_campaign_id;
  return jsonb_build_object('status','queued','notification_id',v_notification_id);
end;
$$;
revoke all on function public.phase9_queue_marketing_campaign_recipient(uuid,uuid) from public, anon, authenticated;
grant execute on function public.phase9_queue_marketing_campaign_recipient(uuid,uuid) to service_role;

-- Provider dispatch state updates campaign analytics without exposing delivery records to customers.
create or replace function public.phase9_sync_campaign_delivery_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_campaign_id uuid;
  v_notification_id uuid := new.notification_id;
begin
  select nullif(n.safe_metadata->>'campaign_id','')::uuid into v_campaign_id
  from public.notifications n where n.id=v_notification_id and n.event_type='marketing_campaign';
  if v_campaign_id is null then return new; end if;

  update public.marketing_campaign_recipients cr
  set status = case
    when exists(select 1 from public.notification_deliveries d where d.notification_id=v_notification_id and d.status='delivered') then 'delivered'
    when exists(select 1 from public.notification_deliveries d where d.notification_id=v_notification_id and d.status='sent') then 'sent'
    when not exists(select 1 from public.notification_deliveries d where d.notification_id=v_notification_id and d.status not in ('dead','failed'))
      and exists(select 1 from public.notification_deliveries d where d.notification_id=v_notification_id) then 'failed'
    else 'queued'
  end,
  updated_at=now()
  where cr.notification_id=v_notification_id;

  update public.marketing_campaigns c set
    total_recipients=(select count(*) from public.marketing_campaign_recipients cr where cr.campaign_id=v_campaign_id),
    sent_count=(select count(*) from public.marketing_campaign_recipients cr where cr.campaign_id=v_campaign_id and cr.status in ('sent','delivered')),
    delivered_count=(select count(*) from public.marketing_campaign_recipients cr where cr.campaign_id=v_campaign_id and cr.status='delivered'),
    failed_count=(select count(*) from public.marketing_campaign_recipients cr where cr.campaign_id=v_campaign_id and cr.status='failed'),
    updated_at=now()
  where c.id=v_campaign_id;
  return new;
end;
$$;
drop trigger if exists phase9_sync_campaign_delivery_status on public.notification_deliveries;
create trigger phase9_sync_campaign_delivery_status
after insert or update on public.notification_deliveries
for each row execute function public.phase9_sync_campaign_delivery_status();

-- Called only by the signature-verified Twilio inbound webhook for STOP keywords.
create or replace function public.phase9_marketing_sms_optout(p_phone text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Invalid E.164 phone number';
  end if;
  update public.notification_preferences np set
    marketing_sms_enabled = false,
    marketing_sms_opted_out_at = now(),
    marketing_unsubscribed_at = case
      when not np.marketing_in_app_enabled and not np.marketing_email_enabled and not np.marketing_whatsapp_enabled then now()
      else np.marketing_unsubscribed_at end
  from public.profiles p
  where p.id = np.user_id
    and regexp_replace(coalesce(p.phone,''),'[^0-9]','','g') = regexp_replace(p_phone,'[^0-9]','','g');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.phase9_marketing_sms_optout(text) from public, anon, authenticated;
grant execute on function public.phase9_marketing_sms_optout(text) to service_role;

-- Customer preferences UI uses the existing owner-scoped preference table.
-- Ensure delivery worker and unsubscribe service can read/write server-side rows.
grant select, insert, update on public.notification_preferences to service_role;

do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

commit;
