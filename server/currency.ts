import { getSetting, upsertSetting } from "./db";

export const BASE_CURRENCY = "INR" as const;
export const STRIPE_SUPPORTED_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "JPY", "CHF", "NZD", "HKD", "SEK", "NOK", "DKK"] as const;
export const DISPLAY_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "JPY", "CHF", "NZD", "HKD", "SEK", "NOK", "DKK", "BRL", "ZAR", "THB", "MYR", "PHP", "IDR"] as const;
export type CurrencyCode = (typeof DISPLAY_CURRENCIES)[number];

const CURRENCY_META: Record<CurrencyCode, { symbol: string; label: string; countries: string[] }> = {
  INR: { symbol: "₹", label: "Indian rupee", countries: ["IN"] }, USD: { symbol: "$", label: "US dollar", countries: ["US", "EC", "PA"] }, EUR: { symbol: "€", label: "Euro", countries: ["DE", "FR", "IT", "ES", "NL", "BE", "AT", "IE", "PT", "GR", "FI"] }, GBP: { symbol: "£", label: "British pound", countries: ["GB"] }, AED: { symbol: "د.إ", label: "UAE dirham", countries: ["AE"] }, SGD: { symbol: "S$", label: "Singapore dollar", countries: ["SG"] }, AUD: { symbol: "A$", label: "Australian dollar", countries: ["AU"] }, CAD: { symbol: "C$", label: "Canadian dollar", countries: ["CA"] }, JPY: { symbol: "¥", label: "Japanese yen", countries: ["JP"] }, CHF: { symbol: "CHF", label: "Swiss franc", countries: ["CH"] }, NZD: { symbol: "NZ$", label: "New Zealand dollar", countries: ["NZ"] }, HKD: { symbol: "HK$", label: "Hong Kong dollar", countries: ["HK"] }, SEK: { symbol: "kr", label: "Swedish krona", countries: ["SE"] }, NOK: { symbol: "kr", label: "Norwegian krone", countries: ["NO"] }, DKK: { symbol: "kr", label: "Danish krone", countries: ["DK"] }, BRL: { symbol: "R$", label: "Brazilian real", countries: ["BR"] }, ZAR: { symbol: "R", label: "South African rand", countries: ["ZA"] }, THB: { symbol: "฿", label: "Thai baht", countries: ["TH"] }, MYR: { symbol: "RM", label: "Malaysian ringgit", countries: ["MY"] }, PHP: { symbol: "₱", label: "Philippine peso", countries: ["PH"] }, IDR: { symbol: "Rp", label: "Indonesian rupiah", countries: ["ID"] },
};

const RATE_SETTING = "currency_rates_inr_v1";
const DAY_MS = 24 * 60 * 60 * 1000;

type RateCache = { fetchedAt: string; rates: Record<string, number> };

async function fetchJson(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Currency provider returned ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function getDailyRates(): Promise<RateCache> {
  const stored = await getSetting(RATE_SETTING);
  if (stored) {
    try {
      const cached = JSON.parse(stored) as RateCache;
      if (cached.fetchedAt && Date.now() - new Date(cached.fetchedAt).getTime() < DAY_MS && cached.rates.INR === 1) return cached;
    } catch { /* refresh malformed cache */ }
  }
  try {
    const payload = await fetchJson("https://open.er-api.com/v6/latest/INR");
    const rates = (payload.rates ?? {}) as Record<string, number>;
    const filtered = Object.fromEntries(Object.entries(rates).filter(([code, value]) => DISPLAY_CURRENCIES.includes(code as CurrencyCode) && Number.isFinite(Number(value))));
    filtered.INR = 1;
    const fresh = { fetchedAt: new Date().toISOString(), rates: filtered };
    await upsertSetting(RATE_SETTING, JSON.stringify(fresh));
    return fresh;
  } catch (error) {
    console.warn("[Currency] Rate refresh failed; using last known rates", error);
    if (stored) {
      try { return JSON.parse(stored) as RateCache; } catch { /* use safe fallback */ }
    }
    return { fetchedAt: new Date().toISOString(), rates: { INR: 1 } };
  }
}

function getClientIp(headers: Record<string, unknown>) {
  const forwarded = String(headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  return forwarded || String(headers["x-real-ip"] ?? "").trim() || "";
}

export async function detectCurrency(headers: Record<string, unknown>) {
  const ip = getClientIp(headers);
  let country = "IN";
  if (ip && !/^(127\.|10\.|192\.168\.|::1|localhost)/.test(ip)) {
    try {
      const geo = await fetchJson(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
      if (typeof geo.country_code === "string") country = geo.country_code.toUpperCase();
    } catch {
      try {
        const fallback = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
        if (typeof fallback.country_code === "string") country = fallback.country_code.toUpperCase();
      } catch (fallbackError) { console.warn("[Currency] Geolocation providers failed; defaulting to INR", fallbackError); }
    }
  }
  const detected = (DISPLAY_CURRENCIES.find((code) => CURRENCY_META[code].countries.includes(country)) ?? "INR") as CurrencyCode;
  const rates = await getDailyRates();
  const selected = rates.rates[detected] ? detected : BASE_CURRENCY;
  return { country, detectedCurrency: selected, rates: rates.rates, fetchedAt: rates.fetchedAt, baseCurrency: BASE_CURRENCY, stripeSupportedCurrencies: [...STRIPE_SUPPORTED_CURRENCIES], currencies: DISPLAY_CURRENCIES.map((code) => ({ code, ...CURRENCY_META[code], available: Boolean(rates.rates[code]), stripeSupported: STRIPE_SUPPORTED_CURRENCIES.includes(code as (typeof STRIPE_SUPPORTED_CURRENCIES)[number]) })) };
}

export async function getCurrencyRate(currency: string) {
  const code = currency.toUpperCase() as CurrencyCode;
  if (!DISPLAY_CURRENCIES.includes(code)) throw new Error("Unsupported display currency");
  const rates = await getDailyRates();
  const rate = rates.rates[code];
  if (!rate) throw new Error("Exchange rate is unavailable for this currency");
  return { code, rate, fetchedAt: rates.fetchedAt, stripeSupported: STRIPE_SUPPORTED_CURRENCIES.includes(code as (typeof STRIPE_SUPPORTED_CURRENCIES)[number]) };
}

export function convertFromInr(amountInr: number, currency: CurrencyCode, rate: number) {
  const converted = amountInr * rate;
  return currency === "JPY" ? Math.round(converted) : Math.round(converted * 100) / 100;
}

export function getMinorUnitAmount(amount: number, currency: CurrencyCode) {
  return currency === "JPY" ? Math.round(amount) : Math.round(amount * 100);
}
