
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("Phase 16 security regression checks", () => {
  it("does not use wildcard CORS in payment creation", () => {
    const source = readProjectFile(
      "supabase/functions/payment-create/index.ts",
    );

    expect(source).not.toContain(
      '"Access-Control-Allow-Origin": "*"',
    );
    expect(source).toContain("isAllowedOrigin");
    expect(source).toContain("PAYMENT_RETURN_ORIGIN");
  });

  it("preserves proposal acceptance and customer ownership checks", () => {
    const source = readProjectFile(
      "supabase/functions/payment-create/index.ts",
    );

    expect(source).toContain("customer_auth_id");
    expect(source).toContain("proposal_status");
    expect(source).toContain('quote.status !== "accepted"');
    expect(source).toContain("idempotency_key");
  });

  it("persists checkout details for safe retries", () => {
    const source = readProjectFile(
      "supabase/functions/payment-create/index.ts",
    );

    expect(source).toContain("provider_checkout_url");
    expect(source).toContain("provider_client_key");
    expect(source).toContain("provider_order_id");
  });

  it("uses the existing atomic webhook reconciliation RPC", () => {
    const source = readProjectFile(
      "supabase/functions/payment-webhook/index.ts",
    );

    expect(source).toContain("verifyStripeWebhook");
    expect(source).toContain("verifyRazorpayWebhook");
    expect(source).toContain('"process_payment_webhook"');
    expect(source).toContain("p_payload_sha256");
  });

  it("does not override the signed Razorpay event ID from an HTTP header", () => {
    const source = readProjectFile(
      "supabase/functions/payment-webhook/index.ts",
    );

    expect(source).not.toContain(
      "event.eventId = headerEventId",
    );
  });

  it("uses the existing shared AI rate limiter", () => {
    const source = readProjectFile(
      "supabase/functions/ai-trip-planner/index.ts",
    );

    expect(source).toContain(
      "phase10_ai_consume_rate_limit",
    );
    expect(source).toContain("p_subject_hash");
    expect(source).toContain("p_window_seconds");
  });

  it("bounds travel-support JSON request size", () => {
    const source = readProjectFile(
      "supabase/functions/travel-support/index.ts",
    );

    expect(source).toContain("MAX_REQUEST_BYTES");
    expect(source).toContain("readBoundedJson");
    expect(source).toContain("phase8_staff_can_access_application");
  });

  it("keeps notification dispatch protected by its worker secret", () => {
    const source = readProjectFile(
      "supabase/functions/notification-dispatch/index.ts",
    );

    expect(source).toContain("NOTIFICATION_DISPATCH_SECRET");
    expect(source).toContain("phase9_claim_notification_deliveries");
    expect(source).toContain("constantTimeEqual");
  });

  it("keeps marketing worker authentication and role checks", () => {
    const source = readProjectFile(
      "supabase/functions/marketing-campaigns/index.ts",
    );

    expect(source).toContain(
      "MARKETING_CAMPAIGN_WORKER_SECRET",
    );
    expect(source).toContain("has_any_role");
    expect(source).toContain("phase9_marketing_eligible_recipients");
  });

  it("does not expose a service-role key in the client source", () => {
    const clientFiles = [
      "client/src/main.tsx",
      "client/src/App.tsx",
      "client/src/lib/supabase.ts",
    ];

    for (const file of clientFiles) {
      let source: string;

      try {
        source = readProjectFile(file);
      } catch {
        // Some projects may not have a separate supabase.ts module.
        continue;
      }

      expect(source).not.toMatch(
        /SUPABASE_SERVICE_ROLE_KEY\s*=\s*["'][^"']+["']/,
      );
    }
  });
});
