import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  Heart,
  MapPin,
  ShieldCheck,
  Star,
  Images,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import EnquiryModal from "@/components/site/EnquiryModal";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DirectBookingModal from "@/components/site/DirectBookingModal";
import {
  addToWishlist,
  isTourWishlisted,
  recordCustomerActivity,
  removeFromWishlist,
} from "@/lib/customer";
import { toast } from "sonner";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePageMeta } from "@/hooks/usePageMeta";
import { rememberAnonymousTourView } from "@/lib/recommendations";
import TravelMap, { MapPoint } from "@/components/site/TravelMap";

export default function TourDetails() {
  const slug = window.location.pathname.split("/").filter(Boolean).pop() ?? "";
  const [, navigate] = useLocation();
  
const {
  data: tour,
  isLoading,
  isError,
} = trpc.content.tour.useQuery({ slug }, { staleTime: 60_000 });

const viewMutation = trpc.content.recordTourView.useMutation();

const [enquiryOpen, setEnquiryOpen] = useState(false);
const { format, currency } = useCurrency();
const { user, isAuthenticated } = useAuth();
const [wishlisted, setWishlisted] = useState(false);
const [wishlistBusy, setWishlistBusy] = useState(false);
const [directBookingOpen, setDirectBookingOpen] = useState(false);

const [galleryOpen, setGalleryOpen] = useState(false);
const [activeImageIndex, setActiveImageIndex] = useState(0);

const showPreviousImage = () => {
  setActiveImageIndex((current) =>
    (current - 1 + galleryImages.length) % galleryImages.length
  );
};

const showNextImage = () => {
  setActiveImageIndex((current) =>
    (current + 1) % galleryImages.length
  );
};

  useEffect(() => {
    if (!tour) return;
    const key = `AeroFlyy-tour-view:${tour.id}`;
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      viewMutation.mutate({ tourId: tour.id });
    }
    if (user?.id) {
      rememberAnonymousTourView(Number(tour.id));
      void recordCustomerActivity(user.id, "tour_viewed", "tour", tour.id, {
        source: "tour_detail",
      }).catch(() => undefined);
      void isTourWishlisted(user.id, tour.id)
        .then(setWishlisted)
        .catch(() => undefined);
    }
  }, [tour?.id, user?.id]);

  const toggleWishlist = async () => {
    if (!user || !tour?.id) return;
    setWishlistBusy(true);
    try {
      if (wishlisted) {
        await removeFromWishlist(user.id, tour.id);
        setWishlisted(false);
        toast.success("Removed from wishlist.");
      } else {
        await addToWishlist(user.id, tour.id);
        setWishlisted(true);
        toast.success("Saved to your wishlist.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update wishlist.",
      );
    } finally {
      setWishlistBusy(false);
    }
  };

 
usePageMeta({
  title: tour
    ? `${tour.title} | AeroFlyy Tours`
    : "Tour Details | AeroFlyy Tours",
  description:
    tour?.metaDescription ??
    tour?.overview ??
    "Explore this AeroFlyy Tours itinerary.",
  canonical: `${window.location.origin}/tours/${slug}`,
  image: tour?.imageUrl ?? undefined,
  indexable: Boolean(tour),
  structuredData: tour
    ? {
        "@context": "https://schema.org",
        "@type": "TouristTrip",
        name: tour.title,
        description:
          tour.metaDescription ??
          tour.overview ??
          undefined,
        image: tour.imageUrl
          ? [tour.imageUrl]
          : undefined,
        provider: {
          "@type": "TravelAgency",
          name: "AeroFlyy Tours",
          url: "https://aeroflyytours.com/",
        },
      }
    : null,
});


  const gallery = useMemo(() => {
    const media = (tour?.media ?? [])
      .map(
        (item: any) =>
          item.public_url ||
          item.publicUrl ||
          item.storage_path ||
          item.storagePath,
      )
      .filter(Boolean);
    const legacy = Array.isArray(tour?.galleryUrls) ? tour.galleryUrls : [];
    return Array.from(
      new Set(
        [tour?.imageUrl, ...media, ...legacy].filter((value): value is string =>
          Boolean(value),
        ),
      ),
    ).slice(0, 8);
  }, [tour]);


  const galleryImages = useMemo(
  () =>
    Array.from(
      new Set(
        [tour?.imageUrl, ...gallery].filter(
          (image): image is string =>
            typeof image === "string" && image.trim().length > 0
        )
      )
    ),
  [tour?.imageUrl, gallery],
);

  if (isLoading)
    return (
      <>
        <Header />
        <div className="container py-32">
          <div className="h-10 w-2/3 animate-pulse rounded bg-[#eee9e1]" />
          <div className="mt-5 h-5 w-1/2 animate-pulse rounded bg-[#eee9e1]" />
        </div>
        <Footer />
      </>
    );
  if (isError || !tour)
    return (
      <>
        <Header />
        <div className="container py-32 text-center">
          <div className="eyebrow">Route not found</div>
          <h1 className="display mt-3 text-5xl font-extrabold">
            Let’s find another way.
          </h1>
          <Link href="/tours" className="btn btn-primary mt-7">
            Back to tours
          </Link>
        </div>
        <Footer />
      </>
    );

  const includes = normalizeList(tour.inclusions);
  const excludes = normalizeList(tour.exclusions);
  const highlights = normalizeList(tour.highlights);
  const upcomingDepartures = (tour.departures ?? []).filter(
    (d: any) =>
      new Date(d.departure_date) >= new Date(new Date().toDateString()) &&
      d.status !== "sold_out",
  );

  
const itineraryDays = Array.isArray(tour?.itinerary)
  ? tour.itinerary
  : [];

const destination = tour?.destinationDetails;

const getCoordinate = (...values: unknown[]): number | null => {
  for (const value of values) {
    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      Number.isFinite(Number(value))
    ) {
      const coordinate = Number(value);
      return coordinate;
    }
  }

  return null;
};

const itineraryMapPoints: MapPoint[] = itineraryDays
  .map((day: any, index: number): MapPoint | null => {
    const lat = getCoordinate(day.latitude, day.lat);
    const lng = getCoordinate(day.longitude, day.lng);

    // Do not plot a stop with missing or invalid coordinates.
    if (
      lat === null ||
      lng === null ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return null;
    }

    return {
  id: day.id ?? `itinerary-day-${index + 1}`,
  name: day.location || day.title || `Day ${day.dayNumber ?? index + 1}`,
  lat,
  lng,
  type: "itinerary",
  description: day.description ?? null,
  imageUrl: day.image_url ?? day.imageUrl ?? null,
  day: day.dayNumber ?? index + 1,
  source: "Published tour itinerary coordinates",
};
  })
  .filter((point): point is MapPoint => point !== null);

// If the itinerary has no mapped stops, fall back to the destination's
// coordinates, provided those coordinates exist and are valid.

const destinationLat = getCoordinate(
  destination?.latitude,
  destination?.lat,
);
const destinationLng = getCoordinate(
  destination?.longitude,
  destination?.lng,
);

const destinationMapPoints: MapPoint[] =
  itineraryMapPoints.length === 0 &&
  destinationLat !== null &&
  destinationLng !== null &&
  destinationLat >= -90 &&
  destinationLat <= 90 &&
  destinationLng >= -180 &&
  destinationLng <= 180
    ? [
        {
  id: `destination-${destination?.id ?? tour?.destinationSlug ?? "unknown"}`,
  name:
    destination?.name ??
    tour?.destination ??
    tour?.title ??
    "Destination",
  lat: destinationLat,
  lng: destinationLng,
  type: "destination",
  description: tour?.overview ?? null,
  imageUrl: tour?.imageUrl ?? null,
  country: tour?.country ?? null,
  source: "Destination coordinates",
}
      ]
    : [];

const tourMapPoints =
  itineraryMapPoints.length > 0
    ? itineraryMapPoints
    : destinationMapPoints;


  return (
    <div className="min-h-screen">
      <Header />
      <main>
        <section className="border-b border-[#e8e4dd] bg-[#f3ede5] py-5">
          <div className="container">
            <button
              onClick={() => navigate("/tours")}
              className="flex items-center gap-2 text-[12px] font-bold text-[#6f6c66] hover:text-[#c94d1c]"
            >
              <ArrowLeft size={14} /> Back to all tours
            </button>
            <div className="mt-8 grid gap-8 lg:grid-cols-[1.05fr_.95fr] lg:items-end">
              <div>
                <div className="eyebrow">
                  {tour.category} ·{" "}
                  {tour.kind === "domestic" ? "India" : "International"}
                </div>
                <h1 className="display mt-4 max-w-[700px] text-5xl font-extrabold sm:text-7xl">
                  {tour.title}
                </h1>
                <div className="mt-5 flex flex-wrap items-center gap-4 text-[13px] text-[#6f6c66]">
                  <span className="flex items-center gap-1">
                    <MapPin size={15} className="text-[#f26b35]" />
                    {tour.destination}, {tour.country}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock3 size={15} className="text-[#f26b35]" />
                    {tour.durationDays} days / {tour.durationNights} nights
                  </span>
                  <span className="flex items-center gap-1">
                    <Star size={14} className="fill-[#f26b35] text-[#f26b35]" />
                    {tour.rating} ({tour.reviewCount})
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-end">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[.14em] text-[#908b83]">
                    Starting from
                  </div>
                  <div className="mt-1 font-['Manrope'] text-3xl font-extrabold">
                    {format(Number(tour.priceFrom))}{" "}
                    <span className="text-[12px] font-medium text-[#77736c]">
                      / person
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-[#92928b]">
                    {currency} display · base price INR
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setEnquiryOpen(true)}
                    className="btn btn-primary"
                  >
                    Plan this trip <ArrowRight size={15} />
                  </button>
                  {isAuthenticated && user ? (
                    <button
                      type="button"
                      disabled={wishlistBusy}
                      onClick={() => void toggleWishlist()}
                      className="btn btn-ghost"
                    >
                      <Heart
                        size={15}
                        className={
                          wishlisted ? "fill-current text-[#f26b35]" : ""
                        }
                      />{" "}
                      {wishlisted ? "Saved" : "Save"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

  <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)] lg:items-start">        
{galleryImages.length > 0 && (
  <div className="min-w-0">
    {/* Single cover image */}
    <div className="group relative overflow-hidden rounded-2xl bg-[#e8e4dd]">
      <img
        src={galleryImages[0]}
        alt={`${tour.title} cover`}
        loading="eager"
        className="h-[280px] w-full object-cover sm:h-[420px] lg:h-[500px] transition-transform duration-500 group-hover:scale-[1.02]"
      />

      {/* Image gradient */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/10" />

      {/* Image count */}
      <div className="absolute bottom-5 left-5 text-sm font-semibold text-white drop-shadow">
        {tour.title}
        <div className="mt-1 text-xs font-medium text-white/80">
          {galleryImages.length} photos
        </div>
      </div>

      {/* View all photos */}
      <button
        type="button"
        onClick={() => {
          setActiveImageIndex(0);
          setGalleryOpen(true);
        }}
        className="absolute bottom-4 right-4 flex items-center gap-2 rounded-xl border border-white/70 bg-white/95 px-4 py-3 text-xs font-extrabold text-[#292722] shadow-lg transition hover:bg-white sm:bottom-6 sm:right-6"
        aria-label={`View all ${galleryImages.length} photos`}
      >
        <Images size={17} className="text-[#c94d1c]" />
        View all photos
        <span className="rounded-md bg-[#f3ede5] px-2 py-1 text-[10px]">
          {galleryImages.length}
        </span>
      </button>
    </div>
  </div>
)}

{/* Full-screen gallery viewer */}
{galleryOpen && galleryImages.length > 0 && (
  <div
    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 backdrop-blur-sm sm:p-6"
    role="dialog"
    aria-modal="true"
    aria-label={`${tour.title} photo gallery`}
    onClick={() => setGalleryOpen(false)}
  >
    <div
      className="relative flex h-full max-h-[900px] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-[#171717] text-white shadow-2xl"
      onClick={(event) => event.stopPropagation()}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-extrabold sm:text-base">
            {tour.title}
          </h2>
          <p className="mt-1 text-xs text-white/55">
            Photo {activeImageIndex + 1} of {galleryImages.length}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setGalleryOpen(false)}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
          aria-label="Close gallery"
        >
          <X size={21} />
        </button>
      </div>

      {/* Main image and navigation */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6">
        <img
          key={galleryImages[activeImageIndex]}
          src={galleryImages[activeImageIndex]}
          alt={`${tour.title} photo ${activeImageIndex + 1}`}
          className="max-h-full max-w-full select-none object-contain"
        />

        {galleryImages.length > 1 && (
          <>
            <button
              type="button"
              onClick={showPreviousImage}
              className="absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/65 text-white shadow-lg transition hover:bg-[#c94d1c] sm:left-5 sm:h-12 sm:w-12"
              aria-label="Previous photo"
            >
              <ChevronLeft size={25} />
            </button>

            <button
              type="button"
              onClick={showNextImage}
              className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/65 text-white shadow-lg transition hover:bg-[#c94d1c] sm:right-5 sm:h-12 sm:w-12"
              aria-label="Next photo"
            >
              <ChevronRight size={25} />
            </button>
          </>
        )}
      </div>

      {/* Thumbnail strip */}
      {galleryImages.length > 1 && (
        <div className="shrink-0 border-t border-white/10 bg-[#111111] px-3 py-3 sm:px-5">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {galleryImages.map((image, index) => (
              <button
                key={`${image}-${index}`}
                type="button"
                onClick={() => setActiveImageIndex(index)}
                className={`relative h-14 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition sm:h-[72px] sm:w-24 ${
                  activeImageIndex === index
                    ? "border-[#f26b35] opacity-100"
                    : "border-transparent opacity-55 hover:opacity-100"
                }`}
                aria-label={`View photo ${index + 1}`}
                aria-current={
                  activeImageIndex === index ? "true" : undefined
                }
              >
                <img
                  src={image}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  </div>
)}

<aside className="lg:pt-8">
              <div className="card sticky top-28 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="eyebrow">Make it yours</div>
                    <h3 className="mt-2 font-['Manrope'] text-2xl font-extrabold">
                      Let’s shape the details.
                    </h3>
                  </div>
                  <div className="grid h-11 w-11 place-items-center rounded-full bg-[#fff0e8] text-[#f26b35]">
                    <ShieldCheck size={20} />
                  </div>
                </div>
                <p className="mt-4 text-[13px] leading-6 text-[#6f6c66]">
                  Availability, rooming, flights, transfers and the little
                  details can all be adjusted with our travel desk.
                </p>
                <button
                  onClick={() => setEnquiryOpen(true)}
                  className="btn btn-primary mt-6 w-full"
                >
                  Request a callback <ArrowRight size={15} />
                </button>
                <button
  type="button"
  onClick={() => setDirectBookingOpen(true)}
  className="mt-2 w-full rounded-full border border-orange-700 px-5 py-3 text-sm font-bold text-orange-800 transition hover:bg-orange-50"
>
  Book Now <ArrowRight size={15} className="ml-1 inline" />
</button>
                <div className="mt-5 border-t border-[#eee9e1] pt-5 text-[12px] leading-6 text-[#77736c]">
                  Prices are starting estimates and may change with dates,
                  availability and chosen inclusions. Your advisor will confirm
                  the final quotation.
                </div>
              </div>
            </aside>
</div>

          </div>
        </section>


        <section className="section">
          <div className="container">
            <div>
              <div className="eyebrow">The route</div>
              <h2 className="display mt-3 text-4xl font-extrabold">
                A trip that leaves room for the good bits.
              </h2>
              <p className="mt-5 text-[15px] leading-8 text-[#6f6c66]">
                {tour.overview}
              </p>
              {highlights.length > 0 && (
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  {highlights.map((item, index) => (
                    <div
                      key={`${item}-${index}`}
                      className="rounded-xl bg-[#f3ede5] p-4 text-[13px] font-semibold text-[#4f4c46]"
                    >
                      <span className="mr-2 text-[#f26b35]">•</span>
                      {item}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-10 grid gap-5 sm:grid-cols-2">
                <InfoList title="Included" items={includes} icon={Check} />
                <InfoList
                  title="Good to know"
                  items={excludes}
                  icon={Heart}
                  muted
                />
              </div>

              

<div className="mt-6 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
  {tour.itinerary?.length > 0 ? (
    tour.itinerary.map((day: any) => {
      const activities = Array.isArray(day.activities)
        ? day.activities.filter(
            (activity: unknown) =>
              typeof activity === "string" && activity.trim().length > 0
          )
        : [];

      const spots = Array.isArray(day.spots)
        ? day.spots.filter(
            (spot: any) =>
              spot &&
              (spot.name?.trim() ||
                spot.title?.trim() ||
                spot.location?.trim())
          )
        : [];

      const hasMapLinks =
        Boolean(day.map_url?.trim()) ||
        Boolean(day.street_view_url?.trim());

      const hasDetails =
        Boolean(day.meals?.trim()) ||
        Boolean(day.accommodation?.trim()) ||
        Boolean(day.stay?.trim()) ||
        Boolean(day.location?.trim());

      const hasExtraContent =
        activities.length > 0 ||
        spots.length > 0 ||
        hasMapLinks ||
        Boolean(day.image_url?.trim());

      return (
        <div
          key={day.id}
          className="card flex h-full min-w-0 flex-col overflow-hidden p-4 sm:p-5"
        >
          {/* Day heading and description */}
          <div className="flex min-w-0 gap-3 sm:gap-4">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#fff0e8] text-xs font-extrabold text-[#c94d1c]">
              {String(day.dayNumber).padStart(2, "0")}
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="break-words font-['Manrope'] text-base font-extrabold">
                {day.title}
              </h3>

              {day.description?.trim() && (
                <p className="mt-2 break-words text-[13px] leading-6 text-[#77736c]">
                  {day.description}
                </p>
              )}

              {hasDetails && (
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-[11px] text-[#908b83]">
                  {day.meals?.trim() && (
                    <span className="break-words">
                      Meals: {day.meals}
                    </span>
                  )}

                  {(day.accommodation?.trim() || day.stay?.trim()) && (
                    <span className="break-words">
                      Stay: {day.accommodation?.trim() || day.stay}
                    </span>
                  )}

                  {day.location?.trim() && (
                    <span className="break-words">
                      Location: {day.location}
                    </span>
                  )}
                </div>
              )}

              {activities.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {activities.map((activity: string, index: number) => (
                    <span
                      key={`${activity}-${index}`}
                      className="max-w-full break-words rounded-full bg-[#fbfaf8] px-3 py-1 text-[10px] font-semibold text-[#6f6c66]"
                    >
                      {activity}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Day image */}
          {day.image_url?.trim() && (
            <img
              src={day.image_url}
              alt={`${day.title || "Day"} itinerary`}
              loading="lazy"
              className="mt-5 aspect-[16/9] w-full rounded-xl object-cover"
            />
          )}

          {/* Places to visit */}
          {spots.length > 0 && (
            <div className="mt-5">
              <h4 className="mb-3 text-sm font-bold text-[#292722]">
                Places to visit
              </h4>

              <div className="space-y-3">
                {spots.map((spot: any, index: number) => {
                  const name =
                    spot.name || spot.title || spot.location;

                  return (
                    <div
                      key={spot.id ?? `${name}-${index}`}
                      className="min-w-0 rounded-xl bg-[#fbfaf8] p-3"
                    >
                      <p className="break-words text-sm font-semibold text-[#292722]">
                        {name}
                      </p>

                      {spot.description?.trim() && (
                        <p className="mt-1 break-words text-xs leading-5 text-[#77736c]">
                          {spot.description}
                        </p>
                      )}

                      {spot.map_url?.trim() && (
                        <a
                          href={spot.map_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block text-xs font-semibold text-[#c94d1c] hover:underline"
                        >
                          View on Google Maps ↗
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Maps and Street View */}
          {hasMapLinks && (
            <div className="mt-4 flex flex-wrap gap-2">
              {day.map_url?.trim() && (
                <a
                  href={day.map_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-[#e8e2d9] px-3 py-2 text-xs font-semibold text-[#c94d1c] transition-colors hover:bg-[#fff0e8]"
                >
                  View route ↗
                </a>
              )}

              {day.street_view_url?.trim() && (
                <a
                  href={day.street_view_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-[#e8e2d9] px-3 py-2 text-xs font-semibold text-[#c94d1c] transition-colors hover:bg-[#fff0e8]"
                >
                  Street View ↗
                </a>
              )}
            </div>
          )}

          {/* Fallback */}
          {!hasExtraContent && (
            <p className="mt-4 text-xs leading-5 text-[#908b83]">
              Contact your travel advisor for additional activity and
              sightseeing details.
            </p>
          )}
        </div>
      );
    })
  ) : (
    <div className="card col-span-full p-6 text-sm text-[#77736c]">
      The detailed itinerary will be confirmed by your travel advisor.
    </div>
  )}
</div>



              {(tour.importantInfo || tour.terms) && (
                <div className="mt-12 grid gap-5 md:grid-cols-2">
                  <div className="rounded-2xl bg-[#f3ede5] p-6">
                    <div className="eyebrow">Important information</div>
                    <p className="mt-4 whitespace-pre-line text-[13px] leading-6 text-[#6f6c66]">
                      {tour.importantInfo}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#f3ede5] p-6">
                    <div className="eyebrow">Terms</div>
                    <p className="mt-4 whitespace-pre-line text-[13px] leading-6 text-[#6f6c66]">
                      {tour.terms}
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-12">
                <div className="flex items-end justify-between gap-5">
                  <div>
                    <div className="eyebrow">Available departures</div>
                    <h2 className="mt-2 font-['Manrope'] text-2xl font-extrabold">
                      Choose a date to start the conversation.
                    </h2>
                  </div>
                </div>
                {upcomingDepartures.length ? (
                  <div className="mt-5 space-y-2">
                    {upcomingDepartures.map((departure: any) => (
                      <div
                        key={departure.id}
                        className="flex flex-col justify-between gap-3 rounded-xl border border-[#e8e4dd] p-4 sm:flex-row sm:items-center"
                      >
                        <div className="flex items-center gap-3">
                          <CalendarDays size={17} className="text-[#f26b35]" />
                          <div>
                            <div className="text-[13px] font-bold">
                              {new Date(
                                departure.departure_date,
                              ).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </div>
                            <div className="text-[11px] text-[#908b83]">
                              {departure.label ?? "Scheduled departure"}
                              {departure.seats_available != null
                                ? ` · ${departure.seats_available} seats`
                                : ""}
                            </div>
                          </div>
                        </div>
                        <div className="text-[13px] font-bold">
                          {departure.price_from
                            ? format(Number(departure.price_from))
                            : "Price on request"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-5 rounded-xl bg-[#f3ede5] p-5 text-[13px] text-[#6f6c66]">
                    Departures are currently on request. Enquire and our travel
                    desk will confirm the next available options.
                  </div>
                )}
              </div>
            </div>

          </div>
          <div className="mt-10">
  {tourMapPoints.length > 0 ? (
    <>
      <TravelMap
        title={
          itineraryMapPoints.length > 0
            ? "Tour itinerary map"
            : "Destination map"
        }
        points={tourMapPoints}
        showRoute={itineraryMapPoints.length > 1}
        showStreetView
        height={400}
      />

      {itineraryMapPoints.length === 0 && (
        <p className="mt-2 text-sm text-gray-600">
          This map shows the destination location. Individual itinerary
          stops will appear when verified coordinates are available.
        </p>
      )}
    </>
  ) : (
    <div className="rounded-xl border border-gray-200 p-5">
      <h2 className="text-lg font-bold">Tour map</h2>
      <p className="mt-2 text-sm text-gray-600">
        Map coordinates are not yet available for this tour or its
        destination. Please check the destination's coordinates in the
        admin map-locations page.
      </p>
    </div>
  )}
</div>
        </section>
      </main>
      <Footer />
      <EnquiryModal
        open={enquiryOpen}
        onClose={() => setEnquiryOpen(false)}
        tour={{ id: tour.id, title: tour.title, destination: tour.destination }}
      />
      <DirectBookingModal
  open={directBookingOpen}
  onClose={() => setDirectBookingOpen(false)}
  tour={{
    id: Number(tour.id),
    title: tour.title,
    destination: tour.destination,
    priceFrom: tour.priceFrom,
    departures: (tour.departures ?? []) as any,
  }}
/>
    </div>
  );
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string")
    return value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  return [];
}

function InfoList({
  title,
  items,
  icon: Icon,
  muted,
}: {
  title: string;
  items: string[];
  icon: typeof Check;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-5 ${muted ? "bg-[#f3ede5]" : "bg-[#fff0e8]"}`}
    >
      <h3 className="font-['Manrope'] text-[15px] font-extrabold">{title}</h3>
      {items.length ? (
        <ul className="mt-4 space-y-3">
          {items.map((item, index) => (
            <li
              key={`${item}-${index}`}
              className="flex gap-2 text-[12px] leading-5 text-[#6f6c66]"
            >
              <Icon size={15} className="mt-0.5 shrink-0 text-[#f26b35]" />
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[12px] text-[#908b83]">
          Details available on request.
        </p>
      )}
    </div>
  );
}
