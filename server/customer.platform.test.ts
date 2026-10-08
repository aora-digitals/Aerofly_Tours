import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

/**
 * These are real Supabase integration tests.
 * Keep them opt-in because they create/delete temporary Auth users and rows.
 *
 * Run with:
 *   $env:RUN_CUSTOMER_PLATFORM_TESTS="true"
 *   pnpm exec vitest --config vitest.config.ts --run server/customer.platform.test.ts
 */
const integrationEnabled = process.env.RUN_CUSTOMER_PLATFORM_TESTS === "true";

const describeIntegration =
  integrationEnabled && supabaseUrl && serviceRoleKey && anonKey
    ? describe
    : describe.skip;

type TestCustomer = {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const customerAEmail = `phase3-a-${runId}@example.com`;
const customerBEmail = `phase3-b-${runId}@example.com`;
const password = `Phase3!${runId}Aa9`;

let admin: SupabaseClient;
let customerA: TestCustomer;
let customerB: TestCustomer;
let testTourId: number | null = null;
let enquiryAId: number | null = null;
let callbackAId: number | null = null;
let appointmentAId: number | null = null;

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required for customer platform integration tests.`);
  }
  return value;
}

async function createCustomer(email: string): Promise<TestCustomer> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: `Phase 3 Test ${email === customerAEmail ? "A" : "B"}`,
    },
  });

  if (error) throw error;

  const userId = data.user?.id;
  if (!userId) throw new Error("Supabase did not return a user id.");

  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId,
    full_name: `Phase 3 Test ${email === customerAEmail ? "A" : "B"}`,
    phone: "+919999999999",
    preferred_language: "en",
    preferred_currency: "INR",
  });

  if (profileError) throw profileError;

  const client = createClient(
    required(supabaseUrl, "SUPABASE_URL"),
    required(anonKey, "SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) throw signInError;

  return { id: userId, email, password, client };
}

async function cleanupCustomer(customer: TestCustomer | undefined) {
  if (!customer) return;

  await admin.from("customer_activity").delete().eq("user_id", customer.id);
  await admin
    .from("customer_preferences")
    .delete()
    .eq("user_id", customer.id);
  await admin.from("wishlists").delete().eq("user_id", customer.id);
  await admin
    .from("enquiries")
    .delete()
    .eq("customer_auth_id", customer.id);
  await admin
    .from("callback_requests")
    .delete()
    .eq("customer_auth_id", customer.id);
  await admin
    .from("appointments")
    .delete()
    .eq("customer_auth_id", customer.id);
  await admin.from("profiles").delete().eq("id", customer.id);
  await admin.auth.admin.deleteUser(customer.id);
}

describeIntegration("Phase 3 customer platform RLS", () => {
  beforeAll(async () => {
    admin = createClient(
      required(supabaseUrl, "SUPABASE_URL"),
      required(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY"),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );

    customerA = await createCustomer(customerAEmail);
    customerB = await createCustomer(customerBEmail);

    const { data: tour, error: tourError } = await admin
      .from("tours")
      .select("id")
      .eq("status", "published")
      .limit(1)
      .maybeSingle();

    if (tourError) throw tourError;
    if (!tour?.id) {
      throw new Error(
        "Phase 3 integration tests require at least one published tour.",
      );
    }

    testTourId = tour.id;

    const { data: enquiry, error: enquiryError } = await admin
      .from("enquiries")
      .insert({
        reference: `P3-TEST-E-${runId}`,
        customer_auth_id: customerA.id,
        name: "Phase 3 Test A",
        email: customerA.email,
        phone: "+919999999999",
        destination: "Test Destination",
        travellers: 2,
        status: "new",
        priority: "normal",
      })
      .select("id")
      .single();

    if (enquiryError) throw enquiryError;
    enquiryAId = enquiry.id;

    const { data: callback, error: callbackError } = await admin
      .from("callback_requests")
      .insert({
        reference: `P3-TEST-C-${runId}`,
        customer_auth_id: customerA.id,
        name: "Phase 3 Test A",
        email: customerA.email,
        phone: "+919999999999",
        reason: "Phase 3 ownership test",
        status: "requested",
      })
      .select("id")
      .single();

    if (callbackError) throw callbackError;
    callbackAId = callback.id;

    const { data: appointment, error: appointmentError } = await admin
      .from("appointments")
      .insert({
        reference: `P3-TEST-A-${runId}`,
        customer_auth_id: customerA.id,
        name: "Phase 3 Test A",
        email: customerA.email,
        phone: "+919999999999",
        appointmentAt: new Date(Date.now() + 86400000).toISOString(),
        durationMinutes: 30,
        mode: "phone",
        purpose: "Phase 3 ownership test",
        status: "requested",
      })
      .select("id")
      .single();

    if (appointmentError) throw appointmentError;
    appointmentAId = appointment.id;
  });

  afterAll(async () => {
    if (!admin) return;
    await cleanupCustomer(customerA);
    await cleanupCustomer(customerB);
  });

  it("lets a customer read and update only their own profile", async () => {
    const { data, error } = await customerA.client
      .from("profiles")
      .select("id, full_name, preferred_currency")
      .eq("id", customerA.id)
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(customerA.id);

    const { error: updateError } = await customerA.client
      .from("profiles")
      .update({ full_name: "Phase 3 Updated Customer A" })
      .eq("id", customerA.id);

    expect(updateError).toBeNull();

    const { data: otherProfile, error: otherProfileError } =
      await customerA.client
        .from("profiles")
        .select("id")
        .eq("id", customerB.id)
        .maybeSingle();

    expect(otherProfileError).toBeNull();
    expect(otherProfile).toBeNull();
  });

  it("isolates customer preferences", async () => {
    const { error: insertError } = await customerA.client
      .from("customer_preferences")
      .upsert({
        user_id: customerA.id,
        travel_scope: "international",
        preferred_destinations: ["Dubai", "Bali"],
        travel_styles: ["luxury", "honeymoon"],
        budget_min: 50000,
        budget_max: 150000,
        duration_min_days: 5,
        duration_max_days: 10,
        preferred_language: "en",
        preferred_currency: "INR",
      });

    expect(insertError).toBeNull();

    const { data: ownPreferences, error: ownError } = await customerA.client
      .from("customer_preferences")
      .select("*")
      .eq("user_id", customerA.id)
      .single();

    expect(ownError).toBeNull();
    expect(ownPreferences?.user_id).toBe(customerA.id);

    const { data: otherPreferences, error: otherError } =
      await customerA.client
        .from("customer_preferences")
        .select("*")
        .eq("user_id", customerB.id)
        .maybeSingle();

    expect(otherError).toBeNull();
    expect(otherPreferences).toBeNull();
  });

  it("supports wishlist add and prevents duplicates", async () => {
    expect(testTourId).toBeTypeOf("number");

    const { error: firstError } = await customerA.client
      .from("wishlists")
      .insert({ user_id: customerA.id, tour_id: testTourId });

    expect(firstError).toBeNull();

    const { error: duplicateError } = await customerA.client
      .from("wishlists")
      .insert({ user_id: customerA.id, tour_id: testTourId });

    expect(duplicateError).not.toBeNull();

    const { data, error } = await customerA.client
      .from("wishlists")
      .select("id, user_id, tour_id")
      .eq("user_id", customerA.id)
      .eq("tour_id", testTourId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("prevents User A from reading User B wishlist", async () => {
    const { error: serviceInsertError } = await admin
      .from("wishlists")
      .insert({ user_id: customerB.id, tour_id: testTourId });

    expect(serviceInsertError).toBeNull();

    const { data, error } = await customerA.client
      .from("wishlists")
      .select("id, user_id, tour_id")
      .eq("user_id", customerB.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("prevents User A from modifying User B wishlist", async () => {
    const { error } = await customerA.client
      .from("wishlists")
      .delete()
      .eq("user_id", customerB.id)
      .eq("tour_id", testTourId);

    expect(error).toBeNull();

    const { data, error: verifyError } = await admin
      .from("wishlists")
      .select("id")
      .eq("user_id", customerB.id)
      .eq("tour_id", testTourId);

    expect(verifyError).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("allows activity inserts only for the authenticated customer", async () => {
    const { error } = await customerA.client.from("customer_activity").insert({
      user_id: customerA.id,
      activity_type: "tour_viewed",
      entity_type: "tour",
      entity_id: String(testTourId),
      metadata: {
        source: "phase3-test",
        entry_point: "integration-test",
      },
    });

    expect(error).toBeNull();

    const { data, error: readError } = await customerA.client
      .from("customer_activity")
      .select("user_id, activity_type, entity_type, entity_id")
      .eq("user_id", customerA.id);

    expect(readError).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0]?.user_id).toBe(customerA.id);
  });

  it("prevents User A from reading User B activity", async () => {
    const { error: serviceInsertError } = await admin
      .from("customer_activity")
      .insert({
        user_id: customerB.id,
        activity_type: "destination_viewed",
        entity_type: "destination",
        entity_id: "phase3-test-destination",
        metadata: { source: "phase3-test" },
      });

    expect(serviceInsertError).toBeNull();

    const { data, error } = await customerA.client
      .from("customer_activity")
      .select("*")
      .eq("user_id", customerB.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("allows User A to see their own enquiry but not User B records", async () => {
    const { data, error } = await customerA.client
      .from("enquiries")
      .select("id, reference, customer_auth_id, status")
      .eq("customer_auth_id", customerA.id);

    expect(error).toBeNull();
    expect(data?.some((row) => row.id === enquiryAId)).toBe(true);

    const { data: other, error: otherError } = await customerA.client
      .from("enquiries")
      .select("id")
      .eq("customer_auth_id", customerB.id);

    expect(otherError).toBeNull();
    expect(other).toEqual([]);
  });

  it("allows User A to see their own appointment but not User B records", async () => {
    const { data, error } = await customerA.client
      .from("appointments")
      .select("id, reference, customer_auth_id, status")
      .eq("customer_auth_id", customerA.id);

    expect(error).toBeNull();
    expect(data?.some((row) => row.id === appointmentAId)).toBe(true);

    const { data: other, error: otherError } = await customerA.client
      .from("appointments")
      .select("id")
      .eq("customer_auth_id", customerB.id);

    expect(otherError).toBeNull();
    expect(other).toEqual([]);
  });

  it("allows User A to see their own callback but not User B records", async () => {
    const { data, error } = await customerA.client
      .from("callback_requests")
      .select("id, reference, customer_auth_id, status")
      .eq("customer_auth_id", customerA.id);

    expect(error).toBeNull();
    expect(data?.some((row) => row.id === callbackAId)).toBe(true);

    const { data: other, error: otherError } = await customerA.client
      .from("callback_requests")
      .select("id")
      .eq("customer_auth_id", customerB.id);

    expect(otherError).toBeNull();
    expect(other).toEqual([]);
  });

  it("does not allow customers to directly update enquiry operational fields", async () => {
  const { error } = await customerA.client
    .from("enquiries")
    .update({
      status: "qualified",
    })
    .eq("id", enquiryAId);

  // RLS may intentionally return no error while affecting zero rows.
  // The important security assertion is that the protected field did not change.
  expect(error).toBeNull();

  const { data, error: verifyError } = await admin
    .from("enquiries")
    .select("status")
    .eq("id", enquiryAId)
    .single();

  expect(verifyError).toBeNull();
  expect(data?.status).not.toBe("qualified");
});

  it("does not allow customers to directly update appointment operational fields", async () => {
  const { error } = await customerA.client
    .from("appointments")
    .update({
      status: "confirmed",
    })
    .eq("id", appointmentAId);

  expect(error).toBeNull();

  const { data, error: verifyError } = await admin
    .from("appointments")
    .select("status")
    .eq("id", appointmentAId)
    .single();

  expect(verifyError).toBeNull();
  expect(data?.status).not.toBe("confirmed");
});

  it("does not allow customers to directly update callback operational fields", async () => {
  const { error } = await customerA.client
    .from("callback_requests")
    .update({
      status: "scheduled",
    })
    .eq("id", callbackAId);

  expect(error).toBeNull();

  const { data, error: verifyError } = await admin
    .from("callback_requests")
    .select("status")
    .eq("id", callbackAId)
    .single();

  expect(verifyError).toBeNull();
  expect(data?.status).not.toBe("scheduled");
});

  it("rejects unsupported customer activity metadata", async () => {
    const { error } = await customerA.client.from("customer_activity").insert({
      user_id: customerA.id,
      activity_type: "tour_viewed",
      entity_type: "tour",
      entity_id: String(testTourId),
      metadata: { password: "should-never-be-stored" },
    });

    expect(error).not.toBeNull();
  });

  it("does not expose another customer's profile", async () => {
    const { data, error } = await customerB.client
      .from("profiles")
      .select("id, full_name")
      .eq("id", customerA.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("does not expose another customer's preferences", async () => {
    const { data, error } = await customerB.client
      .from("customer_preferences")
      .select("*")
      .eq("user_id", customerA.id)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});
