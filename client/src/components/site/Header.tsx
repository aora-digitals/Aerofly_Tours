import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, ChevronDown, Menu, Search, X } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useLanguage } from "@/contexts/LanguageContext";
// import LanguageSelect from "@/components/site/LanguageSelect";

export default function Header() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const {
    currency,
    setCurrency,
    currencies,
    // rateSource,
    // rateStatus,
    // rateUpdatedAt,
  } = useCurrency();

  const { t } = useLanguage();

  const nav = [
    [t("nav_tours"), "/tours"],
    [t("nav_india"), "/tours?kind=domestic"],
    [t("nav_international"), "/tours?kind=international"],
    [t("nav_destinations"), "/destinations"],
    [t("nav_services"), "/services"],
    [t("nav_about"), "/about"],
  ];

  return (
    <>
      <div className="border-b border-[#eee9e1] bg-[#fbfaf8] text-[11px] text-[#77736c]">
        <div className="container flex h-8 items-center justify-between">
          <span>Pune · Maharashtra · India</span>
          <span className="hidden sm:inline">
            Domestic & international travel, thoughtfully coordinated
          </span>
          <span className="font-semibold text-[#c94d1c]">
            Travel desk: 9am—7pm
          </span>
        </div>
      </div>
      <header className="sticky top-0 z-40 border-b border-[#eee9e1]/90 bg-[#fbfaf8]/95 backdrop-blur">
        <div className="container flex h-[74px] items-center justify-between gap-6">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3"
          >
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[#f26b35] text-white">
              <span className="text-[16px] font-black italic">A</span>
            </span>
            <span className="leading-none">
              <span className="block font-['Manrope'] text-[16px] font-extrabold tracking-[-.04em]">
                AeroFly
              </span>
              <span className="mt-1 block text-[9px] font-bold uppercase tracking-[.22em] text-[#77736c]">
                Tours
              </span>
            </span>
          </Link>
          <nav className="hidden items-center gap-6 lg:flex">
            {nav.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="text-[13px] font-semibold text-[#4f4c46] transition-colors hover:text-[#f26b35]"
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-3 lg:flex">
            <CurrencySelect
              currency={currency}
              currencies={currencies}
              onChange={setCurrency}
            />
            {/* <LanguageSelect/> */}
            <Link
              href="/search"
              aria-label="Search tours"
              className="grid h-10 w-10 place-items-center rounded-full text-[#4f4c46] hover:bg-[#fff0e8] hover:text-[#c94d1c]"
            >
              <Search size={17} />
            </Link>
            <button
              onClick={() => navigate("/login")}
              className="text-[13px] font-semibold text-[#4f4c46] hover:text-[#c94d1c]"
            >
              Customer login
            </button>
            <Link
              href="/plan-my-trip"
              className="btn btn-primary min-h-10 px-4 text-[12px]"
            >
              Plan my trip <ArrowRight size={14} />
            </Link>
          </div>
          <button
            className="grid h-10 w-10 place-items-center rounded-full border border-[#e8e4dd] lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {open && (
          <div className="border-t border-[#eee9e1] bg-[#fbfaf8] px-5 py-5 lg:hidden">
            <nav className="container flex flex-col gap-1 px-0">
              {nav.map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setOpen(false)}
                  className="border-b border-[#eee9e1] py-3 text-[15px] font-semibold"
                >
                  {label}
                </Link>
              ))}
              <div className="mt-4 border-b border-[#eee9e1] pb-4">
                <CurrencySelect
                  currency={currency}
                  currencies={currencies}
                  onChange={setCurrency}
                />
              </div>
              {/* <LanguageSelect/> */}
              <Link
                href="/plan-my-trip"
                onClick={() => setOpen(false)}
                className="btn btn-primary mt-4"
              >
                Plan my trip <ArrowRight size={14} />
              </Link>
              <button
                onClick={() => {
                  setOpen(false);
                  navigate("/login");
                }}
                className="mt-3 py-2 text-left text-[13px] font-semibold text-[#6f6c66]"
              >
                Customer login
              </button>
            </nav>
          </div>
        )}
      </header>
    </>
  );
}

function CurrencySelect({
  currency,
  currencies,
  onChange,
}: {
  currency: string;
  currencies: Array<{ code: string; symbol: string; available: boolean }>;
  onChange: (code: string) => void;
}) {
  return (
    <label className="relative flex items-center gap-1 text-[11px] font-bold text-[#4f4c46]">
      <span className="sr-only">Display currency</span>
      <select
        aria-label="Display currency"
        value={currency}
        onChange={(event) => onChange(event.target.value)}
        className="appearance-none bg-transparent py-2 pr-5 font-bold outline-none"
      >
        <option value="INR">INR ₹</option>
        {currencies
          .filter((item) => item.code !== "INR" && item.available)
          .map((item) => (
            <option key={item.code} value={item.code}>
              {item.code} {item.symbol}
            </option>
          ))}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-0" />
    </label>
  );
}
