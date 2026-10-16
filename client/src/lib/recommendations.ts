import { supabase } from "@/lib/supabase";
import type {
  RecommendationPreferences,
  RecommendationTour,
} from "@/lib/recommendation-scoring";

export { scoreTours } from "@/lib/recommendation-scoring";

export type {
  RecommendationPreferences,
  RecommendationTour,
  ScoredRecommendation,
} from "@/lib/recommendation-scoring";

export type TourRecommendation = {
  tour: RecommendationTour;
  reasons: string[];
  score: number;
};

type Preferences = {
  travel_scope?: string;
  preferred_destinations?: string[];
  travel_styles?: string[];
  interests?: string[];
  budget_min?: number | null;
  budget_max?: number | null;
  personalization_enabled?: boolean;
};

type Source =
  | "home"
  | "tour_detail"
  | "dashboard"
  | "customer_dashboard"
  | "ai_assistant"
  | "search"
  | "site";

const clean = (value: unknown) =>
  String(value ?? "").toLocaleLowerCase().trim();

const words = (values: unknown[]) =>
  values
    .flatMap((value) => clean(value).split(/[^a-z0-9]+/))
    .filter((value) => value.length > 2);

function getAnonymousSessionId(): string {
  const key = "aerofly-recommendation-session";

  let id = sessionStorage.getItem(key);

  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }

  return id;
}

function fallback(
  tours: RecommendationTour[],
  limit: number
): TourRecommendation[] {
  return [...tours]
    .sort(
      (a, b) =>
        Number(Boolean(b.featured)) - Number(Boolean(a.featured)) ||
        Number(b.rating ?? 0) - Number(a.rating ?? 0)
    )
    .slice(0, limit)
    .map((tour) => ({
      tour,
      score: 0,
      reasons: [
        tour.featured
          ? "A featured AeroFly journey"
          : "A popular option to explore",
      ],
    }));
}

export async function trackRecommendationEvent(
  userId: string | null | undefined,
  tourId: number,
  eventType: "impression" | "click" | "dismiss",
  source:
    | "home"
    | "tour_detail"
    | "dashboard"
    | "ai_assistant"
    | "unknown",
) {
  if (
    !userId ||
    !Number.isInteger(tourId) ||
    tourId <= 0
  ) {
    return;
  }

  const {
    data: preferences,
    error: preferenceError,
  } = await supabase
    .from("customer_preferences")
    .select("personalization_enabled")
    .eq("user_id", userId)
    .maybeSingle();

  if (
    preferenceError ||
    !preferences?.personalization_enabled
  ) {
    return;
  }

  const { error } = await supabase
    .from("recommendation_events")
    .insert({
      user_id: userId,
      tour_id: tourId,
      event_type: eventType,
      source,
    });

  if (error && import.meta.env.DEV) {
    console.warn(
      "Recommendation event was not recorded",
      error.code,
    );
  }
}

export function rememberAnonymousTourView(
  tourId: number,
) {
  if (
    typeof window === "undefined" ||
    !Number.isInteger(tourId) ||
    tourId <= 0
  ) {
    return;
  }

  try {
    const previous = JSON.parse(
      window.sessionStorage.getItem(
        "aerofly:anonymous-tour-views",
      ) ?? "[]",
    ) as unknown;

    const ids = Array.isArray(previous)
      ? previous
          .map(Number)
          .filter(
            (id) =>
              Number.isInteger(id) && id > 0,
          )
      : [];

    window.sessionStorage.setItem(
      "aerofly:anonymous-tour-views",
      JSON.stringify(
        [
          tourId,
          ...ids.filter((id) => id !== tourId),
        ].slice(0, 30),
      ),
    );
  } catch {
    // Anonymous session context is optional.
  }
}

export function getAnonymousRecommendationContext() {
  if (typeof window === "undefined") {
    return {
      preferences: null,
      wishlistIds: [],
      recentlyViewedIds: [],
      dismissedIds: [],
    };
  }

  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(
        "aerofly:anonymous-tour-views",
      ) ?? "[]",
    ) as unknown;

    const ids = Array.isArray(parsed)
      ? parsed
          .map(Number)
          .filter(
            (id) =>
              Number.isInteger(id) && id > 0,
          )
      : [];

    return {
      preferences: null,
      wishlistIds: [] as number[],
      recentlyViewedIds: ids,
      dismissedIds: [] as number[],
    };
  } catch {
    return {
      preferences: null,
      wishlistIds: [] as number[],
      recentlyViewedIds: [] as number[],
      dismissedIds: [] as number[],
    };
  }
}

export async function loadRecommendationContext(
  userId: string,
) {
  const preferencesResult = await supabase
    .from("customer_preferences")
    .select(
      [
        "travel_scope",
        "preferred_destinations",
        "travel_styles",
        "interests",
        "budget_min",
        "budget_max",
        "personalization_enabled",
      ].join(","),
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (
    preferencesResult.error &&
    preferencesResult.error.code !== "PGRST116"
  ) {
    throw preferencesResult.error;
  }

  const preferences =
    preferencesResult.data as
      | RecommendationPreferences
      | null;

  if (!preferences?.personalization_enabled) {
    return {
      preferences: null,
      wishlistIds: [],
      recentlyViewedIds: [],
      dismissedIds: [],
    };
  }

  // Behavioural data is read only after explicit opt-in.
  const [
    wishlistResult,
    activityResult,
    eventsResult,
  ] = await Promise.all([
    supabase
      .from("wishlists")
      .select("tour_id")
      .eq("user_id", userId)
      .limit(100),

    supabase
      .from("customer_activity")
      .select(
        "entity_id,activity_type,created_at",
      )
      .eq("user_id", userId)
      .eq("entity_type", "tour")
      .order("created_at", { ascending: false })
      .limit(100),

    supabase
      .from("recommendation_events")
      .select("tour_id,event_type,created_at")
      .eq("user_id", userId)
      .eq("event_type", "dismiss")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (wishlistResult.error) {
    throw wishlistResult.error;
  }

  if (activityResult.error) {
    throw activityResult.error;
  }

  if (eventsResult.error) {
    throw eventsResult.error;
  }

  return {
    preferences,
    wishlistIds: (wishlistResult.data ?? []).map(
      (row) => Number(row.tour_id),
    ),
    recentlyViewedIds: (activityResult.data ?? [])
      .filter(
        (row) => row.activity_type === "tour_viewed",
      )
      .map((row) => Number(row.entity_id))
      .filter(Number.isFinite),
    dismissedIds: (eventsResult.data ?? []).map(
      (row) => Number(row.tour_id),
    ),
  };
}

export async function getTourRecommendations(input: {
  tours: RecommendationTour[];
  userId?: string | null;
  limit?: number;
  source?: Source;
}): Promise<TourRecommendation[]> {
  const limit = Math.min(12, Math.max(1, input.limit ?? 6));

  const candidates = input.tours.filter(
  (tour): tour is RecommendationTour & { id: number } =>
    typeof tour.id === "number" &&
    Number.isInteger(tour.id) &&
    tour.id > 0 &&
    Boolean(tour.slug) &&
    Boolean(tour.title) &&
    (!tour.status || tour.status === "published") &&
    !/sold.?out|unavailable|inactive/i.test(
      String(tour.availability ?? ""),
    ),
);

  let preferences: Preferences = {};
  let activity: Array<{
    entity_id: string | null;
    activity_type: string;
  }> = [];
  let wishlistIds: number[] = [];

  if (input.userId) {
    const [preferencesResult, activityResult, wishlistResult] =
      await Promise.all([
        supabase
          .from("customer_preferences")
          .select(
            "travel_scope,preferred_destinations,travel_styles,interests,budget_min,budget_max,personalization_enabled"
          )
          .eq("user_id", input.userId)
          .maybeSingle(),

        supabase
          .from("customer_activity")
          .select("entity_id,activity_type")
          .eq("user_id", input.userId)
          .in("activity_type", [
            "tour_viewed",
            "wishlist_added",
            "enquiry_submitted",
          ])
          .order("created_at", { ascending: false })
          .limit(40),

        supabase
          .from("wishlists")
          .select("tour_id")
          .eq("user_id", input.userId)
          .limit(100),
      ]);

    preferences = (preferencesResult.data ?? {}) as Preferences;
    activity = activityResult.data ?? [];
    wishlistIds = (wishlistResult.data ?? []).map((row) =>
      Number(row.tour_id)
    );

    if (preferences.personalization_enabled === false) {
      return fallback(candidates, limit);
    }
  }

  const recentlyViewed = new Set(
    activity
      .filter((event) => event.activity_type === "tour_viewed")
      .map((event) => Number(event.entity_id))
      .filter(Number.isFinite)
  );

  const wishlisted = new Set(wishlistIds);

  const interests = new Set(
    words([
      ...(preferences.interests ?? []),
      ...(preferences.travel_styles ?? []),
    ])
  );

  const destinations = new Set(
    (preferences.preferred_destinations ?? []).map(clean)
  );

  const ranked = candidates
    .map((tour) => {
      let score = 0;
      const reasons: string[] = [];

      if (tour.destination && destinations.has(clean(tour.destination))) {
        score += 35;
        reasons.push("Matches your preferred destination");
      }

      const tags = Array.isArray(tour.tags)
        ? tour.tags
        : typeof tour.tags === "string"
          ? (tour.tags as unknown as string).split(",")
          : [];

      const tourWords = new Set(
        words([tour.category, ...tags, tour.title])
      );

      const matchedInterests = Array.from(interests).filter((word) =>
  tourWords.has(word)
);

      if (matchedInterests.length) {
        score += Math.min(30, matchedInterests.length * 10);
        reasons.push(
          `Matches your interests: ${matchedInterests.slice(0, 2).join(", ")}`
        );
      }

      const price = Number(tour.priceFrom);

      if (
        Number.isFinite(price) &&
        price > 0 &&
        (preferences.budget_min != null ||
          preferences.budget_max != null)
      ) {
        const fitsMinimum =
          preferences.budget_min == null ||
          price >= Number(preferences.budget_min);

        const fitsMaximum =
          preferences.budget_max == null ||
          price <= Number(preferences.budget_max);

        if (fitsMinimum && fitsMaximum) {
          score += 20;
          reasons.push("Fits your preferred budget");
        } else if (
          preferences.budget_max != null &&
          price > Number(preferences.budget_max)
        ) {
          score -= 20;
        }
      }

      if (
        preferences.travel_scope === "domestic" &&
        clean(tour.kind) === "domestic"
      ) {
        score += 10;
        reasons.push("Matches your domestic travel preference");
      }

      if (
        preferences.travel_scope === "international" &&
        clean(tour.kind) === "international"
      ) {
        score += 10;
        reasons.push("Matches your international travel preference");
      }

      if (wishlisted.has(tour.id)) {
        score += 12;
        reasons.push("You saved this tour");
      }

      if (recentlyViewed.has(tour.id)) {
        score += 5;
      }

      if (tour.featured) score += 4;

      score += Math.min(5, Number(tour.rating ?? 0));

      return {
        tour,
        score,
        reasons:
          reasons.length > 0
            ? reasons
            : [
                tour.featured
                  ? "A featured AeroFly journey"
                  : "A popular option to explore",
              ],
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.tour.rating ?? 0) - Number(a.tour.rating ?? 0)
    );

  const results = ranked.slice(0, limit);

  if (results.length && input.source && typeof window !== "undefined") {
    const sessionId = getAnonymousSessionId();

    const key = `aerofly-impressions:${input.userId ?? sessionId}:${input.source}`;

    let seen = new Set<string>();

    try {
      seen = new Set(
        JSON.parse(sessionStorage.getItem(key) ?? "[]") as string[]
      );
    } catch {
      seen = new Set();
    }

    const fresh = results.filter(
      ({ tour }) => !seen.has(String(tour.id))
    );

    fresh.forEach(({ tour }) => seen.add(String(tour.id)));

    sessionStorage.setItem(
  key,
  JSON.stringify(Array.from(seen).slice(-200))
);

    if (fresh.length) {
      void supabase
        .from("recommendation_events")
        .insert(
          fresh.map(({ tour }) => ({
            user_id: input.userId ?? null,
            session_id: input.userId ? null : sessionId,
            event_type: "recommendation_impression",
            tour_id: tour.id,
            source: input.source,
          }))
        )
        .then(() => undefined);
    }
  }

  return results;
}

export async function recordRecommendationEvent(input: {
  eventType:
    | "tour_view"
    | "tour_search"
    | "wishlist_add"
    | "wishlist_remove"
    | "enquiry_submit"
    | "recommendation_click";
  tourId?: number;
  userId?: string | null;
  source?: Source;
}): Promise<void> {
  const sessionId =
    input.userId || typeof window === "undefined"
      ? null
      : getAnonymousSessionId();

  const { error } = await supabase
    .from("recommendation_events")
    .insert({
      user_id: input.userId ?? null,
      session_id: sessionId,
      event_type: input.eventType,
      tour_id: input.tourId ?? null,
      source: input.source ?? "site",
    });

  if (error) throw error;
}