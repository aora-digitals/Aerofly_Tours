
import { ArrowRight, Compass, Loader2, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { supabase } from "@/lib/supabase";

type Destination = {
  id: number;
  slug: string;
  name: string;
  country: string;
  tagline: string | null;
  kind: string;
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
  highlights: string[] | null;
  tags: string[] | null;
  imageUrl: string | null;
  availability: string;
  destination: Destination | null;
};

type Preferences = {
  budget: string;
  duration: string;
  country: string;
  style: string;
  departureCity: string;
  travelDates: string;
};

const initialPreferences: Preferences = {
  budget: "",
  duration: "",
  country: "",
  style: "",
  departureCity: "",
  travelDates: "",
};

function parseBudget(query: string): number | null {
  const normalized = query.toLowerCase().replace(/,/g, "");
  const match = normalized.match(
    /(?:under|below|within|budget(?:\s+of)?|less than|upto|up to)\s*(?:₹|rs\.?\s*)?(\d+(?:\.\d+)?)\s*(lakh|lakhs|lac|lacs|k)?/,
  );

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];

  if (!Number.isFinite(amount)) return null;
  if (unit && /lakh|lac/.test(unit)) return amount * 100000;
  if (unit === "k") return amount * 1000;
  return amount;
}

function parseDuration(query: string): number | null {
  const match = query.toLowerCase().match(
    /(\d+)\s*(?:-|\s)?(?:day|days|night|nights)\b/,
  );
  return match ? Number(match[1]) : null;
}

function scoreTour(tour: Tour, query: string, style: string): number {
  const text = [
    tour.title,
    tour.overview,
    ...(tour.highlights ?? []),
    ...(tour.tags ?? []),
    tour.destination?.name,
    tour.destination?.country,
  ].join(" ").toLowerCase();

  const terms = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const ignored = new Set([
    "the", "and", "for", "with", "from", "under", "below",
    "trip", "tour", "days", "day", "nights", "night",
    "budget", "want", "need", "please", "around", "about",
  ]);

  let score = 0;

  for (const term of terms) {
    if (term.length < 3 || ignored.has(term)) continue;
    if (text.includes(term)) score += 2;
  }

  if (style && text.includes(style.toLowerCase())) score += 5;

  if (style === "family" && /family|kids|children/.test(text)) score += 5;
  if (style === "honeymoon" && /honeymoon|romantic|couple/.test(text)) score += 5;
  if (style === "adventure" && /adventure|trek|hiking|safari/.test(text)) score += 5;
  if (style === "relaxation" && /relax|beach|wellness|leisure/.test(text)) score += 5;

  return score;
}

export default function AIExplorer() {
  const [query, setQuery] = useState("");
  const [preferences, setPreferences] = useState(initialPreferences);
  const [tours, setTours] = useState<Tour[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const setPreference = (key: keyof Preferences, value: string) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  const effective = useMemo(() => {
    const text = query.trim();
    const budget = preferences.budget
      ? Number(preferences.budget)
      : parseBudget(text);
    const days = preferences.duration
      ? Number(preferences.duration)
      : parseDuration(text);

    return {
      budget: budget && Number.isFinite(budget) ? budget : null,
      days: days && Number.isFinite(days) ? days : null,
      country: preferences.country.trim().toLowerCase(),
      style: preferences.style || (
        /honeymoon|romantic|couple/i.test(text) ? "honeymoon" :
        /family|children|kids/i.test(text) ? "family" :
        /adventure|trek|hiking/i.test(text) ? "adventure" :
        /relax|beach|leisure/i.test(text) ? "relaxation" : ""
      ),
    };
  }, [query, preferences]);

  async function explore() {
    if (busy) return;

    setBusy(true);
    setError("");
    setNotice("");
    setSearched(true);

    try {
      const [tourResult, destinationResult] = await Promise.all([
        supabase
          .from("tours")
          .select(
            'id,slug,title,"destinationId","durationDays","durationNights","priceFrom",overview,highlights,tags,"imageUrl",availability,destinations!tours_destination_fk(id,slug,name,country,tagline,kind)',
          )
          .eq("status", "published")
          .order("featured", { ascending: false })
          .limit(100),
        supabase
          .from("destinations")
          .select("id,slug,name,country,tagline,kind")
          .order("featured", { ascending: false })
          .limit(100),
      ]);

      if (tourResult.error) throw tourResult.error;
      if (destinationResult.error) throw destinationResult.error;

      const allTours: Tour[] = (tourResult.data ?? []).map((row) => {
        const destination = Array.isArray(row.destinations)
          ? row.destinations[0] ?? null
          : row.destinations;

        return {
          ...row,
          destination,
        } as unknown as Tour;
      });

      const allDestinations = (destinationResult.data ?? []) as Destination[];

      const matching = allTours
        .filter((tour) => {
          if (
            effective.budget !== null &&
            Number(tour.priceFrom) > effective.budget
          ) return false;

          if (
            effective.days !== null &&
            tour.durationDays !== effective.days
          ) return false;

          if (
            effective.country &&
            !tour.destination?.country.toLowerCase().includes(effective.country) &&
            !tour.destination?.name.toLowerCase().includes(effective.country)
          ) return false;

          return true;
        })
        .map((tour) => ({
          tour,
          score: scoreTour(tour, query, effective.style),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
        .map(({ tour }) => tour);

      setTours(matching);
      setDestinations(
        allDestinations
          .filter((destination) =>
            !effective.country ||
            destination.country.toLowerCase().includes(effective.country) ||
            destination.name.toLowerCase().includes(effective.country),
          )
          .slice(0, 8),
      );

      if (!matching.length) {
        setNotice(
          "No published tour matches every selected filter. Try increasing your budget, widening the duration, or removing the country filter.",
        );
      } else {
        setNotice(
          "Results are based on published catalogue details. Starting prices do not confirm availability for your dates.",
        );
      }

      if (preferences.departureCity || preferences.travelDates) {
        setNotice((current) =>
          `${current} Departure city and travel dates are saved in this search form only; they have not been verified against live departures.`,
        );
      }
    } catch {
      setTours([]);
      setDestinations([]);
      setError(
        "We couldn't retrieve the published catalogue. Please retry or browse all tours.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="ai-explorer" className="section bg-[#f3ede5]">
      <div className="container">
        <div className="grid gap-8 lg:grid-cols-[.75fr_1.25fr] lg:items-start">
          <div>
            <div className="eyebrow flex items-center gap-2">
              <Compass size={14} /> AI Explorer
            </div>
            <h2 className="display mt-3 text-4xl font-extrabold sm:text-5xl">
              Find the trip that fits you.
            </h2>
            <p className="mt-4 text-[14px] leading-7 text-[#77736c]">
              Describe your ideal holiday in your own words. Combine your
              budget, trip duration, destination and travel style to explore
              published AeroFly tours.
            </p>

            <div className="mt-7 rounded-2xl border border-[#e4dbcf] bg-white p-5">
              <label htmlFor="explorer-query" className="text-xs font-bold">
                Describe your trip
              </label>
              <textarea
                id="explorer-query"
                value={query}
                onChange={(event) => setQuery(event.target.value.slice(0, 1200))}
                maxLength={1200}
                rows={3}
                placeholder="Example: A family holiday in Thailand for 6 days under ₹1.2 lakh"
                className="field mt-2 min-h-24 resize-y"
              />

              <div className="mt-4 flex items-center gap-2 text-xs font-bold">
                <SlidersHorizontal size={14} className="text-[#f26b35]" />
                Refine your search
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Maximum budget (INR)">
                  <input
                    type="number"
                    min="0"
                    max="100000000"
                    value={preferences.budget}
                    onChange={(e) => setPreference("budget", e.target.value)}
                    className="field"
                    placeholder="e.g. 80000"
                  />
                </Field>

                <Field label="Trip duration">
                  <select
                    value={preferences.duration}
                    onChange={(e) => setPreference("duration", e.target.value)}
                    className="field"
                  >
                    <option value="">Any duration</option>
                    {[2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 15].map((days) => (
                      <option key={days} value={days}>{days} days</option>
                    ))}
                  </select>
                </Field>

                <Field label="Country or destination">
                  <input
                    value={preferences.country}
                    onChange={(e) => setPreference("country", e.target.value)}
                    className="field"
                    maxLength={100}
                    placeholder="India, Dubai, Thailand…"
                  />
                </Field>

                <Field label="Travel style">
                  <select
                    value={preferences.style}
                    onChange={(e) => setPreference("style", e.target.value)}
                    className="field"
                  >
                    <option value="">Any style</option>
                    <option value="family">Family</option>
                    <option value="honeymoon">Honeymoon / couple</option>
                    <option value="adventure">Adventure</option>
                    <option value="relaxation">Relaxation / beach</option>
                    <option value="group">Group travel</option>
                  </select>
                </Field>

                <Field label="Departure city (not live-verified)">
                  <input
                    value={preferences.departureCity}
                    onChange={(e) => setPreference("departureCity", e.target.value)}
                    className="field"
                    maxLength={100}
                    placeholder="e.g. Pune"
                  />
                </Field>

                <Field label="Preferred travel dates">
                  <input
                    value={preferences.travelDates}
                    onChange={(e) => setPreference("travelDates", e.target.value)}
                    className="field"
                    maxLength={100}
                    placeholder="e.g. December 2026"
                  />
                </Field>
              </div>

              <button
                type="button"
                onClick={explore}
                disabled={busy || (!query.trim() && !preferences.country && !preferences.budget && !preferences.duration && !preferences.style)}
                className="btn btn-primary mt-5 w-full"
              >
                {busy ? (
                  <><Loader2 size={15} className="animate-spin" /> Exploring tours…</>
                ) : (
                  <><Search size={15} /> Explore matching trips <ArrowRight size={15} /></>
                )}
              </button>
            </div>
          </div>

          <div aria-live="polite" aria-busy={busy}>
            {!searched && (
              <div className="flex min-h-[300px] flex-col justify-center rounded-2xl border border-dashed border-[#d7cbbc] p-8 text-center">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white text-[#f26b35]">
                  <Compass size={21} />
                </div>
                <h3 className="mt-4 font-['Manrope'] text-xl font-extrabold">
                  Your next journey starts here
                </h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#77736c]">
                  Start with a sentence or a few filters. We'll search published
                  AeroFly tours even when the AI provider is unavailable.
                </p>
              </div>
            )}

            {error && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                {error} <Link href="/tours" className="font-bold underline">Browse tours</Link>
              </div>
            )}

            {notice && !error && (
              <p className="mb-4 rounded-xl border border-[#e4dbcf] bg-white p-4 text-xs leading-5 text-[#77736c]">
                {notice}
              </p>
            )}

            {tours.length > 0 && (
              <>
                <div className="mb-4 flex items-end justify-between gap-3">
                  <div>
                    <div className="eyebrow">Published catalogue matches</div>
                    <h3 className="mt-1 font-['Manrope'] text-2xl font-extrabold">
                      Tours to explore
                    </h3>
                  </div>
                  <span className="text-xs text-[#77736c]">{tours.length} results</span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {tours.map((tour) => (
                    <article key={tour.id} className="overflow-hidden rounded-2xl border border-[#e4dbcf] bg-white">
                      <Link href={`/tours/${tour.slug}`} className="block">
                        {tour.imageUrl ? (
                          <img
                            src={tour.imageUrl}
                            alt={tour.title}
                            loading="lazy"
                            className="h-44 w-full object-cover"
                          />
                        ) : (
                          <div className="grid h-44 place-items-center bg-[#eee5d9] text-[#c94d1c]">
                            <Compass size={28} />
                          </div>
                        )}
                      </Link>
                      <div className="p-4">
                        <h4 className="font-['Manrope'] font-extrabold">{tour.title}</h4>
                        <p className="mt-1 text-xs text-[#77736c]">
                          {tour.destination
                            ? `${tour.destination.name}, ${tour.destination.country}`
                            : "Published AeroFly tour"}
                        </p>
                        <p className="mt-2 text-xs text-[#77736c]">
                          {tour.durationDays} days · {tour.durationNights} nights
                        </p>
                        <p className="mt-2 font-bold text-[#c94d1c]">
                          {Number.isFinite(Number(tour.priceFrom))
                            ? `From ₹${Number(tour.priceFrom).toLocaleString("en-IN")}`
                            : "Contact us for pricing"}
                        </p>
                        <p className="mt-1 text-[11px] text-[#77736c]">
                          Availability: {tour.availability || "On request"}
                        </p>
                        <Link
                          href={`/tours/${tour.slug}`}
                          className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-[#c94d1c]"
                        >
                          View tour details <ArrowRight size={13} />
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}

            {destinations.length > 0 && (
              <div className="mt-7">
                <div className="eyebrow">Explore destinations</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {destinations.map((destination) => (
                    <Link
                      key={destination.id}
                      href={`/destinations/${destination.slug}`}
                      className="rounded-full border border-[#ded2c4] bg-white px-4 py-2 text-xs font-bold hover:border-[#f26b35]"
                    >
                      {destination.name}, {destination.country}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {searched && !busy && !error && tours.length === 0 && destinations.length === 0 && (
              <div className="rounded-xl bg-white p-6 text-sm text-[#77736c]">
                No matching tours or destinations were found. Try a broader search or browse the full catalogue.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[11px] font-semibold text-[#77736c]">
        {label}
      </span>
      {children}
    </label>
  );
}
