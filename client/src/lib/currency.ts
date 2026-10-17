export const SUPPORTED_CURRENCIES = [
  "INR", "USD", "EUR", "GBP", "AED",
  "SGD", "AUD", "CAD", "JPY", "CHF",
  "NZD", "HKD", "SEK", "NOK", "DKK",
  "BRL", "ZAR", "THB", "MYR", "PHP", "IDR",
] as const;

export type SupportedCurrency =
  (typeof SUPPORTED_CURRENCIES)[number];

export type RateMetadata = {
  baseCurrency: "INR";
  rates: Partial<Record<SupportedCurrency, number>>;
  source: string;
  fetchedAt: string | null;
  status: "live" | "manual" | "stale" | "base_only";
};

export function isSupportedCurrency(
  value: string,
): value is SupportedCurrency {
  return (
    SUPPORTED_CURRENCIES as readonly string[]
  ).includes(value.toUpperCase());
}

export function formatMoney(
  amount: number,
  currency: string,
  locale = "en-IN",
) {
  if (
    !Number.isFinite(amount) ||
    !isSupportedCurrency(currency)
  ) {
    throw new Error(
      "Invalid amount or unsupported currency.",
    );
  }

  const code = currency.toUpperCase();
  const digits = ["JPY", "IDR"].includes(code) ? 0 : 2;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

/**
 * For indicative display only.
 * Authoritative prices and payments must use server-side
 * decimal arithmetic and the accepted quotation snapshot.
 */
export function convertIndicativeFromInr(
  amountInr: number,
  rate: number,
  currency: string,
): number {
  if (
    !Number.isFinite(amountInr) ||
    amountInr < 0 ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !isSupportedCurrency(currency)
  ) {
    throw new Error("Invalid conversion input.");
  }

  const digits = ["JPY", "IDR"].includes(
    currency.toUpperCase(),
  )
    ? 0
    : 2;

  const factor = 10 ** digits;

  return (
    Math.round(
      (amountInr * rate + Number.EPSILON) * factor,
    ) / factor
  );
}

export function formatRateLabel(
  metadata: RateMetadata,
) {
  if (metadata.status === "stale") {
    return "Stale rate — indicative only";
  }

  if (metadata.status === "manual") {
    return "Configured manual rate";
  }

  if (metadata.status === "base_only") {
    return "INR base rate only";
  }

  return `Rate source: ${metadata.source}`;
}