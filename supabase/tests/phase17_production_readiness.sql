
DO $$
DECLARE
  v_missing text[];
  v_rls_disabled text[];
  v_function_count integer;
  v_service_execute boolean;
  v_payment_function regprocedure;
BEGIN
  SELECT array_agg(required.table_name ORDER BY required.table_name)
  INTO v_missing
  FROM (
    VALUES
      ('payments'),
      ('payment_webhook_events'),
      ('refunds'),
      ('invoices'),
      ('invoice_items'),
      ('quotations'),
      ('bookings'),
      ('profiles'),
      ('user_roles'),
      ('organization_memberships')
  ) AS required(table_name)
  LEFT JOIN pg_class c
    ON c.oid = to_regclass('public.' || required.table_name)
  WHERE c.oid IS NULL;

  IF coalesce(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION
      'Phase 17 required tables missing: %',
      array_to_string(v_missing, ', ');
  END IF;

  SELECT array_agg(required.table_name ORDER BY required.table_name)
  INTO v_rls_disabled
  FROM (
    VALUES
      ('payments'),
      ('payment_webhook_events'),
      ('refunds'),
      ('invoices'),
      ('invoice_items'),
      ('quotations'),
      ('bookings'),
      ('profiles'),
      ('user_roles'),
      ('organization_memberships')
  ) AS required(table_name)
  JOIN pg_class c
    ON c.oid = to_regclass('public.' || required.table_name)
  WHERE c.relkind = 'r'
    AND NOT c.relrowsecurity;

  IF coalesce(array_length(v_rls_disabled, 1), 0) > 0 THEN
    RAISE EXCEPTION
      'RLS is disabled on critical tables: %',
      array_to_string(v_rls_disabled, ', ');
  END IF;

  IF EXISTS (
    SELECT required.table_name
    FROM (
      VALUES
        ('profiles'),
        ('user_roles'),
        ('organization_memberships'),
        ('quotations'),
        ('bookings')
    ) AS required(table_name)
    JOIN pg_class c
      ON c.oid = to_regclass('public.' || required.table_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_policy pol
      WHERE pol.polrelid = c.oid
    )
  ) THEN
    RAISE EXCEPTION
      'Expected RLS policies are missing on customer/role-scoped tables';
  END IF;

  IF to_regclass(
    'public.payments_phase6_idempotency_uidx'
  ) IS NULL THEN
    RAISE EXCEPTION
      'Missing payment idempotency unique index';
  END IF;

  IF to_regclass(
    'public.payments_phase6_provider_order_uidx'
  ) IS NULL THEN
    RAISE EXCEPTION
      'Missing provider order unique index';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    WHERE con.conrelid =
      to_regclass('public.payment_webhook_events')
      AND con.contype = 'u'
      AND pg_get_constraintdef(con.oid)
        ILIKE '%provider, provider_event_id%'
  ) THEN
    RAISE EXCEPTION
      'Payment webhook event deduplication constraint is missing';
  END IF;

  SELECT count(*)
  INTO v_function_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'process_payment_webhook';

  IF v_function_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one process_payment_webhook overload; found %',
      v_function_count;
  END IF;

  SELECT p.oid::regprocedure
  INTO v_payment_function
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'process_payment_webhook';

  SELECT has_function_privilege(
    'service_role',
    v_payment_function,
    'EXECUTE'
  )
  INTO v_service_execute;

  IF v_service_execute IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'service_role cannot execute process_payment_webhook';
  END IF;

  IF has_function_privilege(
       'anon', v_payment_function, 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated', v_payment_function, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'Untrusted roles can execute process_payment_webhook';
  END IF;

  RAISE NOTICE
    'Phase 17 critical database readiness checks passed.';
END $$;
