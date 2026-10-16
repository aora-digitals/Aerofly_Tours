import { supabase } from "@/lib/supabase";

export type CustomerActivityType =
  | "tour_viewed"
  | "destination_viewed"
  | "wishlist_added"
  | "wishlist_removed"
  | "enquiry_started"
  | "enquiry_submitted"
  | "appointment_requested"
  | "callback_requested"
  | "tour_search"
  | "recommendation_clicked"
  | "recommendation_dismissed"
  | "proposal_accepted";

export type CustomerPreferences = {
  user_id: string;
  travel_scope: "domestic" | "international" | "both";
  preferred_destinations: string[];
  travel_styles: string[];
  budget_min: number | null;
  budget_max: number | null;
  duration_min_days: number | null;
  duration_max_days: number | null;
  preferred_language: string;
  preferred_currency: string;
  created_at: string;
  updated_at: string;
};

export type CustomerActivity = {
  id: number;
  user_id: string;
  activity_type: CustomerActivityType;
  entity_type: "tour" | "destination" | "enquiry" | "appointment" | "callback" | null;
  entity_id: string | null;
  metadata: Record<string, string | number | boolean | null>;
  created_at: string;
};

function getErrorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message || fallback;
}

export async function getCustomerPreferences(userId: string) {
  const { data, error } = await supabase
    .from("customer_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(getErrorMessage(error, "Unable to load preferences."));
  return data as CustomerPreferences | null;
}

export async function saveCustomerPreferences(
  userId: string,
  input: Omit<CustomerPreferences, "created_at" | "updated_at" | "user_id">,
) {
  const { data, error } = await supabase
    .from("customer_preferences")
    .upsert(
      { user_id: userId, ...input },
      { onConflict: "user_id" },
    )
    .select("*")
    .single();

  if (error) throw new Error(getErrorMessage(error, "Unable to save preferences."));
  return data as CustomerPreferences;
}

export async function getWishlist(userId: string) {
  const { data, error } = await supabase
    .from("wishlists")
    .select(
      "id,tour_id,created_at,tours(id,slug,title,durationDays,durationNights,priceFrom,originalPrice,rating,reviewCount,imageUrl,tags,availability,destinations(name,country),tour_categories(name))",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(getErrorMessage(error, "Unable to load your wishlist."));
  return data ?? [];
}

export async function isTourWishlisted(userId: string, tourId: number) {
  const { data, error } = await supabase
    .from("wishlists")
    .select("id")
    .eq("user_id", userId)
    .eq("tour_id", tourId)
    .maybeSingle();

  if (error) throw new Error(getErrorMessage(error, "Unable to check your wishlist."));
  return Boolean(data);
}

export async function addToWishlist(userId: string, tourId: number) {
  const { error } = await supabase
    .from("wishlists")
    .upsert(
      { user_id: userId, tour_id: tourId },
      { onConflict: "user_id,tour_id", ignoreDuplicates: true },
    );

  if (error) throw new Error(getErrorMessage(error, "Unable to save this tour."));
  await recordCustomerActivity(userId, "wishlist_added", "tour", String(tourId));
}

export async function removeFromWishlist(userId: string, tourId: number) {
  const { error } = await supabase
    .from("wishlists")
    .delete()
    .eq("user_id", userId)
    .eq("tour_id", tourId);

  if (error) throw new Error(getErrorMessage(error, "Unable to remove this tour."));
  await recordCustomerActivity(userId, "wishlist_removed", "tour", String(tourId));
}

export async function getCustomerActivity(userId: string, limit = 50) {
  const { data, error } = await supabase
    .from("customer_activity")
    .select("id,user_id,activity_type,entity_type,entity_id,metadata,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(getErrorMessage(error, "Unable to load your activity."));
  return (data ?? []) as CustomerActivity[];
}

export async function getRecentlyViewedTours(userId: string, limit = 8) {
  const { data: activities, error: activityError } = await supabase
    .from("customer_activity")
    .select("entity_id,created_at")
    .eq("user_id", userId)
    .eq("activity_type", "tour_viewed")
    .eq("entity_type", "tour")
    .not("entity_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(40);

  if (activityError) {
    throw new Error(getErrorMessage(activityError, "Unable to load recently viewed tours."));
  }

  const seen = new Set<string>();
  const ids = (activities ?? [])
    .map((row) => String(row.entity_id))
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, limit);

  if (ids.length === 0) return [];

  const numericIds = ids.map(Number).filter(Number.isInteger);
  if (numericIds.length === 0) return [];

  const { data: tours, error: tourError } = await supabase
    .from("tours")
    .select("id,slug,title,durationDays,durationNights,priceFrom,originalPrice,rating,reviewCount,imageUrl,tags,availability,destinations(name,country),tour_categories(name)")
    .in("id", numericIds)
    .eq("status", "published");

  if (tourError) throw new Error(getErrorMessage(tourError, "Unable to load recently viewed tours."));

  const byId = new Map((tours ?? []).map((tour) => [String(tour.id), tour]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export async function recordCustomerActivity(
  userId: string,
  activityType: CustomerActivityType,
  entityType: "tour" | "destination" | "enquiry" | "appointment" | "callback" | null,
  entityId?: string | number | null,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  // Collapse repeated tour-view events for the same tour within 30 minutes.
  if (activityType === "tour_viewed" && entityType === "tour" && entityId != null) {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recent, error: recentError } = await supabase
      .from("customer_activity")
      .select("id")
      .eq("user_id", userId)
      .eq("activity_type", "tour_viewed")
      .eq("entity_type", "tour")
      .eq("entity_id", String(entityId))
      .gte("created_at", cutoff)
      .limit(1);

    if (recentError) throw new Error(getErrorMessage(recentError, "Unable to record activity."));
    if (recent?.length) return;
  }

  const { error } = await supabase.from("customer_activity").insert({
    user_id: userId,
    activity_type: activityType,
    entity_type: entityType,
    entity_id: entityId == null ? null : String(entityId),
    metadata,
  });

  if (error) throw new Error(getErrorMessage(error, "Unable to record activity."));
}

export async function cancelCustomerCallback(id: number) {
  const { data, error } = await supabase.rpc("cancel_customer_callback", {
    request_id: id,
  });
  if (error) throw new Error(getErrorMessage(error, "Unable to cancel the callback request."));
  if (!data) throw new Error("This callback request can no longer be cancelled.");
}

export async function cancelCustomerAppointment(id: number) {
  const { data, error } = await supabase.rpc("cancel_customer_appointment", {
    request_id: id,
  });
  if (error) throw new Error(getErrorMessage(error, "Unable to cancel the appointment."));
  if (!data) throw new Error("This appointment can no longer be cancelled.");
}

export async function uploadCustomerAvatar(userId: string, file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Avatar must be 5 MB or smaller.");
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `users/${userId}/avatar.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from("aerofly-private")
    .upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });

  if (uploadError) throw new Error(getErrorMessage(uploadError, "Unable to upload avatar."));

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ avatar_url: path })
    .eq("id", userId);

  if (profileError) throw new Error(getErrorMessage(profileError, "Unable to save avatar."));

  return path;
}

export async function getAvatarUrl(path: string | null) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from("aerofly-private")
    .createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}

export async function getCustomerOperationalData(userId: string) {
  const [enquiries, callbacks, appointments, bookings] = await Promise.all([
    supabase.from("enquiries").select("*").eq("customer_auth_id", userId).order("createdAt", { ascending: false }).limit(20),
    supabase.from("callback_requests").select("*").eq("customer_auth_id", userId).order("createdAt", { ascending: false }).limit(20),
    supabase.from("appointments").select("*").eq("customer_auth_id", userId).order("appointmentAt", { ascending: true }).limit(20),
    supabase.from("bookings").select("*").eq("customer_auth_id", userId).order("createdAt", { ascending: false }).limit(20),
  ]);

  for (const result of [enquiries, callbacks, appointments, bookings]) {
    if (result.error) throw new Error(result.error.message);
  }

  return {
    enquiries: enquiries.data ?? [],
    callbacks: callbacks.data ?? [],
    appointments: appointments.data ?? [],
    bookings: bookings.data ?? [],
  };
}
