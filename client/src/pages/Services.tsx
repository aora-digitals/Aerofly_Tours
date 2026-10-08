import { ArrowRight, CarFront, CheckCircle2, FileCheck2, Hotel, Plane, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import EnquiryModal from "@/components/site/EnquiryModal";
import { trpc } from "@/lib/trpc";
import { usePageMeta } from "../hooks/usePageMeta";

const iconMap: Record<string, typeof FileCheck2> = { FileCheck2, Plane, Hotel, CarFront, ShieldCheck, Sparkles };

export default function Services() {
  const slug = window.location.pathname.split("/").filter(Boolean)[1];
  const { data: services, isLoading } = trpc.content.services.useQuery(undefined, { staleTime: 300_000 });
  const { data: service, isLoading: serviceLoading } = trpc.content.service.useQuery({ slug }, { enabled: Boolean(slug), staleTime: 300_000 });
  const [open, setOpen] = useState(false);
  const activeService = slug ? service : undefined;

  usePageMeta({
    title: activeService ? `${activeService.meta_title ?? activeService.title} | AeroFly Tours` : "Travel Services | AeroFly Tours",
    description: activeService?.meta_description ?? activeService?.intro ?? "Tour packages, custom trips, flights, hotels, transfers, visa assistance and travel support.",
    canonical: window.location.origin + (activeService ? `/services/${activeService.slug}` : "/services"),
    image: activeService?.image_url ?? undefined,
  });

  if (slug && serviceLoading) return <><Header /><div className="container py-32">Loading services…</div><Footer /></>;

  if (slug && !serviceLoading && !activeService) return <><Header /><main><section className="section"><div className="container text-center"><div className="eyebrow">Service not found</div><h1 className="display mt-3 text-5xl font-extrabold">Let’s find another way.</h1><Link href="/services" className="btn btn-primary mt-7">Back to services</Link></div></section></main><Footer /></>;

  if (activeService) {
    const Icon = iconMap[activeService.icon_key ?? ""] ?? Sparkles;
    return <div className="min-h-screen"><Header /><main><section className="border-b border-[#e8e4dd] bg-[#f3ede5] py-20"><div className="container max-w-[900px]"><Link href="/services" className="text-[12px] font-bold text-[#6f6c66] hover:text-[#c94d1c]">← All services</Link><div className="mt-8 grid gap-7 sm:grid-cols-[1fr_auto] sm:items-end"><div><div className="eyebrow">AeroFly service desk</div><h1 className="display mt-4 text-5xl font-extrabold sm:text-7xl">{activeService.title}</h1><p className="mt-5 max-w-[570px] text-[16px] leading-7 text-[#6f6c66]">{activeService.intro}</p></div><div className="grid h-16 w-16 place-items-center rounded-2xl bg-[#fff0e8] text-[#f26b35]"><Icon size={29} /></div></div></div></section><section className="section"><div className="container grid gap-12 lg:grid-cols-[1fr_.7fr]"><div><p className="max-w-[620px] whitespace-pre-line text-[17px] leading-8 text-[#4f4c46]">{activeService.description}</p><div className="mt-9 space-y-4">{(activeService.bullets ?? []).map((bullet: string) => <div key={bullet} className="flex gap-3 text-[14px] text-[#6f6c66]"><CheckCircle2 size={18} className="shrink-0 text-[#f26b35]" />{bullet}</div>)}</div><button onClick={() => setOpen(true)} className="btn btn-primary mt-9">Talk to a travel expert <ArrowRight size={15} /></button></div><div className="card bg-[#20201e] p-7 text-white"><div className="eyebrow text-[#ffac88]">Integration-safe by design</div><h2 className="mt-3 font-['Manrope'] text-2xl font-extrabold">No made-up availability.</h2><p className="mt-4 text-[13px] leading-6 text-white/65">When a live provider is not connected, AeroFly keeps the next step honest: an enquiry to the travel desk, not a pretend confirmation.</p></div></div></section></main><Footer /><EnquiryModal open={open} onClose={() => setOpen(false)} /></div>;
  }

  return <div className="min-h-screen"><Header /><main><section className="border-b border-[#e8e4dd] py-16"><div className="container"><div className="eyebrow">A complete travel partner</div><h1 className="display mt-4 max-w-[740px] text-5xl font-extrabold sm:text-7xl">The details between<br /><span className="text-[#f26b35]">the destinations.</span></h1><p className="mt-6 max-w-[580px] text-[16px] leading-7 text-[#6f6c66]">From a first visa checklist to the ride back to the airport, we coordinate the moving pieces around your journey.</p></div></section><section className="section"><div className="container grid gap-5 md:grid-cols-2 lg:grid-cols-3">{isLoading ? [1,2,3,4,5,6].map((item) => <div key={item} className="h-[240px] animate-pulse rounded-2xl bg-[#eee9e1]" />) : services?.map((item) => { const Icon = iconMap[item.icon_key ?? ""] ?? Sparkles; return <Link key={item.slug} href={`/services/${item.slug}`} className="card card-lift group p-7"><div className="grid h-12 w-12 place-items-center rounded-xl bg-[#fff0e8] text-[#f26b35]"><Icon size={22} /></div><h2 className="mt-6 font-['Manrope'] text-[21px] font-extrabold">{item.title}</h2><p className="mt-3 text-[13px] leading-6 text-[#77736c]">{item.intro}</p><div className="mt-6 flex items-center gap-1 text-[12px] font-bold text-[#c94d1c] opacity-0 transition group-hover:opacity-100">See how we help <ArrowRight size={14} /></div></Link>; })}</div></section></main><Footer /></div>;
}