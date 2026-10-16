export type RecommendationTour = {
  id?: number;
  slug: string;
  title: string;
  destination?: string | null;
  country?: string | null;
  durationDays?: number | null;
  durationNights?: number | null;
  priceFrom?: string | number | null;
  rating?: string | number | null;
  reviewCount?: number | null;
  featured?: boolean | null;
  status?: string | null;
  availability?: string | null;
  category?: string | null;
  tags?: string | string[] | null;
  kind?: string | null;
  imageUrl?: string | null;
};

export type RecommendationPreferences = {
  travel_scope?: string;
  preferred_destinations?: string[];
  travel_styles?: string[];
  interests?: string[];
  budget_min?: number | null;
  budget_max?: number | null;
  personalization_enabled?: boolean;
};

export type ScoredRecommendation<T extends RecommendationTour> = {
  tour: T;
  score: number;
  reasons: string[];
};

const normalize = (value: unknown) =>
  String(value ?? "").trim().toLocaleLowerCase();

const list = (
  value: string | string[] | null | undefined,
): string[] =>
  Array.isArray(value)
    ? value.map(normalize).filter(Boolean)
    : typeof value === "string"
      ? value.split(/[,|]/).map(normalize).filter(Boolean)
      : [];

export function scoreTours<T extends RecommendationTour>(
  tours: T[],
  preferences: RecommendationPreferences | null,
  options: {
    wishlistIds?: number[];
    recentlyViewedIds?: number[];
    dismissedIds?: number[];
    limit?: number;
  } = {},
): ScoredRecommendation<T>[] {
  const wishlist = new Set(options.wishlistIds ?? []);

  const recentRank = new Map(
    (options.recentlyViewedIds ?? []).map((id, index) => [
      id,
      index,
    ]),
  );

  const dismissed = new Set(options.dismissedIds ?? []);
  const personal = Boolean(
    preferences?.personalization_enabled,
  );

  const destinations = (
    preferences?.preferred_destinations ?? []
  ).map(normalize);

  const styles = [
    ...(preferences?.travel_styles ?? []),
    ...(preferences?.interests ?? []),
  ].map(normalize);

  const min =
    preferences?.budget_min == null
      ? null
      : Number(preferences.budget_min);

  const max =
    preferences?.budget_max == null
      ? null
      : Number(preferences.budget_max);

  return tours
    .filter(
      (tour) =>
        tour.id !== undefined && tour.id !== null,
    )
    .filter(
      (tour) => !dismissed.has(Number(tour.id)),
    )
    .filter(
      (tour) =>
        !tour.status ||
        ["published", "active"].includes(
          normalize(tour.status),
        ),
    )
    .filter(
      (tour) =>
        !tour.availability ||
        !/sold.?out|unavailable|inactive|cancelled/i.test(
          tour.availability,
        ),
    )
    .map((tour) => {
      let score = 0;
      const reasons: string[] = [];

      const destination = normalize(tour.destination);

      const haystack = [
        tour.title,
        tour.category,
        ...list(tour.tags),
      ].map(normalize);

      if (
        personal &&
        destinations.some(
          (value) =>
            destination.includes(value) ||
            value.includes(destination),
        )
      ) {
        score += 35;
        reasons.push(
          "Matches your preferred destinations",
        );
      }

      if (
        personal &&
        styles.some((style) =>
          haystack.some(
            (item) =>
              item.includes(style) ||
              style.includes(item),
          ),
        )
      ) {
        score += 25;
        reasons.push(
          "Matches your interests or travel style",
        );
      }

      const price = Number(tour.priceFrom);

      if (
        personal &&
        Number.isFinite(price) &&
        (min !== null || max !== null)
      ) {
        if (
          (min === null || price >= min) &&
          (max === null || price <= max)
        ) {
          score += 25;
          reasons.push("Fits your budget range");
        } else if (max !== null && price > max) {
          score -= Math.min(
            20,
            ((price - max) / Math.max(max, 1)) * 10,
          );
        }
      }

      if (
        personal &&
        preferences?.travel_scope &&
        preferences.travel_scope !== "both"
      ) {
        const isDomestic =
          normalize(tour.kind) === "domestic";

        if (
          (preferences.travel_scope === "domestic") ===
          isDomestic
        ) {
          score += 10;
          reasons.push("Matches your travel preference");
        }
      }

      if (wishlist.has(Number(tour.id))) {
        score += 12;
        reasons.push("Related to a journey you saved");
      }

      const recentPosition = recentRank.get(
        Number(tour.id),
      );

      if (recentPosition !== undefined) {
        score -= Math.max(
          2,
          12 - recentPosition * 1.5,
        );
      }

      score += tour.featured ? 5 : 0;

      score +=
        Math.max(
          0,
          Math.min(5, Number(tour.rating ?? 0)),
        ) * 0.5;

      const popularity = Math.min(
        8,
        Math.log10(
          Math.max(0, Number(tour.reviewCount ?? 0)) + 1,
        ) * 3,
      );

      score += popularity;

      if (Number(tour.reviewCount ?? 0) >= 25) {
        reasons.push("Popular with other travellers");
      }

      if (reasons.length === 0) {
        reasons.push(
          tour.featured
            ? "A featured AeroFly journey"
            : "A popular option to explore",
        );
      }

      return { tour, score, reasons };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.tour.rating ?? 0) -
          Number(a.tour.rating ?? 0),
    )
    .slice(
      0,
      Math.max(1, Math.min(12, options.limit ?? 6)),
    );
}