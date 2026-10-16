BEGIN;

ALTER TABLE public.customer_preferences
  ADD COLUMN IF NOT EXISTS interests text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS personalization_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_consent_at timestamptz;

ALTER TABLE public.customer_preferences
  DROP CONSTRAINT IF EXISTS customer_preferences_interests_count_check,
  ADD CONSTRAINT customer_preferences_interests_count_check
    CHECK (cardinality(interests) <= 30);

ALTER TABLE public.customer_activity
  DROP CONSTRAINT IF EXISTS customer_activity_type_check;

ALTER TABLE public.customer_activity
  ADD CONSTRAINT customer_activity_type_check CHECK (
    activity_type IN (
      'tour_viewed',
      'destination_viewed',
      'wishlist_added',
      'wishlist_removed',
      'enquiry_started',
      'enquiry_submitted',
      'appointment_requested',
      'callback_requested',
      'tour_search',
      'recommendation_clicked',
      'recommendation_dismissed',
      'proposal_accepted'
    )
  );

CREATE INDEX IF NOT EXISTS customer_activity_tour_events_idx
  ON public.customer_activity (activity_type, created_at DESC, entity_id)
  WHERE entity_type = 'tour';

CREATE INDEX IF NOT EXISTS customer_preferences_personalization_idx
  ON public.customer_preferences (personalization_enabled, updated_at DESC);

-- Record only minimal recommendation events. No customer PII is stored here.
CREATE TABLE IF NOT EXISTS public.recommendation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN ('impression', 'click', 'dismiss')),
  tour_id integer NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'unknown'
    CHECK (
      source IN (
        'home',
        'tour_detail',
        'dashboard',
        'ai_assistant',
        'unknown'
      )
    ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recommendation_events_created_idx
  ON public.recommendation_events (created_at DESC, event_type);

CREATE INDEX IF NOT EXISTS recommendation_events_user_created_idx
  ON public.recommendation_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS recommendation_events_tour_idx
  ON public.recommendation_events (tour_id, created_at DESC);

ALTER TABLE public.recommendation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recommendation_events_insert_own
  ON public.recommendation_events;

CREATE POLICY recommendation_events_insert_own
  ON public.recommendation_events
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.customer_preferences cp
      WHERE cp.user_id = auth.uid()
        AND cp.personalization_enabled = true
    )
    AND EXISTS (
      SELECT 1
      FROM public.tours t
      WHERE t.id = tour_id
        AND t.status = 'published'
    )
  );

DROP POLICY IF EXISTS recommendation_events_select_own
  ON public.recommendation_events;

CREATE POLICY recommendation_events_select_own
  ON public.recommendation_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS recommendation_events_update_none
  ON public.recommendation_events;

CREATE POLICY recommendation_events_update_none
  ON public.recommendation_events
  FOR UPDATE TO authenticated
  USING (false);

DROP POLICY IF EXISTS recommendation_events_delete_none
  ON public.recommendation_events;

DROP POLICY IF EXISTS recommendation_events_delete_own
  ON public.recommendation_events;

CREATE POLICY recommendation_events_delete_own
  ON public.recommendation_events
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.recommendation_events FROM anon;
GRANT SELECT, INSERT, DELETE
  ON public.recommendation_events TO authenticated;

-- Automatically record enquiry submissions using the actual enquiry ID.
CREATE OR REPLACE FUNCTION public.phase13_record_enquiry_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_auth_id IS NOT NULL THEN
    INSERT INTO public.customer_activity (
      user_id,
      activity_type,
      entity_type,
      entity_id,
      metadata
    )
    VALUES (
      NEW.customer_auth_id,
      'enquiry_submitted',
      'enquiry',
      NEW.id::text,
      jsonb_build_object('source', 'enquiry_submission')
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phase13_enquiry_submitted_activity
  ON public.enquiries;

CREATE TRIGGER phase13_enquiry_submitted_activity
  AFTER INSERT ON public.enquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.phase13_record_enquiry_submission();

REVOKE ALL ON FUNCTION public.phase13_record_enquiry_submission()
  FROM public, anon, authenticated;

-- Record acceptance once when a quotation becomes accepted.
CREATE OR REPLACE FUNCTION public.phase13_record_proposal_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_enquiry_id integer;
BEGIN
  IF NEW."enquiryId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."acceptedAt" IS NULL
     OR (TG_OP = 'UPDATE' AND OLD."acceptedAt" IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT e.customer_auth_id, e.id
    INTO v_customer_id, v_enquiry_id
  FROM public.enquiries e
  WHERE e.id = NEW."enquiryId";

  IF v_customer_id IS NOT NULL THEN
    INSERT INTO public.customer_activity (
      user_id,
      activity_type,
      entity_type,
      entity_id,
      metadata
    )
    VALUES (
      v_customer_id,
      'proposal_accepted',
      'enquiry',
      v_enquiry_id::text,
      jsonb_build_object('source', 'booking_offer')
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phase13_proposal_accepted_activity
  ON public.quotations;

CREATE TRIGGER phase13_proposal_accepted_activity
  AFTER INSERT OR UPDATE OF "acceptedAt" ON public.quotations
  FOR EACH ROW
  EXECUTE FUNCTION public.phase13_record_proposal_acceptance();

REVOKE ALL ON FUNCTION public.phase13_record_proposal_acceptance()
  FROM public, anon, authenticated;

-- Return aggregates, not customer-level event records.
CREATE OR REPLACE FUNCTION public.phase13_recommendation_analytics(
  p_from timestamptz DEFAULT now() - interval '30 days',
  p_to timestamptz DEFAULT now(),
  p_organization_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_from timestamptz := COALESCE(p_from, now() - interval '30 days');
  v_to timestamptz := COALESCE(p_to, now());
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_permission('reports.read', p_organization_id) THEN
    RAISE EXCEPTION 'Not authorized to view recommendation analytics'
      USING ERRCODE = '42501';
  END IF;

  IF v_to <= v_from
     OR v_to - v_from > interval '366 days' THEN
    RAISE EXCEPTION 'Invalid analytics date range'
      USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),

    'activity', COALESCE((
      SELECT jsonb_object_agg(activity_type, event_count)
      FROM (
        SELECT activity_type, count(*)::bigint AS event_count
        FROM public.customer_activity
        WHERE created_at >= v_from
          AND created_at < v_to
          AND activity_type IN (
            'tour_viewed',
            'tour_search',
            'wishlist_added',
            'wishlist_removed',
            'enquiry_submitted',
            'proposal_accepted'
          )
          AND (
            activity_type IN (
              'tour_viewed',
              'tour_search',
              'wishlist_added',
              'wishlist_removed'
            )
            OR (
              activity_type IN ('enquiry_submitted', 'proposal_accepted')
              AND entity_type = 'enquiry'
              AND EXISTS (
                SELECT 1
                FROM public.enquiries e
                WHERE e.id::text = customer_activity.entity_id
                  AND (
                    p_organization_id IS NULL
                    OR (
                      public.crm_enquiry_organization(e.id) = p_organization_id
                      AND public.crm_can_access_enquiry(e.id)
                    )
                  )
              )
            )
          )
        GROUP BY activity_type
      ) activity_counts
    ), '{}'::jsonb),

    'recommendations', COALESCE((
      SELECT jsonb_build_object(
        'impressions',
          count(*) FILTER (WHERE event_type = 'impression'),
        'clicks',
          count(*) FILTER (WHERE event_type = 'click'),
        'dismissals',
          count(*) FILTER (WHERE event_type = 'dismiss'),
        'click_through_rate',
          CASE
            WHEN count(*) FILTER (WHERE event_type = 'impression') = 0
              THEN 0
            ELSE round(
              (
                count(*) FILTER (WHERE event_type = 'click')
              )::numeric * 100 /
              count(*) FILTER (WHERE event_type = 'impression'),
              2
            )
          END
      )
      FROM public.recommendation_events
      WHERE created_at >= v_from
        AND created_at < v_to
    ), '{"impressions":0,"clicks":0,"dismissals":0,"click_through_rate":0}'::jsonb),

    'popular_tours', COALESCE((
      SELECT jsonb_agg(to_jsonb(popular))
      FROM (
        SELECT
          t.id AS tour_id,
          t.title,
          count(*)::bigint AS interactions
        FROM public.recommendation_events re
        JOIN public.tours t ON t.id = re.tour_id
        WHERE re.created_at >= v_from
          AND re.created_at < v_to
          AND t.status = 'published'
        GROUP BY t.id, t.title
        ORDER BY interactions DESC, t.title
        LIMIT 10
      ) popular
    ), '[]'::jsonb),

    'popular_destinations',
      CASE
        WHEN p_organization_id IS NOT NULL THEN '[]'::jsonb
        ELSE COALESCE((
          SELECT jsonb_agg(to_jsonb(popular))
          FROM (
            SELECT
              d.name AS destination,
              count(*)::bigint AS interactions
            FROM public.recommendation_events re
            JOIN public.tours t ON t.id = re.tour_id
            JOIN public.destinations d ON d.id = t."destinationId"
            WHERE re.created_at >= v_from
              AND re.created_at < v_to
              AND t.status = 'published'
            GROUP BY d.name
            ORDER BY interactions DESC, d.name
            LIMIT 10
          ) popular
        ), '[]'::jsonb)
      END,

    'popular_categories',
      CASE
        WHEN p_organization_id IS NOT NULL THEN '[]'::jsonb
        ELSE COALESCE((
          SELECT jsonb_agg(to_jsonb(popular))
          FROM (
            SELECT
              c.name AS category,
              count(*)::bigint AS interactions
            FROM public.recommendation_events re
            JOIN public.tours t ON t.id = re.tour_id
            JOIN public.tour_categories c ON c.id = t."categoryId"
            WHERE re.created_at >= v_from
              AND re.created_at < v_to
              AND t.status = 'published'
            GROUP BY c.name
            ORDER BY interactions DESC, c.name
            LIMIT 10
          ) popular
        ), '[]'::jsonb)
      END,

    'customer_interests',
      CASE
        WHEN p_organization_id IS NOT NULL THEN '[]'::jsonb
        ELSE COALESCE((
          SELECT jsonb_agg(to_jsonb(interest_count))
          FROM (
            SELECT
              interest,
              count(*)::bigint AS customers
            FROM public.customer_preferences cp
            CROSS JOIN LATERAL unnest(cp.interests) AS interest
            WHERE cp.personalization_enabled = true
              AND cardinality(cp.interests) > 0
            GROUP BY interest
            ORDER BY customers DESC, interest
            LIMIT 15
          ) interest_count
        ), '[]'::jsonb)
      END,

    'enquiry_funnel', jsonb_build_object(
      'enquiries', (
        SELECT count(*)
        FROM public.enquiries e
        WHERE e."createdAt" >= v_from
          AND e."createdAt" < v_to
          AND (
            p_organization_id IS NULL
            OR (
              public.crm_enquiry_organization(e.id) = p_organization_id
              AND public.crm_can_access_enquiry(e.id)
            )
          )
      ),
      'proposals', (
        SELECT count(*)
        FROM public.quotations q
        WHERE q."createdAt" >= v_from
          AND q."createdAt" < v_to
          AND q."enquiryId" IS NOT NULL
          AND (
            p_organization_id IS NULL
            OR (
              public.crm_quotation_organization(q.id) = p_organization_id
              AND public.crm_can_access_enquiry(q."enquiryId")
            )
          )
      ),
      'accepted_proposals', (
        SELECT count(*)
        FROM public.quotations q
        WHERE q."acceptedAt" >= v_from
          AND q."acceptedAt" < v_to
          AND q."enquiryId" IS NOT NULL
          AND (
            p_organization_id IS NULL
            OR (
              public.crm_quotation_organization(q.id) = p_organization_id
              AND public.crm_can_access_enquiry(q."enquiryId")
            )
          )
      )
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.phase13_recommendation_analytics(
  timestamptz, timestamptz, uuid
) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.phase13_recommendation_analytics(
  timestamptz, timestamptz, uuid
) TO authenticated;

COMMIT;