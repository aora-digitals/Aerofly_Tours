import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DISPATCH_SECRET = Deno.env.get("NOTIFICATION_DISPATCH_SECRET") ?? "";
const APP_ORIGIN = (Deno.env.get("APP_ORIGIN") ?? "").replace(/\/$/, "");
const MAX_BATCH = 30;
// const MAX_REQUEST_BYTES = 4 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": APP_ORIGIN || "null",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-notification-dispatch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

type Delivery = {
  id: string;
  notification_id: string;
  recipient_user_id: string;
  channel: "email" | "sms" | "whatsapp";
  template_key: string;
  attempts: number;
  max_attempts: number;
};
type NotificationRow = {
  id: string;
  event_type: string;
  title: string;
  body: string;
  action_path: string | null;
  entity_type: string | null;
  entity_id: string | null;
};
type TemplateRow = {
  subject_template: string | null;
  html_template: string | null;
  text_template: string;
};
type DeliveryResult = { ok: boolean; retryable: boolean; providerMessageId?: string; code?: string; safeMessage?: string };

const db: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function replaceTokens(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-z_]+)\}\}/gi, (_match, key: string) => values[key] ?? "");
}
function safeActionUrl(path: string | null): string {
  if (!APP_ORIGIN || !path || !path.startsWith("/") || path.startsWith("//") || /^(javascript|data|https?):/i.test(path)) return APP_ORIGIN || "";
  return `${APP_ORIGIN}${path}`;
}
async function fetchJson(url: string, init: RequestInit): Promise<{ response: Response; json: Record<string, unknown> }> {
  const response = await fetch(url, init);
  let json: Record<string, unknown> = {};
  try { json = await response.json() as Record<string, unknown>; } catch { /* providers may return non-JSON errors */ }
  return { response, json };
}
async function sendEmail(to: string, subject: string, html: string, textBody: string, idempotencyKey: string): Promise<DeliveryResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("NOTIFICATION_FROM_EMAIL");
  if (!apiKey || !from) return { ok: false, retryable: false, code: "EMAIL_PROVIDER_NOT_CONFIGURED", safeMessage: "Email provider configuration is missing." };
  const { response, json } = await fetchJson("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `aerofly-notification-${idempotencyKey}` },
    body: JSON.stringify({ from, to: [to], subject, html, text: textBody }),
  });
  if (response.ok) return { ok: true, providerMessageId: typeof json.id === "string" ? json.id : undefined };
  const code = `RESEND_HTTP_${response.status}`;
  return { ok: false, retryable: response.status === 429 || response.status >= 500, code, safeMessage: "Email provider rejected the delivery." };
}
async function sendSms(to: string, body: string): Promise<DeliveryResult> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_SMS_FROM");
  if (!sid || !token || !from) return { ok: false, retryable: false, code: "SMS_PROVIDER_NOT_CONFIGURED", safeMessage: "SMS provider configuration is missing." };
  if (!/^\+[1-9]\d{7,14}$/.test(to)) return { ok: false, retryable: false, code: "INVALID_PHONE_FORMAT", safeMessage: "Recipient phone is not in E.164 format." };
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const statusCallback = Deno.env.get("TWILIO_STATUS_CALLBACK_URL");
  if (statusCallback) params.set("StatusCallback", statusCallback);
  const auth = btoa(`${sid}:${token}`);
  const { response, json } = await fetchJson(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: params,
  });
  if (response.ok) return { ok: true, providerMessageId: typeof json.sid === "string" ? json.sid : undefined };
  return { ok: false, retryable: response.status === 429 || response.status >= 500, code: `TWILIO_HTTP_${response.status}`, safeMessage: "SMS provider rejected the delivery." };
}
async function sendWhatsApp(to: string, title: string, body: string, actionUrl: string, isMarketing = false, unsubscribeUrl = ""): Promise<DeliveryResult> {
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const templateName = isMarketing ? Deno.env.get("WHATSAPP_MARKETING_TEMPLATE_NAME") : Deno.env.get("WHATSAPP_TEMPLATE_NAME");
  const language = Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE") ?? "en";
  const graphVersion = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") ?? "v23.0";
  if (!phoneId || !token || !templateName) return { ok: false, retryable: false, code: "WHATSAPP_PROVIDER_NOT_CONFIGURED", safeMessage: "WhatsApp provider or approved template is not configured." };
  if (!/^\+[1-9]\d{7,14}$/.test(to)) return { ok: false, retryable: false, code: "INVALID_PHONE_FORMAT", safeMessage: "Recipient phone is not in E.164 format." };
  // Use an approved transactional template. Free-form WhatsApp messages are not used outside an open service window.
  const { response, json } = await fetchJson(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneId)}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace("+", ""), type: "template", template: {
      name: templateName, language: { code: language }, components: [{ type: "body", parameters: [
        { type: "text", text: title.slice(0, 120) }, { type: "text", text: `${body}${isMarketing && unsubscribeUrl ? ` Manage preferences: ${unsubscribeUrl}` : ""}`.slice(0, 800) }, { type: "text", text: actionUrl.slice(0, 500) },
      ] }],
    } }),
  });
  if (response.ok) {
    const messages = Array.isArray(json.messages) ? json.messages as Array<Record<string, unknown>> : [];
    return { ok: true, providerMessageId: typeof messages[0]?.id === "string" ? messages[0].id : undefined };
  }
  return { ok: false, retryable: response.status === 429 || response.status >= 500, code: `WHATSAPP_HTTP_${response.status}`, safeMessage: "WhatsApp provider rejected the delivery." };
}

async function createMarketingUnsubscribeUrl(userId: string, channel: "email" | "whatsapp"): Promise<string> {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...tokenBytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const { error } = await db.from("marketing_unsubscribe_tokens").insert({
    user_id: userId, channel, token_hash: tokenHash,
    expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error("Unable to create unsubscribe token.");
  return `${SUPABASE_URL}/functions/v1/marketing-unsubscribe?token=${token}`;
}

async function processOne(delivery: Delivery): Promise<{ status: string; code?: string }> {
  const { data: notification, error: notificationError } = await db.from("notifications")
    .select("id,event_type,title,body,action_path,entity_type,entity_id")
    .eq("id", delivery.notification_id).maybeSingle();
  if (notificationError || !notification) return markFailure(delivery, "NOTIFICATION_NOT_FOUND", "Notification record is unavailable.", false);
  const row = notification as NotificationRow;
  const [{ data: authData }, { data: profileData }] = await Promise.all([
    db.auth.admin.getUserById(delivery.recipient_user_id),
    db.from("profiles").select("phone").eq("id", delivery.recipient_user_id).maybeSingle(),
  ]);
  const email = authData?.user?.email ?? null;
  const phone = typeof profileData?.phone === "string" ? profileData.phone : null;
  const { data: template } = await db.from("notification_templates")
    .select("subject_template,html_template,text_template")
    .eq("template_key", delivery.template_key).eq("channel", delivery.channel).eq("is_active", true).maybeSingle();
  if (!template) return markFailure(delivery, "TEMPLATE_NOT_FOUND", "No active template is configured for this channel.", false);
  const actionUrl = safeActionUrl(row.action_path);
  const isMarketing = row.event_type === "marketing_campaign";
  let unsubscribeUrl = "";
  if (isMarketing && (delivery.channel === "email" || delivery.channel === "whatsapp")) {
    try { unsubscribeUrl = await createMarketingUnsubscribeUrl(delivery.recipient_user_id, delivery.channel); }
    catch { return markFailure(delivery, "UNSUBSCRIBE_TOKEN_FAILED", "Unable to create a marketing unsubscribe link.", true); }
  }
  const values = {
    title: row.title,
    body: row.body,
    action_url: actionUrl,
    reference: row.entity_id ?? "",
    unsubscribe_url: unsubscribeUrl,
  };
  const t = template as TemplateRow;
  let result: DeliveryResult;
  if (delivery.channel === "email") {
    if (!email) return markFailure(delivery, "EMAIL_ADDRESS_MISSING", "Recipient has no email address.", false);
    const subject = replaceTokens(t.subject_template ?? "AeroFly Tours update", values).replace(/[\r\n]+/g, " ").slice(0, 180);
    const htmlValues = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, escapeHtml(value)]));
    const html = replaceTokens(t.html_template ?? "<h2>{{title}}</h2><p>{{body}}</p><p><a href=\"{{action_url}}\">Open AeroFly</a></p>", htmlValues);
    const textBody = replaceTokens(t.text_template, values);
    result = await sendEmail(email, subject, html, textBody, delivery.id);
  } else {
    if (!phone) return markFailure(delivery, "PHONE_NUMBER_MISSING", "Recipient has no phone number.", false);
    const textBody = replaceTokens(t.text_template, values).slice(0, 1400);
    result = delivery.channel === "sms" ? await sendSms(phone, textBody) : await sendWhatsApp(phone, row.title, row.body, actionUrl, isMarketing, unsubscribeUrl);
  }
  if (result.ok) {
    const { error } = await db.from("notification_deliveries").update({ status: "sent", sent_at: new Date().toISOString(), locked_at: null,
      provider_message_id: result.providerMessageId ?? null, last_error_code: null, last_error_safe: null, updated_at: new Date().toISOString() }).eq("id", delivery.id);
    if (error) return { status: "sent_update_failed", code: "DELIVERY_STATE_UPDATE_FAILED" };
    return { status: "sent" };
  }
  return markFailure(delivery, result.code ?? "PROVIDER_ERROR", result.safeMessage ?? "Provider delivery failed.", result.retryable);
}

async function markFailure(delivery: Delivery, code: string, safeMessage: string, retryable: boolean): Promise<{ status: string; code: string }> {
  const now = Date.now();
  const exhausted = delivery.attempts >= delivery.max_attempts;
  const retry = retryable && !exhausted;
  const backoffSeconds = Math.min(3600, 30 * (2 ** Math.max(0, delivery.attempts - 1)));
  const values = {
    status: retry ? "pending" : exhausted || !retryable ? "dead" : "failed",
    available_at: new Date(now + backoffSeconds * 1000).toISOString(),
    locked_at: null,
    last_error_code: code.slice(0, 80),
    last_error_safe: safeMessage.slice(0, 240),
    updated_at: new Date().toISOString(),
  };
  await db.from("notification_deliveries").update(values).eq("id", delivery.id);
  return { status: values.status, code };
}

Deno.serve(async (request: Request): Promise<Response> => {
  const requestOrigin = request.headers.get("origin");

  // Only allow browser requests from the configured application origin.
  // Worker-to-worker requests without an Origin header remain supported.
  const originAllowed =
    !requestOrigin ||
    requestOrigin === APP_ORIGIN;

  const responseHeaders = new Headers(corsHeaders);
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("Vary", "Origin");

  if (requestOrigin && originAllowed) {
    responseHeaders.set("Access-Control-Allow-Origin", APP_ORIGIN);
  }

  const respond = (
    body: Record<string, unknown>,
    status: number,
  ): Response =>
    Response.json(body, {
      status,
      headers: responseHeaders,
    });

  // CORS preflight.
  if (request.method === "OPTIONS") {
    if (!originAllowed) {
      return respond({ error: "Origin not allowed" }, 403);
    }

    return new Response(null, {
      status: 204,
      headers: responseHeaders,
    });
  }

  if (!originAllowed) {
    return respond({ error: "Origin not allowed" }, 403);
  }

  if (request.method !== "POST") {
    responseHeaders.set("Allow", "POST, OPTIONS");
    return respond({ error: "Method not allowed" }, 405);
  }

  // Ensure required server-side secrets are configured.
  if (
    !SUPABASE_URL ||
    !SERVICE_ROLE_KEY ||
    !DISPATCH_SECRET ||
    !APP_ORIGIN
  ) {
    return respond(
      { error: "Notification dispatcher is not configured." },
      503,
    );
  }

  // Authenticate the worker before processing its request body.
  const suppliedSecret =
    request.headers.get("x-notification-dispatch-secret") ?? "";

  if (
    suppliedSecret.length !== DISPATCH_SECRET.length ||
    !constantTimeEqual(suppliedSecret, DISPATCH_SECRET)
  ) {
    return respond({ error: "Unauthorized" }, 401);
  }

  // Bound request-body size to prevent unnecessarily large payloads.
  const MAX_REQUEST_BYTES = 4 * 1024;
  const contentLength = request.headers.get("content-length");

  if (contentLength !== null) {
    const declaredLength = Number(contentLength);

    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0
    ) {
      return respond({ error: "Invalid Content-Length header" }, 400);
    }

    if (declaredLength > MAX_REQUEST_BYTES) {
      return respond({ error: "Request body too large" }, 413);
    }
  }

  let batchSize = 20;

  try {
    const rawBody = await request.text();

    if (
      new TextEncoder().encode(rawBody).byteLength >
      MAX_REQUEST_BYTES
    ) {
      return respond({ error: "Request body too large" }, 413);
    }

    // An empty body is valid and uses the default batch size.
    if (rawBody.trim().length > 0) {
      let body: unknown;

      try {
        body = JSON.parse(rawBody);
      } catch {
        return respond({ error: "Invalid JSON request body" }, 400);
      }

      if (
        body === null ||
        typeof body !== "object" ||
        Array.isArray(body)
      ) {
        return respond(
          { error: "Request body must be a JSON object" },
          400,
        );
      }

      const requestedBatchSize = (
        body as { batchSize?: unknown }
      ).batchSize;

      if (requestedBatchSize !== undefined) {
        if (
          typeof requestedBatchSize !== "number" ||
          !Number.isInteger(requestedBatchSize)
        ) {
          return respond(
            { error: "batchSize must be an integer" },
            400,
          );
        }

        batchSize = Math.min(
          MAX_BATCH,
          Math.max(1, requestedBatchSize),
        );
      }
    }
  } catch {
    return respond({ error: "Unable to read request body" }, 400);
  }

  // Preserve the existing atomic claim operation. Do not replace this
  // with a direct table query, which could allow duplicate workers.
  let deliveries: Delivery[];

  try {
    const { data, error } = await db.rpc(
      "phase9_claim_notification_deliveries",
      { p_batch_size: batchSize },
    );

    if (error) {
      return respond(
        { error: "Unable to claim notification deliveries." },
        500,
      );
    }

    deliveries = (data ?? []) as Delivery[];
  } catch {
    return respond(
      { error: "Unable to claim notification deliveries." },
      500,
    );
  }

  // MAX_BATCH must remain a small, configured upper bound.
  // Each delivery is isolated so one failure doesn't abort the batch.
  const results = await Promise.all(
    deliveries.map(async (delivery) => {
      try {
        return {
          id: delivery.id,
          channel: delivery.channel,
          ...(await processOne(delivery)),
        };
      } catch {
        return {
          id: delivery.id,
          channel: delivery.channel,
          status: "worker_error",
          code: "UNEXPECTED_DELIVERY_ERROR",
        };
      }
    }),
  );

  return respond(
    {
      claimed: deliveries.length,
      results,
    },
    200,
  );
});

function constantTimeEqual(a: string, b: string): boolean {
  let mismatch = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}
