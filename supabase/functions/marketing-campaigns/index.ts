import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_ORIGIN = (Deno.env.get("APP_ORIGIN") ?? "").replace(/\/$/, "");
const WORKER_SECRET = Deno.env.get("MARKETING_CAMPAIGN_WORKER_SECRET") ?? "";
const MAX_BATCH = 200;
const MAX_REQUEST_BYTES = 64 * 1024;

const ALLOWED_ROLES = ["owner", "admin", "manager", "marketing"];
const CHANNELS = new Set(["in_app", "email", "sms", "whatsapp"]);
const AUDIENCES = new Set(["consented_customers", "domestic_interest", "international_interest", "wishlist_travelers", "recently_active"]);
const cors = {
  "Access-Control-Allow-Origin": APP_ORIGIN || "null",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-marketing-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const db: SupabaseClient = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

type CampaignInput = {
  id?: string; name?: string; title?: string; subject?: string; body?: string;
  action_path?: string | null; channels?: string[]; audience_segment?: string; scheduled_at?: string | null;
};
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function safePath(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /^(javascript|data|https?):/i.test(value)) throw new Error("action_path must be a safe internal path beginning with one slash.");
  return value.slice(0, 300);
}
function validText(value: unknown, min: number, max: number, field: string): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) throw new Error(`${field} must be between ${min} and ${max} characters.`);
  return value.trim();
}
function templateHtml() {
  return `<div style="margin:0;background:#f8f6f2;padding:28px;font-family:Arial,sans-serif;color:#242424"><div style="max-width:600px;margin:auto;background:#fff;border:1px solid #eee5dc;border-radius:16px;overflow:hidden"><div style="background:#f26b35;color:#fff;padding:22px 26px;font-size:20px;font-weight:700">AeroFly Tours</div><div style="padding:28px"><h1 style="font-size:24px;line-height:1.3;margin:0 0 16px">{{title}}</h1><p style="font-size:15px;line-height:1.7;white-space:pre-line">{{body}}</p><p style="margin:26px 0"><a href="{{action_url}}" style="background:#f26b35;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700">Explore offer</a></p><p style="font-size:12px;color:#777;line-height:1.6">You are receiving this because you opted in to AeroFly Tours marketing communications. <a href="{{unsubscribe_url}}">Unsubscribe</a>.</p></div></div></div>`;
}
async function authorize(request: Request): Promise<{ userId: string; error?: never } | { userId?: never; error: Response }> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token || !ANON_KEY) return { error: response({ error: "Authentication required." }, 401) };
  const userClient = createClient(URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return { error: response({ error: "Invalid session." }, 401) };
  const { data: allowed, error } = await db.rpc("has_any_role", { requested_roles: ALLOWED_ROLES, requested_user: userData.user.id });
  if (error || allowed !== true) return { error: response({ error: "Marketing workspace access is required." }, 403) };
  return { userId: userData.user.id };
}
async function saveTemplates(campaign: Record<string, unknown>) {
  const key = String(campaign.template_key);
  const html = templateHtml();
  const rows = [
    { template_key: key, channel: "email", subject_template: String(campaign.subject), html_template: html, text_template: "{{title}}\n\n{{body}}\n\n{{action_url}}\n\nUnsubscribe: {{unsubscribe_url}}", is_active: true },
    { template_key: key, channel: "sms", subject_template: null, html_template: null, text_template: "{{title}}: {{body}} {{action_url}} Reply STOP to opt out.", is_active: true },
    { template_key: key, channel: "whatsapp", subject_template: null, html_template: null, text_template: "{{title}}: {{body}} {{action_url}} Manage preferences: {{unsubscribe_url}}", is_active: true },
  ];
  const { error } = await db.from("notification_templates").upsert(rows, { onConflict: "template_key,channel" });
  if (error) throw new Error("Unable to save campaign delivery templates.");
}
async function recordEvent(campaignId: string, actorId: string | null, key: string, details: Record<string, unknown> = {}) {
  await db.from("marketing_campaign_events").upsert({ campaign_id: campaignId, actor_user_id: actorId, event_key: key, details }, { onConflict: "campaign_id,event_key", ignoreDuplicates: true });
}
async function processDueCampaigns() {
  const now = new Date().toISOString();
  const { data: due, error: dueError } = await db.from("marketing_campaigns").select("id,status,scheduled_at")
    .eq("status", "scheduled").lte("scheduled_at", now).order("scheduled_at", { ascending: true }).limit(5);
  if (dueError) throw new Error("Unable to load scheduled campaigns.");
  for (const row of due ?? []) {
    const { data: claimed } = await db.from("marketing_campaigns").update({ status: "processing", started_at: now, updated_at: now })
      .eq("id", row.id).eq("status", "scheduled").select("id").maybeSingle();
    if (claimed) await recordEvent(row.id, null, `worker-start:${row.id}`, { started_at: now });
  }

  const { data: campaigns, error: campaignError } = await db.from("marketing_campaigns")
    .select("id,name,title,subject,body,action_path,channels,audience_segment,status,template_key")
    .eq("status", "processing").limit(5);
  if (campaignError) throw new Error("Unable to load processing campaigns.");
  const summary: Array<Record<string, unknown>> = [];
  for (const campaign of campaigns ?? []) {
    const { data: eligible, error: eligibleError } = await db.rpc("phase9_marketing_eligible_recipients", {
      p_campaign_id: campaign.id, p_after_user_id: null, p_limit: MAX_BATCH,
    });
    if (eligibleError) throw new Error("Unable to load eligible campaign recipients.");
    const recipientIds = (eligible ?? []).map((r: { user_id: string } | string) => typeof r === "string" ? r : r.user_id);
    if (recipientIds.length) {
      await saveTemplates(campaign as unknown as Record<string, unknown>);
      for (const recipientId of recipientIds) {
        const { error } = await db.rpc("phase9_queue_marketing_campaign_recipient", { p_campaign_id: campaign.id, p_recipient_user_id: recipientId });
        if (error) console.error("Campaign recipient queue failed", campaign.id, error.code ?? "DB_ERROR");
      }
    }
    const { data: remaining, error: remainingError } = await db.rpc("phase9_marketing_eligible_recipients", {
      p_campaign_id: campaign.id, p_after_user_id: null, p_limit: 1,
    });
    if (remainingError) throw new Error("Unable to check remaining campaign recipients.");
    if (!remaining?.length) {
      await db.from("marketing_campaigns").update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", campaign.id).eq("status", "processing");
      await recordEvent(campaign.id, null, `worker-complete:${campaign.id}`, { completed_at: new Date().toISOString() });
    }
    const { data: stats } = await db.from("marketing_campaigns").select("total_recipients,sent_count,delivered_count,failed_count,status").eq("id", campaign.id).single();
    summary.push({ id: campaign.id, queued_this_run: recipientIds.length, ...stats });
  }
  return { processed: summary.length, campaigns: summary };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
  
  const origin = request.headers.get("origin");

  if (origin && (!APP_ORIGIN || origin !== APP_ORIGIN)) {
    return response(
      { error: "Origin not allowed." },
      403,
    );
  }

  if (!URL || !SERVICE_KEY || !ANON_KEY || !APP_ORIGIN) return response({ error: "Marketing campaign service is not configured." }, 503);

  const workerSecret = request.headers.get("x-marketing-worker-secret") ?? "";
  if (workerSecret && WORKER_SECRET && workerSecret.length === WORKER_SECRET.length && constantTimeEqual(workerSecret, WORKER_SECRET)) {
    try { return response(await processDueCampaigns()); }
    catch (error) { console.error("Campaign worker failed", error instanceof Error ? error.message : "unknown"); return response({ error: "Campaign worker failed." }, 500); }
  }

  const auth = await authorize(request);
  if (auth.error) return auth.error;
  
let payload: Record<string, unknown>;

const declaredLength = Number(
  request.headers.get("content-length") ?? "0",
);

if (declaredLength > MAX_REQUEST_BYTES) {
  return response(
    { error: "Request body is too large." },
    413,
  );
}

const rawBody = await request.text();

if (
  new TextEncoder().encode(rawBody).byteLength >
  MAX_REQUEST_BYTES
) {
  return response(
    { error: "Request body is too large." },
    413,
  );
}

try {
  const parsed: unknown = JSON.parse(rawBody);

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return response(
      { error: "A JSON object is required." },
      400,
    );
  }

  payload = parsed as Record<string, unknown>;
} catch {
  return response(
    { error: "A valid JSON request body is required." },
    400,
  );
}

  const action = payload.action;
  try {
    if (action === "list") {
      const { data, error } = await db.from("marketing_campaigns").select("id,name,title,subject,body,action_path,channels,audience_segment,status,scheduled_at,started_at,completed_at,total_recipients,sent_count,delivered_count,failed_count,created_at,updated_at")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw new Error("Unable to load campaigns.");
      return response({ campaigns: data ?? [] });
    }
    if (action === "create" || action === "update") {
      const input = (payload.campaign ?? {}) as CampaignInput;
      const name = validText(input.name, 3, 120, "Campaign name");
      const title = validText(input.title, 3, 180, "Message title");
      const subject = validText(input.subject, 3, 180, "Email subject");
      const body = validText(input.body, 10, 1200, "Message body");
      const channels = Array.isArray(input.channels) ? [...new Set(input.channels)] : [];
      if (!channels.length || channels.some((channel) => typeof channel !== "string" || !CHANNELS.has(channel))) throw new Error("Choose at least one valid channel.");
      const actionPath = safePath(input.action_path);
      const audience = typeof input.audience_segment === "string" && AUDIENCES.has(input.audience_segment) ? input.audience_segment : "consented_customers";
      if (action === "create") {
        const id = crypto.randomUUID();
        const templateKey = `marketing_${id.replaceAll("-", "")}`;
        const { data, error } = await db.from("marketing_campaigns").insert({ id, created_by: auth.userId, name, title, subject, body, action_path: actionPath, channels, template_key: templateKey, audience_segment: audience, status: "draft" }).select("*").single();
        if (error || !data) throw new Error("Unable to create campaign.");
        await saveTemplates(data as unknown as Record<string, unknown>);
        await recordEvent(id, auth.userId, `created:${id}`, { channels });
        return response({ campaign: data }, 201);
      }
      if (!input.id) throw new Error("Campaign ID is required.");
      const { data: existing, error: existingError } = await db.from("marketing_campaigns").select("id,status,template_key").eq("id", input.id).maybeSingle();
      if (existingError || !existing || existing.status !== "draft") throw new Error("Only draft campaigns can be edited.");
      const { data, error } = await db.from("marketing_campaigns").update({ name, title, subject, body, action_path: actionPath, channels, audience_segment: audience, updated_at: new Date().toISOString() }).eq("id", input.id).eq("status", "draft").select("*").single();
      if (error || !data) throw new Error("Unable to update draft campaign.");
      await saveTemplates(data as unknown as Record<string, unknown>);
      await recordEvent(String(data.id), auth.userId, `updated:${new Date().toISOString()}`, { channels });
      return response({ campaign: data });
    }
    if (action === "schedule") {
      const id = String(payload.id ?? "");
      const scheduledAt = new Date(String(payload.scheduled_at ?? "")).getTime();
      if (!id || !Number.isFinite(scheduledAt) || scheduledAt < Date.now() - 60_000) throw new Error("Choose a valid schedule time that is now or in the future.");
      const { data, error } = await db.from("marketing_campaigns").update({ status: "scheduled", scheduled_at: new Date(scheduledAt).toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id).eq("status", "draft").select("id,status,scheduled_at").maybeSingle();
      if (error || !data) throw new Error("Only draft campaigns can be scheduled.");
      await recordEvent(id, auth.userId, `scheduled:${data.scheduled_at}`, { scheduled_at: data.scheduled_at });
      return response({ campaign: data });
    }
    if (action === "cancel") {
      const id = String(payload.id ?? "");
      const { data, error } = await db.from("marketing_campaigns").update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", id).in("status", ["draft", "scheduled"]).select("id,status").maybeSingle();
      if (error || !data) throw new Error("Only draft or scheduled campaigns can be cancelled.");
      await recordEvent(id, auth.userId, `cancelled:${new Date().toISOString()}`);
      return response({ campaign: data });
    }
    if (action === "preview") {
      const input = (payload.campaign ?? {}) as CampaignInput;
      return response({ preview: { name: String(input.name ?? "Campaign preview"), title: validText(input.title, 1, 180, "Title"), subject: validText(input.subject, 1, 180, "Subject"), body: validText(input.body, 1, 1200, "Body"), channels: input.channels ?? [], action_path: safePath(input.action_path) } });
    }
    return response({ error: "Unsupported action." }, 400);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Campaign operation failed." }, 400);
  }
});

function constantTimeEqual(a: string, b: string): boolean {
  let mismatch = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}
