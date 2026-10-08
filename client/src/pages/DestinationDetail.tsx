import { ArrowLeft, ArrowRight, MapPin } from "lucide-react";
import { Link } from "wouter";
import { useEffect } from "react";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import TourCard from "@/components/site/TourCard";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useAuth } from "@/_core/hooks/useAuth";
import { recordCustomerActivity } from "@/lib/customer";

export default function DestinationDetail() {
  const slug = window.location.pathname.split("/").filter(Boolean).pop() ?? "";
  const { data: destination, isLoading, isError } = trpc.content.destination.useQuery({ slug }, { staleTime: 60_000 });
  const { user } = useAuth();

  useEffect(() => {
    if (!destination || !user?.id) return;
    void recordCustomerActivity(user.id, "destination_viewed", "destination", destination.id, { source: "destination_detail" }).catch(() => undefined);
  }, [destination?.id, user?.id]);

  usePageMeta({
    title: destination?.meta_title ?? (destination ? `${destination.name} Travel | AeroFly Tours` : "Destination | AeroFly Tours"),
    description: destination?.meta_description ?? destination?.description ?? `Explore ${destination?.name ?? "AeroFly destinations"} with AeroFly Tours.`,
    canonical: window.location.origin + `/destinations/${slug}`,
    image: destination?.imageUrl ?? undefined,
  });

  if (isLoading) return <><Header /><div className="container py-32"><div className="h-10 w-1/2 animate-pulse rounded bg-[#eee9e1]" /><div className="mt-5 h-5 w-1/3 animate-pulse rounded bg-[#eee9e1]" /></div><Footer /></>;
  if (isError || !destination) return <><Header /><div className="container py-32 text-center"><div className="eyebrow">Destination not found</div><h1 className="display mt-3 text-5xl font-extrabold">Let’s find another place.</h1><Link href="/destinations" className="btn btn-primary mt-7">Back to destinations</Link></div><Footer /></>;

  return <div className="min-h-screen"><Header /><main>
    <section className="relative min-h-[510px] overflow-hidden bg-[#20201e] text-white"><img src={destination.imageUrl ?? ""} alt={destination.name} className="absolute inset-0 h-full w-full object-cover opacity-75" /><div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" /><div className="container relative flex min-h-[510px] flex-col justify-end pb-12"><Link href="/destinations" className="mb-auto flex items-center gap-2 pt-8 text-[12px] font-bold text-white/70 hover:text-white"><ArrowLeft size={14} /> All destinations</Link><div className="eyebrow text-[#ffac88]">{destination.kind === "domestic" ? "India" : "International"} · {destination.country}</div><h1 className="display mt-3 text-6xl font-extrabold sm:text-8xl">{destination.name}</h1><p className="mt-4 max-w-[560px] text-[16px] leading-7 text-white/75">{destination.tagline}</p></div></section>
    <section className="section"><div className="container grid gap-12 lg:grid-cols-[.7fr_1.3fr]"><div><div className="eyebrow">AeroFly perspective</div><h2 className="display mt-3 text-4xl font-extrabold">A place worth taking your time with.</h2><p className="mt-5 text-[15px] leading-7 text-[#6f6c66]">{destination.description ?? `A thoughtfully planned way to experience ${destination.name}, with the practical details coordinated around your pace.`}</p><div className="mt-7 flex items-center gap-2 text-[12px] font-semibold text-[#77736c]"><MapPin size={15} className="text-[#f26b35]" /> {destination.region ?? destination.country}</div>{(destination.latitude || destination.longitude) && <div className="mt-2 text-[11px] text-[#908b83]">Map coordinates: {destination.latitude}, {destination.longitude}</div>}</div>
      <div><div className="flex items-center justify-between"><div><div className="eyebrow">Suggested journeys</div><h2 className="mt-2 font-['Manrope'] text-2xl font-extrabold">Start with a route</h2></div><Link href={`/tours?destination=${encodeURIComponent(destination.slug)}`} className="text-[12px] font-bold text-[#c94d1c]">See all <ArrowRight size={13} className="inline" /></Link></div><div className="mt-6 grid gap-5 md:grid-cols-2">{destination.tours?.slice(0, 4).map((tour: any) => <TourCard key={tour.slug} tour={tour} />)}</div>{!destination.tours?.length && <div className="mt-6 rounded-2xl bg-[#f3ede5] p-6 text-sm text-[#77736c]">No published journeys are currently attached to this destination. Ask our travel desk for a custom route.</div>}</div>
    </div></section>

    {destination.attractions?.length > 0 && <section className="section bg-[#f3ede5]"><div className="container"><div className="eyebrow">Places to experience</div><h2 className="display mt-3 text-4xl font-extrabold">Highlights of {destination.name}.</h2><div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{destination.attractions.map((attraction: any) => <article key={attraction.id} className="card overflow-hidden"><>{attraction.image_url && <img src={attraction.image_url} alt={attraction.name} loading="lazy" className="aspect-[1.5] w-full object-cover" />}</><div className="p-5"><h3 className="font-['Manrope'] text-lg font-extrabold">{attraction.name}</h3>{attraction.description && <p className="mt-2 text-[13px] leading-6 text-[#77736c]">{attraction.description}</p>}</div></article>)}</div></div></section>}
  </main><Footer /></div>;
}
