
-- Phase 16: persist checkout information for idempotent retries.
-- Apply after the Phase 6 payment migration.

begin;

alter table public.payments
  add column if not exists provider_checkout_url text,
  add column if not exists provider_client_key text;

alter table public.payments
  drop constraint if exists payments_phase16_checkout_url_https_check;

alter table public.payments
  add constraint payments_phase16_checkout_url_https_check
  check (
    provider_checkout_url is null
    or provider_checkout_url ~ '^https://'
  );

comment on column public.payments.provider_checkout_url is
  'Provider checkout URL. Never treat a return redirect as proof of payment.';

comment on column public.payments.provider_client_key is
  'Public provider client key only; never store provider secrets here.';

commit;
