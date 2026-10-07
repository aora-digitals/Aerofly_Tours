import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";

type CurrencyConfig = Awaited<ReturnType<typeof useCurrencyConfig>>;
type CurrencyContextValue = { currency: string; setCurrency: (code: string) => void; rates: Record<string, number>; currencies: CurrencyConfig["currencies"]; isLoading: boolean; format: (amountInr: number) => string; isStripeSupported: boolean; checkoutNotice: string | null; detectedCurrency: string };
const CurrencyContext = createContext<CurrencyContextValue | null>(null);

function useCurrencyConfig() {
  const query = trpc.currency.config.useQuery(undefined, { staleTime: 60 * 60 * 1000, refetchOnWindowFocus: false });
  return query.data ?? { currencies: [], rates: { INR: 1 }, detectedCurrency: "INR", baseCurrency: "INR", stripeSupportedCurrencies: [], country: "IN", fetchedAt: new Date(0).toISOString() };
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const config = useCurrencyConfig();
  const [currency, setCurrencyState] = useState("INR");
  useEffect(() => { const saved = window.localStorage.getItem("aerofly_currency"); if (saved) setCurrencyState(saved.toUpperCase()); }, []);
  useEffect(() => { if (!window.localStorage.getItem("aerofly_currency") && config.detectedCurrency) setCurrencyState(config.detectedCurrency); }, [config.detectedCurrency]);
  const selected = config.currencies.find((item) => item.code === currency) ?? config.currencies.find((item) => item.code === "INR");
  const activeCurrency = selected?.code ?? "INR";
  const rate = config.rates[activeCurrency] ?? 1;
  const setCurrency = (code: string) => { const next = code.toUpperCase(); setCurrencyState(next); window.localStorage.setItem("aerofly_currency", next); };
  const value = useMemo(() => ({ currency: activeCurrency, setCurrency, rates: config.rates, currencies: config.currencies, isLoading: false, format: (amountInr: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: activeCurrency, maximumFractionDigits: activeCurrency === "JPY" ? 0 : 0 }).format(amountInr * rate), isStripeSupported: Boolean(selected?.stripeSupported), checkoutNotice: selected && !selected.stripeSupported ? `Online checkout for ${activeCurrency} is not supported by the payment processor. The final payment will safely revert to INR.` : null, detectedCurrency: config.detectedCurrency }), [activeCurrency, config.currencies, config.detectedCurrency, config.rates, rate, selected]);
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() { const value = useContext(CurrencyContext); if (!value) throw new Error("useCurrency must be used inside CurrencyProvider"); return value; }
