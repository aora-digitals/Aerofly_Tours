DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'destinations'
      AND column_name = 'map_visible'
  ) THEN
    RAISE EXCEPTION 'destinations.map_visible missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'destination_attractions'
      AND column_name = 'location_type'
  ) THEN
    RAISE EXCEPTION 'destination_attractions.location_type missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid =
      'public.destination_attractions'::regclass
      AND conname =
        'destination_attractions_coordinates_pair_check'
  ) THEN
    RAISE EXCEPTION
      'Attraction coordinate constraint missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'destination_attractions'
      AND policyname =
        'attraction_location_staff_manage'
  ) THEN
    RAISE EXCEPTION
      'Attraction location staff policy missing';
  END IF;
END $$;

SELECT
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'destinations',
    'destination_attractions',
    'tour_itineraries'
  )
  AND column_name IN (
    'latitude',
    'longitude',
    'map_visible',
    'location_source',
    'location_verified_at'
  )
ORDER BY table_name, ordinal_position;