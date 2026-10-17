BEGIN;

-- Extend the existing destination catalogue.
-- Existing coordinates are preserved; no coordinates are fabricated.
ALTER TABLE public.destinations
  ADD COLUMN IF NOT EXISTS map_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS location_source text,
  ADD COLUMN IF NOT EXISTS location_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS location_notes text;

-- Extend existing attractions rather than introducing a duplicate catalogue.
ALTER TABLE public.destination_attractions
  ADD COLUMN IF NOT EXISTS latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS longitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS location_type text NOT NULL DEFAULT 'attraction',
  ADD COLUMN IF NOT EXISTS map_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS location_source text,
  ADD COLUMN IF NOT EXISTS location_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS location_notes text,
  ADD COLUMN IF NOT EXISTS country_code char(2),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Validate new and modified coordinate pairs without blocking migration
-- on legacy records that may contain incomplete coordinates.
ALTER TABLE public.destination_attractions
  DROP CONSTRAINT IF EXISTS destination_attractions_coordinates_pair_check,
  ADD CONSTRAINT destination_attractions_coordinates_pair_check
    CHECK (
      (latitude IS NULL AND longitude IS NULL)
      OR (
        latitude BETWEEN -90 AND 90
        AND longitude BETWEEN -180 AND 180
      )
    ) NOT VALID,
  DROP CONSTRAINT IF EXISTS destination_attractions_location_type_check,
  ADD CONSTRAINT destination_attractions_location_type_check
    CHECK (
      location_type IN (
        'attraction',
        'hotel',
        'airport',
        'transport_hub',
        'restaurant',
        'activity',
        'other'
      )
    );

ALTER TABLE public.destinations
  DROP CONSTRAINT IF EXISTS destinations_coordinates_pair_check,
  ADD CONSTRAINT destinations_coordinates_pair_check
    CHECK (
      (latitude IS NULL AND longitude IS NULL)
      OR (
        latitude BETWEEN -90 AND 90
        AND longitude BETWEEN -180 AND 180
      )
    ) NOT VALID;

ALTER TABLE public.tour_itineraries
  DROP CONSTRAINT IF EXISTS tour_itineraries_coordinates_pair_check,
  ADD CONSTRAINT tour_itineraries_coordinates_pair_check
    CHECK (
      (latitude IS NULL AND longitude IS NULL)
      OR (
        latitude BETWEEN -90 AND 90
        AND longitude BETWEEN -180 AND 180
      )
    ) NOT VALID;

-- Keep spatially useful lookups bounded and index-backed.
CREATE INDEX IF NOT EXISTS destinations_map_visible_coords_idx
  ON public.destinations (map_visible, kind)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS attractions_map_visible_coords_idx
  ON public.destination_attractions (
    "destinationId",
    location_type,
    map_visible
  )
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS itinerary_map_coords_idx
  ON public.tour_itineraries ("tourId", "dayNumber")
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Replace legacy role-name policies with the existing permission system.
-- Public SELECT policies are retained.
DROP POLICY IF EXISTS destinations_staff_manage
  ON public.destinations;

DROP POLICY IF EXISTS destination_location_staff_update
  ON public.destinations;

DROP POLICY IF EXISTS destinations_staff_insert
  ON public.destinations;

DROP POLICY IF EXISTS destinations_staff_update
  ON public.destinations;

DROP POLICY IF EXISTS destinations_staff_delete
  ON public.destinations;

CREATE POLICY destination_location_staff_manage
  ON public.destinations
  FOR ALL TO authenticated
  USING (public.has_permission('tours.manage'))
  WITH CHECK (
    public.has_permission('tours.manage')
    AND (
      (latitude IS NULL AND longitude IS NULL)
      OR (
        latitude BETWEEN -90 AND 90
        AND longitude BETWEEN -180 AND 180
      )
    )
  );

DROP POLICY IF EXISTS destination_attractions_staff_manage
  ON public.destination_attractions;

DROP POLICY IF EXISTS attraction_location_staff_update
  ON public.destination_attractions;

CREATE POLICY attraction_location_staff_manage
  ON public.destination_attractions
  FOR ALL TO authenticated
  USING (public.has_permission('tours.manage'))
  WITH CHECK (
    public.has_permission('tours.manage')
    AND (
      (latitude IS NULL AND longitude IS NULL)
      OR (
        latitude BETWEEN -90 AND 90
        AND longitude BETWEEN -180 AND 180
      )
    )
  );

COMMIT;