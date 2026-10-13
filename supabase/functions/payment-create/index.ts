import { createClient } from "npm:@supabase/supabase-js@2";
import { createProviderOrder, type ProviderName } from "../_shared/payment-providers.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, idempotency-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Authentication required" });
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("Supabase server configuration is missing");

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json(401, { error: "Invalid session" });

    const input = await req.json().catch(() => ({}));
    const quotationId = Number(input.quotationId);
    if (!Number.isSafeInteger(quotationId) || quotationId <= 0) return json(400, { error: "quotationId must be a positive integer" });
    const idempotencyKey = req.headers.get("idempotency-key") ?? input.idempotencyKey;
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16 || idempotencyKey.length > 128) return json(400, { error: "Provide an Idempotency-Key header of 16–128 characters" });

    const providerValue = Deno.env.get("PAYMENT_DEFAULT_PROVIDER") ?? "mock";
    if (!(["mock", "razorpay", "stripe"] as string[]).includes(providerValue)) return json(500, { error: "Invalid payment provider configuration" });
    const provider = providerValue as ProviderName;
    if (provider === "mock" && Deno.env.get("PAYMENT_MOCK_ENABLED") !== "true") return json(503, { error: "Mock payments are disabled" });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: quote, error: quoteError } = await admin.from("quotations")
      .select('id, reference, status, proposal_status, customer_response, customer_auth_id, total, "bookingId", "validUntil", withdrawn_at, issued_at')
      .eq("id", quotationId).eq("customer_auth_id", userData.user.id).maybeSingle();
    if (quoteError) throw new Error("Could not validate the booking proposal");
    if (!quote) return json(404, { error: "Booking proposal not found for this customer" });
    if (quote.proposal_status !== "ACCEPTED" || quote.customer_response !== "accepted" || quote.status !== "accepted") return json(409, { error: "Only an accepted staff-issued proposal can be paid" });
    if (quote.withdrawn_at) return json(409, { error: "This proposal has been withdrawn" });
    if (quote.validUntil && new Date(quote.validUntil).getTime() < Date.now()) return json(409, { error: "This proposal has expired" });

    const total = Number(quote.total);
    if (!Number.isFinite(total) || total <= 0) return json(409, { error: "Invalid quotation total" });
    const currency = "INR";
    const amountMinor = Math.round(total * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return json(409, { error: "Invalid payment amount" });

    // Reuse an existing attempt for this idempotency key before creating another provider order.
    const { data: existing, error: existingError } = await admin.from("payments").select("id,reference,status,provider_order_id,amount_minor,currency_snapshot")
      .eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existingError) throw new Error("Could not check existing payment attempt");
    if (existing) {
      if (existing.currency_snapshot !== currency || Number(existing.amount_minor) !== amountMinor) return json(409, { error: "Idempotency key was already used for a different amount" });
      if (existing.provider_order_id) return json(200, { paymentReference: existing.reference, provider: providerValue, providerOrderId: existing.provider_order_id, status: existing.status, reused: true });
      return json(409, { error: "This payment attempt is being initialized; retry shortly using the same idempotency key" });
    }

    const paymentReference = `PM-${crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
    const { data: payment, error: insertError } = await admin.from("payments").insert({
      reference: paymentReference, "bookingId": quote["bookingId"] ?? null, "quotationId": quotationId,
      "receivedBy": null, amount: total, "settlementCurrency": currency, method: "card", status: "pending",
      provider: providerValue, idempotency_key: idempotencyKey, amount_minor: amountMinor, currency_snapshot: currency,
      notes: "Online payment attempt; status is confirmed only by verified provider webhook.",
    }).select("id,reference").single();
    if (insertError || !payment) {
      if (insertError?.code === "23505") return json(409, { error: "Duplicate payment attempt; retry with the same idempotency key" });
      throw new Error("Could not create payment attempt");
    }

    try {
      const origin = req.headers.get("origin") ?? Deno.env.get("PAYMENT_RETURN_ORIGIN") ?? "";
      const order = await createProviderOrder(provider, {
        paymentReference, amountMinor, currency, idempotencyKey,
        customerEmail: userData.user.email,
        successUrl: `${origin}/dashboard?payment=return`, cancelUrl: `${origin}/dashboard?payment=cancelled`,
      });
      const { error: updateError } = await admin.from("payments").update({ provider_order_id: order.providerOrderId, updated_at: new Date().toISOString() }).eq("id", payment.id);
      if (updateError) throw new Error("Could not save provider order reference");
      return json(201, { paymentReference, paymentId: payment.id, provider: order.provider, providerOrderId: order.providerOrderId, checkoutUrl: order.checkoutUrl ?? null, clientKey: order.clientKey ?? null, amountMinor: order.amountMinor, currency: order.currency, status: "pending" });
    } catch (error) {
      // Keep the failed attempt for audit; do not pretend the charge succeeded.
      await admin.from("payments").update({ status: "failed", notes: "Provider order creation failed; see server logs.", updated_at: new Date().toISOString() }).eq("id", payment.id);
      throw error;
    }
  } catch (error) {
    console.error("payment-create failed", error instanceof Error ? error.message : "unknown error");
    return json(400, { error: error instanceof Error ? error.message : "Unable to create payment" });
  }
});
