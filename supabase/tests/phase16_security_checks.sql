
-- AeroFly Tours Phase 16 database regression checks.
-- Run only after the Phase 6 and Phase 16 migrations have been applied.

begin;

do $$
declare
  v_function oid;
  v_security_definer boolean;
  v_search_path text;
begin
  -- Verify the checkout fields required by payment-create.
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payments'
      and column_name = 'provider_checkout_url'
  ) then
    raise exception 'Missing payments.provider_checkout_url';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payments'
      and column_name = 'provider_client_key'
  ) then
    raise exception 'Missing payments.provider_client_key';
  end if;

  -- Verify that provider order IDs cannot be duplicated.
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'payments_phase6_provider_order_uidx'
  ) then
    raise exception 'Missing provider-order unique index';
  end if;

  -- Verify global idempotency-key uniqueness.
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'payments_phase6_idempotency_uidx'
  ) then
    raise exception 'Missing payment idempotency unique index';
  end if;

  -- Verify the existing webhook RPC.
  v_function := to_regprocedure(
    'public.process_payment_webhook(text,text,text,text,text,text,bigint,text,text)'
  );

  if v_function is null then
    raise exception 'Missing process_payment_webhook RPC';
  end if;

  select p.prosecdef, array_to_string(p.proconfig, ',')
  into v_security_definer, v_search_path
  from pg_proc p
  where p.oid = v_function;

  if v_security_definer is distinct from true then
    raise exception 'Webhook RPC must be SECURITY DEFINER';
  end if;

  if coalesce(v_search_path, '') not like '%search_path=public%' then
    raise exception 'Webhook RPC must use a fixed search_path';
  end if;

  if has_function_privilege(
    'authenticated',
    v_function,
    'EXECUTE'
  ) then
    raise exception 'Authenticated users must not execute the webhook RPC';
  end if;

  if has_function_privilege(
    'anon',
    v_function,
    'EXECUTE'
  ) then
    raise exception 'Anonymous users must not execute the webhook RPC';
  end if;

  if not has_function_privilege(
    'service_role',
    v_function,
    'EXECUTE'
  ) then
    raise exception 'Service role must be able to execute the webhook RPC';
  end if;

  raise notice 'Phase 16 payment database checks passed.';
end
$$;

rollback;
