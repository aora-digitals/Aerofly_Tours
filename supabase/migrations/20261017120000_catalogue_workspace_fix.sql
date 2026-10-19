
BEGIN;

-- Keep existing tour records and relationships intact.
ALTER TABLE public.tours
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

-- Existing Phase 2 schema has these structures; add only missing fields.
ALTER TABLE public.tour_itineraries
  ADD COLUMN IF NOT EXISTS activities text[],
  ADD COLUMN IF NOT EXISTS accommodation text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS longitude numeric(9,6);

ALTER TABLE public.destinations
  ADD COLUMN IF NOT EXISTS latitude numeric(9,6),
  ADD COLUMN IF NOT EXISTS longitude numeric(9,6);

-- Reject invalid coordinate pairs.
ALTER TABLE public.tour_itineraries
  DROP CONSTRAINT IF EXISTS tour_itineraries_coordinates_pair_check;

ALTER TABLE public.tour_itineraries
  ADD CONSTRAINT tour_itineraries_coordinates_pair_check
  CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (
      latitude BETWEEN -90 AND 90
      AND longitude BETWEEN -180 AND 180
    )
  ) NOT VALID;

ALTER TABLE public.destinations
  DROP CONSTRAINT IF EXISTS destinations_coordinates_pair_check;

ALTER TABLE public.destinations
  ADD CONSTRAINT destinations_coordinates_pair_check
  CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (
      latitude BETWEEN -90 AND 90
      AND longitude BETWEEN -180 AND 180
    )
  ) NOT VALID;

-- RLS must remain enabled.
ALTER TABLE public.tours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tour_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tour_itineraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tour_departures ENABLE ROW LEVEL SECURITY;

-- Ensure the owner/staff permission system remains authoritative.
-- These policies do not grant permissions to customers.
DROP POLICY IF EXISTS catalogue_tours_manage
  ON public.tours;

CREATE POLICY catalogue_tours_manage
ON public.tours
FOR ALL
TO authenticated
USING (public.has_permission('tours.manage'))
WITH CHECK (public.has_permission('tours.manage'));

DROP POLICY IF EXISTS catalogue_itineraries_manage
  ON public.tour_itineraries;

CREATE POLICY catalogue_itineraries_manage
ON public.tour_itineraries
FOR ALL
TO authenticated
USING (public.has_permission('tours.manage'))
WITH CHECK (public.has_permission('tours.manage'));

DROP POLICY IF EXISTS catalogue_media_manage
  ON public.tour_media;

CREATE POLICY catalogue_media_manage
ON public.tour_media
FOR ALL
TO authenticated
USING (public.has_permission('tours.manage'))
WITH CHECK (public.has_permission('tours.manage'));

DROP POLICY IF EXISTS catalogue_departures_manage
  ON public.tour_departures;

CREATE POLICY catalogue_departures_manage
ON public.tour_departures
FOR ALL
TO authenticated
USING (public.has_permission('tours.manage'))
WITH CHECK (public.has_permission('tours.manage'));


-- Remove known legacy staff-role upload policies if present.
-- Keep any required public-read policy for this bucket.
DROP POLICY IF EXISTS aerofly_catalogue_image_insert
  ON storage.objects;

DROP POLICY IF EXISTS aerofly_catalogue_image_update
  ON storage.objects;

DROP POLICY IF EXISTS aerofly_catalogue_image_delete
  ON storage.objects;

CREATE POLICY aerofly_catalogue_image_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'aerofly-public'
  AND (storage.foldername(name))[1] = 'tours'
  AND public.has_permission('tours.manage')
);

CREATE POLICY aerofly_catalogue_image_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'aerofly-public'
  AND (storage.foldername(name))[1] = 'tours'
  AND public.has_permission('tours.manage')
)
WITH CHECK (
  bucket_id = 'aerofly-public'
  AND (storage.foldername(name))[1] = 'tours'
  AND public.has_permission('tours.manage')
);

CREATE POLICY aerofly_catalogue_image_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'aerofly-public'
  AND (storage.foldername(name))[1] = 'tours'
  AND public.has_permission('tours.manage')
);


COMMIT;
