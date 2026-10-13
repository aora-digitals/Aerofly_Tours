export type ProviderName = "mock" | "razorpay" | "stripe";

export type CreateOrderInput = {
  paymentReference: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
};

export type CreatedOrder = {
  provider: ProviderName;
  providerOrderId: string;
  checkoutUrl?: string;
  clientKey?: string;
  amountMinor: number;
  currency: string;
};

export type VerifiedEvent = {
  provider: ProviderName;
  eventId: string;
  eventType: string;
  providerOrderId: string;
  providerPaymentId: string | null;
  amountMinor: number;
  currency: string;
  outcome: "succeeded" | "failed" | "pending";
};

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");

async function hmacSha256(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

async function providerFetch(url: string, init: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Payment provider request failed (${response.status})`);
  return body;
}

export async function createProviderOrder(provider: ProviderName, input: CreateOrderInput): Promise<CreatedOrder> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Invalid trusted amount");
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error("Invalid currency");

  if (provider === "mock") {
    if (Deno.env.get("PAYMENT_MOCK_ENABLED") !== "true") throw new Error("Mock payments are disabled");
    return { provider, providerOrderId: `mock_${input.paymentReference}`, amountMinor: input.amountMinor, currency: input.currency };
  }

  if (provider === "razorpay") {
    const keyId = requireEnv("RAZORPAY_KEY_ID");
    const keySecret = requireEnv("RAZORPAY_KEY_SECRET");
    const order = await providerFetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: input.amountMinor, currency: input.currency, receipt: input.paymentReference, notes: { idempotency_key: input.idempotencyKey } }),
    });
    return { provider, providerOrderId: order.id, clientKey: keyId, amountMinor: order.amount, currency: order.currency };
  }

  const secret = requireEnv("STRIPE_SECRET_KEY");
  const body = new URLSearchParams({
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.customerEmail ?? "",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(input.amountMinor),
    "line_items[0][price_data][product_data][name]": `AeroFly booking ${input.paymentReference}`,
    "line_items[0][quantity]": "1",
    client_reference_id: input.paymentReference,
    "metadata[payment_reference]": input.paymentReference,
  });
  const session = await providerFetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": input.idempotencyKey },
    body,
  });
  return { provider, providerOrderId: session.id, checkoutUrl: session.url, amountMinor: input.amountMinor, currency: input.currency };
}

export async function verifyRazorpayWebhook(rawBody: string, signature: string | null): Promise<VerifiedEvent> {
  if (!signature) throw new Error("Missing Razorpay webhook signature");
  const expected = await hmacSha256(requireEnv("RAZORPAY_WEBHOOK_SECRET"), rawBody);
  if (!equalConstantTime(expected, signature)) throw new Error("Invalid Razorpay webhook signature");
  const event = JSON.parse(rawBody);
  const payment = event.payload?.payment?.entity;
  const order = event.payload?.order?.entity;
  const paymentEntity = payment ?? {};
  const orderId = paymentEntity.order_id ?? order?.id;
  if (!event.id || !orderId) throw new Error("Webhook is missing required references");
  const outcome = event.event === "payment.captured" ? "succeeded" : event.event === "payment.failed" ? "failed" : "pending";
  return {
    provider: "razorpay", eventId: String(event.id), eventType: String(event.event),
    providerOrderId: String(orderId), providerPaymentId: paymentEntity.id ? String(paymentEntity.id) : null,
    amountMinor: Number(paymentEntity.amount ?? order?.amount ?? 0), currency: String(paymentEntity.currency ?? order?.currency ?? "").toUpperCase(), outcome,
  };
}

export async function verifyStripeWebhook(rawBody: string, signatureHeader: string | null): Promise<VerifiedEvent> {
  if (!signatureHeader) throw new Error("Missing Stripe signature");
  const parts = Object.fromEntries(signatureHeader.split(",").map(p => p.split("=", 2) as [string, string]));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new Error("Invalid or stale Stripe signature");
  const expected = await hmacSha256(requireEnv("STRIPE_WEBHOOK_SECRET"), `${timestamp}.${rawBody}`);
  if (!equalConstantTime(expected, signature)) throw new Error("Invalid Stripe webhook signature");
  const event = JSON.parse(rawBody);
  const object = event.data?.object ?? {};
  const paymentIntent = object.payment_intent;
  const amount = object.amount_total ?? object.amount ?? 0;
  const currency = String(object.currency ?? "").toUpperCase();
  const type = String(event.type ?? "unknown");
  return {
    provider: "stripe", eventId: String(event.id), eventType: type,
    providerOrderId: String(object.id ?? ""),
    providerPaymentId: typeof paymentIntent === "string" ? paymentIntent : (paymentIntent?.id ?? null),
    amountMinor: Number(amount), currency,
    outcome: type === "checkout.session.completed" && object.payment_status === "paid" || type === "checkout.session.async_payment_succeeded" ? "succeeded" : type.includes("payment_failed") || type === "checkout.session.expired" ? "failed" : "pending",
  };
}
