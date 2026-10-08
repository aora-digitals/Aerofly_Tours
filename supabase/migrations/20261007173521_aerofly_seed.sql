-- ============================================================
-- AeroFly Tours seed data
-- ============================================================

-- ============================================================
-- TOUR CATEGORIES
-- ============================================================

INSERT INTO public.tour_categories
(slug, name, description, "imageUrl", accent)
VALUES
(
  'family',
  'Family Tours',
  'Easy-paced journeys designed around together time.',
  'https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?auto=format&fit=crop&w=1200&q=85',
  'orange'
),
(
  'honeymoon',
  'Honeymoon Escapes',
  'Thoughtful stays and private moments for two.',
  'https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=1200&q=85',
  'orange'
),
(
  'group',
  'Group Tours',
  'Well-coordinated departures with a warm, social rhythm.',
  'https://images.unsplash.com/photo-1477587458883-47145ed94245?auto=format&fit=crop&w=1200&q=85',
  'orange'
),
(
  'adventure',
  'Adventure Tours',
  'The kind of landscapes that make the route worthwhile.',
  'https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=1200&q=85',
  'orange'
),
(
  'weekend',
  'Weekend Getaways',
  'Short breaks with a considered itinerary.',
  'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=1200&q=85',
  'orange'
),
(
  'international',
  'International Tours',
  'Confident planning beyond the familiar.',
  'https://images.unsplash.com/photo-1518684079-3c830dcef090?auto=format&fit=crop&w=1200&q=85',
  'orange'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  "imageUrl" = EXCLUDED."imageUrl",
  accent = EXCLUDED.accent;


-- ============================================================
-- DESTINATIONS
-- ============================================================

INSERT INTO public.destinations
(slug, name, country, region, kind, tagline, description, "imageUrl", featured)
VALUES
(
  'goa',
  'Goa',
  'India',
  'West Coast',
  'domestic',
  'Sun, spice and slow coastal mornings.',
  'A relaxed coastal escape with beaches, food and Portuguese heritage.',
  'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=1200&q=85',
  true
),
(
  'kerala',
  'Kerala',
  'India',
  'South India',
  'domestic',
  'Backwaters, tea country and unhurried hospitality.',
  'A slower journey through backwaters, hills, heritage and local cuisine.',
  'https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?auto=format&fit=crop&w=1200&q=85',
  true
),
(
  'rajasthan',
  'Rajasthan',
  'India',
  'North India',
  'domestic',
  'Forts, desert light and living craft traditions.',
  'A story-rich journey through historic cities, forts and cultural landscapes.',
  'https://images.unsplash.com/photo-1477587458883-47145ed94245?auto=format&fit=crop&w=1200&q=85',
  true
),
(
  'himachal',
  'Himachal Pradesh',
  'India',
  'North India',
  'domestic',
  'Mountain air, pine trails and small-town warmth.',
  'A mountain escape with peaceful landscapes and outdoor experiences.',
  'https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=1200&q=85',
  false
),
(
  'dubai',
  'Dubai',
  'United Arab Emirates',
  'Gulf',
  'international',
  'A confident city break with sky-high possibilities.',
  'A modern city experience combining iconic architecture, desert landscapes and evening experiences.',
  'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1400&q=85',
  true
),
(
  'bali',
  'Bali',
  'Indonesia',
  'Southeast Asia',
  'international',
  'A softer island pace, from rice terraces to reef time.',
  'An island escape combining nature, culture, wellness and private stays.',
  'https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=1200&q=85',
  true
),
(
  'singapore',
  'Singapore',
  'Singapore',
  'Southeast Asia',
  'international',
  'Food, design and a city made for easy exploration.',
  'A polished city break built around food, culture and modern design.',
  'https://images.unsplash.com/photo-1518684079-3c830dcef090?auto=format&fit=crop&w=1200&q=85',
  false
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  country = EXCLUDED.country,
  region = EXCLUDED.region,
  kind = EXCLUDED.kind,
  tagline = EXCLUDED.tagline,
  description = EXCLUDED.description,
  "imageUrl" = EXCLUDED."imageUrl",
  featured = EXCLUDED.featured;


-- ============================================================
-- TOURS
-- ============================================================

INSERT INTO public.tours
(
  slug,
  title,
  "destinationId",
  "categoryId",
  "durationDays",
  "durationNights",
  "priceFrom",
  "originalPrice",
  rating,
  "reviewCount",
  overview,
  highlights,
  inclusions,
  exclusions,
  "imageUrl",
  tags,
  availability,
  status,
  featured
)
SELECT
  'dubai-city-lights',
  'Dubai City Lights',
  d.id,
  c.id,
  5,
  4,
  64900,
  74900,
  4.9,
  28,
  'A considered Dubai itinerary balancing iconic city moments with space to discover the city at your own pace.',
  ARRAY[
    'Burj Khalifa sunset',
    'Desert safari with dinner',
    'Marina evening cruise',
    'Airport transfers'
  ],
  ARRAY[
    '4 nights stay',
    'Daily breakfast',
    'Sightseeing transfers',
    'Travel assistance'
  ],
  ARRAY[
    'Airfare',
    'Personal expenses',
    'Optional activities'
  ],
  'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1400&q=85',
  ARRAY[
    'City break',
    'Family',
    'First-time Dubai'
  ],
  'Departures on request',
  'published',
  true
FROM public.destinations d
JOIN public.tour_categories c
  ON c.slug = 'international'
WHERE d.slug = 'dubai'
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  "destinationId" = EXCLUDED."destinationId",
  "categoryId" = EXCLUDED."categoryId",
  "durationDays" = EXCLUDED."durationDays",
  "durationNights" = EXCLUDED."durationNights",
  "priceFrom" = EXCLUDED."priceFrom",
  "originalPrice" = EXCLUDED."originalPrice",
  rating = EXCLUDED.rating,
  "reviewCount" = EXCLUDED."reviewCount",
  overview = EXCLUDED.overview,
  highlights = EXCLUDED.highlights,
  inclusions = EXCLUDED.inclusions,
  exclusions = EXCLUDED.exclusions,
  "imageUrl" = EXCLUDED."imageUrl",
  tags = EXCLUDED.tags,
  availability = EXCLUDED.availability,
  status = EXCLUDED.status,
  featured = EXCLUDED.featured;


INSERT INTO public.tours
(
  slug,
  title,
  "destinationId",
  "categoryId",
  "durationDays",
  "durationNights",
  "priceFrom",
  "originalPrice",
  rating,
  "reviewCount",
  overview,
  highlights,
  inclusions,
  exclusions,
  "imageUrl",
  tags,
  availability,
  status,
  featured
)
SELECT
  'kerala-slow-journey',
  'Kerala, The Slow Journey',
  d.id,
  c.id,
  6,
  5,
  38900,
  44900,
  4.8,
  36,
  'From Kochi''s old lanes to a private night on the backwaters, this is Kerala with time built in.',
  ARRAY[
    'Fort Kochi heritage walk',
    'Munnar tea gardens',
    'Private houseboat stay',
    'Local cuisine experience'
  ],
  ARRAY[
    '5 nights accommodation',
    'Breakfast and dinner',
    'Private vehicle',
    'Houseboat cruise'
  ],
  ARRAY[
    'Flights',
    'Lunches',
    'Travel insurance'
  ],
  'https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?auto=format&fit=crop&w=1200&q=85',
  ARRAY[
    'Backwaters',
    'Family',
    'Wellness'
  ],
  'Year-round',
  'published',
  true
FROM public.destinations d
JOIN public.tour_categories c
  ON c.slug = 'family'
WHERE d.slug = 'kerala'
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  "destinationId" = EXCLUDED."destinationId",
  "categoryId" = EXCLUDED."categoryId",
  "durationDays" = EXCLUDED."durationDays",
  "durationNights" = EXCLUDED."durationNights",
  "priceFrom" = EXCLUDED."priceFrom",
  "originalPrice" = EXCLUDED."originalPrice",
  rating = EXCLUDED.rating,
  "reviewCount" = EXCLUDED."reviewCount",
  overview = EXCLUDED.overview,
  highlights = EXCLUDED.highlights,
  inclusions = EXCLUDED.inclusions,
  exclusions = EXCLUDED.exclusions,
  "imageUrl" = EXCLUDED."imageUrl",
  tags = EXCLUDED.tags,
  availability = EXCLUDED.availability,
  status = EXCLUDED.status,
  featured = EXCLUDED.featured;


INSERT INTO public.tours
(
  slug,
  title,
  "destinationId",
  "categoryId",
  "durationDays",
  "durationNights",
  "priceFrom",
  "originalPrice",
  rating,
  "reviewCount",
  overview,
  highlights,
  inclusions,
  exclusions,
  "imageUrl",
  tags,
  availability,
  status,
  featured
)
SELECT
  'royal-rajasthan-trail',
  'The Royal Rajasthan Trail',
  d.id,
  c.id,
  8,
  7,
  52900,
  59900,
  4.7,
  22,
  'A story-rich circuit across Jaipur, Jodhpur and Udaipur, with hotels that let the architecture do some of the talking.',
  ARRAY[
    'Amber Fort',
    'Blue City lanes',
    'Lake Pichola boat ride',
    'Cultural evening'
  ],
  ARRAY[
    '7 nights stay',
    'Breakfast',
    'Private transfers',
    'Local guide'
  ],
  ARRAY[
    'Flights',
    'Monument fees',
    'Personal expenses'
  ],
  'https://images.unsplash.com/photo-1477587458883-47145ed94245?auto=format&fit=crop&w=1200&q=85',
  ARRAY[
    'Culture',
    'Heritage',
    'Group'
  ],
  'Monthly departures',
  'published',
  true
FROM public.destinations d
JOIN public.tour_categories c
  ON c.slug = 'group'
WHERE d.slug = 'rajasthan'
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  "destinationId" = EXCLUDED."destinationId",
  "categoryId" = EXCLUDED."categoryId",
  "durationDays" = EXCLUDED."durationDays",
  "durationNights" = EXCLUDED."durationNights",
  "priceFrom" = EXCLUDED."priceFrom",
  "originalPrice" = EXCLUDED."originalPrice",
  rating = EXCLUDED.rating,
  "reviewCount" = EXCLUDED."reviewCount",
  overview = EXCLUDED.overview,
  highlights = EXCLUDED.highlights,
  inclusions = EXCLUDED.inclusions,
  exclusions = EXCLUDED.exclusions,
  "imageUrl" = EXCLUDED."imageUrl",
  tags = EXCLUDED.tags,
  availability = EXCLUDED.availability,
  status = EXCLUDED.status,
  featured = EXCLUDED.featured;


INSERT INTO public.tours
(
  slug,
  title,
  "destinationId",
  "categoryId",
  "durationDays",
  "durationNights",
  "priceFrom",
  "originalPrice",
  rating,
  "reviewCount",
  overview,
  highlights,
  inclusions,
  exclusions,
  "imageUrl",
  tags,
  availability,
  status,
  featured
)
SELECT
  'bali-island-reset',
  'Bali Island Reset',
  d.id,
  c.id,
  7,
  6,
  71900,
  81900,
  4.9,
  31,
  'A gentle island rhythm for couples who want a little design, a little nature, and plenty of room to breathe.',
  ARRAY[
    'Ubud rice terraces',
    'Private pool villa',
    'Sunset temple visit',
    'Nusa Penida day trip'
  ],
  ARRAY[
    '6 nights stay',
    'Breakfast',
    'Private transfers',
    'Selected excursions'
  ],
  ARRAY[
    'Flights',
    'Visa fees',
    'Travel insurance'
  ],
  'https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=1200&q=85',
  ARRAY[
    'Honeymoon',
    'Island',
    'Private'
  ],
  'On request',
  'published',
  true
FROM public.destinations d
JOIN public.tour_categories c
  ON c.slug = 'honeymoon'
WHERE d.slug = 'bali'
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  "destinationId" = EXCLUDED."destinationId",
  "categoryId" = EXCLUDED."categoryId",
  "durationDays" = EXCLUDED."durationDays",
  "durationNights" = EXCLUDED."durationNights",
  "priceFrom" = EXCLUDED."priceFrom",
  "originalPrice" = EXCLUDED."originalPrice",
  rating = EXCLUDED.rating,
  "reviewCount" = EXCLUDED."reviewCount",
  overview = EXCLUDED.overview,
  highlights = EXCLUDED.highlights,
  inclusions = EXCLUDED.inclusions,
  exclusions = EXCLUDED.exclusions,
  "imageUrl" = EXCLUDED."imageUrl",
  tags = EXCLUDED.tags,
  availability = EXCLUDED.availability,
  status = EXCLUDED.status,
  featured = EXCLUDED.featured;


-- ============================================================
-- ITINERARIES
-- ============================================================

INSERT INTO public.tour_itineraries
("tourId", "dayNumber", title, description, meals, stay)
SELECT
  t.id,
  x.day_number,
  CASE
    WHEN x.day_number = 1 THEN 'Arrival & orientation'
    WHEN x.day_number = x.total_days THEN 'Departure'
    ELSE 'Day ' || x.day_number || ' — Explore at your pace'
  END,
  x.description,
  CASE
    WHEN x.day_number = 1 THEN 'Welcome drink'
    ELSE 'Breakfast'
  END,
  CASE
    WHEN x.day_number = x.total_days THEN '—'
    ELSE 'Handpicked stay'
  END
FROM public.tours t
JOIN (
  VALUES
    ('dubai-city-lights',1,'Arrive in Dubai and settle into your city stay.',5),
    ('dubai-city-lights',2,'Old Dubai and creekside stories with your local host.',5),
    ('dubai-city-lights',3,'A full day between the desert and the dunes.',5),
    ('dubai-city-lights',4,'Marina, Palm and a golden-hour skyline.',5),
    ('dubai-city-lights',5,'Breakfast, final shopping and departure.',5),

    ('kerala-slow-journey',1,'Arrive in Kochi and meet your trip coordinator.',6),
    ('kerala-slow-journey',2,'Fort Kochi heritage lanes and local flavours.',6),
    ('kerala-slow-journey',3,'Travel into Munnar''s tea country.',6),
    ('kerala-slow-journey',4,'Tea gardens, viewpoints and a slow afternoon.',6),
    ('kerala-slow-journey',5,'Transfer to Alleppey for your private houseboat.',6),
    ('kerala-slow-journey',6,'Wake on the backwaters and return home with time to spare.',6),

    ('royal-rajasthan-trail',1,'Arrive in Jaipur, the Pink City.',8),
    ('royal-rajasthan-trail',2,'Amber Fort and a first taste of old Jaipur.',8),
    ('royal-rajasthan-trail',3,'Travel to Jodhpur through changing desert light.',8),
    ('royal-rajasthan-trail',4,'Blue City walk and Mehrangarh Fort.',8),
    ('royal-rajasthan-trail',5,'Continue to Udaipur by road.',8),
    ('royal-rajasthan-trail',6,'Lake Pichola at sunset.',8),
    ('royal-rajasthan-trail',7,'A final cultural evening and unhurried breakfast.',8),
    ('royal-rajasthan-trail',8,'Departure with your route notes.',8),

    ('bali-island-reset',1,'Arrive in Bali and transfer to your Ubud stay.',7),
    ('bali-island-reset',2,'Rice terraces and a gentle village walk.',7),
    ('bali-island-reset',3,'A private day built around your pace.',7),
    ('bali-island-reset',4,'Move to the coast and reset by the sea.',7),
    ('bali-island-reset',5,'Nusa Penida day trip.',7),
    ('bali-island-reset',6,'Sunset, spa time and a last dinner.',7),
    ('bali-island-reset',7,'Breakfast and airport transfer.',7)
) AS x(slug, day_number, description, total_days)
ON t.slug = x.slug
WHERE NOT EXISTS (
  SELECT 1
  FROM public.tour_itineraries ti
  WHERE ti."tourId" = t.id
    AND ti."dayNumber" = x.day_number
);


-- ============================================================
-- BLOG POSTS
-- ============================================================

INSERT INTO public.blog_posts
(
  slug,
  title,
  excerpt,
  content,
  category,
  "imageUrl",
  author,
  status,
  "publishedAt"
)
VALUES
(
  'how-to-plan-a-kerala-holiday',
  'How to plan a Kerala holiday that still feels unhurried',
  'A practical way to balance backwaters, hills and beach time without turning the route into a checklist.',
  'Kerala rewards a little breathing room. Start with the landscape you want to wake up to, then let the route follow.',
  'Destination Guides',
  'https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?auto=format&fit=crop&w=1200&q=85',
  'AeroFly Editorial',
  'published',
  '2026-08-18'
),
(
  'first-time-dubai-notes',
  'First-time Dubai: the details worth planning ahead',
  'From airport transfers to choosing your neighbourhood, a few small decisions make the city feel much easier.',
  'Dubai is at its best when the big-ticket moments are balanced with a little local context and room to wander.',
  'Travel Guides',
  'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1400&q=85',
  'AeroFly Editorial',
  'published',
  '2026-08-05'
),
(
  'a-better-weekend-getaway',
  'A better weekend getaway starts before you leave',
  'Three questions to ask before choosing a short break from Pune, Mumbai or Bengaluru.',
  'Short trips need intention. Think about the feeling you want to bring home, not just the number of places you can tick off.',
  'Travel Tips',
  'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?auto=format&fit=crop&w=1200&q=85',
  'AeroFly Editorial',
  'published',
  '2026-07-22'
)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  excerpt = EXCLUDED.excerpt,
  content = EXCLUDED.content,
  category = EXCLUDED.category,
  "imageUrl" = EXCLUDED."imageUrl",
  author = EXCLUDED.author,
  status = EXCLUDED.status,
  "publishedAt" = EXCLUDED."publishedAt";


-- ============================================================
-- TESTIMONIALS
-- ============================================================

INSERT INTO public.testimonials
(name, destination, quote, rating, verified, published)
SELECT
  x.name,
  x.destination,
  x.quote,
  x.rating,
  x.verified,
  x.published
FROM (
  VALUES
  (
    'Development Guest',
    'Kerala',
    'Development testimonial placeholder.',
    5,
    false,
    false
  ),
  (
    'Development Guest',
    'Dubai',
    'Development testimonial placeholder.',
    5,
    false,
    false
  )
) AS x(name, destination, quote, rating, verified, published)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.testimonials t
  WHERE t.name = x.name
    AND t.destination = x.destination
);


-- ============================================================
-- SETTINGS
-- ============================================================

INSERT INTO public.settings
("settingKey", "settingValue")
VALUES
(
  'company_name',
  'AeroFly Tours'
),
(
  'city',
  'Pune, Maharashtra'
),
(
  'phone',
  '+91 20 0000 0000 · placeholder'
),
(
  'email',
  'hello@aeroflytours.com · placeholder'
),
(
  'whatsapp',
  'WhatsApp number to be configured'
),
(
  'footer_note',
  'Travel planning, thoughtfully coordinated from Pune.'
)
ON CONFLICT ("settingKey") DO UPDATE SET
  "settingValue" = EXCLUDED."settingValue";