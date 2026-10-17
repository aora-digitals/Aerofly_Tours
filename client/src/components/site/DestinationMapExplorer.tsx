
import { ArrowRight, Globe2, MapPin, Navigation } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import TravelMap, {
  type MapPoint,
  hasValidCoordinates,
} from "@/components/site/TravelMap";

type Destination = {
  id?: number;
  slug: string;
  name: string;
  country: string;
  kind: "domestic" | "international";
  tagline: string | null;
  imageUrl: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  map_visible?: boolean | null;
};

type DestinationMapExplorerProps = {
  destinations: Destination[];
};

function toCoordinate(
  value: number | string | null | undefined,
): number | null {
  if (value == null || value === "") return null;

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export default function DestinationMapExplorer({
  destinations,
}: DestinationMapExplorerProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<
    "all" | "domestic" | "international"
  >("all");

  const filteredDestinations = useMemo(
    () =>
      destinations.filter(
        (destination) =>
          kindFilter === "all" || destination.kind === kindFilter,
      ),
    [destinations, kindFilter],
  );

  const mapPoints = useMemo<MapPoint[]>(
    () =>
      filteredDestinations
        .map((destination): MapPoint => ({
          id: `destination-${destination.slug}`,
          name: destination.name,
          lat: toCoordinate(destination.latitude),
          lng: toCoordinate(destination.longitude),
          type: "destination",
          country: destination.country,
          description: destination.tagline,
          imageUrl: destination.imageUrl,
          visible: destination.map_visible !== false,
          href: `/destinations/${destination.slug}`,
        }))
        .filter(
          (point) =>
            point.visible !== false && hasValidCoordinates(point),
        ),
    [filteredDestinations],
  );

  const selectedDestination = useMemo(() => {
    const current = filteredDestinations.find(
      (destination) => destination.slug === selectedSlug,
    );

    if (current) return current;

    // Prefer a destination that actually has coordinates.
    const firstMapped = filteredDestinations.find((destination) =>
      mapPoints.some(
        (point) => point.id === `destination-${destination.slug}`,
      ),
    );

    return firstMapped ?? filteredDestinations[0] ?? null;
  }, [filteredDestinations, mapPoints, selectedSlug]);

  useEffect(() => {
    if (
      selectedDestination &&
      selectedDestination.slug !== selectedSlug
    ) {
      setSelectedSlug(selectedDestination.slug);
    }

    if (!selectedDestination && selectedSlug !== null) {
      setSelectedSlug(null);
    }
  }, [selectedDestination, selectedSlug]);

  const selectedHasCoordinates = selectedDestination
    ? mapPoints.some(
        (point) =>
          point.id === `destination-${selectedDestination.slug}`,
      )
    : false;

  return (
    <section className="section overflow-hidden bg-[#20201e] text-white">
      <div className="container">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="min-w-0">
            <div className="eyebrow text-[#ffac88]">
              Explore by map
            </div>

            <h2 className="display mt-3 max-w-[680px] text-4xl font-extrabold leading-[1.05] sm:text-5xl lg:text-6xl">
              See where the next
              <br />
              <span className="text-[#ff9c70]">
                good idea could take you.
              </span>
            </h2>

            <p className="mt-4 max-w-xl text-sm leading-6 text-white/60">
              Explore destinations across India and beyond. Select a place
              to view its details and open its destination page.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 text-xs font-semibold text-white/65">
            <Navigation size={15} className="text-[#f26b35]" />
            India and beyond
          </div>
        </div>

        <div className="mt-9 grid min-w-0 overflow-hidden rounded-3xl bg-white text-[#20201e] shadow-2xl lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          {/* Map area */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e9e5de] bg-[#faf9f6] px-4 py-4 sm:px-5">
              <div className="text-xs font-bold text-[#514d46]">
                {mapPoints.length} mapped destination
                {mapPoints.length === 1 ? "" : "s"}
              </div>

              <div
                className="flex flex-wrap gap-2"
                aria-label="Filter destinations"
              >
                {(
                  [
                    ["all", "All places"],
                    ["domestic", "India"],
                    ["international", "International"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setKindFilter(value)}
                    aria-pressed={kindFilter === value}
                    className={`rounded-full px-3 py-2 text-xs font-bold transition ${
                      kindFilter === value
                        ? "bg-[#f26b35] text-white"
                        : "border border-[#e6e1d9] bg-white text-[#514d46] hover:border-[#f26b35]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative h-[360px] bg-[#e3e9e5] sm:h-[440px] lg:h-[540px]">
              {mapPoints.length > 0 ? (
                <TravelMap
                  points={mapPoints}
                  title="Explore destinations"
                  showStreetView={false}
                  showRoute={false}
                  height={540}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <MapPin
                    size={30}
                    className="text-[#f26b35]"
                    aria-hidden="true"
                  />
                  <p className="font-bold text-[#38352f]">
                    Destination coordinates unavailable
                  </p>
                  <p className="max-w-sm text-sm leading-6 text-[#77736c]">
                    Add valid latitude and longitude values to the
                    destinations in Supabase to display map markers.
                  </p>
                </div>
              )}
            </div>

            <div className="border-t border-[#e9e5de] bg-[#faf9f6] px-4 py-3 text-xs leading-5 text-[#77736c] sm:px-5">
              Map markers use coordinates stored in AeroFly Tours.
              Destinations without valid coordinates are not plotted.
            </div>
          </div>

          {/* Destination details */}
          <aside className="flex min-w-0 flex-col border-t border-[#e9e5de] lg:border-l lg:border-t-0">
            <div className="p-5 sm:p-6">
              <div className="flex items-center gap-2 text-[#c94d1c]">
                <Globe2 size={16} />
                <span className="text-[10px] font-extrabold uppercase tracking-[0.16em]">
                  Selected destination
                </span>
              </div>

              {selectedDestination ? (
                <>
                  {selectedDestination.imageUrl ? (
                    <img
                      src={selectedDestination.imageUrl}
                      alt={selectedDestination.name}
                      loading="lazy"
                      className="mt-5 aspect-[16/9] w-full rounded-2xl bg-[#f2f0eb] object-cover"
                    />
                  ) : (
                    <div className="mt-5 flex aspect-[16/9] w-full items-center justify-center rounded-2xl bg-[#f2f0eb] text-[#908b83]">
                      <MapPin size={32} aria-hidden="true" />
                    </div>
                  )}

                  <div className="mt-5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#908b83]">
                    {selectedDestination.kind === "domestic"
                      ? "India"
                      : "International"}{" "}
                    · {selectedDestination.country}
                  </div>

                  <h3 className="mt-2 break-words font-['Manrope'] text-3xl font-extrabold tracking-[-0.04em]">
                    {selectedDestination.name}
                  </h3>

                  <p className="mt-3 text-sm leading-6 text-[#77736c]">
                    {selectedDestination.tagline ??
                      "Discover the places and experiences waiting for you."}
                  </p>

                  {!selectedHasCoordinates && (
                    <p className="mt-3 rounded-xl bg-[#fff4eb] p-3 text-xs leading-5 text-[#9a471f]">
                      This destination has no valid map coordinates yet.
                      Its details are available, but it cannot have a map
                      marker until coordinates are added.
                    </p>
                  )}

                  <Link
                    href={`/destinations/${selectedDestination.slug}`}
                    className="btn btn-dark mt-5 inline-flex items-center gap-2 self-start"
                  >
                    Explore destination
                    <ArrowRight size={14} />
                  </Link>
                </>
              ) : (
                <p className="py-10 text-sm text-[#77736c]">
                  No destinations are available for this filter.
                </p>
              )}
            </div>

            <div className="border-t border-[#e9e5de] p-5 sm:p-6">
              <h4 className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#77736c]">
                Browse destinations
              </h4>

              <div className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
                {filteredDestinations.map((destination) => {
                  const isSelected =
                    destination.slug === selectedDestination?.slug;
                  const isMapped = mapPoints.some(
                    (point) =>
                      point.id === `destination-${destination.slug}`,
                  );

                  return (
                    <button
                      key={destination.slug}
                      type="button"
                      onClick={() => setSelectedSlug(destination.slug)}
                      aria-pressed={isSelected}
                      className={`flex w-full min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition ${
                        isSelected
                          ? "border-[#f26b35] bg-[#fff4eb]"
                          : "border-[#ece8e1] bg-white hover:border-[#f26b35]/60"
                      }`}
                    >
                      <span
                        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
                          isSelected
                            ? "bg-[#f26b35] text-white"
                            : "bg-[#f2f0eb] text-[#77736c]"
                        }`}
                      >
                        <MapPin size={16} />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">
                          {destination.name}
                        </span>
                        <span className="mt-1 block truncate text-xs text-[#908b83]">
                          {destination.country}
                          {!isMapped ? " · Coordinates missing" : ""}
                        </span>
                      </span>

                      {isSelected && (
                        <span className="shrink-0 text-[10px] font-bold text-[#c94d1c]">
                          SELECTED
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-auto flex items-center gap-2 border-t border-[#e9e5de] px-5 py-4 text-xs text-[#908b83] sm:px-6">
              <MapPin
                size={14}
                className="shrink-0 text-[#f26b35]"
                aria-hidden="true"
              />
              {filteredDestinations.length} places in the AeroFly collection
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
