DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_preferences'
      AND column_name = 'personalization_enabled'
  ) THEN
    RAISE EXCEPTION
      'Missing customer_preferences.personalization_enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_preferences'
      AND column_name = 'interests'
  ) THEN
    RAISE EXCEPTION
      'Missing customer_preferences.interests';
  END IF;

  IF to_regclass('public.recommendation_events') IS NULL THEN
    RAISE EXCEPTION
      'Missing recommendation_events';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.recommendation_events'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION
      'RLS must be enabled on recommendation_events';
  END IF;

  IF to_regprocedure(
    'public.phase13_recommendation_analytics(timestamp with time zone,timestamp with time zone,uuid)'
  ) IS NULL THEN
    RAISE EXCEPTION
      'Missing analytics RPC';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'phase13_proposal_accepted_activity'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION
      'Missing proposal acceptance activity trigger';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'phase13_enquiry_submitted_activity'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION
      'Missing enquiry submission activity trigger';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'recommendation_events'
      AND policyname = 'recommendation_events_insert_own'
      AND with_check ILIKE '%personalization_enabled%'
  ) THEN
    RAISE EXCEPTION
      'Recommendation event inserts must require explicit consent';
  END IF;
END $$;

SELECT
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'recommendation_events'
ORDER BY policyname;