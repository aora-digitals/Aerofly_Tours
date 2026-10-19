
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  verifyRazorpayWebhook,
  verifyStripeWebhook,
} from "../_shared/payment-providers.ts";

const MAX_BODY_BYTES = 256 * 1024;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    // No browser CORS permission is granted for this server endpoint.
    return new Response(null, { status: 204 });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const declaredLength = Number(
    req.headers.get("content-length") ?? "0",
  );

  if (declaredLength > MAX_BODY_BYTES) {
    return json(413, { error: "Webhook payload is too large" });
  }

  try {
    // Provider signatures must be verified against the exact raw body.
    const rawBody = await req.text();

    if (
      new TextEncoder().encode(rawBody).byteLength >
      MAX_BODY_BYTES
    ) {
      return json(413, {
        error: "Webhook payload is too large",
      });
    }

    const providerHeader =
      req.headers.get("x-payment-provider");

    const provider =
      providerHeader ??
      (req.headers.has("stripe-signature")
        ? "stripe"
        : req.headers.has("x-razorpay-signature")
          ? "razorpay"
          : null);

    let event;

    if (provider === "stripe") {
      event = await verifyStripeWebhook(
        rawBody,
        req.headers.get("stripe-signature"),
      );
    } else if (provider === "razorpay") {
      event = await verifyRazorpayWebhook(
        rawBody,
        req.headers.get("x-razorpay-signature"),
      );

      // Use the event ID from the signed payload. Do not allow an
      // unsigned HTTP header to replace the provider's event identity.
    } else {
      return json(400, {
        error: "Unsupported payment provider",
      });
    }

    if (
      !event.eventId ||
      !event.providerOrderId ||
      !Number.isSafeInteger(event.amountMinor) ||
      event.amountMinor <= 0 ||
      !/^[A-Z]{3}$/.test(event.currency)
    ) {
      return json(400, {
        error: "Verified event is missing required payment fields",
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Payment webhook configuration is incomplete");

      return json(503, {
        error: "Payment reconciliation is unavailable",
      });
    }

    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const { data, error } = await admin.rpc(
      "process_payment_webhook",
      {
        p_provider: event.provider,
        p_event_id: event.eventId,
        p_event_type: event.eventType,
        p_payload_sha256: await sha256Hex(rawBody),
        p_provider_order_id: event.providerOrderId,
        p_provider_payment_id: event.providerPaymentId,
        p_amount_minor: event.amountMinor,
        p_currency: event.currency,
        p_outcome: event.outcome,
      },
    );

    if (error) {
      // Do not acknowledge failed reconciliation as successful.
      // The provider should retry its webhook according to its policy.
      console.error("Payment webhook reconciliation failed", {
        provider: event.provider,
        eventType: event.eventType,
        code: error.code,
      });

      return json(500, {
        error: "Payment event could not be reconciled",
      });
    }

    return json(200, {
      received: true,
      result: data,
    });
  } catch {
    // Never log raw payment bodies, signatures, or credentials.
    console.warn("Payment webhook signature or payload rejected");

    return json(400, {
      error: "Invalid or unverifiable payment webhook",
    });
  }
});
