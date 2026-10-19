
BEGIN;

ALTER TABLE public.tour_itineraries
  ADD COLUMN IF NOT EXISTS map_url text,
  ADD COLUMN IF NOT EXISTS street_view_url text,
  ADD COLUMN IF NOT EXISTS spots jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.tour_itineraries
  DROP CONSTRAINT IF EXISTS tour_itineraries_spots_array_check;

ALTER TABLE public.tour_itineraries
  ADD CONSTRAINT tour_itineraries_spots_array_check
  CHECK (jsonb_typeof(spots) = 'array')
  NOT VALID;

COMMIT;
