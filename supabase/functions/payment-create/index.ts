
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createProviderOrder,
  type ProviderName,
} from "../_shared/payment-providers.ts";

const MAX_BODY_BYTES = 16 * 1024;

const configuredOrigins = [
  Deno.env.get("APP_ORIGIN"),
  Deno.env.get("PAYMENT_RETURN_ORIGIN"),
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://aeroflyytours.com",
  "https://www.aeroflyytours.com",
].filter((value): value is string => Boolean(value));

function isAllowedOrigin(origin: string): boolean {
  try {
    const normalizedOrigin = new URL(origin).origin;

    return configuredOrigins.some((configured) => {
      try {
        return new URL(configured).origin === normalizedOrigin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function headersFor(req: Request): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, apikey, x-client-info, content-type, idempotency-key",
    Vary: "Origin",
  };

  const origin = req.headers.get("origin");

  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function json(
  req: Request,
  status: number,
  body: Record<string, unknown>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: headersFor(req),
  });
}

function getReturnOrigin(): string {
  const configured =
    Deno.env.get("PAYMENT_RETURN_ORIGIN") ??
    Deno.env.get("APP_ORIGIN");

  if (!configured) {
    throw new Error("Payment return origin is not configured");
  }

  const parsed = new URL(configured);

  if (
    parsed.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(parsed.hostname)
  ) {
    throw new Error("Payment return origin must use HTTPS");
  }

  return parsed.origin;
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const length = Number(req.headers.get("content-length") ?? "0");

  if (length > MAX_BODY_BYTES) return null;

  const raw = await req.text();

  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (origin && !isAllowedOrigin(origin)) {
    return new Response("Origin not allowed", {
      status: 403,
      headers: {
        "Cache-Control": "no-store",
        Vary: "Origin",
      },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: headersFor(req),
    });
  }

  if (req.method !== "POST") {
    return json(req, 405, { error: "Method not allowed" });
  }

  try {
    // ---------------------------------------------------------
    // 1. Authenticate the customer
    // ---------------------------------------------------------
    const authorization = req.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return json(req, 401, { error: "Authentication required" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json(req, 503, {
        error: "Payment service is not configured",
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: { Authorization: authorization },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: authData, error: authError } =
      await userClient.auth.getUser();

    if (authError || !authData.user) {
      return json(req, 401, { error: "Invalid session" });
    }

    // ---------------------------------------------------------
    // 2. Validate request and idempotency key
    // ---------------------------------------------------------
    const input = await readJson(req);

    if (!input) {
      return json(req, 400, {
        error: "Request body is invalid or exceeds the size limit",
      });
    }

    const quotationId = Number(input.quotationId);

    if (!Number.isSafeInteger(quotationId) || quotationId <= 0) {
      return json(req, 400, {
        error: "quotationId must be a positive integer",
      });
    }

    const idempotencyKey =
      req.headers.get("idempotency-key") ?? input.idempotencyKey;

    if (
      typeof idempotencyKey !== "string" ||
      !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)
    ) {
      return json(req, 400, {
        error: "A valid Idempotency-Key is required",
      });
    }

    // ---------------------------------------------------------
    // 3. Initialize server-side Supabase admin client
    // ---------------------------------------------------------
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // ---------------------------------------------------------
    // 4. Load the customer's own quotation
    // ---------------------------------------------------------
    const { data: quote, error: quoteError } = await admin
      .from("quotations")
      .select(
        'id, reference, status, proposal_status, customer_response, customer_auth_id, total, currency, "bookingId", "validUntil", withdrawn_at',
      )
      .eq("id", quotationId)
      .eq("customer_auth_id", authData.user.id)
      .maybeSingle();

    if (quoteError) {
      console.error("Quotation validation failed", {
        quotationId,
        code: quoteError.code,
      });

      return json(req, 503, {
        error: "Could not validate the booking proposal",
      });
    }

    if (!quote) {
      return json(req, 404, {
        error: "Booking proposal not found",
      });
    }

    // Only an accepted staff-issued proposal can be paid.
    if (
      quote.proposal_status !== "ACCEPTED" ||
      quote.customer_response !== "accepted" ||
      quote.status !== "accepted"
    ) {
      return json(req, 409, {
        error: "Only an accepted proposal can be paid",
      });
    }

    if (quote.withdrawn_at) {
      return json(req, 409, {
        error: "This proposal has been withdrawn",
      });
    }

    if (quote.validUntil) {
      const expiry = new Date(quote.validUntil).getTime();

      if (!Number.isFinite(expiry)) {
        return json(req, 409, {
          error: "The proposal expiry date is invalid",
        });
      }

      if (expiry < Date.now()) {
        return json(req, 409, {
          error: "This proposal has expired",
        });
      }
    }

    // ---------------------------------------------------------
    // 5. Validate amount and currency
    // ---------------------------------------------------------
    const amount = Number(quote.total);

    if (!Number.isFinite(amount) || amount <= 0) {
      return json(req, 409, {
        error: "Invalid proposal total",
      });
    }

    const currency = String(quote.currency ?? "INR").toUpperCase();

    if (!/^[A-Z]{3}$/.test(currency)) {
      return json(req, 409, {
        error: "Invalid proposal currency",
      });
    }

    /*
     * This function creates a full-balance payment attempt.
     * INR is routed to Razorpay; other currencies to Stripe.
     *
     * Stripe supports currencies with different minor-unit
     * precision. Extend this mapping if your catalogue uses
     * three-decimal currencies.
     */
    const zeroDecimalCurrencies = new Set([
      "BIF", "CLP", "DJF", "GNF", "ISK", "JPY",
      "KMF", "KRW", "PYG", "RWF", "UGX", "VND",
      "VUV", "XAF", "XOF", "XPF",
    ]);

    const minorUnitFactor = zeroDecimalCurrencies.has(currency)
      ? 1
      : 100;

    const amountMinor = Math.round(amount * minorUnitFactor);

    if (
      !Number.isSafeInteger(amountMinor) ||
      amountMinor <= 0
    ) {
      return json(req, 409, {
        error: "Invalid payment amount",
      });
    }

    // ---------------------------------------------------------
    // 6. Select the gateway
    // ---------------------------------------------------------
    const configuredProvider =
      Deno.env.get("PAYMENT_DEFAULT_PROVIDER") ?? "auto";

    console.log("[payment-create] Provider routing", {
      configuredProvider,
      currency,
    });

    let provider: ProviderName;

    if (configuredProvider === "mock") {
      if (Deno.env.get("PAYMENT_MOCK_ENABLED") !== "true") {
        return json(req, 503, {
          error: "Mock payments are disabled",
        });
      }

      provider = "mock";
    } else if (
      configuredProvider !== "auto" &&
      configuredProvider !== "razorpay" &&
      configuredProvider !== "stripe"
    ) {
      return json(req, 503, {
        error: "Payment provider is not configured",
      });
    } else if (currency === "INR") {
      provider = "razorpay";
    } else {
      provider = "stripe";
    }

    // Do not allow a fixed provider configuration to route a
    // currency to a gateway that this function does not select.
    if (
      configuredProvider === "razorpay" &&
      currency !== "INR"
    ) {
      return json(req, 409, {
        error: "Razorpay is selected for INR payments only",
      });
    }

    if (
      configuredProvider === "stripe" &&
      currency === "INR"
    ) {
      return json(req, 409, {
        error:
          "INR payments are routed to Razorpay. Set PAYMENT_DEFAULT_PROVIDER=auto to enable automatic routing.",
      });
    }

    // ---------------------------------------------------------
    // 7. Reuse existing idempotent attempts
    // ---------------------------------------------------------
    const { data: existing, error: existingError } = await admin
      .from("payments")
      .select(
        'id, reference, status, provider, provider_order_id, provider_checkout_url, provider_client_key, amount_minor, currency_snapshot, "quotationId"',
      )
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existingError) {
      return json(req, 503, {
        error: "Could not check the existing payment attempt",
      });
    }

    if (existing) {
      if (
        Number(existing.quotationId) !== quotationId ||
        existing.provider !== provider ||
        Number(existing.amount_minor) !== amountMinor ||
        existing.currency_snapshot !== currency
      ) {
        return json(req, 409, {
          error:
            "This idempotency key is already associated with another payment request",
        });
      }

      if (
        existing.status === "successful" ||
        existing.status === "refunded"
      ) {
        return json(req, 409, {
          error: "This payment attempt is no longer payable",
        });
      }

      if (existing.provider_order_id) {
        return json(req, 200, {
          paymentReference: existing.reference,
          provider: existing.provider,
          providerOrderId: existing.provider_order_id,
          checkoutUrl: existing.provider_checkout_url,
          clientKey: existing.provider_client_key,
          amountMinor,
          currency,
          status: existing.status,
          reused: true,
        });
      }

      return json(req, 409, {
        error:
          "The existing payment attempt needs reconciliation. Do not create another attempt yet.",
      });
    }

    // ---------------------------------------------------------
    // 8. Create the pending payment record
    // ---------------------------------------------------------
    const paymentReference =
      `PM-${crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;

    const { data: payment, error: insertError } = await admin
      .from("payments")
      .insert({
        reference: paymentReference,
        bookingId: quote["bookingId"] ?? null,
        quotationId,
        receivedBy: null,
        amount,
        settlementCurrency: currency,
        method: "card",
        status: "pending",
        provider,
        idempotency_key: idempotencyKey,
        amount_minor: amountMinor,
        currency_snapshot: currency,
        notes:
          "Online payment attempt. Success is confirmed only by a verified provider webhook.",
      })
      .select("id, reference")
      .single();

    if (insertError || !payment) {
      if (insertError?.code === "23505") {
        return json(req, 409, {
          error:
            "A concurrent request created this payment attempt. Retry using the same idempotency key.",
        });
      }

      console.error("Payment record creation failed", {
        quotationId,
        code: insertError?.code,
      });

      return json(req, 503, {
        error: "Could not create the payment attempt",
      });
    }

    // ---------------------------------------------------------
    // 9. Create the Razorpay order or Stripe Checkout Session
    // ---------------------------------------------------------
    try {
      const returnOrigin = getReturnOrigin();

      const order = await createProviderOrder(provider, {
        paymentReference: payment.reference,
        amountMinor,
        currency,
        idempotencyKey,
        customerEmail: authData.user.email,
        successUrl:
          `${returnOrigin}/dashboard?payment=return`,
        cancelUrl:
          `${returnOrigin}/dashboard?payment=cancelled`,
      });

      // Persist provider details without changing payment status.
      const { error: updateError } = await admin
        .from("payments")
        .update({
          provider_order_id: order.providerOrderId,
          provider_checkout_url: order.checkoutUrl ?? null,
          provider_client_key: order.clientKey ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payment.id)
        .eq("status", "pending");

      if (updateError) {
        console.error("Payment order persistence failed", {
          paymentId: payment.id,
          provider,
        });

        return json(req, 503, {
          error:
            "The provider order was created but needs reconciliation. Do not start another payment.",
          paymentReference: payment.reference,
        });
      }

      // -------------------------------------------------------
      // 10. Return checkout details to the frontend
      // -------------------------------------------------------
      return json(req, 201, {
        paymentReference: payment.reference,
        paymentId: payment.id,
        provider: order.provider,
        providerOrderId: order.providerOrderId,
        checkoutUrl: order.checkoutUrl ?? null,
        clientKey: order.clientKey ?? null,
        amountMinor: order.amountMinor,
        currency: order.currency,
        status: "pending",
      });
    } catch {
      // The provider might have created an order even if the
      // request timed out. Preserve the record for reconciliation.
      console.error("Payment provider order creation failed", {
        paymentId: payment.id,
        provider,
      });

      return json(req, 503, {
        error:
          "Payment initialization could not be confirmed. Do not submit a new payment; contact support if the issue persists.",
        paymentReference: payment.reference,
      });
    }
  } catch {
    console.error("payment-create request failed");

    return json(req, 500, {
      error: "Unable to create payment",
    });
  }
});
