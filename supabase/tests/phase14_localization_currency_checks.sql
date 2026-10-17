DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'preferred_language'
  ) THEN
    RAISE EXCEPTION 'Missing preferred_language';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'preferred_currency'
  ) THEN
    RAISE EXCEPTION 'Missing preferred_currency';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tours'
      AND column_name = 'tour_kind'
  ) THEN
    RAISE EXCEPTION 'Missing tour_kind';
  END IF;

  IF to_regclass('public.content_translations') IS NULL THEN
    RAISE EXCEPTION 'Missing content_translations';
  END IF;

  IF to_regprocedure(
    'public.phase14_set_manual_currency_rates(jsonb,text,timestamp with time zone)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Missing manual currency rate RPC';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'phase14_lock_accepted_quote_snapshot'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Missing accepted quotation snapshot trigger';
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
  AND tablename = 'content_translations'
ORDER BY policyname;