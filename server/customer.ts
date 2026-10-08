import type { LegacyUser } from "./_core/context";
import { getDb } from "./db";
import { createServerSupabaseClient } from "./_core/supabase";

function getAuthUserId(user: LegacyUser): string | null {
  const value = String(user.openId ?? "");
  const match = value.match(/^supabase:([0-9a-fA-F-]{36})$/);
  return match?.[1] ?? null;
}

function customerDb(accessToken?: string) {
  return accessToken ? createServerSupabaseClient(accessToken) : getDb();
}

function throwDbError(error: { message?: string } | null): never {
  throw new Error(error?.message || "Customer operation failed");
}

function reference(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

export async function createCustomerEnquiry(user: LegacyUser, input: {
  tourId?: number; name: string; email: string; phone: string; destination?: string;
  travelDates?: string; travellers?: number; budget?: string; tripType?: string; message?: string;
}, accessToken?: string) {
  const customerAuthId = getAuthUserId(user);
  if (!customerAuthId) throw new Error("Your authenticated customer identity could not be resolved.");
  const ref = reference("AF");
  const { error } = await customerDb(accessToken).from("enquiries").insert({ ...input, userId: user.id, customer_auth_id: customerAuthId, reference: ref, travellers: input.travellers ?? 2 });
  if (error) throwDbError(error);
  return { reference: ref };
}

export async function createCustomerCallback(user: LegacyUser, input: {
  enquiryId?: number; name: string; email: string; phone: string; preferredAt?: Date; reason: string;
}, accessToken?: string) {
  const customerAuthId = getAuthUserId(user);
  if (!customerAuthId) throw new Error("Your authenticated customer identity could not be resolved.");
  if (input.preferredAt && input.preferredAt.getTime() < Date.now()) throw new Error("Preferred callback time must be in the future");
  const ref = reference("CB");
  const { error } = await customerDb(accessToken).from("callback_requests").insert({ ...input, userId: user.id, customer_auth_id: customerAuthId, reference: ref });
  if (error) throwDbError(error);
  return { reference: ref };
}

export async function createCustomerAppointment(user: LegacyUser, input: {
  enquiryId?: number; name: string; email: string; phone: string; appointmentAt: Date;
  durationMinutes: number; mode: "phone" | "video" | "office"; purpose: string;
}, accessToken?: string) {
  const customerAuthId = getAuthUserId(user);
  if (!customerAuthId) throw new Error("Your authenticated customer identity could not be resolved.");
  if (input.appointmentAt.getTime() < Date.now()) throw new Error("Appointment time must be in the future");
  const db = customerDb(accessToken);
  const { data: conflict, error: conflictError } = await db.from("appointments").select("id").eq("appointmentAt", input.appointmentAt.toISOString()).in("status", ["requested", "confirmed"]).limit(1).maybeSingle();
  if (conflictError) throwDbError(conflictError);
  if (conflict) throw new Error("That appointment time is already requested. Please choose another time.");
  const ref = reference("AP");
  const { error } = await db.from("appointments").insert({ ...input, userId: user.id, customer_auth_id: customerAuthId, reference: ref });
  if (error) throwDbError(error);
  return { reference: ref };
}
