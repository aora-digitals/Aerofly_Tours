import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyRazorpayWebhook, verifyStripeWebhook } from "../_shared/payment-providers.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, stripe-signature, x-razorpay-signature, x-razorpay-event-id", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const rawBody = await req.text();
    const providerHeader = req.headers.get("x-payment-provider");
    const provider = providerHeader ?? (req.headers.has("stripe-signature") ? "stripe" : req.headers.has("x-razorpay-signature") ? "razorpay" : null);
    let event;
    if (provider === "stripe") {
      event = await verifyStripeWebhook(rawBody, req.headers.get("stripe-signature"));
    } else if (provider === "razorpay") {
      event = await verifyRazorpayWebhook(rawBody, req.headers.get("x-razorpay-signature"));
      const headerEventId = req.headers.get("x-razorpay-event-id");
      if (headerEventId) event.eventId = headerEventId;
    } else {
      return json(400, { error: "Unsupported payment provider" });
    }

    if (!event.eventId || !event.providerOrderId || !Number.isSafeInteger(event.amountMinor) || event.amountMinor <= 0 || !/^[A-Z]{3}$/.test(event.currency)) {
      return json(400, { error: "Verified event is missing required payment fields" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server configuration is missing");
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.rpc("process_payment_webhook", {
      p_provider: event.provider,
      p_event_id: event.eventId,
      p_event_type: event.eventType,
      p_payload_sha256: await sha256Hex(rawBody),
      p_provider_order_id: event.providerOrderId,
      p_provider_payment_id: event.providerPaymentId,
      p_amount_minor: event.amountMinor,
      p_currency: event.currency,
      p_outcome: event.outcome,
    });
    if (error) {
      console.error("Payment webhook reconciliation failed", { provider: event.provider, eventType: event.eventType, code: error.code });
      return json(409, { error: "Payment event could not be reconciled" });
    }
    return json(200, { received: true, result: data });
  } catch (error) {
    // Do not log raw body, signatures, provider secrets, or payment credentials.
    console.warn("Rejected payment webhook", error instanceof Error ? error.message : "unknown error");
    return json(400, { error: "Invalid or unverifiable payment webhook" });
  }
});
