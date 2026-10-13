import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const EXPECTED_WEBHOOK_URL = Deno.env.get("TWILIO_SMS_INBOUND_WEBHOOK_URL") ?? "";
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
function twiml(message: string, status = 200) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`, {
    status, headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function constantTimeEqual(a: string, b: string) {
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}
async function expectedSignature(url: string, params: URLSearchParams) {
  const pairs = [...params.entries()].sort(([a, av], [b, bv]) => a === b ? av.localeCompare(bv) : a.localeCompare(b));
  const canonical = url + pairs.map(([key, value]) => `${key}${value}`).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(TWILIO_AUTH_TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return twiml("Method not allowed.", 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !TWILIO_AUTH_TOKEN) return twiml("Service unavailable.", 503);
  const params = new URLSearchParams(await request.text());
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const canonicalUrl = EXPECTED_WEBHOOK_URL || request.url;
  const expected = await expectedSignature(canonicalUrl, params);
  if (!signature || !constantTimeEqual(signature, expected)) return twiml("Invalid webhook signature.", 403);

  const body = (params.get("Body") ?? "").trim().toLowerCase();
  const from = (params.get("From") ?? "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(from)) return twiml("We could not identify this mobile number. Please contact AeroFly Tours support.");
  if (["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout", "opt out"].includes(body)) {
    const { error } = await db.rpc("phase9_marketing_sms_optout", { p_phone: from });
    if (error) {
      console.error("SMS opt-out persistence failed", error.code ?? "DB_ERROR");
      return twiml("We received your request but could not update preferences. Please contact support.", 500);
    }
    return twiml("You are unsubscribed from AeroFly Tours promotional SMS. Essential service messages may still be sent.");
  }
  if (["start", "unstop", "yes"].includes(body)) {
    return twiml("To opt in again, sign in to your AeroFly Tours account and enable SMS marketing in Notification Preferences.");
  }
  return twiml("AeroFly Tours received your message. Reply STOP to opt out of promotional SMS.");
});
