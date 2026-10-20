import {
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  CarFront,
  ChevronRight,
  Compass,
  FileCheck2,
  Hotel,
  MapPinned,
  Plane,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import TourCard from "@/components/site/TourCard";
import EnquiryModal from "@/components/site/EnquiryModal";
import AITripConcierge from "@/components/site/AITripConcierge";
import DemoTripExplorer from "@/components/site/DemoTripExplorer";
import Reveal from "@/components/site/Reveal";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "../hooks/usePageMeta";
// import PersonalizedTourRecommendations from "@/components/site/PersonalizedTourRecommendations";
// import { useLanguage } from "@/contexts/LanguageContext";
// import AIExplorer from "@/components/site/AIExplorer";
 
const heroImage = "https://images.unsplash.com/photo-1542296332-2e4473faf563?auto=format&fit=crop&w=1800&q=82";
const iconMap: Record<string, typeof Compass> = {
  FileCheck2,
  Plane,
  Hotel,
  CarFront,
  ShieldCheck,
  Sparkles,
};

export default function Home() {
 
usePageMeta({
  title: "AeroFlyy Tours | Thoughtful Domestic & International Travel",
  description:
    "Explore curated domestic and international tours, destinations and travel assistance from AeroFlyy Tours.",
  canonical: `${window.location.origin}/`,
  image: heroImage,
  structuredData: {
    "@context": "https://schema.org",
    "@type": "TravelAgency",
    name: "AeroFlyy Tours",
    url: "https://aeroflyytours.com/",
    description:
      "Domestic and international travel planning and assistance.",
  },
});


  const { data, isLoading, isError } = trpc.content.home.useQuery(undefined, {
    staleTime: 60_000,
  });

//   const recommendationTours = [
//   ...(data?.featuredTours ?? []),
//   ...(data?.trendingTours ?? []),
//   ...(data?.domesticTours ?? []),
//   ...(data?.internationalTours ?? []),
// ];

  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [query, setQuery] = useState("");

  const destinations = data?.destinations?.filter((item) => item.featured).slice(0, 4) ?? [];
  const services = data?.services ?? [];
  const blogs = data?.blogs ?? [];
  // const { language } = useLanguage();

  return (
    <div className="min-h-screen bg-[#fbfaf8]">
      <Header />
      <main>
        <section className="relative min-h-[650px] overflow-hidden bg-[#191918] text-white">
          <img src={heroImage} alt="Airplane above the clouds" className="absolute inset-0 h-full w-full object-cover opacity-65" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#111110]/90 via-[#111110]/55 to-transparent" />
          <div className="relative mx-auto flex min-h-[650px] max-w-[1240px] items-center px-6 py-20 sm:px-8 lg:px-10">
            <div className="max-w-[680px]">
              <div className="reveal eyebrow text-[#ffb18c]">Thoughtful travel, from Pune to the world</div>
              <h1 className="display reveal reveal-delay-1 mt-5 max-w-[680px] text-[52px] font-extrabold sm:text-[72px]"> 
                Your journey.<br /><span className="text-[#ff9c70]">Our responsibility.</span>
              </h1>
              <p className="reveal reveal-delay-2 mt-7 max-w-[540px] text-[16px] leading-7 text-white/78 sm:text-[18px]">
                Complete domestic and international travel solutions, from planning and visas to flights, stays, sightseeing and a safe return.
              </p>
              <div className="reveal reveal-delay-3 mt-9 flex flex-wrap gap-3">
                <Link href="/tours" className="btn btn-primary">Explore tours <ArrowRight size={16} /></Link>
                <button onClick={() => setEnquiryOpen(true)} className="btn border border-white/25 bg-white/10 text-white backdrop-blur hover:bg-white hover:text-[#181817]">Plan my trip</button>
              </div>
            </div>
            <div className="drift absolute bottom-10 right-[9%] hidden rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-md lg:block">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-[#f26b35]"><MapPinned size={18} /></div>
                <div><div className="text-[11px] font-bold uppercase tracking-[.15em] text-white/55">Travel desk</div><div className="mt-1 text-[13px] font-semibold">Ready when your route is</div></div>
              </div>
            </div>
          </div>
        </section>

        <section className="relative z-10 -mt-12">
          <div className="container">
            <div className="card p-5 sm:p-6">
              <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
                <div><div className="eyebrow">Find a starting point</div><h2 className="mt-2 font-['Manrope'] text-2xl font-extrabold tracking-[-.05em]">Where are you thinking of going?</h2></div>
                <Link href={`/tours${query ? `?search=${encodeURIComponent(query)}` : ""}`} className="text-[13px] font-bold text-[#c94d1c]">See all journeys <ArrowRight className="ml-1 inline" size={14} /></Link>
              </div>
              <div className="mt-5 grid gap-3 lg:grid-cols-[1.6fr_1fr_auto]">
                <label className="sr-only" htmlFor="home-tour-search">Destination, city or tour name</label>
                <input id="home-tour-search" value={query} onChange={(e) => setQuery(e.target.value)} className="field" placeholder="Destination, city or tour name" />
                <select className="field" defaultValue=""><option value="">Travel style</option><option value="family">Family</option><option value="honeymoon">Honeymoon</option><option value="group">Group</option><option value="adventure">Adventure</option></select>
                <Link href={`/tours${query ? `?search=${encodeURIComponent(query)}` : ""}`} className="btn btn-dark">Find my trip</Link>
              </div>
            </div>
          </div>
        </section>

        {isError ? (
          <section className="section"><div className="container"><div className="card p-10 text-center"><h2 className="font-['Manrope'] text-2xl font-extrabold">The catalogue is taking a moment.</h2><p className="mt-2 text-sm text-[#77736c]">Please refresh or use the travel desk while we reconnect the public catalogue.</p></div></div></section>
        ) : (
          <>
          {/* {recommendationTours.length > 0 && (
  <PersonalizedTourRecommendations
  tours={recommendationTours}
  title="Recommended for your next journey"
  source="home"
  limit={3}
/>
)} */}
            <TourSection title="Featured journeys" eyebrow="A considered collection" tours={data?.featuredTours ?? []} loading={isLoading} />
            <TourSection title="Trending right now" eyebrow="What travellers are exploring" tours={data?.trendingTours ?? []} loading={isLoading} muted />
           
            <Reveal>
  <section className="section pt-8">
    <div className="container">
      <AITripConcierge />
    </div>
  </section>
</Reveal>

            <Reveal><section className="section bg-[#f3ede5]"><div className="container"><div className="flex items-end justify-between gap-5"><div><div className="eyebrow">Go where it feels right</div><h2 className="display mt-3 text-4xl font-extrabold sm:text-5xl">Places with a point of view.</h2></div><Link href="/destinations" className="hidden items-center gap-2 text-[13px] font-bold text-[#c94d1c] sm:flex">Explore destinations <ArrowRight size={15} /></Link></div><div className="mt-10 grid auto-rows-[220px] gap-4 md:grid-cols-4 md:grid-rows-[250px_190px]">{destinations.map((destination, index) => <Link key={destination.slug} href={`/destinations/${destination.slug}`} className={`group relative overflow-hidden rounded-2xl ${index === 0 ? "md:col-span-2 md:row-span-2" : index === 1 ? "md:col-span-2" : ""}`}><img src={destination.imageUrl ?? heroImage} alt={destination.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-105" /><div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" /><div className="absolute bottom-5 left-5 text-white"><div className="text-[10px] font-bold uppercase tracking-[.17em] text-white/70">{destination.kind === "domestic" ? "India" : "International"}</div><div className="mt-1 font-['Manrope'] text-2xl font-extrabold">{destination.name}</div><div className="mt-1 max-w-[220px] text-[12px] text-white/72">{destination.tagline}</div></div></Link>)}</div></div></section></Reveal>
            <TourSection title="Domestic favourites" eyebrow="India, thoughtfully" tours={data?.domesticTours ?? []} loading={isLoading} />
            <TourSection title="International escapes" eyebrow="Beyond the familiar" tours={data?.internationalTours ?? []} loading={isLoading} muted />

            <Reveal>
  <DemoTripExplorer />
</Reveal>


            <TourSection title="Honeymoon escapes" eyebrow="For two" tours={data?.honeymoonTours ?? []} loading={isLoading} />
            <TourSection title="Family journeys" eyebrow="Together time" tours={data?.familyTours ?? []} loading={isLoading} muted />
            <TourSection title="Seasonal routes" eyebrow="Travel with the moment" tours={data?.seasonalTours ?? []} loading={isLoading} />
          </>
        )}

{/* <Reveal>
  <AIExplorer />
</Reveal> */}


        <section className="section">
          <div className="container">
            <div className="max-w-[650px]"><div className="eyebrow">More than a package</div><h2 className="display mt-3 text-4xl font-extrabold sm:text-5xl">The details matter. That’s where we come in.</h2><p className="mt-5 max-w-[570px] text-[15px] leading-7 text-[#6f6c66]">From choosing the right pace to keeping documents in order, AeroFlyy works as your travel partner—not just the company that hands you an itinerary.</p></div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(services.length ? services.slice(0, 4) : []).map((service) => { const Icon = iconMap[service.icon_key ?? ""] ?? Compass; return <Link key={service.slug} href={`/services/${service.slug}`} className="card card-lift group p-6"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[#fff0e8] text-[#f26b35]"><Icon size={20} /></div><h3 className="mt-5 font-['Manrope'] text-[17px] font-extrabold">{service.title}</h3><p className="mt-2 text-[13px] leading-6 text-[#77736c]">{service.intro}</p><div className="mt-5 flex items-center gap-1 text-[12px] font-bold text-[#c94d1c] opacity-0 transition group-hover:opacity-100">Learn more <ChevronRight size={14} /></div></Link>; })}
            </div>
          </div>
        </section>

        {blogs.length > 0 && <section className="section"><div className="container"><div className="flex items-end justify-between"><div><div className="eyebrow">From the travel desk</div><h2 className="display mt-3 text-4xl font-extrabold">Notes for the road.</h2></div><Link href="/blog" className="hidden items-center gap-2 text-[13px] font-bold text-[#c94d1c] sm:flex">Read the journal <ArrowRight size={15} /></Link></div><div className="mt-10 grid gap-5 md:grid-cols-3">{blogs.map((post) => <Link key={post.slug} href={`/blog/${post.slug}`} className="group"><div className="overflow-hidden rounded-2xl"><img src={post.imageUrl} alt={post.title} loading="lazy" className="aspect-[1.28] w-full object-cover transition duration-700 group-hover:scale-105" /></div><div className="mt-4 text-[10px] font-bold uppercase tracking-[.16em] text-[#c94d1c]">{post.category}</div><h3 className="mt-2 font-['Manrope'] text-[20px] font-extrabold leading-tight group-hover:text-[#c94d1c]">{post.title}</h3><p className="mt-2 text-[13px] leading-6 text-[#77736c]">{post.excerpt}</p></Link>)}</div></div></section>}

        <section className="section bg-[#20201e] text-white"><div className="container grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center"><div><div className="eyebrow text-[#ffac88]">A little more personal</div><h2 className="display mt-3 text-4xl font-extrabold sm:text-5xl">Your trip should sound like you.</h2><p className="mt-5 max-w-[470px] text-[15px] leading-7 text-white/65">Tell us what matters—from the kind of mornings you like to the moments you want to remember. We’ll build from there.</p><button onClick={() => setEnquiryOpen(true)} className="btn btn-primary mt-8">Build my trip <ArrowRight size={15} /></button></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Stat icon={BadgeCheck} label="Thoughtful planning" /><Stat icon={BriefcaseBusiness} label="End-to-end support" /><Stat icon={Sparkles} label="Flexible by design" /></div></div></section>
      </main>
      <Footer />
      <EnquiryModal open={enquiryOpen} onClose={() => setEnquiryOpen(false)} />
    </div>
  );
}

function TourSection({ title, eyebrow, tours, loading, muted }: { title: string; eyebrow: string; tours: any[]; loading: boolean; muted?: boolean }) {
  if (!loading && tours.length === 0) return null;
  return <Reveal><section className={`section ${muted ? "bg-[#f3ede5]" : ""}`}><div className="container"><div className="flex items-end justify-between gap-5"><div><div className="eyebrow">{eyebrow}</div><h2 className="display mt-3 text-4xl font-extrabold sm:text-5xl">{title}</h2></div><Link href="/tours" className="hidden items-center gap-2 text-[13px] font-bold text-[#c94d1c] sm:flex">Browse all <ArrowRight size={15} /></Link></div>{loading ? <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3"><div className="h-[420px] animate-pulse rounded-2xl bg-[#eee9e1]" /><div className="h-[420px] animate-pulse rounded-2xl bg-[#eee9e1]" /><div className="hidden h-[420px] animate-pulse rounded-2xl bg-[#eee9e1] lg:block" /></div> : <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{tours.slice(0, 6).map((tour) => <TourCard key={tour.slug} tour={tour} />)}</div>}</div></section></Reveal>;
}

function Stat({ icon: Icon, label }: { icon: typeof BadgeCheck; label: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/5 p-5"><Icon size={21} className="text-[#f26b35]" /><div className="mt-14 text-[13px] font-semibold text-white/80">{label}</div></div>;
}
