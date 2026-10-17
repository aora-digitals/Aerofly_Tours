BEGIN;

-- User language and display currency are independent preferences.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS preferred_currency varchar(3) NOT NULL DEFAULT 'INR';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_phase14_language_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_phase14_language_check
  CHECK (preferred_language IN ('en','mr','hi'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_phase14_currency_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_phase14_currency_check
  CHECK (preferred_currency IN (
    'INR','USD','EUR','GBP','AED','SGD','AUD','CAD',
    'JPY','CHF','NZD','HKD','SEK','NOK','DKK','BRL',
    'ZAR','THB','MYR','PHP','IDR'
  ));

-- English remains canonical content; translations are additive.
ALTER TABLE public.tours
  ADD COLUMN IF NOT EXISTS tour_kind text,
  ADD COLUMN IF NOT EXISTS base_currency varchar(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS translation_status jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.destinations
  ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS translation_status jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.tour_itineraries
  ADD COLUMN IF NOT EXISTS translations jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS translation_status jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.tours t
SET tour_kind = CASE
  WHEN lower(d.kind::text) IN ('domestic','india','national')
    THEN 'domestic'
  ELSE 'international'
END
FROM public.destinations d
WHERE d.id = t."destinationId"
  AND (
    t.tour_kind IS NULL
    OR t.tour_kind NOT IN ('domestic','international')
  );

ALTER TABLE public.tours
  ALTER COLUMN tour_kind SET DEFAULT 'domestic';

ALTER TABLE public.tours
  ALTER COLUMN tour_kind SET NOT NULL;

ALTER TABLE public.tours
  DROP CONSTRAINT IF EXISTS tours_phase14_kind_check;

ALTER TABLE public.tours
  ADD CONSTRAINT tours_phase14_kind_check
  CHECK (tour_kind IN ('domestic','international'));

ALTER TABLE public.tours
  DROP CONSTRAINT IF EXISTS tours_phase14_base_currency_check;

ALTER TABLE public.tours
  ADD CONSTRAINT tours_phase14_base_currency_check
  CHECK (base_currency ~ '^[A-Z]{3}$');

CREATE INDEX IF NOT EXISTS tours_phase14_kind_status_idx
  ON public.tours(tour_kind, status, featured DESC);

CREATE INDEX IF NOT EXISTS tours_phase14_translations_gin_idx
  ON public.tours USING gin(translations);

CREATE INDEX IF NOT EXISTS destinations_phase14_translations_gin_idx
  ON public.destinations USING gin(translations);

-- Per-field translations. Publication requires review metadata.
CREATE TABLE IF NOT EXISTS public.content_translations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL CHECK (
    entity_type IN (
      'tour','destination','itinerary','attraction',
      'knowledge_document','faq','policy','company'
    )
  ),
  entity_id text NOT NULL,
  language_code text NOT NULL
    CHECK (language_code IN ('en','mr','hi')),
  field_key text NOT NULL
    CHECK (field_key ~ '^[a-z][a-z0-9_]{0,80}$'),
  translated_value text NOT NULL DEFAULT '',
  review_status text NOT NULL DEFAULT 'draft'
    CHECK (
      review_status IN ('missing','draft','reviewed','published')
    ),
  requires_approval boolean NOT NULL DEFAULT false,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  published_at timestamptz,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_id, language_code, field_key),
  CHECK (
    review_status <> 'published'
    OR (
      length(trim(translated_value)) > 0
      AND reviewed_at IS NOT NULL
      AND reviewed_by IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS content_translations_lookup_idx
  ON public.content_translations(
    entity_type, entity_id, language_code, review_status
  );

ALTER TABLE public.content_translations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_translations_public_read
  ON public.content_translations;

CREATE POLICY content_translations_public_read
  ON public.content_translations
  FOR SELECT TO anon, authenticated
  USING (
    review_status = 'published'
    AND (
      NOT requires_approval
      OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
    )
  );

DROP POLICY IF EXISTS content_translations_staff_manage
  ON public.content_translations;

CREATE POLICY content_translations_staff_manage
  ON public.content_translations
  FOR ALL TO authenticated
  USING (
    (
      entity_type IN (
        'tour','destination','itinerary','attraction'
      )
      AND public.has_permission('tours.manage')
    )
    OR (
      entity_type IN (
        'knowledge_document','faq','policy','company'
      )
      AND public.has_permission('knowledge.manage', null)
    )
  )
  WITH CHECK (
    (
      entity_type IN (
        'tour','destination','itinerary','attraction'
      )
      AND public.has_permission('tours.manage')
    )
    OR (
      entity_type IN (
        'knowledge_document','faq','policy','company'
      )
      AND public.has_permission('knowledge.manage', null)
    )
  );

REVOKE ALL ON public.content_translations FROM anon;
GRANT SELECT ON public.content_translations TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE
  ON public.content_translations TO authenticated;

GRANT USAGE, SELECT
  ON SEQUENCE public.content_translations_id_seq TO authenticated;

-- Sensitive translation types always require approval.
CREATE OR REPLACE FUNCTION public.phase14_require_translation_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sensitive boolean := false;
BEGIN
  v_sensitive := NEW.field_key IN (
    'visa','safety','legal','financial_policy',
    'cancellation_policy'
  );

  IF NEW.entity_type = 'knowledge_document' THEN
    SELECT (
      d.category IN ('visa','policy')
      OR d.title ~* '(visa|safety|legal|cancellation|financial policy)'
    )
    INTO v_sensitive
    FROM public.knowledge_documents d
    WHERE d.id::text = NEW.entity_id;

    v_sensitive := COALESCE(v_sensitive, false);
  END IF;

  IF v_sensitive THEN
    NEW.requires_approval := true;
  END IF;

  IF NEW.review_status = 'published'
     AND NEW.requires_approval
     AND (NEW.reviewed_at IS NULL OR NEW.reviewed_by IS NULL) THEN
    RAISE EXCEPTION
      'Sensitive translations require an authorized reviewer before publication';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phase14_require_translation_review
  ON public.content_translations;

CREATE TRIGGER phase14_require_translation_review
  BEFORE INSERT OR UPDATE ON public.content_translations
  FOR EACH ROW
  EXECUTE FUNCTION public.phase14_require_translation_review();

REVOKE ALL
  ON FUNCTION public.phase14_require_translation_review()
  FROM public, anon, authenticated;

-- Financial snapshots preserve the accepted price and currency.
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS currency_snapshot varchar(3),
  ADD COLUMN IF NOT EXISTS base_currency_snapshot varchar(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS exchange_rate_snapshot numeric(20,10),
  ADD COLUMN IF NOT EXISTS price_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS price_locked_at timestamptz;

UPDATE public.quotations
SET currency_snapshot = currency
WHERE currency_snapshot IS NULL;

UPDATE public.quotations
SET base_currency_snapshot = currency
WHERE "acceptedAt" IS NOT NULL
  AND exchange_rate_snapshot IS NULL;

UPDATE public.quotations
SET price_snapshot = jsonb_build_object(
  'subtotal', subtotal,
  'taxes', taxes,
  'discount', discount,
  'total', total,
  'currency', currency,
  'captured_at', COALESCE("acceptedAt", "updatedAt", "createdAt")
),
price_locked_at = COALESCE("acceptedAt", "updatedAt", "createdAt")
WHERE "acceptedAt" IS NOT NULL
  AND price_snapshot = '{}'::jsonb;

ALTER TABLE public.quotations
  ALTER COLUMN currency_snapshot SET DEFAULT 'INR';

ALTER TABLE public.quotations
  DROP CONSTRAINT IF EXISTS quotations_phase14_snapshot_currency_check;

ALTER TABLE public.quotations
  ADD CONSTRAINT quotations_phase14_snapshot_currency_check
  CHECK (
    currency_snapshot ~ '^[A-Z]{3}$'
    AND base_currency_snapshot ~ '^[A-Z]{3}$'
    AND (
      exchange_rate_snapshot IS NULL
      OR exchange_rate_snapshot > 0
    )
  );

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS currency_snapshot varchar(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS base_currency_snapshot varchar(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS exchange_rate_snapshot numeric(20,10),
  ADD COLUMN IF NOT EXISTS price_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS price_locked_at timestamptz;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_phase14_snapshot_currency_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_phase14_snapshot_currency_check
  CHECK (
    currency_snapshot ~ '^[A-Z]{3}$'
    AND base_currency_snapshot ~ '^[A-Z]{3}$'
    AND (
      exchange_rate_snapshot IS NULL
      OR exchange_rate_snapshot > 0
    )
  );

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS base_currency_snapshot varchar(3),
  ADD COLUMN IF NOT EXISTS exchange_rate_snapshot numeric(20,10),
  ADD COLUMN IF NOT EXISTS price_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_phase14_exchange_rate_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_phase14_exchange_rate_check
  CHECK (
    exchange_rate_snapshot IS NULL
    OR exchange_rate_snapshot > 0
  );

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS price_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS price_locked_at timestamptz;

ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS price_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS price_locked_at timestamptz;

UPDATE public.invoices
SET price_snapshot = jsonb_build_object(
  'subtotal', subtotal,
  'tax_amount', tax_amount,
  'discount_amount', discount_amount,
  'total_amount', total_amount,
  'currency', currency,
  'captured_at', COALESCE(issued_at, created_at)
),
price_locked_at = COALESCE(issued_at, created_at)
WHERE status = 'issued'
  AND price_snapshot = '{}'::jsonb;

UPDATE public.refunds r
SET price_snapshot = jsonb_build_object(
  'requested_amount', r.requested_amount,
  'currency', r.currency_snapshot,
  'original_payment_amount', p.amount,
  'original_payment_currency',
    COALESCE(p.currency_snapshot, p."settlementCurrency"),
  'captured_at', r.created_at
),
price_locked_at = r.created_at
FROM public.payments p
WHERE p.id = r.payment_id
  AND r.price_snapshot = '{}'::jsonb;

-- Issued invoice financial fields are immutable.
CREATE OR REPLACE FUNCTION public.phase14_lock_invoice_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'issued' THEN
    NEW.price_snapshot := jsonb_build_object(
      'subtotal', NEW.subtotal,
      'tax_amount', NEW.tax_amount,
      'discount_amount', NEW.discount_amount,
      'total_amount', NEW.total_amount,
      'currency', NEW.currency,
      'captured_at', now()
    );
    NEW.price_locked_at := now();

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'issued' THEN
    IF NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
      OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount
      OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
      OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
      OR NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot
      OR NEW.price_locked_at IS DISTINCT FROM OLD.price_locked_at THEN
      RAISE EXCEPTION
        'Issued invoice pricing and currency are immutable';
    END IF;

  ELSIF TG_OP = 'UPDATE'
    AND OLD.status = 'draft'
    AND NEW.status = 'issued' THEN
    NEW.price_snapshot := jsonb_build_object(
      'subtotal', NEW.subtotal,
      'tax_amount', NEW.tax_amount,
      'discount_amount', NEW.discount_amount,
      'total_amount', NEW.total_amount,
      'currency', NEW.currency,
      'captured_at', now()
    );
    NEW.price_locked_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phase14_lock_invoice_snapshot
  ON public.invoices;

CREATE TRIGGER phase14_lock_invoice_snapshot
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.phase14_lock_invoice_snapshot();

REVOKE ALL
  ON FUNCTION public.phase14_lock_invoice_snapshot()
  FROM public, anon, authenticated;

-- Refund requests preserve their original amount and currency.
CREATE OR REPLACE FUNCTION public.phase14_lock_refund_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.payments%rowtype;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO p
    FROM public.payments
    WHERE id = NEW.payment_id;

    NEW.price_snapshot := jsonb_build_object(
      'requested_amount', NEW.requested_amount,
      'currency', NEW.currency_snapshot,
      'original_payment_amount', p.amount,
      'original_payment_currency',
        COALESCE(p.currency_snapshot, p."settlementCurrency"),
      'captured_at', now()
    );

    NEW.price_locked_at := now();

  ELSE
    IF NEW.requested_amount IS DISTINCT FROM OLD.requested_amount
      OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot
      OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
      OR NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot THEN
      RAISE EXCEPTION
        'Refund request amount and currency snapshots are immutable';
    END IF;

    IF OLD.approved_amount IS NOT NULL
      AND NEW.approved_amount IS DISTINCT FROM OLD.approved_amount THEN
      RAISE EXCEPTION
        'Approved refund amount is immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phase14_lock_refund_snapshot
  ON public.refunds;

CREATE TRIGGER phase14_lock_refund_snapshot
  BEFORE INSERT OR UPDATE ON public.refunds
  FOR EACH ROW
  EXECUTE FUNCTION public.phase14_lock_refund_snapshot();

REVOKE ALL
  ON FUNCTION public.phase14_lock_refund_snapshot()
  FROM public, anon, authenticated;

-- Accepted quotation prices and currencies cannot change.
CREATE OR REPLACE FUNCTION public.phase14_lock_accepted_quote_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD."acceptedAt" IS NOT NULL THEN
    IF NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot
      OR NEW.base_currency_snapshot IS DISTINCT FROM OLD.base_currency_snapshot
      OR NEW.exchange_rate_snapshot IS DISTINCT FROM OLD.exchange_rate_snapshot
      OR NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot
      OR NEW.price_locked_at IS DISTINCT FROM OLD.price_locked_at
      OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
      OR NEW.taxes IS DISTINCT FROM OLD.taxes
      OR NEW.discount IS DISTINCT FROM OLD.discount
      OR NEW.total IS DISTINCT FROM OLD.total THEN
      RAISE EXCEPTION
        'Accepted proposal pricing and currency snapshots are immutable';
    END IF;

  ELSIF NEW."acceptedAt" IS NOT NULL THEN
    NEW.currency_snapshot := NEW.currency;

    IF NEW.exchange_rate_snapshot IS NULL THEN
      NEW.base_currency_snapshot := NEW.currency;
    END IF;

    NEW.price_snapshot := jsonb_build_object(
      'subtotal', NEW.subtotal,
      'taxes', NEW.taxes,
      'discount', NEW.discount,
      'total', NEW.total,
      'currency', NEW.currency,
      'captured_at', now()
    );

    NEW.price_locked_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phase14_lock_accepted_quote_snapshot
  ON public.quotations;

CREATE TRIGGER phase14_lock_accepted_quote_snapshot
  BEFORE UPDATE ON public.quotations
  FOR EACH ROW
  EXECUTE FUNCTION public.phase14_lock_accepted_quote_snapshot();

REVOKE ALL
  ON FUNCTION public.phase14_lock_accepted_quote_snapshot()
  FROM public, anon, authenticated;

-- Copy an accepted quote's immutable snapshot to a newly created booking.
CREATE OR REPLACE FUNCTION public.phase14_copy_quote_snapshot_to_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q public.quotations%rowtype;
BEGIN
  SELECT * INTO q
  FROM public.quotations
  WHERE "bookingId" = NEW.id
    AND "acceptedAt" IS NOT NULL
  ORDER BY "acceptedAt" DESC
  LIMIT 1;

  IF FOUND THEN
    NEW.amount := q.total;
    NEW.currency_snapshot :=
      COALESCE(q.currency_snapshot, q.currency, 'INR');
    NEW.base_currency_snapshot :=
      COALESCE(q.base_currency_snapshot, 'INR');
    NEW.exchange_rate_snapshot := q.exchange_rate_snapshot;
    NEW.price_snapshot :=
      COALESCE(q.price_snapshot, '{}'::jsonb);
    NEW.price_locked_at :=
      COALESCE(q.price_locked_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phase14_copy_quote_snapshot_to_booking
  ON public.bookings;

CREATE TRIGGER phase14_copy_quote_snapshot_to_booking
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.phase14_copy_quote_snapshot_to_booking();

REVOKE ALL
  ON FUNCTION public.phase14_copy_quote_snapshot_to_booking()
  FROM public, anon, authenticated;

-- Payments inherit the accepted quote's currency snapshot.
CREATE OR REPLACE FUNCTION public.phase14_copy_quote_snapshot_to_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q public.quotations%rowtype;
BEGIN
  IF NEW."quotationId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO q
  FROM public.quotations
  WHERE id = NEW."quotationId"
    AND "acceptedAt" IS NOT NULL;

  IF FOUND THEN
    NEW.currency_snapshot :=
      COALESCE(
        NEW.currency_snapshot,
        q.currency_snapshot,
        q.currency,
        NEW."settlementCurrency"
      );

    NEW.base_currency_snapshot :=
      COALESCE(NEW.base_currency_snapshot, q.base_currency_snapshot, 'INR');

    NEW.exchange_rate_snapshot :=
      COALESCE(
        NEW.exchange_rate_snapshot,
        q.exchange_rate_snapshot
      );

    NEW.price_snapshot :=
      COALESCE(
        NULLIF(NEW.price_snapshot, '{}'::jsonb),
        q.price_snapshot,
        '{}'::jsonb
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phase14_copy_quote_snapshot_to_payment
  ON public.payments;

CREATE TRIGGER phase14_copy_quote_snapshot_to_payment
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.phase14_copy_quote_snapshot_to_payment();

REVOKE ALL
  ON FUNCTION public.phase14_copy_quote_snapshot_to_payment()
  FROM public, anon, authenticated;

-- Backfill existing bookings and payments from accepted quotations.
UPDATE public.bookings b
SET
  currency_snapshot = COALESCE(q.currency_snapshot, q.currency, 'INR'),
  base_currency_snapshot = COALESCE(q.base_currency_snapshot, 'INR'),
  exchange_rate_snapshot = q.exchange_rate_snapshot,
  price_snapshot = COALESCE(
    NULLIF(q.price_snapshot, '{}'::jsonb),
    jsonb_build_object(
      'total', q.total,
      'currency', q.currency,
      'captured_at', COALESCE(q.price_locked_at, q."acceptedAt")
    )
  ),
  price_locked_at = COALESCE(
    q.price_locked_at,
    q."acceptedAt",
    b."createdAt"
  )
FROM public.quotations q
WHERE q."bookingId" = b.id
  AND q."acceptedAt" IS NOT NULL;

UPDATE public.payments p
SET
  currency_snapshot = COALESCE(
    p.currency_snapshot,
    q.currency_snapshot,
    q.currency,
    p."settlementCurrency"
  ),
  base_currency_snapshot =
    COALESCE(p.base_currency_snapshot, q.base_currency_snapshot, 'INR'),
  exchange_rate_snapshot =
    COALESCE(p.exchange_rate_snapshot, q.exchange_rate_snapshot),
  price_snapshot = CASE
    WHEN p.price_snapshot = '{}'::jsonb
      THEN COALESCE(q.price_snapshot, '{}'::jsonb)
    ELSE p.price_snapshot
  END
FROM public.quotations q
WHERE q.id = p."quotationId"
  AND q."acceptedAt" IS NOT NULL;

-- Once locked, a booking's amount and currency cannot change.
CREATE OR REPLACE FUNCTION public.phase14_lock_booking_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.price_locked_at IS NOT NULL THEN
    IF NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot
      OR NEW.base_currency_snapshot IS DISTINCT FROM OLD.base_currency_snapshot
      OR NEW.exchange_rate_snapshot IS DISTINCT FROM OLD.exchange_rate_snapshot
      OR NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot
      OR NEW.price_locked_at IS DISTINCT FROM OLD.price_locked_at THEN
      RAISE EXCEPTION
        'Booking price and currency snapshots are immutable';
    END IF;

  ELSIF NEW.price_locked_at IS NOT NULL
    AND NEW.price_snapshot = '{}'::jsonb THEN
    NEW.price_snapshot := jsonb_build_object(
      'amount', NEW.amount,
      'currency', NEW.currency_snapshot,
      'captured_at', now()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phase14_lock_booking_snapshot
  ON public.bookings;

CREATE TRIGGER phase14_lock_booking_snapshot
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.phase14_lock_booking_snapshot();

REVOKE ALL
  ON FUNCTION public.phase14_lock_booking_snapshot()
  FROM public, anon, authenticated;

-- Payment transaction amounts and currency snapshots are immutable.
CREATE OR REPLACE FUNCTION public.phase14_lock_payment_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.currency_snapshot IS NOT NULL THEN
    IF NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW."settlementCurrency" IS DISTINCT FROM OLD."settlementCurrency"
      OR NEW.currency_snapshot IS DISTINCT FROM OLD.currency_snapshot
      OR NEW.base_currency_snapshot IS DISTINCT FROM OLD.base_currency_snapshot
      OR NEW.exchange_rate_snapshot IS DISTINCT FROM OLD.exchange_rate_snapshot
      OR NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot THEN
      RAISE EXCEPTION
        'Payment amount and currency snapshots are immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phase14_lock_payment_snapshot
  ON public.payments;

CREATE TRIGGER phase14_lock_payment_snapshot
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.phase14_lock_payment_snapshot();

REVOKE ALL
  ON FUNCTION public.phase14_lock_payment_snapshot()
  FROM public, anon, authenticated;

-- Manual rates require an authorized staff member and a real timestamp.
CREATE OR REPLACE FUNCTION public.phase14_set_manual_currency_rates(
  p_rates jsonb,
  p_source text DEFAULT 'manual admin configuration',
  p_fetched_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_permission('settings.manage') THEN
    RAISE EXCEPTION 'Not authorized to manage currency rates'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_rates) <> 'object'
     OR p_rates->>'INR' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION
      'Rates must be an object with INR equal to 1'
      USING ERRCODE = '22023';
  END IF;

  IF p_fetched_at > now() + interval '5 minutes'
     OR length(COALESCE(p_source, '')) > 160 THEN
    RAISE EXCEPTION
      'Invalid rate timestamp or source label'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_each_text(p_rates) r
    WHERE r.key !~ '^[A-Z]{3}$'
      OR r.key NOT IN (
        'INR','USD','EUR','GBP','AED','SGD','AUD','CAD',
        'JPY','CHF','NZD','HKD','SEK','NOK','DKK','BRL',
        'ZAR','THB','MYR','PHP','IDR'
      )
      OR r.value !~ '^[0-9]+(\.[0-9]{1,10})?$'
      OR r.value::numeric <= 0
  ) THEN
    RAISE EXCEPTION 'Invalid currency rate values'
      USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'fetchedAt', COALESCE(p_fetched_at, now()),
    'rates', p_rates,
    'source', COALESCE(
      NULLIF(trim(p_source), ''),
      'manual admin configuration'
    ),
    'status', 'manual',
    'baseCurrency', 'INR'
  );

  INSERT INTO public.settings(
    "settingKey",
    "settingValue",
    "updatedAt"
  )
  VALUES (
    'currency_rates_inr_v1',
    v_payload::text,
    now()
  )
  ON CONFLICT ("settingKey")
  DO UPDATE SET
    "settingValue" = EXCLUDED."settingValue",
    "updatedAt" = now();

  RETURN v_payload;
END;
$$;

REVOKE ALL
  ON FUNCTION public.phase14_set_manual_currency_rates(
    jsonb, text, timestamptz
  )
  FROM public, anon;

GRANT EXECUTE
  ON FUNCTION public.phase14_set_manual_currency_rates(
    jsonb, text, timestamptz
  )
  TO authenticated;

COMMIT;