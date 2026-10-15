
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  MapPin,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { supabase } from "@/lib/supabase";

type Destination = {
  id: number;
  slug: string;
  name: string;
  country: string;
  tagline: string | null;
  description: string | null;
  imageUrl: string | null;
  is_active: boolean;
};

type Tour = {
  id: number;
  slug: string;
  title: string;
  destinationId: number;
  durationDays: number;
  durationNights: number;
  priceFrom: number | string;
  overview: string | null;
  imageUrl: string | null;
  galleryUrls: string[] | null;
  availability: string;
};

type ItineraryDay = {
  id: number;
  tourId: number;
  dayNumber: number;
  title: string;
  description: string | null;
  meals: string | null;
  stay: string | null;
  activities: string[] | null;
  accommodation: string | null;
  location: string | null;
  image_url: string | null;
  latitude: number | null;
  longitude: number | null;
};

type TourMedia = {
  media_type: "cover" | "gallery" | "itinerary";
  public_url: string | null;
  storage_path: string | null;
  alt_text: string;
  sort_order: number;
};

type PreviewSlide = {
  key: string;
  dayNumber: number;
  title: string;
  description: string;
  location: string;
  imageUrl: string | null;
  imageAlt: string;
  tags: string[];
  meals: string | null;
  stay: string | null;
};

type LoadState = "loading" | "ready" | "empty" | "error";

const imageFallback =
  "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1600&q=85";

export default function DemoTripExplorer() {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [tours, setTours] = useState<Tour[]>([]);
  const [itinerary, setItinerary] = useState<ItineraryDay[]>([]);
  const [media, setMedia] = useState<TourMedia[]>([]);

  const [destinationId, setDestinationId] = useState<number | null>(null);
  const [tourId, setTourId] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);

  const [destinationState, setDestinationState] =
    useState<LoadState>("loading");
  const [tourState, setTourState] = useState<LoadState>("empty");
  const [itineraryState, setItineraryState] =
    useState<LoadState>("empty");
  const [errorMessage, setErrorMessage] = useState("");

  const selectedDestination = useMemo(
    () => destinations.find((item) => item.id === destinationId) ?? null,
    [destinations, destinationId],
  );

  const destinationTours = useMemo(
    () => tours.filter((tour) => tour.destinationId === destinationId),
    [tours, destinationId],
  );

  const selectedTour = useMemo(
    () => tours.find((tour) => tour.id === tourId) ?? null,
    [tours, tourId],
  );

  // Load available destinations and published tours from Supabase.
  // No destination or tour content is hardcoded in this component.
  const loadCatalogue = useCallback(async () => {
    setDestinationState("loading");
    setErrorMessage("");

    try {
      const [destinationResult, tourResult] = await Promise.all([
        supabase
          .from("destinations")
          .select(
            'id,slug,name,country,tagline,description,"imageUrl",is_active',
          )
          .eq("is_active", true)
          .order("featured", { ascending: false })
          .order("name"),
        supabase
          .from("tours")
          .select(
            'id,slug,title,"destinationId","durationDays","durationNights","priceFrom",overview,"imageUrl","galleryUrls",availability',
          )
          .eq("status", "published")
          .order("featured", { ascending: false })
          .order("title"),
      ]);

      if (destinationResult.error) throw destinationResult.error;
      if (tourResult.error) throw tourResult.error;

      const publishedTours = (tourResult.data ?? []) as Tour[];
      const tourDestinationIds = new Set(
        publishedTours.map((tour) => tour.destinationId),
      );

      // Only offer destinations with at least one published tour.
      const availableDestinations = (
        (destinationResult.data ?? []) as Destination[]
      ).filter((destination) => tourDestinationIds.has(destination.id));

      setTours(publishedTours);
      setDestinations(availableDestinations);
      setDestinationState(
        availableDestinations.length ? "ready" : "empty",
      );

      // Keep selections only when they remain in the public catalogue.
      if (
        destinationId !== null &&
        !availableDestinations.some((item) => item.id === destinationId)
      ) {
        setDestinationId(null);
        setTourId(null);
        setItinerary([]);
        setMedia([]);
        setPlaying(false);
      }
    } catch {
      setDestinationState("error");
      setErrorMessage(
        "We couldn't load available destinations. Please try again.",
      );
    }
  }, [destinationId]);

  useEffect(() => {
    void loadCatalogue();
  }, [loadCatalogue]);

  function chooseDestination(id: number | null) {
  setDestinationId(id);
  setTourId(null);
  setItinerary([]);
  setMedia([]);
  setActive(0);
  setPlaying(false);
  setErrorMessage("");
  setTourState("empty");
  setItineraryState("empty");
}

  function chooseTour(id: number) {
    setTourId(id);
    setItinerary([]);
    setMedia([]);
    setActive(0);
    setPlaying(false);
    setErrorMessage("");
    setItineraryState("loading");
  }

  // Load the selected tour's actual itinerary and public images.
  useEffect(() => {
    if (tourId === null) return;

    let cancelled = false;

    async function loadTourPreview() {
      setItineraryState("loading");
      setErrorMessage("");

      try {
        const [itineraryResult, mediaResult] = await Promise.all([
          supabase
            .from("tour_itineraries")
            .select(
              'id,"tourId","dayNumber",title,description,meals,stay,activities,accommodation,location,image_url,latitude,longitude',
            )
            .eq("tourId", tourId)
            .order("dayNumber", { ascending: true }),
          supabase
            .from("tour_media")
            .select(
              "media_type,public_url,storage_path,alt_text,sort_order",
            )
            .eq("tourId", tourId)
            .eq("is_public", true)
            .order("sort_order", { ascending: true }),
        ]);

        if (itineraryResult.error) throw itineraryResult.error;
        if (cancelled) return;

        setItinerary((itineraryResult.data ?? []) as ItineraryDay[]);

        // Media is supplementary. Itinerary and tour cover images still
        // work if the media query is unavailable under the current policies.
        setMedia(
          mediaResult.error
            ? []
            : ((mediaResult.data ?? []) as TourMedia[]),
        );

        setItineraryState("ready");
      } catch {
        if (cancelled) return;
        setItinerary([]);
        setMedia([]);
        setItineraryState("error");
        setErrorMessage(
          "We couldn't load this tour's itinerary. Please try another tour.",
        );
      }
    }

    void loadTourPreview();

    return () => {
      cancelled = true;
    };
  }, [tourId]);

  const slides = useMemo<PreviewSlide[]>(() => {
    if (!selectedTour) return [];

    const getMediaUrl = (item: TourMedia): string | null => {
      if (item.public_url) return item.public_url;

      if (item.storage_path) {
        const { data } = supabase.storage
          .from("aerofly-public")
          .getPublicUrl(item.storage_path);
        return data.publicUrl || null;
      }

      return null;
    };

    const tourImages = media
      .filter((item) => item.media_type === "gallery" || item.media_type === "cover")
      .map((item) => ({
        url: getMediaUrl(item),
        alt: item.alt_text,
      }))
      .filter(
        (item): item is { url: string; alt: string } =>
          Boolean(item.url),
      );

    const itineraryImages = media
      .filter((item) => item.media_type === "itinerary")
      .map((item) => ({
        url: getMediaUrl(item),
        alt: item.alt_text,
      }))
      .filter(
        (item): item is { url: string; alt: string } =>
          Boolean(item.url),
      );

    const getImage = (
      day: ItineraryDay,
      index: number,
    ): { url: string | null; alt: string } => {
      if (day.image_url) {
        return {
          url: day.image_url,
          alt: `${selectedTour.title} — ${day.title}`,
        };
      }

      if (itineraryImages[index]) return itineraryImages[index];

      if (tourImages[index]) return tourImages[index];

      if (selectedTour.galleryUrls?.[index]) {
        return {
          url: selectedTour.galleryUrls[index],
          alt: `${selectedTour.title} — ${day.title}`,
        };
      }

      if (selectedTour.imageUrl) {
        return {
          url: selectedTour.imageUrl,
          alt: selectedTour.title,
        };
      }

      return {
        url: selectedDestination?.imageUrl ?? null,
        alt: selectedDestination?.name ?? selectedTour.title,
      };
    };

    if (itinerary.length) {
      return itinerary.map((day, index) => {
        const image = getImage(day, index);

        return {
          key: String(day.id),
          dayNumber: day.dayNumber,
          title: day.title,
          description: day.description ?? "Explore this part of your journey.",
          location: day.location ?? selectedDestination?.name ?? "",
          imageUrl: image.url,
          imageAlt: image.alt,
          tags: day.activities ?? [],
          meals: day.meals,
          stay: day.accommodation ?? day.stay,
        };
      });
    }

    // Do not invent day-by-day activities when the tour has no itinerary.
    // A single visual tour preview is safer and still useful.
    return [
      {
        key: `tour-${selectedTour.id}`,
        dayNumber: 0,
        title: selectedTour.title,
        description:
          selectedTour.overview ??
          "Explore the published tour details to learn more about this journey.",
        location: selectedDestination?.name ?? "",
        imageUrl:
          selectedTour.imageUrl ??
          selectedDestination?.imageUrl ??
          tourImages[0]?.url ??
          null,
        imageAlt: selectedTour.title,
        tags: [],
        meals: null,
        stay: null,
      },
    ];
  }, [itinerary, media, selectedTour, selectedDestination]);

  useEffect(() => {
    if (!playing || slides.length < 2) return;

    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % slides.length);
    }, 4500);

    return () => window.clearInterval(timer);
  }, [playing, slides.length]);

  useEffect(() => {
    setActive(0);
  }, [tourId]);

  const activeSlide = slides[active] ?? null;

  function previousSlide() {
    setActive((current) => (current - 1 + slides.length) % slides.length);
  }

  function nextSlide() {
    setActive((current) => (current + 1) % slides.length);
  }

  return (
    <section className="section bg-[#f3ede5]">
      <div className="container">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <div className="eyebrow flex items-center gap-2">
              <Sparkles size={14} className="text-[#f26b35]" />
              Explore before you book
            </div>

            <h2 className="display mt-3 max-w-[720px] text-4xl font-extrabold sm:text-6xl">
              Your next trip,
              <br />
              <span className="text-[#f26b35]">brought to life.</span>
            </h2>

            <p className="mt-4 max-w-[600px] text-sm leading-7 text-[#77736c]">
              Choose a destination, select a published AeroFly tour, and
              preview the journey with its itinerary and images.
            </p>
          </div>

          {selectedTour && (
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setTourId(null);
                setItinerary([]);
                setMedia([]);
                setItineraryState("empty");
              }}
              className="btn btn-dark self-start sm:self-auto"
            >
              <ArrowLeft size={14} />
              Change tour
            </button>
          )}
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => {
                if (tourId !== null) {
                  setItineraryState("loading");
                  setTourId(null);
                  window.setTimeout(() => setTourId(tourId), 0);
                } else {
                  void loadCatalogue();
                }
              }}
              className="inline-flex items-center gap-2 font-bold"
            >
              <RotateCcw size={14} />
              Retry
            </button>
          </div>
        )}

        {/* STEP 1: Choose an actual active destination. */}
        {!selectedTour && (
          <div className="mt-9">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f26b35] text-sm font-bold text-white">
                1
              </span>
              <div>
                <h3 className="font-['Manrope'] text-xl font-extrabold">
                  Where would you like to go?
                </h3>
                <p className="mt-1 text-xs text-[#77736c]">
                  Choose from destinations with published AeroFly tours.
                </p>
              </div>
            </div>

            {destinationState === "loading" && (
              <LoadingMessage label="Finding available destinations…" />
            )}

            {destinationState === "empty" && (
              <EmptyMessage
                title="No destinations available yet"
                detail="Publish a destination and at least one tour for it to appear here."
              />
            )}

            {destinationState === "ready" && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {destinations.map((destination) => {
                  const count = tours.filter(
                    (tour) => tour.destinationId === destination.id,
                  ).length;

                  const chosen = destination.id === destinationId;

                  return (
                    <button
                      type="button"
                      key={destination.id}
                      onClick={() => chooseDestination(destination.id)}
                      aria-pressed={chosen}
                      className={`group overflow-hidden rounded-2xl border bg-white text-left transition ${
                        chosen
                          ? "border-[#f26b35] ring-2 ring-[#f26b35]/20"
                          : "border-[#e4dbcf] hover:-translate-y-0.5 hover:border-[#f26b35]"
                      }`}
                    >
                      <div className="relative h-48 overflow-hidden bg-[#e8ded0]">
                        {destination.imageUrl ? (
                          <img
                            src={destination.imageUrl}
                            alt={destination.name}
                            loading="lazy"
                            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div className="grid h-full place-items-center text-[#c94d1c]">
                            <MapPin size={30} />
                          </div>
                        )}

                        <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1.5 text-[10px] font-bold text-[#383630]">
                          {destination.country}
                        </span>

                        {chosen && (
                          <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-[#f26b35] text-white">
                            <Check size={14} />
                          </span>
                        )}
                      </div>

                      <div className="p-4">
                        <h4 className="font-['Manrope'] text-lg font-extrabold">
                          {destination.name}
                        </h4>

                        {destination.tagline && (
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#77736c]">
                            {destination.tagline}
                          </p>
                        )}

                        <div className="mt-4 flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-[#77736c]">
                            {count} published {count === 1 ? "tour" : "tours"}
                          </span>
                          <ArrowRight
                            size={15}
                            className="text-[#f26b35] transition group-hover:translate-x-1"
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Choose a real published tour for the selected destination. */}
        {selectedDestination && !selectedTour && (
          <div className="mt-9">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f26b35] text-sm font-bold text-white">
                2
              </span>
              <div>
                <h3 className="font-['Manrope'] text-xl font-extrabold">
                  Choose your {selectedDestination.name} journey
                </h3>
                <p className="mt-1 text-xs text-[#77736c]">
                  These tours are retrieved from the published catalogue.
                </p>
              </div>
            </div>

            <div className="mb-4">
              <button
                type="button"
                onClick={() => chooseDestination(null)}
                className="inline-flex items-center gap-2 text-xs font-bold text-[#a74720] hover:text-[#f26b35]"
              >
                <ArrowLeft size={13} />
                Choose another destination
              </button>
            </div>

            {tourState === "loading" && (
              <LoadingMessage label="Loading published tours…" />
            )}

            {destinationTours.length === 0 && (
              <EmptyMessage
                title="No published tours for this destination"
                detail="Choose another destination or publish a tour for this destination."
              />
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {destinationTours.map((tour) => (
                <button
                  type="button"
                  key={tour.id}
                  onClick={() => chooseTour(tour.id)}
                  className="group overflow-hidden rounded-2xl border border-[#e4dbcf] bg-white text-left transition hover:-translate-y-0.5 hover:border-[#f26b35]"
                >
                  <div className="relative h-48 overflow-hidden bg-[#e8ded0]">
                    {tour.imageUrl || selectedDestination.imageUrl ? (
                      <img
                        src={
                          tour.imageUrl ??
                          selectedDestination.imageUrl ??
                          undefined
                        }
                        alt={tour.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-[#c94d1c]">
                        <MapPin size={30} />
                      </div>
                    )}
                  </div>

                  <div className="p-4">
                    <h4 className="font-['Manrope'] text-lg font-extrabold">
                      {tour.title}
                    </h4>

                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[#77736c]">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 size={12} />
                        {tour.durationDays} days · {tour.durationNights} nights
                      </span>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="text-sm font-extrabold text-[#c94d1c]">
                        {Number.isFinite(Number(tour.priceFrom))
                          ? `From ₹${Number(tour.priceFrom).toLocaleString("en-IN")}`
                          : "Contact us for pricing"}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-bold">
                        Preview <ArrowRight size={13} />
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* STEP 3: Play the selected tour's actual itinerary. */}
        {selectedTour && selectedDestination && (
          <div className="mt-9">
            <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <div className="eyebrow flex items-center gap-2">
                  <MapPin size={13} className="text-[#f26b35]" />
                  {selectedDestination.name}, {selectedDestination.country}
                </div>

                <h3 className="display mt-2 text-3xl font-extrabold sm:text-4xl">
                  {selectedTour.title}
                </h3>

                <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#77736c]">
                  <span className="inline-flex items-center gap-1">
                    <Clock3 size={13} className="text-[#f26b35]" />
                    {selectedTour.durationDays} days ·{" "}
                    {selectedTour.durationNights} nights
                  </span>

                  <span className="font-bold text-[#c94d1c]">
                    {Number.isFinite(Number(selectedTour.priceFrom))
                      ? `From ₹${Number(selectedTour.priceFrom).toLocaleString("en-IN")}`
                      : "Contact us for pricing"}
                  </span>
                </div>
              </div>

              {slides.length > 1 && (
                <button
                  type="button"
                  onClick={() => setPlaying((value) => !value)}
                  className="btn btn-dark self-start sm:self-auto"
                  disabled={itineraryState === "loading"}
                >
                  {playing ? (
                    <>
                      <Pause size={14} />
                      Pause journey
                    </>
                  ) : (
                    <>
                      <Play size={14} className="fill-current" />
                      Play journey
                    </>
                  )}
                </button>
              )}
            </div>

            {itineraryState === "loading" && (
              <LoadingMessage label="Loading itinerary and travel images…" />
            )}

            {itineraryState === "error" && (
              <EmptyMessage
                title="Itinerary unavailable"
                detail="We couldn't retrieve this tour's itinerary. Please retry or select another tour."
              />
            )}

            {itineraryState === "ready" && activeSlide && (
              <>
                <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
                  <div className="relative min-h-[350px] overflow-hidden rounded-[26px] bg-[#20201e] sm:min-h-[470px]">
                    {activeSlide.imageUrl ? (
                      <img
                        key={activeSlide.imageUrl}
                        src={activeSlide.imageUrl}
                        alt={activeSlide.imageAlt}
                        onError={(event) => {
                          const img = event.currentTarget;
                          if (img.src !== imageFallback) {
                            img.src = imageFallback;
                          }
                        }}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center bg-[#302d28] text-white/70">
                        <div className="text-center">
                          <MapPin size={32} className="mx-auto text-[#ffac88]" />
                          <p className="mt-3 text-sm">
                            Images for this itinerary day have not been added yet.
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-black/10" />

                    <div className="absolute left-5 right-5 top-5 flex items-start justify-between gap-3 sm:left-8 sm:right-8 sm:top-8">
                      <span className="rounded-full border border-white/25 bg-black/25 px-3 py-2 text-[10px] font-bold uppercase tracking-[.15em] text-white backdrop-blur">
                        {activeSlide.dayNumber > 0
                          ? `Day ${String(activeSlide.dayNumber).padStart(2, "0")}`
                          : "Tour preview"}
                      </span>

                      <span className="rounded-full bg-black/30 px-3 py-2 text-[10px] font-semibold text-white backdrop-blur">
                        {active + 1} / {slides.length}
                      </span>
                    </div>

                    <div className="absolute bottom-0 left-0 right-0 p-6 text-white sm:p-9">
                      {activeSlide.location && (
                        <div className="eyebrow flex items-center gap-2 text-[#ffac88]">
                          <MapPin size={13} />
                          {activeSlide.location}
                        </div>
                      )}

                      <h4 className="mt-3 max-w-2xl font-['Manrope'] text-3xl font-extrabold tracking-[-.04em] sm:text-4xl">
                        {activeSlide.title}
                      </h4>

                      <p className="mt-3 max-w-2xl text-sm leading-7 text-white/85">
                        {activeSlide.description}
                      </p>

                      {activeSlide.tags.length > 0 && (
                        <div className="mt-5 flex flex-wrap gap-2">
                          {activeSlide.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full border border-white/25 bg-black/15 px-3 py-1.5 text-[10px] font-semibold text-white"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {(activeSlide.meals || activeSlide.stay) && (
                        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-white/75">
                          {activeSlide.meals && (
                            <span>Meals: {activeSlide.meals}</span>
                          )}
                          {activeSlide.stay && (
                            <span>Stay: {activeSlide.stay}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[26px] border border-[#e4dbcf] bg-white p-5 sm:p-7">
                    <div className="eyebrow">Your itinerary</div>
                    <h4 className="mt-2 font-['Manrope'] text-2xl font-extrabold">
                      The journey, day by day
                    </h4>

                    <div className="relative mt-6">
                      {slides.map((slide, index) => {
                        const isActive = index === active;

                        return (
                          <button
                            type="button"
                            key={slide.key}
                            onClick={() => {
                              setActive(index);
                              setPlaying(false);
                            }}
                            className="group relative flex w-full gap-3 pb-5 text-left last:pb-0"
                            aria-current={isActive ? "step" : undefined}
                          >
                            <div className="relative flex w-8 shrink-0 justify-center">
                              {index < slides.length - 1 && (
                                <span className="absolute bottom-[-1px] top-8 w-px bg-[#e4dbcf]" />
                              )}
                              <span
                                className={`relative z-10 grid h-8 w-8 place-items-center rounded-full border text-[10px] font-bold transition ${
                                  isActive
                                    ? "border-[#f26b35] bg-[#f26b35] text-white"
                                    : "border-[#e4dbcf] bg-[#faf8f5] text-[#77736c] group-hover:border-[#f26b35]"
                                }`}
                              >
                                {isActive ? (
                                  <Check size={13} />
                                ) : (
                                  slide.dayNumber || index + 1
                                )}
                              </span>
                            </div>

                            <span className="min-w-0 flex-1 pb-1">
                              <span
                                className={`block font-['Manrope'] text-sm font-extrabold ${
                                  isActive ? "text-[#c94d1c]" : "text-[#242422]"
                                }`}
                              >
                                {slide.title}
                              </span>
                              <span className="mt-1 line-clamp-2 block text-[11px] leading-5 text-[#77736c]">
                                {slide.location || selectedDestination.name}
                                {slide.description
                                  ? ` · ${slide.description}`
                                  : ""}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-6 flex items-center justify-between border-t border-[#eee8df] pt-5">
                      <button
                        type="button"
                        onClick={previousSlide}
                        disabled={slides.length < 2}
                        aria-label="Previous itinerary day"
                        className="grid h-10 w-10 place-items-center rounded-full border border-[#ded7cc] hover:border-[#f26b35] disabled:opacity-40"
                      >
                        <ChevronLeft size={16} />
                      </button>

                      <span className="text-xs font-semibold text-[#77736c]">
                        {active + 1} of {slides.length}
                      </span>

                      <button
                        type="button"
                        onClick={nextSlide}
                        disabled={slides.length < 2}
                        aria-label="Next itinerary day"
                        className="grid h-10 w-10 place-items-center rounded-full border border-[#ded7cc] hover:border-[#f26b35] disabled:opacity-40"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-col justify-between gap-4 rounded-2xl border border-[#e4dbcf] bg-white p-5 sm:flex-row sm:items-center sm:p-6">
                  <div>
                    <div className="font-['Manrope'] text-lg font-extrabold">
                      Ready to explore this tour?
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[#77736c]">
                      Preview content comes from the published AeroFly catalogue.
                      Confirm travel dates, final pricing and availability with our team.
                    </p>
                  </div>

                  <Link
                    href={`/tours/${selectedTour.slug}`}
                    className="btn btn-primary self-start sm:self-auto"
                  >
                    View full tour <ArrowRight size={14} />
                  </Link>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function LoadingMessage({ label }: { label: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center gap-3 rounded-2xl border border-[#e4dbcf] bg-white p-6 text-sm text-[#77736c]">
      <LoaderCircle size={18} className="animate-spin text-[#f26b35]" />
      {label}
    </div>
  );
}

function EmptyMessage({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-[#d8cdbf] bg-white p-8 text-center">
      <MapPin size={24} className="mx-auto text-[#f26b35]" />
      <h4 className="mt-3 font-['Manrope'] font-extrabold">{title}</h4>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#77736c]">
        {detail}
      </p>
    </div>
  );
}
