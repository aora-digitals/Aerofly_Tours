import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const page = (message: string, token?: string, channel = "email") => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>AeroFly Tours preferences</title></head><body style="font-family:Arial,sans-serif;background:#f8f6f2;padding:24px;color:#242424"><main style="max-width:520px;margin:8vh auto;background:white;border:1px solid #eee5dc;border-radius:16px;padding:28px"><h1 style="color:#f26b35">AeroFly Tours</h1><h2>Marketing preferences</h2><p>${message}</p>${token ? `<form method="post"><input type="hidden" name="token" value="${token}"><button style="border:0;border-radius:999px;background:#f26b35;color:white;padding:12px 18px;font-weight:bold">Unsubscribe from marketing ${channel === "whatsapp" ? "WhatsApp" : "email"}</button></form>` : `<p>You can close this page.</p>`}<p style="font-size:12px;color:#777;margin-top:24px">Essential booking, payment, security and service updates are not affected.</p></main></body></html>`;
function html(body: string, status = 200) { return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }
async function hashToken(token: string) { const bytes = new TextEncoder().encode(token); const digest = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
Deno.serve(async (request: Request) => {
  if (!SUPABASE_URL || !SERVICE_KEY) return html(page("This preference service is temporarily unavailable."), 503);
  const url = new URL(request.url);
  const token = (request.method === "POST" ? new URLSearchParams(await request.text()).get("token") : url.searchParams.get("token")) ?? "";
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) return html(page("This unsubscribe link is invalid or incomplete."), 400);
  const tokenHash = await hashToken(token);
  const { data: row, error } = await db.from("marketing_unsubscribe_tokens").select("id,user_id,channel,expires_at,used_at").eq("token_hash", tokenHash).maybeSingle();
  if (error || !row || !(["email", "whatsapp"] as string[]).includes(row.channel) || row.used_at || new Date(row.expires_at).getTime() < Date.now()) return html(page("This unsubscribe link is expired or has already been used."), 410);
  if (request.method === "GET") return html(page(`Confirm that you want to stop receiving promotional ${row.channel === "whatsapp" ? "WhatsApp" : "email"} messages from AeroFly Tours. You can still receive essential booking and service updates.`, token, row.channel));
  if (request.method !== "POST") return html(page("Method not allowed."), 405);
  const now = new Date().toISOString();
  const { data: prefs } = await db.from("notification_preferences").select("marketing_in_app_enabled,marketing_email_enabled,marketing_sms_enabled,marketing_whatsapp_enabled").eq("user_id", row.user_id).maybeSingle();
  if (!prefs) return html(page("No marketing preference record was found. Please contact AeroFly Tours support."), 404);
  const disableField = row.channel === "whatsapp" ? "marketing_whatsapp_enabled" : "marketing_email_enabled";
  const disableOptOutField = row.channel === "whatsapp" ? "marketing_whatsapp_opted_out_at" : "marketing_email_opted_out_at";
  const allOff = !prefs.marketing_in_app_enabled && !prefs.marketing_sms_enabled && (row.channel === "email" || !prefs.marketing_email_enabled) && (row.channel === "whatsapp" || !prefs.marketing_whatsapp_enabled);
  const { error: prefError } = await db.from("notification_preferences").update({ [disableField]: false, [disableOptOutField]: now, ...(allOff ? { marketing_unsubscribed_at: now } : {}) }).eq("user_id", row.user_id);
  if (prefError) return html(page("We could not update your preferences. Please try again later."), 500);
  await db.from("marketing_unsubscribe_tokens").update({ used_at: now }).eq("id", row.id).is("used_at", null);
  return html(page(`You have been unsubscribed from promotional ${row.channel === "whatsapp" ? "WhatsApp" : "email"} messages. Essential booking, payment, and service messages may still be sent.`));
});
