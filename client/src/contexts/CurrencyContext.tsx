import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatMoney, type SupportedCurrency } from "../lib/currency";
import { useAuth } from "@/_core/hooks/useAuth";
import { supabase } from "@/lib/supabase";

type CurrencyConfig = {
  currencies: Array<{
    code: string;
    name: string;
    symbol: string;
    available: boolean;
    stripeSupported: boolean;
  }>;
  rates: Record<string, number>;
  detectedCurrency: string;
  baseCurrency: string;
  stripeSupportedCurrencies: string[];
  country: string;
  fetchedAt: string;
  rateSource: string;
  rateStatus: "live" | "manual" | "stale" | "base_only";
};

type CurrencyContextValue = {
  currency: string;
  setCurrency: (code: string) => void;
  rates: Record<string, number>;
  currencies: CurrencyConfig["currencies"];
  isLoading: boolean;
  format: (amountInr: number) => string;
  isStripeSupported: boolean;
  checkoutNotice: string | null;
  detectedCurrency: string;
  rateSource: string;
  rateStatus: CurrencyConfig["rateStatus"];
  rateUpdatedAt: string;
};

const CurrencyContext =
  createContext<CurrencyContextValue | null>(null);

function useCurrencyConfig(): CurrencyConfig {
  const query = trpc.currency.config.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return query.data ?? {
    currencies: [],
    rates: { INR: 1 },
    detectedCurrency: "INR",
    baseCurrency: "INR",
    stripeSupportedCurrencies: [],
    country: "IN",
    fetchedAt: "",
    rateSource: "INR base only",
    rateStatus: "base_only",
  };
}

export function CurrencyProvider({
  children,
}: {
  children: ReactNode;
}) {
  const config = useCurrencyConfig();
  const { language } = useLanguage();
  const { user } = useAuth();
  const [currency, setCurrencyState] = useState("INR");

  useEffect(() => {
    const profileCurrency =
      user?.profile?.preferred_currency;

    let saved: string | null = null;

    try {
      saved = window.localStorage.getItem(
        "aerofly_currency",
      );
    } catch {
      // Storage can be disabled by the browser.
    }

    const preferred = profileCurrency || saved;

    if (preferred && /^[A-Z]{3}$/i.test(preferred)) {
      setCurrencyState(preferred.toUpperCase());
    }
  }, [user?.profile?.preferred_currency]);

  useEffect(() => {
    let saved: string | null = null;

    try {
      saved = window.localStorage.getItem(
        "aerofly_currency",
      );
    } catch {
      // Leave INR as the fallback.
    }

    if (!saved && config.detectedCurrency) {
      setCurrencyState(config.detectedCurrency);
    }
  }, [config.detectedCurrency]);

  const selected =
    config.currencies.find(
      (item) => item.code === currency && item.available,
    ) ??
    config.currencies.find(
      (item) => item.code === "INR",
    );

  const activeCurrency = selected?.code ?? "INR";
  const rate = config.rates[activeCurrency] ?? 1;

  const setCurrency = (code: string) => {
    const next = code.toUpperCase();

    if (
      !config.currencies.some(
        (item) =>
          item.code === next && item.available,
      )
    ) {
      return;
    }

    setCurrencyState(next);

    try {
      window.localStorage.setItem(
        "aerofly_currency",
        next,
      );
    } catch {
      // Current selection remains usable in memory.
    }

    if (user?.id) {
      void supabase
        .from("profiles")
        .update({ preferred_currency: next })
        .eq("id", user.id)
        .then(({ error }) => {
          if (error) {
            console.warn(
              "Unable to save preferred currency to profile.",
            );
          }
        });
    }
  };

  const value = useMemo(
    () => ({
      currency: activeCurrency,
      setCurrency,
      rates: config.rates,
      currencies: config.currencies,
      isLoading: false,
      format: (amountInr: number) =>
        formatMoney(
          amountInr * rate,
          activeCurrency as SupportedCurrency,
          language === "mr" ? "mr-IN" : "en-IN",
        ),
      isStripeSupported: Boolean(
        selected?.stripeSupported,
      ),
      checkoutNotice:
        selected && !selected.stripeSupported
          ? `Online checkout for ${activeCurrency} is not supported by the payment processor. Your accepted proposal's currency and amount remain authoritative; changing the display currency never changes them.`
          : null,
      detectedCurrency: config.detectedCurrency,
      rateSource: config.rateSource,
      rateStatus: config.rateStatus,
      rateUpdatedAt: config.fetchedAt,
    }),
    [
      activeCurrency,
      config.currencies,
      config.detectedCurrency,
      config.fetchedAt,
      config.rateSource,
      config.rateStatus,
      config.rates,
      language,
      rate,
      selected,
      user?.id,
    ],
  );

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const value = useContext(CurrencyContext);

  if (!value) {
    throw new Error(
      "useCurrency must be used inside CurrencyProvider",
    );
  }

  return value;
}