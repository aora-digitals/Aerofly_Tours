import { ArrowRight, Search as SearchIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import TourCard from "@/components/site/TourCard";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "../hooks/usePageMeta";

const Empty = ({ text }: { text: string }) => (
  <div className="mt-6 rounded-2xl border border-dashed border-[#e8e4dd] bg-[#faf8f4] px-6 py-10 text-center text-[13px] text-[#77736c]">
    {text}
  </div>
);

export default function SearchPage() {
  
usePageMeta({
  title: "Search | AeroFlyy Tours",
  description:
    "Search AeroFlyy tours, destinations and travel services.",
  canonical: `${window.location.origin}/search`,
  indexable: false,
});


  const [term, setTerm] = useState("");
  const [submitted, setSubmitted] = useState("");

  const { data: tours, isLoading: toursLoading } =
    trpc.content.tours.useQuery(
      {
        search: submitted || undefined,
        page: 1,
        pageSize: 6,
      },
      {
        enabled: Boolean(submitted),
        staleTime: 30_000,
      },
    );

  const { data: destinations, isLoading: destinationsLoading } =
    trpc.content.destinations.useQuery(
      {
        search: submitted || undefined,
      },
      {
        enabled: Boolean(submitted),
        staleTime: 60_000,
      },
    );

  const { data: services } = trpc.content.services.useQuery(undefined, {
    staleTime: 300_000,
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(term.trim());
  };

  const serviceMatches =
    services
      ?.filter((item) =>
        `${item.title} ${item.intro} ${item.description}`
          .toLowerCase()
          .includes(submitted.toLowerCase()),
      )
      .slice(0, 4) ?? [];

  return (
    <div className="min-h-screen">
      <Header />

      <main>
        <section className="border-b border-[#e8e4dd] bg-[#f3ede5] py-16">
          <div className="container">
            <div className="eyebrow">Global search</div>

            <h1 className="display mt-4 text-5xl font-extrabold sm:text-7xl">
              Where next?
            </h1>

            <form
              onSubmit={submit}
              className="mt-8 flex max-w-[720px] gap-3 rounded-2xl bg-white p-3 shadow-[0_18px_45px_rgba(29,25,20,.08)]"
            >
              <div className="relative flex-1">
                <SearchIcon
                  size={17}
                  className="absolute left-4 top-3.5 text-[#908b83]"
                />

                <label
                  className="sr-only"
                  htmlFor="global-search"
                >
                  Search tours, destinations or services
                </label>

                <input
                  autoFocus
                  id="global-search"
                  className="field border-0 bg-[#fbfaf8] pl-11"
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder="Search tours, destinations or services"
                />
              </div>

              <button className="btn btn-dark" type="submit">
                Search
              </button>
            </form>
          </div>
        </section>

        <section className="section">
          <div className="container">
            {!submitted ? (
              <div className="card p-10 text-center">
                <div className="eyebrow">Start with a thought</div>

                <h2 className="mt-3 font-['Manrope'] text-2xl font-extrabold">
                  Try “Dubai”, “honeymoon” or “Kerala”.
                </h2>

                <p className="mt-2 text-[13px] text-[#77736c]">
                  Search is connected to the live public catalogue.
                </p>
              </div>
            ) : (
              <div className="space-y-14">
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-semibold text-[#6f6c66]">
                    Results for “{submitted}”
                  </div>

                  <Link
                    href="/plan-my-trip"
                    className="text-[12px] font-bold text-[#c94d1c]"
                  >
                    Can’t find it? Plan a custom trip{" "}
                    <ArrowRight size={13} className="inline" />
                  </Link>
                </div>

                <section>
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="eyebrow">Tours</div>

                      <h2 className="mt-2 font-['Manrope'] text-2xl font-extrabold">
                        Journeys
                      </h2>
                    </div>

                    <Link
                      href={`/tours?search=${encodeURIComponent(submitted)}`}
                      className="text-[12px] font-bold text-[#c94d1c]"
                    >
                      All tour results{" "}
                      <ArrowRight size={13} className="inline" />
                    </Link>
                  </div>

                  {toursLoading ? (
                    <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                      <Skeleton />
                      <Skeleton />
                      <Skeleton />
                    </div>
                  ) : tours?.items?.length ? (
                    <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                      {tours.items.map((tour) => (
                        <TourCard key={tour.slug} tour={tour} />
                      ))}
                    </div>
                  ) : (
                    <Empty text="No tours matched this search." />
                  )}
                </section>

                <section>
                  <div className="eyebrow">Destinations</div>

                  <h2 className="mt-2 font-['Manrope'] text-2xl font-extrabold">
                    Places
                  </h2>

                  {destinationsLoading ? (
                    <div className="mt-4 h-24 animate-pulse rounded-2xl bg-[#eee9e1]" />
                  ) : destinations?.length ? (
                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      {destinations.slice(0, 8).map((item) => (
                        <Link
                          key={item.slug}
                          href={`/destinations/${item.slug}`}
                          className="flex items-center justify-between rounded-xl border border-[#e8e4dd] p-4 text-[13px] font-bold hover:border-[#f2b59a]"
                        >
                          <span>
                            {item.name}

                            <span className="ml-2 text-[11px] font-medium text-[#908b83]">
                              {item.country}
                            </span>
                          </span>

                          <ArrowRight
                            size={14}
                            className="text-[#f26b35]"
                          />
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <Empty text="No destinations matched this search." />
                  )}
                </section>

                <section>
                  <div className="eyebrow">Services</div>

                  <h2 className="mt-2 font-['Manrope'] text-2xl font-extrabold">
                    Travel support
                  </h2>

                  {serviceMatches.length ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {serviceMatches.map((item) => (
                        <Link
                          key={item.slug}
                          href={`/services/${item.slug}`}
                          className="rounded-xl border border-[#e8e4dd] p-5 hover:border-[#f2b59a]"
                        >
                          <div className="font-bold">{item.title}</div>

                          <div className="mt-1 text-[12px] leading-5 text-[#77736c]">
                            {item.intro}
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <Empty text="No services matched this search." />
                  )}
                </section>
              </div>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function Skeleton() {
  return (
    <div className="h-[420px] animate-pulse rounded-2xl bg-[#eee9e1]" />
  );
}