-- AeroFly Tours Phase 6 foundation. Additive migration; retains existing tables.
-- Apply only after testing against all existing Phase 1-5 migrations.
begin;

-- Online checkout must not masquerade as a staff-recorded payment.
alter table public.payments alter column "receivedBy" drop not null;

alter table public.payments
  add column if not exists provider text not null default 'offline',
  add column if not exists provider_order_id text,
  add column if not exists provider_payment_id text,
  add column if not exists idempotency_key text,
  add column if not exists amount_minor bigint,
  add column if not exists currency_snapshot varchar(3),
  add column if not exists refunded_amount numeric(12,2) not null default 0,
  add column if not exists updated_at timestamptz not null default now();

alter table public.payments drop constraint if exists payments_phase6_provider_check;
alter table public.payments add constraint payments_phase6_provider_check
  check (provider in ('mock','razorpay','stripe','offline'));
alter table public.payments drop constraint if exists payments_phase6_amount_check;
alter table public.payments add constraint payments_phase6_amount_check
  check (amount > 0 and refunded_amount >= 0 and refunded_amount <= amount
    and (amount_minor is null or amount_minor > 0));
alter table public.payments drop constraint if exists payments_phase6_currency_check;
alter table public.payments add constraint payments_phase6_currency_check
  check (currency_snapshot is null or currency_snapshot ~ '^[A-Z]{3}$');

create unique index if not exists payments_phase6_provider_order_uidx
  on public.payments(provider, provider_order_id) where provider_order_id is not null;
create unique index if not exists payments_phase6_provider_payment_uidx
  on public.payments(provider, provider_payment_id) where provider_payment_id is not null;
create unique index if not exists payments_phase6_idempotency_uidx
  on public.payments(idempotency_key) where idempotency_key is not null;
create index if not exists payments_phase6_provider_status_idx
  on public.payments(provider, status, "createdAt" desc);

-- Provider event id is unique so duplicate deliveries cannot be processed twice.
create table if not exists public.payment_webhook_events (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('mock','razorpay','stripe')),
  provider_event_id text not null,
  event_type text not null,
  payload_sha256 text not null,
  processing_status text not null default 'received'
    check (processing_status in ('received','processing','processed','ignored','failed')),
  payment_id integer references public.payments(id) on delete restrict,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  failure_code text,
  unique(provider, provider_event_id)
);
create index if not exists payment_webhook_events_status_idx
  on public.payment_webhook_events(processing_status, received_at);

create table if not exists public.refunds (
  id bigint generated always as identity primary key,
  payment_id integer not null references public.payments(id) on delete restrict,
  requested_by integer not null references public.users(id) on delete restrict,
  approved_by integer references public.users(id) on delete restrict,
  requested_amount numeric(12,2) not null check (requested_amount > 0),
  approved_amount numeric(12,2) check (approved_amount is null or approved_amount > 0),
  currency_snapshot varchar(3) not null check (currency_snapshot ~ '^[A-Z]{3}$'),
  reason text not null check (length(trim(reason)) between 1 and 2000),
  status text not null default 'requested' check (status in
    ('requested','approved','processing','succeeded','failed','rejected','cancelled')),
  provider text not null check (provider in ('mock','razorpay','stripe','offline')),
  provider_refund_id text,
  offline_reference text,
  approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approved_amount is null or approved_amount <= requested_amount)
);
create unique index if not exists refunds_provider_reference_uidx
  on public.refunds(provider, provider_refund_id) where provider_refund_id is not null;
create index if not exists refunds_payment_status_idx on public.refunds(payment_id,status,created_at desc);

create table if not exists public.invoices (
  id bigint generated always as identity primary key,
  document_number text not null unique,
  booking_id integer references public.bookings(id) on delete restrict,
  quotation_id integer references public.quotations(id) on delete restrict,
  customer_user_id integer not null references public.users(id) on delete restrict,
  document_type text not null check (document_type in ('invoice','statement','receipt')),
  status text not null default 'issued' check (status in ('draft','issued','void')),
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  tax_amount numeric(12,2) not null default 0 check (tax_amount >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  total_amount numeric(12,2) not null check (total_amount >= 0),
  company_details jsonb not null default '{}'::jsonb,
  customer_details jsonb not null default '{}'::jsonb,
  issued_at timestamptz,
  storage_path text,
  created_at timestamptz not null default now(),
  check (booking_id is not null or quotation_id is not null)
);
create index if not exists invoices_customer_idx on public.invoices(customer_user_id,created_at desc);

create table if not exists public.invoice_items (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.invoices(id) on delete restrict,
  description text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  tax_amount numeric(12,2) not null default 0 check (tax_amount >= 0)
);

create table if not exists public.payment_reconciliation_records (
  id bigint generated always as identity primary key,
  payment_id integer references public.payments(id) on delete restrict,
  provider text not null check (provider in ('mock','razorpay','stripe','offline')),
  provider_reference text,
  result text not null check (result in ('matched','unmatched','amount_mismatch','status_mismatch')),
  expected_amount numeric(12,2),
  provider_amount numeric(12,2),
  currency varchar(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  notes text,
  reconciled_by integer not null references public.users(id) on delete restrict,
  reconciled_at timestamptz not null default now()
);
create index if not exists payment_reconciliation_date_idx on public.payment_reconciliation_records(reconciled_at desc);

-- These tables are accessed through authenticated server routes/service-role operations.
-- No direct client mutation is allowed. Read access is exposed only through server routes
-- until the project's existing auth model is mapped to Supabase Auth identities.
alter table public.payment_webhook_events enable row level security;
alter table public.refunds enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payment_reconciliation_records enable row level security;
revoke all on public.payment_webhook_events, public.refunds, public.invoices,
  public.invoice_items, public.payment_reconciliation_records from anon, authenticated;
revoke insert, update, delete on public.payments from anon, authenticated;

-- Atomic webhook reconciliation. Only service_role may call this function.
create or replace function public.process_payment_webhook(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_payload_sha256 text,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_minor bigint,
  p_currency text,
  p_outcome text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_event_id bigint;
begin
  if p_provider not in ('mock','razorpay','stripe') then raise exception 'Unsupported provider'; end if;
  if p_outcome not in ('succeeded','failed','pending') then raise exception 'Invalid outcome'; end if;

  insert into public.payment_webhook_events(provider,provider_event_id,event_type,payload_sha256,processing_status)
  values (p_provider,p_event_id,p_event_type,p_payload_sha256,'processing')
  on conflict (provider,provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('duplicate',true,'processed',false);
  end if;

  select * into v_payment from public.payments
  where provider = p_provider and provider_order_id = p_provider_order_id
  for update;

  if not found then
    update public.payment_webhook_events set processing_status='ignored', processed_at=now(), failure_code='payment_not_found' where id=v_event_id;
    return jsonb_build_object('found',false);
  end if;

  if v_payment.amount_minor is distinct from p_amount_minor
     or upper(coalesce(v_payment.currency_snapshot,'')) <> upper(coalesce(p_currency,'')) then
    update public.payment_webhook_events set processing_status='failed',processed_at=now(),payment_id=v_payment.id,failure_code='amount_or_currency_mismatch' where id=v_event_id;
    raise exception 'Provider amount/currency does not match payment snapshot';
  end if;

  -- Never downgrade a confirmed success because an older failure event arrived late.
  if v_payment.status <> 'successful' then
    if p_outcome='succeeded' then
      update public.payments set status='successful', provider_payment_id=coalesce(p_provider_payment_id,provider_payment_id),
        "transactionReference"=coalesce(p_provider_payment_id,"transactionReference"), "paidAt"=now(), updated_at=now()
      where id=v_payment.id;
      if v_payment."bookingId" is not null then
        update public.bookings set "paymentStatus"='successful', "updatedAt"=now() where id=v_payment."bookingId";
      end if;
    elsif p_outcome='failed' and v_payment.status in ('pending','initiated') then
      update public.payments set status='failed', provider_payment_id=coalesce(p_provider_payment_id,provider_payment_id), updated_at=now()
      where id=v_payment.id;
    end if;
  end if;

  update public.payment_webhook_events set processing_status='processed',processed_at=now(),payment_id=v_payment.id where id=v_event_id;
  return jsonb_build_object('found',true,'payment_id',v_payment.id,'outcome',p_outcome);
exception when others then
  -- Exception rolls back the transaction, including the event insert, allowing safe retry.
  raise;
end;
$$;
revoke all on function public.process_payment_webhook(text,text,text,text,text,text,bigint,text,text) from public, anon, authenticated;
grant execute on function public.process_payment_webhook(text,text,text,text,text,text,bigint,text,text) to service_role;

commit;
