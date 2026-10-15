
import {
  ArrowRight,
  CalendarDays,
  Compass,
  Heart,
  MapPin,
  Wallet,
} from "lucide-react";
import { Link } from "wouter";

const actions = [
  {
    title: "Explore destinations",
    description: "Find somewhere new to discover",
    href: "/destinations",
    Icon: MapPin,
  },
  {
    title: "Plan your itinerary",
    description: "Start shaping your next trip",
    href: "/tours",
    Icon: CalendarDays,
  },
  {
    title: "Browse tours",
    description: "Explore curated travel packages",
    href: "/tours",
    Icon: Compass,
  },
  {
    title: "Travel preferences",
    description: "Personalize your travel experience",
    href: "/dashboard/preferences",
    Icon: Heart,
  },
];

export default function AITravelDiscoveryPanel() {

 
  return (
    <aside className="h-full min-w-0 rounded-3xl border border-white/10 bg-[#20201e] p-5 text-white sm:p-6 lg:p-7">
      {/* Travel toolkit */}
      <section className="mt-6">
        <div className="text-[10px] font-extrabold uppercase tracking-[.17em] text-[#ffac88]">
          Your travel toolkit
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          {actions.map(({ title, description, href, Icon }) => (
            <Link
              key={title}
              href={href}
              className="group rounded-xl border border-white/10 bg-white/[0.04] p-3 transition hover:-translate-y-0.5 hover:border-[#f26b35]/60 hover:bg-white/[0.07] sm:p-4"
            >
              <Icon
                size={19}
                className="text-[#ffac88] transition group-hover:text-white"
              />
              <h4 className="mt-3 text-xs font-extrabold sm:text-sm">
                {title}
              </h4>
              <p className="mt-1 text-[11px] leading-5 text-white/55">
                {description}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* Budget / human support */}
      <div className="mt-5 flex flex-col gap-3 rounded-xl border border-[#f26b35]/25 bg-[#f26b35]/[0.08] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Wallet size={19} className="mt-0.5 shrink-0 text-[#ffac88]" />
          <div>
            <p className="text-sm font-bold">Need help planning?</p>
            <p className="mt-1 text-xs leading-5 text-white/60">
              Let the AeroFly travel desk help you plan around your needs.
            </p>
          </div>
        </div>

        <Link
          href="/contact"
          className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-white/15 px-3 py-2 text-xs font-bold transition hover:border-[#ffac88] hover:text-[#ffac88] sm:self-auto"
        >
          Contact us <ArrowRight size={13} />
        </Link>
      </div>
    </aside>
  );
}
