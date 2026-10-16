import { Filter, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import TourCard from "@/components/site/TourCard";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "../hooks/usePageMeta";
import { useAuth } from "@/_core/hooks/useAuth";
import { recordCustomerActivity } from "@/lib/customer";

export default function Tours() {
  usePageMeta({
    title: "Tours | AeroFly Tours",
    description: "Browse AeroFly domestic and international tours by destination, category, price, duration and travel style.",
    canonical: window.location.origin + "/tours",
  });
 
  const initial = useMemo(() => new URLSearchParams(window.location.search), []);
  const { user } = useAuth();
  const [search, setSearch] = useState(initial.get("search") ?? "");
  const [kind, setKind] = useState<"all" | "domestic" | "international">((initial.get("kind") as any) ?? "all");
  const [category, setCategory] = useState(initial.get("category") ?? "");
  const [destination, setDestination] = useState(initial.get("destination") ?? "");
  const [minPrice, setMinPrice] = useState(0);
  const [maxPrice, setMaxPrice] = useState(300000);
  const [minDuration, setMinDuration] = useState(1);
  const [maxDuration, setMaxDuration] = useState(30);
  const [travelType, setTravelType] = useState("");
  const [sort, setSort] = useState<"featured" | "newest" | "price_asc" | "price_desc" | "duration" | "rating" | "popular" | "most_enquired">("featured");
  const [page, setPage] = useState(1);

  const input = useMemo(() => ({
    search: search.trim() || undefined,
    kind: kind === "all" ? undefined : kind,
    category: category || undefined,
    destination: destination || undefined,
    minPrice: minPrice > 0 ? minPrice : undefined,
    maxPrice: maxPrice < 300000 ? maxPrice : undefined,
    minDuration: minDuration > 1 ? minDuration : undefined,
    maxDuration: maxDuration < 30 ? maxDuration : undefined,
    travelType: travelType || undefined,
    sort,
    page,
    pageSize: 12,
  }), [search, kind, category, destination, minPrice, maxPrice, minDuration, maxDuration, travelType, sort, page]);

  const { data, isLoading, isError, isFetching } = trpc.content.tours.useQuery(input, { staleTime: 30_000, placeholderData: (previous) => previous });
  const { data: categories } = trpc.content.categories.useQuery(undefined, { staleTime: 300_000 });
  const { data: destinations } = trpc.content.destinations.useQuery(undefined, { staleTime: 300_000 });

  const reset = () => {
    setSearch(""); setKind("all"); setCategory(""); setDestination(""); setMinPrice(0); setMaxPrice(300000); setMinDuration(1); setMaxDuration(30); setTravelType(""); setSort("featured"); setPage(1);
  };

  return <div className="min-h-screen"><Header /><main>
    <section className="border-b border-[#e8e4dd] bg-[#f3ede5] py-16"><div className="container"><div className="eyebrow">The AeroFly collection</div><h1 className="display mt-4 max-w-[680px] text-5xl font-extrabold sm:text-7xl">Find the route<br /><span className="text-[#f26b35]">that fits.</span></h1><p className="mt-5 max-w-[560px] text-[15px] leading-7 text-[#6f6c66]">Browse thoughtfully paced domestic and international journeys. Filter by the details that actually matter.</p>
      <div className="mt-8 grid gap-3 rounded-2xl bg-white p-3 shadow-[0_18px_45px_rgba(29,25,20,.08)] lg:grid-cols-[1.7fr_1fr_1fr_auto]"><label className="sr-only" htmlFor="tour-search">Search tours</label><div className="relative"><Search size={17} className="absolute left-4 top-3.5 text-[#908b83]" /><input id="tour-search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="field pl-11" placeholder="Search Dubai, Kerala, family…" /></div><select className="field" value={kind} onChange={(e) => { setKind(e.target.value as any); setPage(1); }}><option value="all">All destinations</option><option value="domestic">Domestic</option><option value="international">International</option></select><select className="field" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}><option value="">All travel styles</option>{categories?.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select>
      <button className="btn btn-dark"
       onClick={() => {
    setPage(1);

    if (user?.id && search.trim()) {
      void recordCustomerActivity(
        user.id,
        "tour_search",
        null,
        null,
        { source: "catalogue_search" },
      ).catch(() => undefined);
    }
  }}
       >
        <Search size={15} /> Find journeys
        </button>
        </div>
    </div>
    </section>

    <section className="section"><div className="container grid gap-8 lg:grid-cols-[260px_1fr]">
      <aside className="card h-fit p-5 lg:sticky lg:top-24"><div className="flex items-center justify-between"><div className="flex items-center gap-2 font-['Manrope'] font-extrabold"><SlidersHorizontal size={16} /> Filters</div><button onClick={reset} className="text-[11px] font-bold text-[#c94d1c]">Reset</button></div>
        <label className="mt-6 block"><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-[#77736c]">Destination</span><select className="field" value={destination} onChange={(e) => { setDestination(e.target.value); setPage(1); }}><option value="">All destinations</option>{destinations?.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
        <label className="mt-5 block"><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-[#77736c]">Travel type</span><select className="field" value={travelType} onChange={(e) => { setTravelType(e.target.value); setPage(1); }}><option value="">Any</option><option value="Family">Family</option><option value="Honeymoon">Honeymoon</option><option value="Group">Group</option><option value="Adventure">Adventure</option><option value="Luxury">Luxury</option><option value="Budget">Budget</option></select></label>
        <div className="mt-5"><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-[#77736c]">Price: ₹{minPrice.toLocaleString("en-IN")} – ₹{maxPrice.toLocaleString("en-IN")}</span><input aria-label="Minimum price" type="range" min="0" max="300000" step="5000" value={minPrice} onChange={(e) => { setMinPrice(Number(e.target.value)); setPage(1); }} className="w-full" /><input aria-label="Maximum price" type="range" min="0" max="300000" step="5000" value={maxPrice} onChange={(e) => { setMaxPrice(Number(e.target.value)); setPage(1); }} className="mt-2 w-full" /></div>
        <div className="mt-5"><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-[#77736c]">Duration: {minDuration}–{maxDuration} days</span><input aria-label="Minimum duration" type="range" min="1" max="30" value={minDuration} onChange={(e) => { setMinDuration(Number(e.target.value)); setPage(1); }} className="w-full" /><input aria-label="Maximum duration" type="range" min="1" max="30" value={maxDuration} onChange={(e) => { setMaxDuration(Number(e.target.value)); setPage(1); }} className="mt-2 w-full" /></div>
      </aside>

      <div><div className="flex flex-col justify-between gap-4 border-b border-[#e8e4dd] pb-5 sm:flex-row sm:items-center"><div><span className="text-[13px] font-semibold text-[#6f6c66]">{isLoading ? "Finding journeys…" : `${data?.total ?? 0} journeys to explore`}</span>{isFetching && !isLoading && <span className="ml-2 text-[11px] text-[#908b83]">Updating…</span>}</div><label className="flex items-center gap-2 text-[12px] font-semibold"><span className="text-[#908b83]">Sort</span><select className="border-0 bg-transparent outline-none" value={sort} onChange={(e) => { setSort(e.target.value as any); setPage(1); }}><option value="featured">Featured</option><option value="newest">Newest</option><option value="popular">Most viewed</option><option value="most_enquired">Most enquired</option><option value="rating">Top rated</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="duration">Shortest first</option></select></label></div>
        {isError ? <div className="card mt-8 p-12 text-center"><h2 className="font-['Manrope'] text-2xl font-extrabold">We couldn’t load the journeys.</h2><p className="mt-2 text-sm text-[#77736c]">Check the catalogue connection and try again.</p></div> : isLoading ? <div className="mt-8 grid gap-5 md:grid-cols-2"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div> : data?.items.length ? <><div className="mt-8 grid gap-5 md:grid-cols-2">{data.items.map((tour) => <TourCard key={tour.slug} tour={tour} />)}</div><div className="mt-8 flex items-center justify-between"><button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button><span className="text-[12px] font-semibold text-[#77736c]">Page {data.page} of {data.totalPages}</span><button className="btn btn-dark" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button></div></> : <div className="card mt-8 grid place-items-center p-16 text-center"><Filter size={28} className="text-[#f26b35]" /><h2 className="mt-5 font-['Manrope'] text-2xl font-extrabold">Nothing quite matched that search.</h2><p className="mt-2 max-w-[360px] text-[13px] leading-6 text-[#6f6c66]">Try a broader destination or tell us what you have in mind and we’ll shape a route around it.</p><Link href="/plan-my-trip" className="btn btn-primary mt-6">Plan a custom trip</Link></div>}</div>
      </div>
    </section>
  </main><Footer /></div>;
}
function Skeleton() { return <div className="h-[420px] animate-pulse rounded-2xl bg-[#eee9e1]" />; }
