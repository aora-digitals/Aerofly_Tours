import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Sparkles, X } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import TourCard from "@/components/site/TourCard";
import {
  getAnonymousRecommendationContext,
  loadRecommendationContext,
  scoreTours,
  trackRecommendationEvent,
  type RecommendationPreferences,
  type RecommendationTour,
} from "@/lib/recommendations";

// type DisplayTour = RecommendationTour & {
//   id: number;
//   slug: string;
//   title: string;
//   destination: string;
//   country: string;
//   durationDays: number;
//   durationNights: number;
//   priceFrom: number | string;
//   rating: number | string;
//   reviewCount: number;
//   imageUrl: string;
//   originalPrice?: number | string | null;
// };

type RecommendationContext = {
  preferences: RecommendationPreferences | null;
  wishlistIds: number[];
  recentlyViewedIds: number[];
  dismissedIds: number[];
};

export default function PersonalizedTourRecommendations({
  tours,
  source = "home",
  title = "Journeys picked for you",
  limit = 4,
}: {
  tours: RecommendationTour[];
  source?: "home" | "tour_detail" | "dashboard" | "ai_assistant";
  title?: string;
  limit?: number;
}) {
  const { user } = useAuth();

  const [context, setContext] =
    useState<RecommendationContext>({
      preferences: null,
      wishlistIds: [],
      recentlyViewedIds: [],
      dismissedIds: [],
    });

  const [contextReady, setContextReady] = useState(false);

  useEffect(() => {
    let active = true;

    setContextReady(false);

    if (!user?.id) {
      setContext(getAnonymousRecommendationContext());
      setContextReady(true);

      return () => {
        active = false;
      };
    }

    void loadRecommendationContext(user.id)
      .then((result) => {
        if (active) setContext(result);
      })
      .catch(() => {
        if (active) {
          setContext({
            preferences: null,
            wishlistIds: [],
            recentlyViewedIds: [],
            dismissedIds: [],
          });
        }
      })
      .finally(() => {
        if (active) setContextReady(true);
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  const recommendations = useMemo(
    () =>
      scoreTours(tours, context.preferences, {
        wishlistIds: context.wishlistIds,
        recentlyViewedIds: context.recentlyViewedIds,
        dismissedIds: context.dismissedIds,
        limit,
      }),
    [tours, context, limit],
  );

  useEffect(() => {
    if (
      !user?.id ||
      !context.preferences?.personalization_enabled ||
      !contextReady
    ) {
      return;
    }

    for (const item of recommendations) {
      void trackRecommendationEvent(
        user.id,
        Number(item.tour.id),
        "impression",
        source,
      );
    }
}, [
    user?.id,
    contextReady,
    source,
    recommendations
      .map((item) => item.tour.id)
      .join(","),
  ]);

  if (!tours.length) return null;

  return (
    <section className="section">
      <div className="container">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow flex items-center gap-2">
              <Sparkles size={14} />
              {context.preferences?.personalization_enabled
                ? "Personalized for you"
                : "Curated by AeroFly"}
            </div>

            <h2 className="display mt-3 text-3xl font-extrabold sm:text-4xl">
              {title}
            </h2>

            <p className="mt-2 max-w-xl text-sm text-[#77736c]">
              {context.preferences?.personalization_enabled
                ? "Based on your selected preferences and recent travel interests."
                : "Explore a few popular journeys. Turn on personalization in your dashboard for tailored suggestions."}
            </p>
          </div>

          <Link
            href={
              user
                ? "/dashboard/preferences"
                : "/login?next=%2Fdashboard%2Fpreferences"
            }
            className="text-sm font-bold text-[#c94d1c]"
          >
            Personalization settings →
          </Link>
        </div>

        {!contextReady ? (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from(
              { length: Math.min(limit, 4) },
              (_, i) => (
                <div
                  key={i}
                  className="h-[360px] animate-pulse rounded-2xl bg-[#eee9e1]"
                />
              ),
            )}
          </div>
        ) : recommendations.length ? (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {recommendations.map(({ tour, reasons }) => (
              <div key={tour.id}>
                <TourCard
                  onTourClick={() => {
                    if (user?.id) {
                      void trackRecommendationEvent(
                        user.id,
                        Number(tour.id),
                        "click",
                        source,
                      );
                    }
                  }}
                 tour={{
  ...tour,
  id: Number(tour.id),
  destination: tour.destination ?? "Destination",
  country: tour.country ?? "",
  durationDays: Number(tour.durationDays ?? 1),
  durationNights: Number(
    tour.durationNights ??
      Math.max(0, Number(tour.durationDays ?? 1) - 1),
  ),
  priceFrom: tour.priceFrom ?? 0,
  rating: Number(tour.rating ?? 0),
  reviewCount: Number(tour.reviewCount ?? 0),
  imageUrl: tour.imageUrl ?? "",
  category: tour.category ?? undefined,
  availability: tour.availability ?? undefined,
  // status: tour.status ?? undefined,
  slug: tour.slug,
  title: tour.title,
}}
                />

                <div className="mt-2 flex items-start justify-between gap-2 px-1">
                  <span className="text-xs leading-5 text-[#77736c]">
                    {reasons[0]}
                  </span>

                  {user?.id &&
                    context.preferences
                      ?.personalization_enabled && (
                      <button
                        type="button"
                        aria-label={`Dismiss ${tour.title} recommendation`}
                        title="Show me fewer like this"
                        className="shrink-0 rounded-full p-1 text-[#908b83] hover:bg-[#fff0e8] hover:text-[#c94d1c]"
                        onClick={() => {
                          const id = Number(tour.id);

                          setContext((current) => ({
                            ...current,
                           dismissedIds: Array.from(
  new Set<number>([
    ...current.dismissedIds,
    id,
  ]),
),
                            
                          }));

                          void trackRecommendationEvent(
                            user.id,
                            id,
                            "dismiss",
                            source,
                          );
                        }}
                      >
                        <X size={14} />
                      </button>
                    )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-[#e8e4dd] bg-white p-6 text-sm text-[#77736c]">
            We don’t have enough information to personalize
            your list yet. Explore the catalogue or update
            your preferences.
          </div>
        )}
      </div>
    </section>
  );
}