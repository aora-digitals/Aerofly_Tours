import { useEffect, useState } from "react";
import {
  Award,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Globe2,
  HeartHandshake,
  Mail,
  MapPin,
  MessageCircle,
  Newspaper,
  Phone,
  Plane,
  Route,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  UsersRound,
} from "lucide-react";
import { Link } from "wouter";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import EnquiryModal from "@/components/site/EnquiryModal";
import Reveal from "@/components/site/Reveal";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";

const milestones = [
  {
    year: "01",
    title: "A travel desk with a point of view",
    copy: "AeroFly began with a simple idea: the practical side of travel deserves the same care as the destination itself.",
    icon: Sparkles,
  },
  {
    year: "02",
    title: "From Pune to the world",
    copy: "Our planning lens now covers thoughtful domestic escapes, international journeys, family travel and business movement.",
    icon: Globe2,
  },
  {
    year: "03",
    title: "A familiar team around the trip",
    copy: "Counsellors, operations, customer care and finance work together so every handoff feels clear and accountable.",
    icon: UsersRound,
  },
];
const tripHighlights = [
  {
    value: "Domestic",
    label: "Journeys across India",
    copy: "From coastlines and backwaters to city breaks and mountain air.",
  },
  {
    value: "International",
    label: "Routes beyond India",
    copy: "Curated planning for the first flight, the repeat visit and everything between.",
  },
  {
    value: "End-to-end",
    label: "Travel desk support",
    copy: "Flights, stays, transfers, documents, insurance and human help.",
  },
];
const recognitions = [
  {
    icon: Trophy,
    title: "Customer-first travel desk",
    copy: "AeroFly’s operating principle: make the next step clear, then stay close to it.",
  },
  {
    icon: Award,
    title: "A culture of appreciation",
    copy: "We celebrate the people behind every smooth departure—our customers, partners and travel team.",
  },
  {
    icon: Newspaper,
    title: "A story still being written",
    copy: "News, awards and verified felicitations will be added here as AeroFly’s company record grows.",
  },
];


function MapReadyHandler({
  onReady,
}: {
  onReady: () => void;
}) {
  const map = useMap();

  useEffect(() => {
    // React Leaflet has created the Leaflet map instance.
    const handleLoad = () => onReady();

    map.whenReady(handleLoad);

    return () => {
      map.off("load", handleLoad);
    };
  }, [map, onReady]);

  return null;
}

export default function About() {
  const [open, setOpen] = useState(false);
const [mapLoaded, setMapLoaded] = useState(false);
  return (
    <div className="min-h-screen">
      <Header />
      <main>
        <section className="relative overflow-hidden border-b border-[#e8e4dd] bg-[#f3ede5] py-20 sm:py-28">
          <div className="container grid gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
            <div>
              <div className="eyebrow">About AeroFly Tours</div>
              <h1 className="display mt-4 max-w-[780px] text-5xl font-extrabold sm:text-7xl">
                The people,
                <br />
                <span className="text-[#f26b35]">purpose and progress</span>
                <br />
                behind the journey.
              </h1>
            </div>
            <div>
              <p className="max-w-[450px] text-[15px] leading-7 text-[#6f6c66]">
                AeroFly is a Pune-based travel company being built for people
                who want thoughtful planning, dependable coordination and a
                human travel desk from the first question to the safe return.
              </p>
              <Link href="/plan-my-trip" className="btn btn-dark mt-7">
                Plan with AeroFly <ArrowRight size={15} />
              </Link>
            </div>
          </div>
          <div className="container mt-16 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-[#20201e] p-6 text-white sm:col-span-2">
              <div className="eyebrow text-[#ffac88]">Our promise</div>
              <p className="mt-5 max-w-[680px] font-['Manrope'] text-2xl font-extrabold leading-tight sm:text-3xl">
                Make travel feel considered—not complicated.
              </p>
            </div>
            <div className="rounded-2xl bg-white p-6">
              <ShieldCheck size={22} className="text-[#f26b35]" />
              <p className="mt-8 text-[13px] leading-6 text-[#6f6c66]">
                Clear plans, transparent next steps and a team that stays
                reachable.
              </p>
            </div>
          </div>
        </section>
        <section className="section">
          <div className="container grid gap-12 lg:grid-cols-[.75fr_1.25fr] lg:items-start">
            <div>
              <div className="eyebrow">Our point of view</div>
              <h2 className="display mt-3 text-4xl font-extrabold sm:text-5xl">
                Good travel has a rhythm.
              </h2>
              <p className="mt-6 text-[14px] leading-7 text-[#6f6c66]">
                Some people travel for a table in a new neighbourhood. Some for
                the trail, the family story or the first glimpse of a city they
                have only seen from a window. AeroFly starts there—with your
                reason to go.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {tripHighlights.map((item, index) => (
                <Reveal key={item.label} delay={index * 80}>
                  <div className="card card-lift h-full bg-[#fbfaf8] p-6">
                    <div className="font-['Manrope'] text-2xl font-extrabold text-[#f26b35]">
                      {item.value}
                    </div>
                    <h3 className="mt-8 font-['Manrope'] text-[16px] font-extrabold">
                      {item.label}
                    </h3>
                    <p className="mt-3 text-[12px] leading-5 text-[#77736c]">
                      {item.copy}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
        <section className="section bg-[#20201e] text-white">
          <div className="container">
            <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
              <div>
                <div className="eyebrow text-[#ffac88]">Our journey so far</div>
                <h2 className="display mt-3 max-w-[650px] text-4xl font-extrabold sm:text-5xl">
                  Progress is made of small, well-handled moments.
                </h2>
              </div>
              <Plane size={34} className="text-[#f26b35]" />
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {milestones.map((item, index) => (
                <Reveal key={item.year} delay={index * 90}>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-7">
                    <div className="flex items-center justify-between">
                      <item.icon size={23} className="text-[#f26b35]" />
                      <span className="font-['Manrope'] text-4xl font-extrabold text-white/15">
                        {item.year}
                      </span>
                    </div>
                    <h3 className="mt-16 font-['Manrope'] text-xl font-extrabold">
                      {item.title}
                    </h3>
                    <p className="mt-3 text-[13px] leading-6 text-white/60">
                      {item.copy}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
        <section className="section">
          <div className="container">
            <div className="eyebrow">Trips worth remembering</div>
            <div className="mt-3 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <h2 className="display max-w-[680px] text-4xl font-extrabold sm:text-5xl">
                The measure of our work is how the journey feels.
              </h2>
              <Link href="/tours" className="btn btn-ghost">
                Explore journeys <ArrowRight size={15} />
              </Link>
            </div>
            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {[
                [
                  "01",
                  "The first departure",
                  "A calm, clearly explained plan for travellers taking an important first step.",
                ],
                [
                  "02",
                  "The family return",
                  "The details that make a reunion, celebration or multi-generational holiday easier.",
                ],
                [
                  "03",
                  "The trip they repeat",
                  "A travel partner that remembers the preferences that matter next time.",
                ],
              ].map(([number, title, copy], index) => (
                <Reveal key={number} delay={index * 80}>
                  <div className="relative overflow-hidden rounded-2xl bg-[#f3ede5] p-7">
                    <span className="font-['Manrope'] text-6xl font-extrabold text-[#f26b35]/25">
                      {number}
                    </span>
                    <h3 className="mt-10 font-['Manrope'] text-xl font-extrabold">
                      {title}
                    </h3>
                    <p className="mt-3 max-w-[300px] text-[13px] leading-6 text-[#6f6c66]">
                      {copy}
                    </p>
                    <CheckCircle2
                      className="absolute right-6 top-7 text-[#f26b35]"
                      size={20}
                    />
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
        <section className="section border-y border-[#e8e4dd] bg-[#fbfaf8]">
          <div className="container">
            <div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr] lg:items-end">
              <div>
                <div className="eyebrow">Recognition & company news</div>
                <h2 className="display mt-3 text-4xl font-extrabold sm:text-5xl">
                  The moments we are proud to build.
                </h2>
                <p className="mt-5 text-[14px] leading-7 text-[#6f6c66]">
                  This is AeroFly’s growing company wall: a place for verified
                  awards, partner felicitations, customer milestones and
                  meaningful news as the team earns them.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {recognitions.map((item, index) => (
                  <Reveal key={item.title} delay={index * 80}>
                    <div className="card bg-white p-6">
                      <item.icon size={22} className="text-[#f26b35]" />
                      <h3 className="mt-8 font-['Manrope'] text-[16px] font-extrabold">
                        {item.title}
                      </h3>
                      <p className="mt-3 text-[12px] leading-5 text-[#77736c]">
                        {item.copy}
                      </p>
                      <div className="mt-6 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#92928b]">
                        <CalendarDays size={12} /> AeroFly journal
                      </div>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section className="section">
          <div className="container grid gap-6 lg:grid-cols-[.85fr_1.15fr]">
            <div className="rounded-2xl bg-[#f26b35] p-8 text-white sm:p-10">
              <div className="eyebrow text-white/70">Customer care</div>
              <h2 className="mt-4 font-['Manrope'] text-3xl font-extrabold">
                A real person for the next question.
              </h2>
              <p className="mt-4 text-[14px] leading-6 text-white/80">
                Need help with a booking, documents, a payment or a change of
                plan? Our travel desk is here to pick it up.
              </p>
              <div className="mt-8 space-y-4 text-[13px]">
                <a
                  href="tel:+912000000000"
                  className="flex items-center gap-3 hover:underline"
                >
                  <Phone size={16} /> +91 20 0000 0000{" "}
                  <span className="text-white/60">(configure)</span>
                </a>
                <a
                  href="mailto:care@aeroflytours.com"
                  className="flex items-center gap-3 hover:underline"
                >
                  <Mail size={16} /> care@aeroflytours.com
                </a>
                <div className="flex items-center gap-3">
                  <Clock3 size={16} /> Monday–Saturday · 9am–7pm
                </div>
              </div>
              <button
                onClick={() => setOpen(true)}
                className="btn btn-light mt-8"
              >
                Contact customer care <MessageCircle size={15} />
              </button>
            </div>
            <div className="card bg-[#fbfaf8] p-8 sm:p-10">
              <div className="eyebrow">Why customers stay with us</div>
              <div className="mt-7 space-y-6">
                {[
                  [
                    HeartHandshake,
                    "Human throughout",
                    "No disappearing act after the booking—your travel desk remains close to the journey.",
                  ],
                  [
                    Route,
                    "One connected plan",
                    "Sales, operations, finance and care work from the same travel context.",
                  ],
                  [
                    Star,
                    "Care in the details",
                    "The small preferences, reminders and checks that make a trip feel like yours.",
                  ],
                ].map(([Icon, title, copy]) => (
                  <div key={title as string} className="flex gap-4">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fff0e8] text-[#f26b35]">
                      <Icon size={18} />
                    </div>
                    <div>
                      <h3 className="font-['Manrope'] text-[16px] font-extrabold">
                        {title as string}
                      </h3>
                      <p className="mt-1 text-[13px] leading-6 text-[#77736c]">
                        {copy as string}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section className="section bg-[#f3ede5]">
          <div className="container">
            <div className="grid gap-8 lg:grid-cols-[.7fr_1.3fr] lg:items-stretch">
              <div className="flex flex-col justify-between">
                <div>
                  <div className="eyebrow">Find the travel desk</div>
                  <h2 className="display mt-3 text-4xl font-extrabold sm:text-5xl">
                    Come say hello in Pune.
                  </h2>
                  <p className="mt-5 text-[14px] leading-7 text-[#6f6c66]">
                    Our office location is centred in Pune, Maharashtra. The
                    exact address can be configured by the AeroFly team as the
                    company workspace grows.
                  </p>
                </div>
                <div className="mt-8 rounded-2xl bg-white p-6">
                  <div className="flex items-start gap-4">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fff0e8] text-[#f26b35]">
                      <MapPin size={18} />
                    </div>
                    <div>
                      <div className="font-['Manrope'] text-[16px] font-extrabold">
                        AeroFly Tours · Pune
                      </div>
                      <div className="mt-1 text-[12px] leading-5 text-[#77736c]">
                        Maharashtra, India
                        <br />
                        Travel desk · 9am–7pm
                      </div>
                    </div>
                  </div>
                  <a
                    href="https://www.google.com/maps/search/?api=1&query=Pune%2C%20Maharashtra"
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-dark mt-6 w-full"
                  >
                    Open directions <ArrowRight size={15} />
                  </a>
                </div>
              </div>
              <div className="relative overflow-hidden rounded-2xl border border-[#e8e4dd] bg-white shadow-[0_18px_44px_rgba(29,25,20,.08)]">
                
<div
  className={`pointer-events-none absolute inset-0 z-0 bg-[#e9e2d7] p-8 transition-opacity duration-300 ${
    mapLoaded ? "opacity-0" : "opacity-100"
  }`}
  aria-hidden="true"
>
  <div className="soft-grid absolute inset-0 opacity-50" />

  <div className="relative flex h-full flex-col items-center justify-center text-center">
    <div className="grid h-16 w-16 place-items-center rounded-full border-8 border-[#ffd5c1] bg-[#f26b35] text-white shadow-[0_10px_25px_rgba(242,107,53,.25)]">
      <MapPin size={25} />
    </div>

    <div className="mt-5 font-['Manrope'] text-lg font-extrabold text-[#20201e]">
      Pune, Maharashtra
    </div>

    <div className="mt-2 text-[12px] text-[#6f6c66]">
      AeroFly Tours travel desk
    </div>

    <div className="mt-5 flex items-center gap-2 rounded-full bg-white/80 px-3 py-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#c94d1c]">
      <Sparkles size={12} />
      {mapLoaded ? "Map ready" : "Loading map…"}
    </div>
  </div>
</div>

               <MapContainer
  center={[18.5204, 73.8567]}
  zoom={13}
  scrollWheelZoom={false}
  style={{ height: 320, width: "100%" }}
>
 <MapReadyHandler
    onReady={() => setMapLoaded(true)}
  />
  <TileLayer
    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    eventHandlers={{
      load: () => setMapLoaded(true),
      tileerror: () => {
        // A failed tile should not necessarily hide the map container.
      },
    }}
  />
  <Marker position={[18.5204, 73.8567]}>
    <Popup>AeroFly Tours — Pune</Popup>
  </Marker>
</MapContainer>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <EnquiryModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
