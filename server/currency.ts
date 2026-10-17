import { getSetting, upsertSetting } from "./db";

export const BASE_CURRENCY = "INR" as const;

export const STRIPE_SUPPORTED_CURRENCIES = [
  "INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD",
  "CAD", "JPY", "CHF", "NZD", "HKD", "SEK", "NOK", "DKK",
] as const;

export const DISPLAY_CURRENCIES = [
  "INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD",
  "CAD", "JPY", "CHF", "NZD", "HKD", "SEK", "NOK",
  "DKK", "BRL", "ZAR", "THB", "MYR", "PHP", "IDR",
] as const;

export type CurrencyCode =
  (typeof DISPLAY_CURRENCIES)[number];

const CURRENCY_META: Record<
  CurrencyCode,
  { symbol: string; label: string; countries: string[] }
> = {
  INR: { symbol: "₹", label: "Indian rupee", countries: ["IN"] },
  USD: { symbol: "$", label: "US dollar", countries: ["US", "EC", "PA"] },
  EUR: { symbol: "€", label: "Euro", countries: ["DE", "FR", "IT", "ES", "NL", "BE", "AT", "IE", "PT", "GR", "FI"] },
  GBP: { symbol: "£", label: "British pound", countries: ["GB"] },
  AED: { symbol: "د.إ", label: "UAE dirham", countries: ["AE"] },
  SGD: { symbol: "S$", label: "Singapore dollar", countries: ["SG"] },
  AUD: { symbol: "A$", label: "Australian dollar", countries: ["AU"] },
  CAD: { symbol: "C$", label: "Canadian dollar", countries: ["CA"] },
  JPY: { symbol: "¥", label: "Japanese yen", countries: ["JP"] },
  CHF: { symbol: "CHF", label: "Swiss franc", countries: ["CH"] },
  NZD: { symbol: "NZ$", label: "New Zealand dollar", countries: ["NZ"] },
  HKD: { symbol: "HK$", label: "Hong Kong dollar", countries: ["HK"] },
  SEK: { symbol: "kr", label: "Swedish krona", countries: ["SE"] },
  NOK: { symbol: "kr", label: "Norwegian krone", countries: ["NO"] },
  DKK: { symbol: "kr", label: "Danish krone", countries: ["DK"] },
  BRL: { symbol: "R$", label: "Brazilian real", countries: ["BR"] },
  ZAR: { symbol: "R", label: "South African rand", countries: ["ZA"] },
  THB: { symbol: "฿", label: "Thai baht", countries: ["TH"] },
  MYR: { symbol: "RM", label: "Malaysian ringgit", countries: ["MY"] },
  PHP: { symbol: "₱", label: "Philippine peso", countries: ["PH"] },
  IDR: { symbol: "Rp", label: "Indonesian rupiah", countries: ["ID"] },
};

const RATE_SETTING = "currency_rates_inr_v1";
const DAY_MS = 24 * 60 * 60 * 1000;

type RateCache = {
  fetchedAt: string;
  rates: Record<string, number>;
  source?: string;
  status?: "live" | "manual" | "stale" | "base_only";
  baseCurrency?: string;
};

async function fetchJson(
  url: string,
  headers: Record<string, string> = {},
) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: {
      accept: "application/json",
      ...headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Provider returned ${response.status}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

function validRates(value: unknown): Record<string, number> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return { INR: 1 };
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, number> = { INR: 1 };

  for (const [rawCode, rawRate] of Object.entries(input)) {
    const code = rawCode.toUpperCase();
    const rate = Number(rawRate);

    if (
      DISPLAY_CURRENCIES.includes(code as CurrencyCode) &&
      Number.isFinite(rate) &&
      rate > 0
    ) {
      output[code] = rate;
    }
  }

  return output;
}

export async function getDailyRates(): Promise<RateCache> {
  const stored = await getSetting(RATE_SETTING);
  let previous: RateCache | null = null;

  if (stored) {
    try {
      const parsed = JSON.parse(stored) as RateCache;

      if (parsed.fetchedAt && parsed.rates?.INR === 1) {
        previous = {
          ...parsed,
          rates: validRates(parsed.rates),
        };
      }
    } catch {
      // Ignore malformed cached configuration.
    }
  }

  const providerUrl =
    process.env.CURRENCY_RATE_PROVIDER_URL?.trim();

  let providerFailed = false;

  if (providerUrl) {
    try {
      const url = providerUrl.includes("{base}")
        ? providerUrl.replaceAll("{base}", "INR")
        : `${providerUrl}${providerUrl.includes("?") ? "&" : "?"}base=INR`;

      const key =
        process.env.CURRENCY_RATE_PROVIDER_API_KEY?.trim();

      const payload = await fetchJson(
        url,
        key
          ? { authorization: `Bearer ${key}` }
          : {},
      );

      const rates = validRates(
        payload.rates ?? payload.conversion_rates,
      );

      if (Object.keys(rates).length <= 1) {
        throw new Error(
          "Provider returned no supported exchange rates",
        );
      }

      const fresh: RateCache = {
        fetchedAt: new Date().toISOString(),
        rates,
        source:
          process.env.CURRENCY_RATE_PROVIDER_NAME?.trim() ||
          new URL(url).hostname,
        status: "live",
        baseCurrency: "INR",
      };

      await upsertSetting(
        RATE_SETTING,
        JSON.stringify(fresh),
      );

      return fresh;
    } catch (error) {
      providerFailed = true;

      console.warn(
        "[Currency] Configured provider failed; falling back to saved rates",
        error instanceof Error
          ? error.message
          : "provider error",
      );
    }
  }

  if (previous) {
    const age =
      Date.now() - new Date(previous.fetchedAt).getTime();

    const isManual = previous.status === "manual";
    const staleAfter = isManual
      ? 7 * DAY_MS
      : DAY_MS;

    const status = isManual
      ? age > staleAfter || providerFailed
        ? "stale"
        : "manual"
      : !providerUrl || providerFailed || age > staleAfter
        ? "stale"
        : previous.status ?? "stale";

    return {
      ...previous,
      status,
      source:
        previous.source ||
        (isManual
          ? "Manual configuration"
          : "Previously cached provider rate"),
    };
  }

  // No provider or configured rate: never fabricate FX data.
  return {
    fetchedAt: new Date().toISOString(),
    rates: { INR: 1 },
    source:
      "INR base only; no exchange-rate provider configured",
    status: "base_only",
    baseCurrency: "INR",
  };
}

function getClientIp(headers: Record<string, unknown>) {
  const forwarded = String(
    headers["x-forwarded-for"] ?? "",
  )
    .split(",")[0]
    ?.trim();

  return (
    forwarded ||
    String(headers["x-real-ip"] ?? "").trim() ||
    ""
  );
}

export async function detectCurrency(
  headers: Record<string, unknown>,
) {
  const ip = getClientIp(headers);
  let country = "IN";

  if (
    ip &&
    !/^(127\.|10\.|192\.168\.|::1|localhost)/.test(ip)
  ) {
    try {
      const geo = await fetchJson(
        `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
      );

      if (typeof geo.country_code === "string") {
        country = geo.country_code.toUpperCase();
      }
    } catch {
      try {
        const fallback = await fetchJson(
          `https://ipwho.is/${encodeURIComponent(ip)}`,
        );

        if (
          typeof fallback.country_code === "string"
        ) {
          country = fallback.country_code.toUpperCase();
        }
      } catch (error) {
        console.warn(
          "[Currency] Geolocation providers failed; defaulting to INR",
          error,
        );
      }
    }
  }

  const detected = (
    DISPLAY_CURRENCIES.find((code) =>
      CURRENCY_META[code].countries.includes(country),
    ) ?? "INR"
  ) as CurrencyCode;

  const rates = await getDailyRates();
  const selected = rates.rates[detected]
    ? detected
    : BASE_CURRENCY;

  return {
    country,
    detectedCurrency: selected,
    rates: rates.rates,
    fetchedAt: rates.fetchedAt,
    rateSource: rates.source ?? "Unknown",
    rateStatus: rates.status ?? "stale",
    baseCurrency: BASE_CURRENCY,
    stripeSupportedCurrencies: [
      ...STRIPE_SUPPORTED_CURRENCIES,
    ],
    currencies: DISPLAY_CURRENCIES.map((code) => ({
  code,
  name: CURRENCY_META[code].label,
  symbol: CURRENCY_META[code].symbol,
  available: Boolean(rates.rates[code]),
  stripeSupported:
    STRIPE_SUPPORTED_CURRENCIES.includes(
      code as (typeof STRIPE_SUPPORTED_CURRENCIES)[number],
    ),
})),
  };
}

export async function getCurrencyRate(currency: string) {
  const code = currency.toUpperCase() as CurrencyCode;

  if (!DISPLAY_CURRENCIES.includes(code)) {
    throw new Error("Unsupported display currency");
  }

  const rates = await getDailyRates();
  const rate = rates.rates[code];

  if (!rate) {
    throw new Error(
      "Exchange rate is unavailable for this currency",
    );
  }

  return {
    code,
    rate,
    fetchedAt: rates.fetchedAt,
    rateSource: rates.source ?? "Unknown",
    rateStatus: rates.status ?? "stale",
    stripeSupported:
      STRIPE_SUPPORTED_CURRENCIES.includes(
        code as (typeof STRIPE_SUPPORTED_CURRENCIES)[number],
      ),
  };
}

/** Accepted proposal currency is authoritative for checkout. */
export function resolvePayableCurrency(
  acceptedCurrency: string,
  requestedDisplayCurrency?: string,
) {
  const accepted = acceptedCurrency.toUpperCase();

  if (
    !DISPLAY_CURRENCIES.includes(
      accepted as CurrencyCode,
    )
  ) {
    throw new Error(
      `Unsupported accepted proposal currency: ${accepted}`,
    );
  }

  if (
    !STRIPE_SUPPORTED_CURRENCIES.includes(
      accepted as (typeof STRIPE_SUPPORTED_CURRENCIES)[number],
    )
  ) {
    throw new Error(
      `Accepted proposal currency ${accepted} is not enabled for online checkout. Staff must review and reissue a supported proposal.`,
    );
  }

  const requested = requestedDisplayCurrency?.toUpperCase();

  return {
    currency: accepted as CurrencyCode,
    notice:
      requested && requested !== accepted
        ? `Your accepted proposal is payable in ${accepted}. The selected display currency is indicative only and does not change the amount due.`
        : undefined,
  };
}

export function convertFromInr(
  amountInr: number,
  currency: CurrencyCode,
  rate: number,
) {
  if (
    !Number.isFinite(amountInr) ||
    amountInr < 0 ||
    !Number.isFinite(rate) ||
    rate <= 0
  ) {
    throw new Error("Invalid conversion input");
  }

  const converted = amountInr * rate;

  return ["JPY", "IDR"].includes(currency)
    ? Math.round(converted)
    : Math.round(converted * 100) / 100;
}

export function getMinorUnitAmount(
  amount: number | string,
  currency: CurrencyCode,
): number {
  const raw =
    typeof amount === "number"
      ? String(amount)
      : amount.trim();

  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(raw)) {
    throw new Error("Invalid monetary amount");
  }

  const digits = ["JPY", "IDR"].includes(currency)
    ? 0
    : 2;

  const [wholeText, fractionText = ""] = raw.split(".");
  const whole = BigInt(wholeText);

  const kept = (
    fractionText.slice(0, digits) +
    "0".repeat(digits)
  ).slice(0, digits);

  let minor =
    whole * 10n ** BigInt(digits) +
    BigInt(kept || "0");

  if (
    fractionText.length > digits &&
    Number(fractionText[digits]) >= 5
  ) {
    minor += 1n;
  }

  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      "Monetary amount exceeds safe payment limits",
    );
  }

  return Number(minor);
}