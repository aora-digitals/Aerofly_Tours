import { getDb } from "./db";

type TourListInput = {
  search?: string;
  kind?: "domestic" | "international";
  category?: string;
  destination?: string;
  minPrice?: number;
  maxPrice?: number;
  minDuration?: number;
  maxDuration?: number;
  travelType?: string;
  sort?: "featured" | "newest" | "price_asc" | "price_desc" | "duration" | "rating" | "popular" | "most_enquired";
  page?: number;
  pageSize?: number;
};

function fail(error: { message?: string }): never {
  console.error("Supabase catalogue error:", error);
  throw new Error(error?.message || "Catalogue request failed");
}

function mapTour(row: any) {
  const destination = Array.isArray(row.destinations) ? row.destinations[0] : row.destinations;
  const category = Array.isArray(row.tour_categories) ? row.tour_categories[0] : row.tour_categories;
  const metric = Array.isArray(row.tour_metrics) ? row.tour_metrics[0] : row.tour_metrics;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    durationDays: row.durationDays,
    durationNights: row.durationNights,
    priceFrom: row.priceFrom,
    originalPrice: row.originalPrice,
    rating: row.rating,
    reviewCount: row.reviewCount,
    overview: row.overview,
    highlights: row.highlights ?? [],
    inclusions: row.inclusions ?? [],
    exclusions: row.exclusions ?? [],
    imageUrl: row.imageUrl,
    galleryUrls: row.galleryUrls ?? [],
    tags: row.tags ?? [],
    availability: row.availability,
    status: row.status,
    featured: row.featured,
    isSeasonal: row.is_seasonal ?? false,
    seasonLabel: row.season_label ?? null,
    destination: destination?.name ?? null,
    destinationSlug: destination?.slug ?? null,
    country: destination?.country ?? null,
    kind: destination?.kind ?? null,
    region: destination?.region ?? null,
    category: category?.name ?? null,
    categorySlug: category?.slug ?? null,
    metrics: {
      views: Number(metric?.views ?? 0),
      enquiries: Number(metric?.enquiries ?? 0),
      bookings: Number(metric?.bookings ?? 0),
    },
  };
}

export async function listPublicTours(input: TourListInput = {}) {
  const db = getDb();
  const pageSize = Math.min(Math.max(input.pageSize ?? 12, 1), 48);
  const page = Math.max(input.page ?? 1, 1);

  let query = db
    .from("tours")
    .select(
      `
        id,
        slug,
        title,
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
        "galleryUrls",
        tags,
        availability,
        status,
        featured,
        "createdAt",
        is_seasonal,
        season_label,
        destinations!inner(id,slug,name,country,region,kind),
        tour_categories!inner(id,slug,name),
        tour_metrics("tourId",views,enquiries,bookings)
      `,
      { count: "exact" },
    )
    .eq("status", "published");

  if (input.kind) query = query.eq("destinations.kind", input.kind);
  if (input.category) query = query.eq("tour_categories.slug", input.category);
  if (input.destination) query = query.eq("destinations.slug", input.destination);
  if (input.minPrice !== undefined) query = query.gte("priceFrom", input.minPrice);
  if (input.maxPrice !== undefined) query = query.lte("priceFrom", input.maxPrice);
  if (input.minDuration !== undefined) query = query.gte("durationDays", input.minDuration);
  if (input.maxDuration !== undefined) query = query.lte("durationDays", input.maxDuration);
  if (input.travelType) query = query.contains("tags", [input.travelType]);

  if (input.search?.trim()) {
    const term = input.search.trim();
    const pattern = `%${term.replace(/[%_]/g, "\\$&")}%`;

    const [{ data: directMatches, error: directError }, { data: destinationMatches, error: destinationError }] = await Promise.all([
      db
        .from("tours")
        .select("id")
        .eq("status", "published")
        .or(`title.ilike.${pattern},overview.ilike.${pattern}`),
      db
        .from("destinations")
        .select("id")
        .or(`name.ilike.${pattern},country.ilike.${pattern},region.ilike.${pattern}`),
    ]);

    if (directError) fail(directError);
    if (destinationError) fail(destinationError);

    const destinationIds = (destinationMatches ?? []).map((row: any) => row.id);
    let destinationTourIds: number[] = [];

    if (destinationIds.length) {
      const { data, error } = await db
        .from("tours")
        .select("id")
        .eq("status", "published")
        .in("destinationId", destinationIds);
      if (error) fail(error);
      destinationTourIds = (data ?? []).map((row: any) => row.id);
    }

   const ids = Array.from(
  new Set([
    ...(directMatches ?? []).map((row: any) => row.id),
    ...destinationTourIds,
  ])
);

    if (!ids.length) return { items: [], page, pageSize, total: 0, totalPages: 0 };
    query = query.in("id", ids);
  }

  const sort = input.sort ?? "featured";
  if (sort === "price_asc") query = query.order("priceFrom", { ascending: true });
  else if (sort === "price_desc") query = query.order("priceFrom", { ascending: false });
  else if (sort === "duration") query = query.order("durationDays", { ascending: true });
  else if (sort === "rating") query = query.order("rating", { ascending: false });
  else if (sort === "newest") query = query.order("createdAt", { ascending: false });
  else query = query.order("featured", { ascending: false }).order("createdAt", { ascending: false });

  // Popularity sorts are handled after retrieving a bounded candidate set.
  const metricSort = sort === "popular" || sort === "most_enquired";
  if (metricSort) {
    query = query.range(0, Math.min(page * pageSize * 4, 199));
  } else {
    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);
  }

  const { data, error, count } = await query;
  if (error) fail(error);

  let items = (data ?? []).map(mapTour);
  if (sort === "popular") items.sort((a, b) => b.metrics.views - a.metrics.views);
  if (sort === "most_enquired") items.sort((a, b) => b.metrics.enquiries - a.metrics.enquiries);

  if (metricSort) {
    const from = (page - 1) * pageSize;
    items = items.slice(from, from + pageSize);
  }

  const total = count ?? items.length;
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getPublicTourBySlug(slug: string) {
  const db = getDb();
  const { data: row, error } = await db
    .from("tours")
    .select(
      `
        id,
        slug,
        title,
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
        "galleryUrls",
        tags,
        availability,
        status,
        featured,
        important_info,
        terms,
        meta_title,
        meta_description,
        is_seasonal,
        season_label,
        destinations!inner(id,slug,name,country,region,kind,tagline,description,latitude,longitude),
        tour_categories!inner(id,slug,name),
        tour_metrics("tourId",views,enquiries,bookings)
      `,
    )
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error) fail(error);
  if (!row) return undefined;

  const [itineraryResult, mediaResult, departuresResult, attractionsResult] = await Promise.all([
    db.from("tour_itineraries").select("*").eq("tourId", row.id).order("dayNumber", { ascending: true }),
    db.from("tour_media").select("*").eq("tourId", row.id).eq("is_public", true).order("sort_order", { ascending: true }),
    db.from("tour_departures").select("*").eq("tourId", row.id).neq("status", "cancelled").order("departure_date", { ascending: true }),
    db.from("destination_attractions").select("*").eq("destinationId", (row as any).destinations?.id).eq("is_public", true).order("sort_order", { ascending: true }),
  ]);

  if (itineraryResult.error) fail(itineraryResult.error);
  if (mediaResult.error) fail(mediaResult.error);
  if (departuresResult.error) fail(departuresResult.error);
  if (attractionsResult.error) fail(attractionsResult.error);

  const media = (mediaResult.data ?? []).map((item: any) => {
    if (item.public_url || !item.storage_path) return item;
    const { data: publicUrl } = db.storage.from("aerofly-public").getPublicUrl(item.storage_path);
    return { ...item, public_url: publicUrl.publicUrl };
  });

  const mapped = mapTour(row);
  return {
    ...mapped,
    importantInfo: (row as any).important_info ?? null,
    terms: (row as any).terms ?? null,
    metaTitle: (row as any).meta_title ?? null,
    metaDescription: (row as any).meta_description ?? null,
    media,
    departures: departuresResult.data ?? [],
    itinerary: itineraryResult.data ?? [],
    attractions: attractionsResult.data ?? [],
    destinationDetails: (row as any).destinations ?? null,
  };
}

export async function recordPublicTourView(tourId: number) {
  const db = getDb();
  const { error } = await db.rpc("increment_tour_view", { requested_tour_id: tourId });
  if (error) fail(error);
  return { success: true } as const;
}

export async function listPublicDestinations(input: {
  search?: string;
  kind?: "domestic" | "international";
  region?: string;
  featured?: boolean;
} = {}) {
  const db = getDb();
  let query = db
    .from("destinations")
    .select("*")
    .eq("is_active", true)
    .order("featured", { ascending: false })
    .order("name", { ascending: true });

  if (input.kind) query = query.eq("kind", input.kind);
  if (input.region) query = query.eq("region", input.region);
  if (input.featured !== undefined) query = query.eq("featured", input.featured);
  if (input.search?.trim()) {
    const pattern = `%${input.search.trim().replace(/[%_]/g, "\\$&")}%`;
    query = query.or(`name.ilike.${pattern},country.ilike.${pattern},region.ilike.${pattern},tagline.ilike.${pattern}`);
  }

  const { data, error } = await query;
  if (error) fail(error);
  return data ?? [];
}

export async function getPublicDestinationBySlug(slug: string) {
  const db = getDb();
  const { data: destination, error } = await db
    .from("destinations")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error) fail(error);
  if (!destination) return undefined;

  const [tours, attractions] = await Promise.all([
    listPublicTours({ destination: slug, page: 1, pageSize: 12, sort: "featured" }),
    db.from("destination_attractions").select("*").eq("destinationId", destination.id).eq("is_public", true).order("sort_order", { ascending: true }),
  ]);

  if (attractions.error) fail(attractions.error);

  return {
    ...destination,
    tours: tours.items,
    attractions: attractions.data ?? [],
  };
}

export async function listPublicCategories() {
  const db = getDb();
  const { data, error } = await db
    .from("tour_categories")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) fail(error);
  return data ?? [];
}

export async function listPublicServices() {
  const db = getDb();
  const { data, error } = await db
    .from("services")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) fail(error);
  return data ?? [];
}

export async function getPublicServiceBySlug(slug: string) {
  const db = getDb();
  const { data, error } = await db
    .from("services")
    .select("*")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) fail(error);
  return data ?? undefined;
}

export async function getPublicHomepage() {
  const [catalogue, destinations, categories, services] = await Promise.all([
    listPublicTours({ page: 1, pageSize: 48, sort: "newest" }),
    listPublicDestinations({}),
    listPublicCategories(),
    listPublicServices(),
  ]);

  const all = catalogue.items;

  return {
    featuredTours: all.filter((tour) => tour.featured).slice(0, 6),
    trendingTours: [...all].sort((a, b) => b.metrics.views - a.metrics.views).slice(0, 6),
    bestsellers: [...all].sort((a, b) => b.metrics.bookings - a.metrics.bookings || b.metrics.enquiries - a.metrics.enquiries).slice(0, 6),
    mostViewed: [...all].sort((a, b) => b.metrics.views - a.metrics.views).slice(0, 6),
    mostEnquired: [...all].sort((a, b) => b.metrics.enquiries - a.metrics.enquiries).slice(0, 6),
    recentlyAdded: [...all].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 6),
    activeTours: all.slice(0, 6),
    seasonalTours: all.filter((tour) => tour.isSeasonal || tour.tags.some((tag: string) => /season|summer|winter|monsoon|festive/i.test(tag))).slice(0, 6),
    domesticTours: all.filter((tour) => tour.kind === "domestic").slice(0, 6),
    internationalTours: all.filter((tour) => tour.kind === "international").slice(0, 6),
    honeymoonTours: all.filter((tour) => tour.categorySlug === "honeymoon").slice(0, 6),
    familyTours: all.filter((tour) => tour.categorySlug === "family").slice(0, 6),
    luxuryTours: all.filter((tour) => tour.tags.some((tag: string) => /luxury|premium/i.test(tag))).slice(0, 6),
    budgetTours: all.filter((tour) => Number(tour.priceFrom) < 50000).slice(0, 6),
    destinations,
    categories,
    services,
    recommendations: [],
  };
}
