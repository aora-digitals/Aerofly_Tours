import Stripe from "stripe";
import { ENV } from "./_core/env";
import { createPendingStripePayment, getCustomerQuotation, getPaymentById, markPaymentRefunded, reconcileStripePayment } from "./db";
import type { User } from "../drizzle/schema";
import { BASE_CURRENCY, convertFromInr, getCurrencyRate, getMinorUnitAmount, STRIPE_SUPPORTED_CURRENCIES, type CurrencyCode } from "./currency";

function getStripe() {
  if (!ENV.stripeSecretKey) throw new Error("Stripe is not configured. Add the payment keys in Settings → Payment.");
  return new Stripe(ENV.stripeSecretKey);
}

export async function createCustomerCheckout(input: { quotationId: number; user: User; origin: string; requestedCurrency?: string }) {
  const stripe = getStripe();
  const quote = await getCustomerQuotation(input.quotationId, input.user.id);
  if (!quote) throw new Error("This quotation is not available in your customer account");
  if (quote.status !== "accepted") throw new Error("Only an accepted quotation can be paid online");
  if (quote.validUntil && quote.validUntil.getTime() < Date.now()) throw new Error("This quotation has expired");
  const baseAmountInr = Number(quote.total);
  if (!Number.isFinite(baseAmountInr) || baseAmountInr <= 0) throw new Error("The quotation amount is invalid");
  let checkoutCurrency: CurrencyCode = BASE_CURRENCY;
  let displayAmount = baseAmountInr;
  let fallbackNotice: string | undefined;
  if (input.requestedCurrency) {
    try {
      const requested = await getCurrencyRate(input.requestedCurrency);
      if (requested.stripeSupported && STRIPE_SUPPORTED_CURRENCIES.includes(requested.code as (typeof STRIPE_SUPPORTED_CURRENCIES)[number])) {
        checkoutCurrency = requested.code;
        displayAmount = convertFromInr(baseAmountInr, requested.code, requested.rate);
      } else {
        fallbackNotice = `Stripe does not support ${requested.code} for this payment. The transaction will be completed safely in ${BASE_CURRENCY}.`;
      }
    } catch {
      fallbackNotice = `The selected currency is temporarily unavailable. The transaction will be completed safely in ${BASE_CURRENCY}.`;
    }
  }
  const amount = getMinorUnitAmount(displayAmount, checkoutCurrency);
  if (!Number.isFinite(amount) || amount < (checkoutCurrency === "JPY" ? 50 : 50)) throw new Error("The quotation amount is below Stripe's minimum checkout value");
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: input.user.email ?? undefined,
    client_reference_id: String(input.user.id),
    allow_promotion_codes: true,
    line_items: [{ price_data: { currency: checkoutCurrency.toLowerCase(), product_data: { name: `AeroFly trip to ${quote.destination}`, description: `${quote.travelDates} · ${quote.travellers} traveller${quote.travellers === 1 ? "" : "s"}` }, unit_amount: amount }, quantity: 1 }],
    metadata: { user_id: String(input.user.id), customer_email: input.user.email ?? "", customer_name: input.user.name ?? "", quotation_id: String(quote.id), booking_id: quote.bookingId ? String(quote.bookingId) : "", base_currency: BASE_CURRENCY, checkout_currency: checkoutCurrency },
    payment_intent_data: { metadata: { user_id: String(input.user.id), quotation_id: String(quote.id), booking_id: quote.bookingId ? String(quote.bookingId) : "", base_currency: BASE_CURRENCY, checkout_currency: checkoutCurrency } },
    success_url: `${input.origin}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/dashboard?payment=cancelled`,
  });
  await createPendingStripePayment({ quotationId: quote.id, bookingId: quote.bookingId ?? undefined, userId: input.user.id, checkoutSessionId: session.id, paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : undefined, amount: quote.total, settlementCurrency: checkoutCurrency });
  return { url: session.url, currency: checkoutCurrency, displayAmount, fallbackNotice };
}

export async function handleStripeWebhook(rawBody: Buffer, signature: string | undefined) {
  const stripe = getStripe();
  if (!signature) throw new Error("Missing Stripe signature");
  const event = stripe.webhooks.constructEvent(rawBody, signature, ENV.stripeWebhookSecret);
  if (event.id.startsWith("evt_test_")) return { verified: true } as const;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      await reconcileStripePayment({ checkoutSessionId: session.id, paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : undefined, status: session.payment_status === "paid" || event.type.endsWith("succeeded") ? "successful" : "failed" });
      break;
    }
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      await reconcileStripePayment({ checkoutSessionId: session.id, status: "failed" });
      break;
    }
    default:
      break;
  }
  return { received: true } as const;
}

export async function refundStripePayment(paymentIntentId: string) {
  const stripe = getStripe();
  const refund = await stripe.refunds.create({ payment_intent: paymentIntentId });
  return { id: refund.id, status: refund.status };
}

export async function refundCustomerPayment(paymentId: number) {
  const payment = await getPaymentById(paymentId);
  if (!payment) throw new Error("Payment not found");
  if (payment.status !== "successful") throw new Error("Only a successful payment can be refunded");
  if (!payment.stripePaymentIntentId) throw new Error("This payment was recorded manually and has no Stripe refund reference");
  const refund = await refundStripePayment(payment.stripePaymentIntentId);
  if (refund.status === "succeeded" || refund.status === "pending") await markPaymentRefunded(paymentId);
  return refund;
}

export { markPaymentRefunded };
