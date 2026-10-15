
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin =
  Deno.env.get("AI_ALLOWED_ORIGIN") ?? "https://aerofly.com";

const headers = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function respond(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}

function validPhone(value: string): boolean {
  return /^[+()\d\s.-]{7,40}$/.test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin");
    if (origin && origin !== allowedOrigin) {
      return respond(403, { error: "Origin not allowed" });
    }
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") {
    return respond(405, { error: "Method not allowed" });
  }

  const origin = req.headers.get("origin");
  if (origin && origin !== allowedOrigin) {
    return respond(403, { error: "Origin not allowed" });
  }

  try {
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (contentLength > 8192) {
      return respond(413, { error: "Request too large" });
    }

    const raw = await req.text();
    if (raw.length > 8192) {
      return respond(413, { error: "Request too large" });
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return respond(400, { error: "Expected a JSON object" });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return respond(400, { error: "Invalid JSON" });
    }

    if (body.confirmed !== true) {
      return respond(400, {
        error: "Explicit customer confirmation is required",
      });
    }

    if (body.type !== "enquiry" && body.type !== "callback") {
      return respond(400, { error: "Unsupported request type" });
    }

    const authorization = req.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return respond(401, { error: "Please sign in before submitting a request" });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!url || !anonKey || !serviceKey) {
      return respond(503, { error: "Request service is not configured" });
    }

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } =
      await userClient.auth.getUser();

    if (authError || !authData.user) {
      return respond(401, { error: "Your session is invalid. Please sign in again." });
    }

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const name = text(body.name, 160);
    const email = text(body.email, 320);
    const phone = text(body.phone, 40);
    const destination = text(body.destination, 160);
    const travelDates = text(body.travelDates, 160);
    const budget = text(body.budget, 120);
    const tripType = text(body.tripType, 120);
    const message = text(body.message, 1500);
    const reason = text(body.reason, 500);

    if (name.length < 2) {
      return respond(400, { error: "Please enter your full name" });
    }
    if (!validEmail(email)) {
      return respond(400, { error: "Please enter a valid email address" });
    }
    if (!validPhone(phone)) {
      return respond(400, { error: "Please enter a valid phone number" });
    }

    let tourId: number | null = null;
    if (body.tourId !== undefined && body.tourId !== null && body.tourId !== "") {
      tourId = Number(body.tourId);
      if (!Number.isSafeInteger(tourId) || tourId <= 0) {
        return respond(400, { error: "Invalid tour selection" });
      }

      const { data: tour, error: tourError } = await admin
        .from("tours")
        .select("id")
        .eq("id", tourId)
        .eq("status", "published")
        .maybeSingle();

      if (tourError || !tour) {
        return respond(400, {
          error: "The selected tour is not currently available in the published catalogue",
        });
      }
    }

    const reference = `AF-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
    const userId = authData.user.id;

    if (body.type === "enquiry") {
      const { data, error } = await admin
        .from("enquiries")
        .insert({
          reference,
          customer_auth_id: userId,
          name,
          email,
          phone,
          destination: destination || null,
          "travelDates": travelDates || null,
          budget: budget || null,
          "tripType": tripType || null,
          message: message || null,
          "tourId": tourId,
          status: "new",
        })
        .select("id,reference,status")
        .single();

      if (error) {
        console.error("AI enquiry creation failed");
        return respond(500, { error: "Unable to submit your enquiry right now" });
      }

      return respond(201, {
        success: true,
        type: "enquiry",
        reference: data.reference,
        status: data.status,
        message: "Your enquiry was submitted. AeroFly must confirm the next steps with you.",
      });
    }

    const { data, error } = await admin
      .from("callback_requests")
      .insert({
        reference,
        customer_auth_id: userId,
        name,
        email,
        phone,
        reason: reason || message || "Travel planning assistance requested",
        status: "requested",
      })
      .select("id,reference,status")
      .single();

    if (error) {
      console.error("AI callback creation failed");
      return respond(500, { error: "Unable to request a callback right now" });
    }

    return respond(201, {
      success: true,
      type: "callback",
      reference: data.reference,
      status: data.status,
      message: "Your callback request was submitted. The travel team will follow up.",
    });
  } catch {
    console.error("Unexpected AI travel request failure");
    return respond(500, { error: "Unable to submit the request right now" });
  }
});
