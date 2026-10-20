
import { createServerSupabaseClient } from "./_core/supabase";

function requireDb(accessToken?: string) {
  if (!accessToken) {
    throw new Error("A valid Supabase session is required.");
  }

  return createServerSupabaseClient(accessToken);
}

function validateTravellerCounts(input: {
  adults: number;
  children: number;
  infants: number;
}) {
  const { adults, children, infants } = input;

  if (!Number.isSafeInteger(adults) || adults < 1) {
    throw new Error("At least one adult is required.");
  }

  if (!Number.isSafeInteger(children) || children < 0) {
    throw new Error("Child count must be a non-negative integer.");
  }

  if (!Number.isSafeInteger(infants) || infants < 0) {
    throw new Error("Infant count must be a non-negative integer.");
  }

  const travellers = adults + children + infants;

  if (!Number.isSafeInteger(travellers) || travellers > 100) {
    throw new Error("The total number of travellers is invalid.");
  }

  return travellers;
}

export async function createDirectBooking(
  accessToken: string,
  input: {
    tourId: number;
    departureId?: number;
    name: string;
    email: string;
    phone: string;
    adults: number;
    children: number;
    infants: number;
    travellerNames: string[];
    notes?: string;
  },
) {
  if (!Number.isSafeInteger(input.tourId) || input.tourId < 1) {
    throw new Error("A valid tour must be selected.");
  }

  if (
    input.departureId !== undefined &&
    (!Number.isSafeInteger(input.departureId) ||
      input.departureId < 1)
  ) {
    throw new Error("The selected departure is invalid.");
  }

  if (!input.name?.trim()) {
    throw new Error("Traveller name is required.");
  }

  if (!input.email?.trim()) {
    throw new Error("Email address is required.");
  }

  if (!input.phone?.trim()) {
    throw new Error("Phone number is required.");
  }

  if (!Array.isArray(input.travellerNames)) {
    throw new Error("Traveller names must be provided as a list.");
  }

  const travellers = validateTravellerCounts(input);

  if (
    input.travellerNames.length > 0 &&
    input.travellerNames.length !== travellers
  ) {
    throw new Error(
      "The number of traveller names must match the total travellers.",
    );
  }

  const { data, error } = await requireDb(accessToken).rpc(
    "customer_create_direct_booking",
    {
      p_tour_id: input.tourId,
      p_departure_id: input.departureId ?? null,
      p_name: input.name.trim(),
      p_email: input.email.trim().toLowerCase(),
      p_phone: input.phone.trim(),
      p_adults: input.adults,
      p_children: input.children,
      p_infants: input.infants,
      p_traveller_names: input.travellerNames,
      p_notes: input.notes?.trim() || null,
    },
  );

  if (error) {
    console.error("[customer.directBook] Supabase RPC failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      tourId: input.tourId,
      departureId: input.departureId ?? null,
      travellers,
    });

    throw new Error(
      error.message || "Unable to create your booking.",
    );
  }

  return data as {
    bookingId: number;
    bookingReference: string;
    quotationId: number;
    quotationReference: string;
    total: number;
  };
}

export async function applyCustomerCoupon(
  accessToken: string,
  quotationId: number,
  code: string,
) {
  if (!Number.isSafeInteger(quotationId) || quotationId < 1) {
    throw new Error("A valid quotation is required.");
  }

  if (!code.trim()) {
    throw new Error("Enter a coupon code.");
  }

  const { data, error } = await requireDb(accessToken).rpc(
    "customer_apply_coupon",
    {
      p_quotation_id: quotationId,
      p_code: code.trim().toUpperCase(),
    },
  );

  if (error) {
    throw new Error(error.message || "Unable to apply this coupon.");
  }

  return data as {
    success: boolean;
    code: string;
    subtotal: number;
    discount: number;
    total: number;
    currency: string;
  };
}

export async function listAdminCoupons(accessToken: string) {
  const { data, error } = await requireDb(accessToken).rpc(
    "admin_list_coupons",
  );

  if (error) {
    throw new Error(error.message || "Unable to load coupons.");
  }

  return data ?? [];
}

export async function saveAdminCoupon(
  accessToken: string,
  input: {
    id?: number;
    code: string;
    description?: string;
    discountType: "percent" | "fixed";
    discountValue: number;
    maxDiscount?: number;
    minSubtotal: number;
    startsAt: string;
    expiresAt?: string;
    usageLimit?: number;
    perCustomerLimit: number;
    isActive: boolean;
  },
) {
  const { data, error } = await requireDb(accessToken).rpc(
    "admin_upsert_coupon",
    {
      p_id: input.id ?? null,
      p_code: input.code.trim().toUpperCase(),
      p_description: input.description?.trim() || null,
      p_discount_type: input.discountType,
      p_discount_value: input.discountValue,
      p_max_discount: input.maxDiscount ?? null,
      p_min_subtotal: input.minSubtotal,
      p_starts_at: input.startsAt,
      p_expires_at: input.expiresAt ?? null,
      p_usage_limit: input.usageLimit ?? null,
      p_per_customer_limit: input.perCustomerLimit,
      p_is_active: input.isActive,
    },
  );

  if (error) {
    throw new Error(error.message || "Unable to save coupon.");
  }

  return data;
}

export async function setAdminCouponActive(
  accessToken: string,
  id: number,
  isActive: boolean,
) {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error("A valid coupon ID is required.");
  }

  const { error } = await requireDb(accessToken).rpc(
    "admin_set_coupon_active",
    {
      p_id: id,
      p_is_active: isActive,
    },
  );

  if (error) {
    throw new Error(error.message || "Unable to update coupon.");
  }

  return { success: true };
}
