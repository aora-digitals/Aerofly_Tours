import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const TWILIO_STATUS_CALLBACK_URL = Deno.env.get("TWILIO_STATUS_CALLBACK_URL") ?? "";
const WHATSAPP_APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const WHATSAPP_WEBHOOK_VERIFY_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? "";
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (request: Request) => {
  const provider = new URLSearchParams(new URL(request.url).search).get("provider");
  if (provider === "whatsapp" && request.method === "GET") return verifyWhatsAppWebhook(request);
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (!SUPABASE_URL || !SERVICE_KEY) return Response.json({ error: "Webhook is not configured" }, { status: 503 });
  if (provider === "resend") return handleResend(request);
  if (provider === "twilio") return handleTwilio(request);
  if (provider === "whatsapp") return handleWhatsApp(request);
  return Response.json({ error: "Unknown provider" }, { status: 400 });
});


function verifyWhatsAppWebhook(request: Request): Response {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (!WHATSAPP_WEBHOOK_VERIFY_TOKEN) return new Response("WhatsApp webhook is not configured", { status: 503 });
  if (mode !== "subscribe" || !token || !constantTimeEqual(token, WHATSAPP_WEBHOOK_VERIFY_TOKEN) || challenge === null) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

async function handleWhatsApp(request: Request): Promise<Response> {
  if (!WHATSAPP_APP_SECRET) return Response.json({ error: "WhatsApp webhook is not configured" }, { status: 503 });
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const expected = `sha256=${await hmacHex("SHA-256", new TextEncoder().encode(WHATSAPP_APP_SECRET), rawBody)}`;
  if (!signature || !constantTimeEqual(signature.toLowerCase(), expected.toLowerCase())) {
    return Response.json({ error: "Invalid WhatsApp webhook signature" }, { status: 401 });
  }

  let payload: { entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<{ id?: string; status?: string; errors?: Array<{ code?: number }> }> } }> }> };
  try { payload = JSON.parse(rawBody); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const now = new Date().toISOString();
  const statuses = (payload.entry ?? []).flatMap((entry) => (entry.changes ?? []).flatMap((change) => change.value?.statuses ?? []));
  for (const item of statuses) {
    if (!item.id || !item.status) continue;
    const status = item.status.toLowerCase();
    if (status === "sent") {
      await db.from("notification_deliveries").update({ status: "sent", updated_at: now }).eq("channel", "whatsapp").eq("provider_message_id", item.id);
    } else if (status === "delivered" || status === "read") {
      await db.from("notification_deliveries").update({ status: "delivered", delivered_at: now, updated_at: now, last_error_code: null, last_error_safe: null }).eq("channel", "whatsapp").eq("provider_message_id", item.id);
    } else if (status === "failed") {
      const providerCode = item.errors?.[0]?.code;
      await db.from("notification_deliveries").update({ status: "dead", updated_at: now, last_error_code: providerCode ? `WHATSAPP_${providerCode}`.slice(0, 80) : "WHATSAPP_DELIVERY_FAILED", last_error_safe: "WhatsApp reported a permanent delivery failure." }).eq("channel", "whatsapp").eq("provider_message_id", item.id);
    }
  }
  return Response.json({ received: true, statuses: statuses.length });
}

async function handleResend(request: Request): Promise<Response> {
  if (!RESEND_WEBHOOK_SECRET) return Response.json({ error: "Resend webhook is not configured" }, { status: 503 });
  const rawBody = await request.text();
  const id = request.headers.get("svix-id") ?? "";
  const timestamp = request.headers.get("svix-timestamp") ?? "";
  const signatures = request.headers.get("svix-signature") ?? "";
  if (!id || !timestamp || !signatures || !verifyTimestamp(timestamp)) return Response.json({ error: "Invalid webhook headers" }, { status: 401 });
  const secret = decodeBase64(RESEND_WEBHOOK_SECRET.replace(/^whsec_/, ""));
  const expected = await hmac("SHA-256", secret, `${id}.${timestamp}.${rawBody}`);
  const valid = signatures.split(" ").some((entry) => {
    const [version, signature] = entry.split(",", 2);
    return version === "v1" && signature && constantTimeEqual(signature, expected);
  });
  if (!valid) return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
  let payload: { type?: string; data?: { email_id?: string; id?: string } };
  try { payload = JSON.parse(rawBody); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const providerId = payload.data?.email_id ?? payload.data?.id;
  if (!providerId) return Response.json({ received: true, ignored: true });
  if (payload.type === "email.delivered") {
    await db.from("notification_deliveries").update({ status: "delivered", delivered_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error_code: null, last_error_safe: null }).eq("channel", "email").eq("provider_message_id", providerId);
  } else if (["email.bounced", "email.complained", "email.failed"].includes(payload.type ?? "")) {
    await db.from("notification_deliveries").update({ status: "dead", updated_at: new Date().toISOString(), last_error_code: `RESEND_${(payload.type ?? "unknown").toUpperCase().slice(0, 60)}`, last_error_safe: "Email provider reported a permanent delivery failure." }).eq("channel", "email").eq("provider_message_id", providerId);
  }
  return Response.json({ received: true });
}

async function handleTwilio(request: Request): Promise<Response> {
  if (!TWILIO_AUTH_TOKEN || !TWILIO_STATUS_CALLBACK_URL) return Response.json({ error: "Twilio status callback is not configured" }, { status: 503 });
  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const signed = TWILIO_STATUS_CALLBACK_URL + sorted.map(([key, value]) => `${key}${value}`).join("");
  const expected = await hmac("SHA-1", new TextEncoder().encode(TWILIO_AUTH_TOKEN), signed);
  if (!signature || !constantTimeEqual(signature, expected)) return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
  const sid = params.get("MessageSid");
  const status = (params.get("MessageStatus") ?? "").toLowerCase();
  const errorCode = params.get("ErrorCode");
  if (!sid) return Response.json({ error: "Missing message identifier" }, { status: 400 });
  const now = new Date().toISOString();
  if (status === "delivered") {
    await db.from("notification_deliveries").update({ status: "delivered", delivered_at: now, updated_at: now, last_error_code: null, last_error_safe: null }).eq("channel", "sms").eq("provider_message_id", sid);
  } else if (["failed", "undelivered"].includes(status)) {
    await db.from("notification_deliveries").update({ status: "dead", updated_at: now, last_error_code: errorCode ? `TWILIO_${errorCode}`.slice(0, 80) : `TWILIO_${status.toUpperCase()}`, last_error_safe: "SMS provider reported a permanent delivery failure." }).eq("channel", "sms").eq("provider_message_id", sid);
  }
  return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
}

async function hmacHex(algorithm: "SHA-1" | "SHA-256", secret: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: algorithm }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function hmac(algorithm: "SHA-1" | "SHA-256", secret: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: algorithm }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function constantTimeEqual(a: string, b: string): boolean {
  let mismatch = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}
function verifyTimestamp(timestamp: string): boolean {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && Math.abs(Date.now() / 1000 - seconds) <= 300;
}
