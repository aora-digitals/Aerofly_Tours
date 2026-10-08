import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "./_core/env";

export type User = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: "user" | "owner" | "manager" | "marketing" | "customer_care" | "staff" | "counsellor" | "admin";
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date | null;
};

const supabaseAdmin = createClient(
  ENV.supabaseUrl,
  ENV.supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

export function getDb(): SupabaseClient {
  return supabaseAdmin;
}


function throwDbError(error: { message?: string; details?: string; hint?: string } | null): never {
  console.error("Supabase database error:", error);
  throw new Error(error?.message || "Database operation failed");
}

function nullable<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

export type InsertUser = {
  openId: string;
  name?: string | null;
  email?: string | null;
  loginMethod?: string | null;
  role?: "user" | "owner" | "manager" | "marketing" | "customer_care" | "staff" | "counsellor";
  lastSignedIn?: Date | null;
};

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");

  const values: Record<string, unknown> = {
    openId: user.openId,
    lastSignedIn: user.lastSignedIn ?? new Date(),
  };

  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) values[field] = user[field] ?? null;
  }

  if (user.role !== undefined) {
    values.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "owner";
  }

  const { error } = await supabaseAdmin
    .from("users")
    .upsert(values, { onConflict: "openId" });

  if (error) throwDbError(error);
}

export async function getUserByOpenId(openId: string) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("openId", openId)
    .maybeSingle();

  if (error) throwDbError(error);
  return data ?? undefined;
}

export async function getUserByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return undefined;

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("*")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (error) throwDbError(error);
  return data ?? undefined;
}

export async function listTeamMembers() {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id,name,email,role,lastSignedIn,createdAt")
    .order("createdAt", { ascending: false });

  if (error) throwDbError(error);
  return data ?? [];
}

export async function updateTeamMemberRole(
  id: number,
  role: "user" | "owner" | "manager" | "marketing" | "customer_care" | "staff" | "counsellor",
) {
  const { error } = await supabaseAdmin
    .from("users")
    .update({ role })
    .eq("id", id);

  if (error) throwDbError(error);
  return { success: true } as const;
}

/* -------------------------------------------------------------------------- */
/* Tours                                                                      */
/* -------------------------------------------------------------------------- */

export async function listTours(
  input: {
    search?: string;
    kind?: "domestic" | "international";
    category?: string;
    featured?: boolean;
    limit?: number;
  } = {},
) {
  const limit = input.limit ?? 24;

  let query = supabaseAdmin
    .from("tours")
    .select(`
      id,
      slug,
      title,
      durationDays,
      durationNights,
      priceFrom,
      originalPrice,
      rating,
      reviewCount,
      overview,
      highlights,
      imageUrl,
      tags,
      availability,
      featured,
      destinationId,
      categoryId,
      destinations!tours_destination_fk (
        name,
        country,
        kind
      ),
      tour_categories!tours_category_fk (
        name,
        slug
      )
    `)
    .eq("status", "published")
    .order("featured", { ascending: false })
    .order("createdAt", { ascending: false })
    .limit(limit);

  if (input.featured !== undefined) {
    query = query.eq("featured", input.featured);
  }

  if (input.category) {
    const { data: category, error } = await supabaseAdmin
      .from("tour_categories")
      .select("id")
      .eq("slug", input.category)
      .maybeSingle();

    if (error) throwDbError(error);
    if (!category) return [];
    query = query.eq("categoryId", category.id);
  }

  if (input.kind) {
    const { data: destinations, error } = await supabaseAdmin
      .from("destinations")
      .select("id")
      .eq("kind", input.kind);

    if (error) throwDbError(error);

    const ids = (destinations ?? []).map((d) => d.id);
    if (!ids.length) return [];
    query = query.in("destinationId", ids);
  }

  if (input.search) {
    const term = input.search.trim();
    if (term) {
      const pattern = `%${term}%`;

      const [{ data: titleMatches, error: titleError }, { data: destinationMatches, error: destinationError }] =
        await Promise.all([
          supabaseAdmin.from("tours").select("id").ilike("title", pattern),
          supabaseAdmin
            .from("destinations")
            .select("id")
            .or(`name.ilike.${pattern},country.ilike.${pattern}`),
        ]);

      if (titleError) throwDbError(titleError);
      if (destinationError) throwDbError(destinationError);

      const ids = [
        ...(titleMatches ?? []).map((row) => row.id),
        ...(destinationMatches ?? []).map((row) => row.id),
      ];

     
     const destinationIds = new Set(
  (destinationMatches ?? []).map((row) => row.id),
);

const tourIds = new Set(
  (titleMatches ?? []).map((row) => row.id),
);

let filteredIds = Array.from(tourIds);

      if (destinationIds.size) {
  const { data: destinationTours, error: destinationToursError } =
    await supabaseAdmin
      .from("tours")
      .select("id")
      .in("destinationId", Array.from(destinationIds));

  if (destinationToursError) throwDbError(destinationToursError);

  filteredIds = Array.from(
    new Set([
      ...filteredIds,
      ...(destinationTours ?? []).map((row) => row.id),
    ]),
  );
}

      if (!ids.length || !filteredIds.length) return [];
      query = query.in("id", filteredIds);
    }
  }

  const { data, error } = await query;

  if (error) throwDbError(error);

  return (data ?? []).map((row: any) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    durationDays: row.durationDays,
    durationNights: row.durationNights,
    priceFrom: row.priceFrom,
    originalPrice: row.originalPrice,
    rating: row.rating,
    reviewCount: row.reviewCount,
    overview: row.overview,
    highlights: row.highlights,
    imageUrl: row.imageUrl,
    tags: row.tags,
    availability: row.availability,
    featured: row.featured,
    destination: row.destinations?.name ?? null,
    country: row.destinations?.country ?? null,
    kind: row.destinations?.kind ?? null,
    category: row.tour_categories?.name ?? null,
    categorySlug: row.tour_categories?.slug ?? null,
  }));
}

export async function getTourBySlug(slug: string) {
  const { data: row, error } = await supabaseAdmin
    .from("tours")
    .select(`
      id,
      slug,
      title,
      durationDays,
      durationNights,
      priceFrom,
      originalPrice,
      rating,
      reviewCount,
      overview,
      highlights,
      inclusions,
      exclusions,
      imageUrl,
      galleryUrls,
      tags,
      availability,
      destinationId,
      categoryId,
      destinations!tours_destination_fk (
        name,
        country,
        kind
      ),
      tour_categories!tours_category_fk (
        name
      )
    `)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error) throwDbError(error);
  if (!row) return undefined;

  const { data: itinerary, error: itineraryError } = await supabaseAdmin
    .from("tour_itineraries")
    .select("*")
    .eq("tourId", row.id)
    .order("dayNumber", { ascending: true });

  if (itineraryError) throwDbError(itineraryError);

  const r: any = row;

  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    durationDays: r.durationDays,
    durationNights: r.durationNights,
    priceFrom: r.priceFrom,
    originalPrice: r.originalPrice,
    rating: r.rating,
    reviewCount: r.reviewCount,
    overview: r.overview,
    highlights: r.highlights,
    inclusions: r.inclusions,
    exclusions: r.exclusions,
    imageUrl: r.imageUrl,
    galleryUrls: r.galleryUrls,
    tags: r.tags,
    availability: r.availability,
    destination: r.destinations?.name ?? null,
    country: r.destinations?.country ?? null,
    kind: r.destinations?.kind ?? null,
    category: r.tour_categories?.name ?? null,
    itinerary: itinerary ?? [],
  };
}

export async function listDestinations(kind?: "domestic" | "international") {
  let query = supabaseAdmin
    .from("destinations")
    .select("*")
    .order("featured", { ascending: false })
    .order("name", { ascending: true });

  if (kind) query = query.eq("kind", kind);

  const { data, error } = await query;
  if (error) throwDbError(error);

  return data ?? [];
}

export async function listCategories() {
  const { data, error } = await supabaseAdmin
    .from("tour_categories")
    .select("*")
    .order("name", { ascending: true });

  if (error) throwDbError(error);
  return data ?? [];
}

/* -------------------------------------------------------------------------- */
/* Content                                                                    */
/* -------------------------------------------------------------------------- */

export async function listBlogPosts(limit = 6) {
  const { data, error } = await supabaseAdmin
    .from("blog_posts")
    .select("*")
    .eq("status", "published")
    .order("publishedAt", { ascending: false, nullsFirst: false })
    .order("createdAt", { ascending: false })
    .limit(limit);

  if (error) throwDbError(error);
  return data ?? [];
}

export async function listTestimonials() {
  const { data, error } = await supabaseAdmin
    .from("testimonials")
    .select("*")
    .eq("published", true)
    .eq("verified", true)
    .order("createdAt", { ascending: false })
    .limit(6);

  if (error) throwDbError(error);
  return data ?? [];
}

/* -------------------------------------------------------------------------- */
/* Enquiries / callbacks / appointments                                       */
/* -------------------------------------------------------------------------- */

export async function createEnquiry(input: {
  userId?: number;
  tourId?: number;
  name: string;
  email: string;
  phone: string;
  destination?: string;
  travelDates?: string;
  travellers?: number;
  budget?: string;
  tripType?: string;
  message?: string;
}) {
  const reference = `AF-${Date.now().toString(36).toUpperCase()}`;

  const { error } = await supabaseAdmin
    .from("enquiries")
    .insert({
      ...input,
      reference,
      travellers: input.travellers ?? 2,
    });

  if (error) throwDbError(error);
  return { reference };
}

export async function createCallbackRequest(input: {
  userId?: number;
  enquiryId?: number;
  name: string;
  email: string;
  phone: string;
  preferredAt?: Date;
  reason: string;
}) {
  if (input.preferredAt && input.preferredAt.getTime() < Date.now()) {
    throw new Error("Preferred callback time must be in the future");
  }

  const reference = `CB-${Date.now().toString(36).toUpperCase()}`;

  const { error } = await supabaseAdmin
    .from("callback_requests")
    .insert({ ...input, reference });

  if (error) throwDbError(error);
  return { reference };
}

export async function createAppointment(input: {
  userId?: number;
  enquiryId?: number;
  name: string;
  email: string;
  phone: string;
  appointmentAt: Date;
  durationMinutes: number;
  mode: "phone" | "video" | "office";
  purpose: string;
}) {
  if (input.appointmentAt.getTime() < Date.now()) {
    throw new Error("Appointment time must be in the future");
  }

  const { data: conflict, error: conflictError } = await supabaseAdmin
    .from("appointments")
    .select("id")
    .eq("appointmentAt", input.appointmentAt.toISOString())
    .in("status", ["requested", "confirmed"])
    .limit(1)
    .maybeSingle();

  if (conflictError) throwDbError(conflictError);
  if (conflict) {
    throw new Error("That appointment time is already requested. Please choose another time.");
  }

  const reference = `AP-${Date.now().toString(36).toUpperCase()}`;

  const { error } = await supabaseAdmin
    .from("appointments")
    .insert({ ...input, reference });

  if (error) throwDbError(error);
  return { reference };
}

export async function listCustomerCallbacks(userId: number) {
  const { data, error } = await supabaseAdmin
    .from("callback_requests")
    .select("*")
    .eq("userId", userId)
    .order("createdAt", { ascending: false });

  if (error) throwDbError(error);
  return data ?? [];
}

export async function listCustomerAppointments(userId: number) {
  const { data, error } = await supabaseAdmin
    .from("appointments")
    .select("*")
    .eq("userId", userId)
    .order("appointmentAt", { ascending: false });

  if (error) throwDbError(error);
  return data ?? [];
}

export async function listSupportCallbacks() {
  const { data, error } = await supabaseAdmin
    .from("callback_requests")
    .select("*")
    .order("createdAt", { ascending: false })
    .limit(100);

  if (error) throwDbError(error);
  return data ?? [];
}

export async function listSupportAppointments() {
  const { data, error } = await supabaseAdmin
    .from("appointments")
    .select("*")
    .order("appointmentAt", { ascending: false })
    .limit(100);

  if (error) throwDbError(error);
  return data ?? [];
}

export async function updateCallbackRequest(input: {
  id: number;
  status: "requested" | "scheduled" | "completed" | "cancelled";
  assignedTo?: number;
  notes?: string;
}) {
  const { error } = await supabaseAdmin
    .from("callback_requests")
    .update({
      status: input.status,
      assignedTo: nullable(input.assignedTo),
      notes: nullable(input.notes),
    })
    .eq("id", input.id);

  if (error) throwDbError(error);
  return { success: true } as const;
}

export async function updateAppointment(input: {
  id: number;
  status: "requested" | "confirmed" | "completed" | "cancelled" | "no_show";
  assignedTo?: number;
  meetingLink?: string;
  notes?: string;
}) {
  const { error } = await supabaseAdmin
    .from("appointments")
    .update({
      status: input.status,
      assignedTo: nullable(input.assignedTo),
      meetingLink: nullable(input.meetingLink),
      notes: nullable(input.notes),
    })
    .eq("id", input.id);

  if (error) throwDbError(error);
  return { success: true } as const;
}

/* -------------------------------------------------------------------------- */
/* Customer sales data                                                        */
/* -------------------------------------------------------------------------- */

export async function listCustomerEnquiries(userId: number) {
  const { data, error } = await supabaseAdmin
    .from("enquiries")
    .select("*")
    .eq("userId", userId)
    .order("createdAt", { ascending: false });

  if (error) throwDbError(error);
  return data ?? [];
}

export async function listCustomerBookings(userId: number) {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("*")
    .eq("userId", userId)
    .order("createdAt", { ascending: false });

  if (error) throwDbError(error);
  return data ?? [];
}

export async function listCustomerQuotations(userId: number) {
  const { data, error } = await supabaseAdmin
    .from("quotations")
    .select("*")
    .eq("customerId", userId)
    .order("createdAt", { ascending: false });

  if (error) throwDbError(error);
  return data ?? [];
}

export async function listCustomerPayments(userId: number) {
  const [{ data: quotations, error: quotationError }, { data: bookings, error: bookingError }] =
    await Promise.all([
      supabaseAdmin.from("quotations").select("id").eq("customerId", userId),
      supabaseAdmin.from("bookings").select("id").eq("userId", userId),
    ]);

  if (quotationError) throwDbError(quotationError);
  if (bookingError) throwDbError(bookingError);

  const quotationIds = (quotations ?? []).map((q) => q.id);
  const bookingIds = (bookings ?? []).map((b) => b.id);

  if (!quotationIds.length && !bookingIds.length) return [];

  const orParts: string[] = [];
  if (quotationIds.length) orParts.push(`quotationId.in.(${quotationIds.join(",")})`);
  if (bookingIds.length) orParts.push(`bookingId.in.(${bookingIds.join(",")})`);

  const { data, error } = await supabaseAdmin
    .from("payments")
    .select("*")
    .or(orParts.join(","))
    .order("createdAt", { ascending: false });

  if (error) throwDbError(error);

  return data ?? [];
}

export async function getCustomerQuotation(quotationId: number, userId: number) {
  const { data, error } = await supabaseAdmin
    .from("quotations")
    .select("*")
    .eq("id", quotationId)
    .eq("customerId", userId)
    .maybeSingle();

  if (error) throwDbError(error);
  return data ?? undefined;
}

/* -------------------------------------------------------------------------- */
/* Payments / Stripe                                                          */
/* -------------------------------------------------------------------------- */

export async function createPendingStripePayment(input: {
  quotationId: number;
  bookingId?: number;
  userId: number;
  checkoutSessionId: string;
  paymentIntentId?: string;
  amount: string;
  settlementCurrency?: string;
}) {
  const reference = `PM-${Date.now().toString(36).toUpperCase()}`;

  const { error } = await supabaseAdmin
    .from("payments")
    .insert({
      reference,
      bookingId: nullable(input.bookingId),
      quotationId: input.quotationId,
      receivedBy: input.userId,
      amount: input.amount,
      settlementCurrency: input.settlementCurrency ?? "INR",
      method: "card",
      status: "pending",
      stripeCheckoutSessionId: input.checkoutSessionId,
      stripePaymentIntentId: nullable(input.paymentIntentId),
    });

  if (error) throwDbError(error);
  return reference;
}

export async function reconcileStripePayment(input: {
  checkoutSessionId: string;
  paymentIntentId?: string;
  status: "successful" | "failed";
}) {
  const { data: payment, error } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("stripeCheckoutSessionId", input.checkoutSessionId)
    .maybeSingle();

  if (error) throwDbError(error);
  if (!payment) return { found: false } as const;

  const { error: paymentUpdateError } = await supabaseAdmin
    .from("payments")
    .update({
      status: input.status,
      stripePaymentIntentId:
        input.paymentIntentId ?? payment.stripePaymentIntentId,
      paidAt:
        input.status === "successful"
          ? new Date().toISOString()
          : payment.paidAt,
    })
    .eq("id", payment.id);

  if (paymentUpdateError) throwDbError(paymentUpdateError);

  if (input.status === "successful") {
    if (payment.bookingId) {
      const { error: bookingError } = await supabaseAdmin
        .from("bookings")
        .update({
          paymentStatus: "successful",
          bookingStatus: "confirmed",
        })
        .eq("id", payment.bookingId);

      if (bookingError) throwDbError(bookingError);
    }

    const { data: existingLedgerEntry, error: ledgerLookupError } =
      await supabaseAdmin
        .from("finance_transactions")
        .select("id")
        .eq("paymentId", payment.id)
        .limit(1)
        .maybeSingle();

    if (ledgerLookupError) throwDbError(ledgerLookupError);

    if (!existingLedgerEntry) {
      const { error: ledgerError } = await supabaseAdmin
        .from("finance_transactions")
        .insert({
          paymentId: payment.id,
          recordedBy: payment.receivedBy,
          type: "income",
          amount: payment.amount,
          description: `Stripe payment ${payment.reference}`,
        });

      if (ledgerError) throwDbError(ledgerError);
    }
  }

  return { found: true, paymentId: payment.id } as const;
}

export async function markPaymentRefunded(paymentId: number) {
  const { data: payment, error } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();

  if (error) throwDbError(error);
  if (!payment) throw new Error("Payment not found");

  const { error: paymentError } = await supabaseAdmin
    .from("payments")
    .update({ status: "refunded" })
    .eq("id", paymentId);

  if (paymentError) throwDbError(paymentError);

  if (payment.bookingId) {
    const { error: bookingError } = await supabaseAdmin
      .from("bookings")
      .update({
        paymentStatus: "refunded",
        bookingStatus: "cancelled",
      })
      .eq("id", payment.bookingId);

    if (bookingError) throwDbError(bookingError);
  }

  const { error: ledgerError } = await supabaseAdmin
    .from("finance_transactions")
    .insert({
      paymentId,
      recordedBy: payment.receivedBy,
      type: "refund",
      amount: payment.amount,
      description: `Refund ${payment.reference}`,
    });

  if (ledgerError) throwDbError(ledgerError);

  return { success: true } as const;
}

export async function getPaymentById(paymentId: number) {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();

  if (error) throwDbError(error);
  return data ?? undefined;
}

/* -------------------------------------------------------------------------- */
/* Sales / finance                                                            */
/* -------------------------------------------------------------------------- */

export async function listSalesQuotations() {
  const { data, error } = await supabaseAdmin
    .from("quotations")
    .select("*")
    .order("createdAt", { ascending: false })
    .limit(80);

  if (error) throwDbError(error);
  return data ?? [];
}

export async function listSalesBookings() {
  const { data, error } = await supabaseAdmin
    .from("bookings")
    .select("*")
    .order("createdAt", { ascending: false })
    .limit(80);

  if (error) throwDbError(error);
  return data ?? [];
}

export async function listFinanceTransactions() {
  const { data, error } = await supabaseAdmin
    .from("finance_transactions")
    .select("*")
    .order("occurredAt", { ascending: false })
    .limit(100);

  if (error) throwDbError(error);
  return data ?? [];
}

export async function listFinancePayments() {
  const { data, error } = await supabaseAdmin
    .from("payments")
    .select("*")
    .order("paidAt", { ascending: false })
    .limit(100);

  if (error) throwDbError(error);
  return data ?? [];
}

export async function getFinanceSummary() {
  const { data: payments, error } = await supabaseAdmin
    .from("payments")
    .select("amount,status");

  if (error) throwDbError(error);

  const rows = payments ?? [];

  const collected = rows
    .filter((p) => p.status === "successful")
    .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);

  const pending = rows
    .filter((p) => p.status === "pending")
    .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);

  const refunds = rows
    .filter((p) => p.status === "refunded")
    .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);

  return {
    collected,
    pending,
    refunds,
    payments: rows.length,
  };
}

export async function getMonthlyStripeRevenue(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  const { data: transactions, error: transactionError } = await supabaseAdmin
    .from("finance_transactions")
    .select("*")
    .eq("type", "income")
    .gte("occurredAt", start.toISOString())
    .lt("occurredAt", end.toISOString())
    .order("occurredAt", { ascending: false });

  if (transactionError) throwDbError(transactionError);

  const txRows = transactions ?? [];
const paymentIds = Array.from(
  new Set(
    txRows
      .map((row) => row.paymentId)
      .filter((id): id is number => Boolean(id))
  )
);
  if (!paymentIds.length) {
    return {
      year,
      month,
      grossRevenue: 0,
      refunds: 0,
      netRevenue: 0,
      transactionCount: 0,
      rows: [],
    };
  }

  const { data: payments, error: paymentError } = await supabaseAdmin
    .from("payments")
    .select("*")
    .in("id", paymentIds)
    .eq("method", "card");

  if (paymentError) throwDbError(paymentError);

  const paymentMap = new Map((payments ?? []).map((payment) => [payment.id, payment]));
  const validTransactions = txRows.filter((tx) => paymentMap.has(tx.paymentId));

   const bookingIds = Array.from(
  new Set(
    (payments ?? [])
      .map((p) => p.bookingId)
      .filter((id): id is number => Boolean(id)),
  ),
);

  const quotationIds = Array.from(
  new Set(
    (payments ?? [])
      .map((p) => p.quotationId)
      .filter((id): id is number => Boolean(id)),
  ),
);

  const [{ data: bookings, error: bookingError }, { data: quotations, error: quotationError }] =
    await Promise.all([
      bookingIds.length
        ? supabaseAdmin.from("bookings").select("*").in("id", bookingIds)
        : Promise.resolve({ data: [], error: null }),
      quotationIds.length
        ? supabaseAdmin.from("quotations").select("*").in("id", quotationIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (bookingError) throwDbError(bookingError);
  if (quotationError) throwDbError(quotationError);

  const bookingMap = new Map((bookings ?? []).map((booking) => [booking.id, booking]));
  const quotationMap = new Map(
    (quotations ?? []).map((quotation) => [quotation.id, quotation]),
  );

  const rows = validTransactions.map((transaction) => {
    const payment = paymentMap.get(transaction.paymentId)!;

    return {
      transaction,
      payment,
      booking: payment.bookingId
        ? bookingMap.get(payment.bookingId) ?? null
        : null,
      quotation: payment.quotationId
        ? quotationMap.get(payment.quotationId) ?? null
        : null,
    };
  });

  const grossRevenue = rows
    .filter((row) => row.transaction.type === "income")
    .reduce((sum, row) => sum + Number(row.transaction.amount ?? 0), 0);

  const refunds = rows
    .filter((row) => row.transaction.type === "refund")
    .reduce((sum, row) => sum + Number(row.transaction.amount ?? 0), 0);

  return {
    year,
    month,
    grossRevenue,
    refunds,
    netRevenue: grossRevenue - refunds,
    transactionCount: rows.length,
    rows,
  };
}

export async function createQuotation(input: {
  enquiryId?: number;
  customerId?: number;
  createdBy: number;
  destination: string;
  travelDates: string;
  travellers: number;
  taxes?: number;
  discount?: number;
  notes?: string;
  validUntil?: Date;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
}) {
  if (!input.items.length) {
    throw new Error("At least one quotation item is required");
  }

  const subtotal = input.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );

  const taxes = input.taxes ?? 0;
  const discount = input.discount ?? 0;
  const total = subtotal + taxes - discount;

  if (total <= 0) {
    throw new Error("Quotation total must be greater than zero");
  }

  let customerId = input.customerId;

  if (!customerId && input.enquiryId) {
    const { data: enquiry, error } = await supabaseAdmin
      .from("enquiries")
      .select("userId")
      .eq("id", input.enquiryId)
      .maybeSingle();

    if (error) throwDbError(error);
    customerId = enquiry?.userId ?? undefined;
  }

  const reference = `QT-${Date.now().toString(36).toUpperCase()}`;

  const { data: quote, error: quoteError } = await supabaseAdmin
    .from("quotations")
    .insert({
      reference,
      enquiryId: nullable(input.enquiryId),
      customerId: nullable(customerId),
      createdBy: input.createdBy,
      destination: input.destination,
      travelDates: input.travelDates,
      travellers: input.travellers,
      subtotal: subtotal.toFixed(2),
      taxes: taxes.toFixed(2),
      discount: discount.toFixed(2),
      total: total.toFixed(2),
      notes: nullable(input.notes),
      validUntil: input.validUntil?.toISOString() ?? null,
    })
    .select("id")
    .single();

  if (quoteError) throwDbError(quoteError);
  if (!quote) throw new Error("Quotation could not be created");

  const { error: itemsError } = await supabaseAdmin
    .from("quotation_items")
    .insert(
      input.items.map((item) => ({
        quotationId: quote.id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toFixed(2),
        lineTotal: (item.quantity * item.unitPrice).toFixed(2),
      })),
    );

  if (itemsError) throwDbError(itemsError);

  return { id: quote.id, reference };
}

export async function updateQuotationStatus(
  id: number,
  status: "draft" | "sent" | "viewed" | "accepted" | "rejected" | "expired",
) {
  const { data: current, error: currentError } = await supabaseAdmin
    .from("quotations")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  if (currentError) throwDbError(currentError);
  if (!current) throw new Error("Quotation not found");

  const transitions: Record<string, readonly string[]> = {
    draft: ["sent", "rejected"],
    sent: ["viewed", "accepted", "rejected", "expired"],
    viewed: ["accepted", "rejected", "expired"],
    accepted: [],
    rejected: [],
    expired: [],
  };

  if (!transitions[current.status]?.includes(status)) {
    throw new Error(
      `Quotation cannot move from ${current.status} to ${status}`,
    );
  }

  const { error } = await supabaseAdmin
    .from("quotations")
    .update({
      status,
      sentAt: status === "sent" ? new Date().toISOString() : undefined,
      acceptedAt:
        status === "accepted" ? new Date().toISOString() : undefined,
    })
    .eq("id", id);

  if (error) throwDbError(error);
  return { success: true } as const;
}

export async function convertQuotationToBooking(quotationId: number) {
  const { data: quote, error: quoteError } = await supabaseAdmin
    .from("quotations")
    .select("*")
    .eq("id", quotationId)
    .maybeSingle();

  if (quoteError) throwDbError(quoteError);
  if (!quote) throw new Error("Quotation not found");

  if (quote.status !== "accepted") {
    throw new Error("Only an accepted quotation can become a booking");
  }

  if (quote.bookingId) {
    return {
      bookingId: quote.bookingId,
      reference: `BK-${quote.bookingId}`,
    };
  }

  const reference = `BK-${Date.now().toString(36).toUpperCase()}`;

  const { data: booking, error: bookingError } = await supabaseAdmin
    .from("bookings")
    .insert({
      reference,
      userId: quote.customerId,
      destination: quote.destination,
      travelDates: quote.travelDates,
      travellers: quote.travellers,
      amount: quote.total,
      bookingStatus: "pending",
      paymentStatus: "pending",
    })
    .select("id")
    .single();

  if (bookingError) throwDbError(bookingError);
  if (!booking) throw new Error("Booking could not be created");

  const { error: updateError } = await supabaseAdmin
    .from("quotations")
    .update({ bookingId: booking.id })
    .eq("id", quotationId);

  if (updateError) throwDbError(updateError);

  return {
    bookingId: booking.id,
    reference,
  };
}

export async function recordPayment(input: {
  bookingId?: number;
  quotationId?: number;
  receivedBy: number;
  amount: number;
  method: "upi" | "bank_transfer" | "card" | "cash" | "other";
  transactionReference?: string;
  notes?: string;
}) {
  if (!input.bookingId && !input.quotationId) {
    throw new Error("A payment must be linked to a booking or quotation");
  }

  if (input.amount <= 0) {
    throw new Error("Payment amount must be greater than zero");
  }

  const reference = `PM-${Date.now().toString(36).toUpperCase()}`;

  const { data: payment, error: paymentError } = await supabaseAdmin
    .from("payments")
    .insert({
      reference,
      bookingId: nullable(input.bookingId),
      quotationId: nullable(input.quotationId),
      receivedBy: input.receivedBy,
      amount: input.amount.toFixed(2),
      method: input.method,
      transactionReference: nullable(input.transactionReference),
      notes: nullable(input.notes),
      status: "successful",
    })
    .select("id")
    .single();

  if (paymentError) throwDbError(paymentError);
  if (!payment) throw new Error("Payment could not be recorded");

  const { error: transactionError } = await supabaseAdmin
    .from("finance_transactions")
    .insert({
      paymentId: payment.id,
      recordedBy: input.receivedBy,
      type: "income",
      amount: input.amount.toFixed(2),
      description: `Payment ${reference}`,
    });

  if (transactionError) throwDbError(transactionError);

  if (input.bookingId) {
    const { error: bookingError } = await supabaseAdmin
      .from("bookings")
      .update({
        paymentStatus: "successful",
        bookingStatus: "confirmed",
      })
      .eq("id", input.bookingId);

    if (bookingError) throwDbError(bookingError);
  }

  return { reference };
}

/* -------------------------------------------------------------------------- */
/* Admin dashboard                                                            */
/* -------------------------------------------------------------------------- */

export async function getAdminStats() {
  const [
    { count: enquiryCount, error: enquiryError },
    { count: newCount, error: newError },
    { count: bookingCount, error: bookingError },
    { count: customerCount, error: customerError },
    { count: tourCount, error: tourError },
    { data: revenueRows, error: revenueError },
  ] = await Promise.all([
    supabaseAdmin
      .from("enquiries")
      .select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("enquiries")
      .select("id", { count: "exact", head: true })
      .eq("status", "new"),
    supabaseAdmin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("bookingStatus", "confirmed")
      .eq("paymentStatus", "successful"),
    supabaseAdmin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "user"),
    supabaseAdmin
      .from("tours")
      .select("id", { count: "exact", head: true })
      .eq("status", "published"),
    supabaseAdmin
      .from("bookings")
      .select("amount")
      .eq("paymentStatus", "successful"),
  ]);

  if (enquiryError) throwDbError(enquiryError);
  if (newError) throwDbError(newError);
  if (bookingError) throwDbError(bookingError);
  if (customerError) throwDbError(customerError);
  if (tourError) throwDbError(tourError);
  if (revenueError) throwDbError(revenueError);

  const revenue = (revenueRows ?? []).reduce(
    (sum, row) => sum + Number(row.amount ?? 0),
    0,
  );

  return {
    enquiries: enquiryCount ?? 0,
    newEnquiries: newCount ?? 0,
    activeBookings: bookingCount ?? 0,
    customers: customerCount ?? 0,
    publishedTours: tourCount ?? 0,
    revenue,
  };
}

export async function listAdminEnquiries() {
  const { data, error } = await supabaseAdmin
    .from("enquiries")
    .select("*")
    .order("createdAt", { ascending: false })
    .limit(40);

  if (error) throwDbError(error);
  return data ?? [];
}

export async function listAdminTours() {
  const { data, error } = await supabaseAdmin
    .from("tours")
    .select(`
      id,
      slug,
      title,
      destinationId,
      categoryId,
      durationDays,
      durationNights,
      priceFrom,
      originalPrice,
      rating,
      reviewCount,
      overview,
      highlights,
      inclusions,
      exclusions,
      imageUrl,
      tags,
      availability,
      status,
      featured,
      destinations!tours_destination_fk (
        name,
        country
      ),
      tour_categories!tours_category_fk (
        name
      )
    `)
    .order("updatedAt", { ascending: false });

  if (error) throwDbError(error);

  return (data ?? []).map((row: any) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    destinationId: row.destinationId,
    categoryId: row.categoryId,
    durationDays: row.durationDays,
    durationNights: row.durationNights,
    priceFrom: row.priceFrom,
    originalPrice: row.originalPrice,
    rating: row.rating,
    reviewCount: row.reviewCount,
    overview: row.overview,
    highlights: row.highlights,
    inclusions: row.inclusions,
    exclusions: row.exclusions,
    imageUrl: row.imageUrl,
    tags: row.tags,
    availability: row.availability,
    status: row.status,
    featured: row.featured,
    destination: row.destinations?.name ?? null,
    country: row.destinations?.country ?? null,
    category: row.tour_categories?.name ?? null,
  }));
}

export async function listAdminDestinations() {
  const { data, error } = await supabaseAdmin
    .from("destinations")
    .select("*")
    .order("featured", { ascending: false })
    .order("name", { ascending: true });

  if (error) throwDbError(error);
  return data ?? [];
}

/* -------------------------------------------------------------------------- */
/* Tour administration                                                        */
/* -------------------------------------------------------------------------- */

export async function createTourRecord(input: {
  slug: string;
  title: string;
  destinationId: number;
  categoryId: number;
  durationDays: number;
  durationNights: number;
  priceFrom: number;
  originalPrice?: number;
  rating?: number;
  reviewCount?: number;
  overview: string;
  highlights?: string;
  inclusions?: string;
  exclusions?: string;
  imageUrl: string;
  galleryUrls?: string;
  tags?: string;
  availability?: string;
  status?: "draft" | "published" | "archived";
  featured?: boolean;
}) {
  const { error } = await supabaseAdmin
    .from("tours")
    .insert({
      ...input,
      priceFrom: input.priceFrom,
      originalPrice:
        input.originalPrice === undefined ? null : input.originalPrice,
      rating: input.rating ?? 4.8,
      reviewCount: input.reviewCount ?? 0,
      highlights: input.highlights ?? null,
      inclusions: input.inclusions ?? null,
      exclusions: input.exclusions ?? null,
      galleryUrls: input.galleryUrls ?? null,
      tags: input.tags ?? null,
      availability: input.availability ?? "On request",
      status: input.status ?? "draft",
      featured: input.featured ?? false,
    });

  if (error) throwDbError(error);
  return { success: true } as const;
}

export async function updateTourRecord(input: {
  id: number;
  slug: string;
  title: string;
  destinationId: number;
  categoryId: number;
  durationDays: number;
  durationNights: number;
  priceFrom: number;
  originalPrice?: number;
  rating?: number;
  reviewCount?: number;
  overview: string;
  highlights?: string;
  inclusions?: string;
  exclusions?: string;
  imageUrl: string;
  galleryUrls?: string;
  tags?: string;
  availability?: string;
  status?: "draft" | "published" | "archived";
  featured?: boolean;
}) {
  const { id, ...values } = input;

  const { error } = await supabaseAdmin
    .from("tours")
    .update({
      ...values,
      priceFrom: values.priceFrom,
      originalPrice:
        values.originalPrice === undefined ? null : values.originalPrice,
      rating: values.rating ?? 4.8,
      reviewCount: values.reviewCount ?? 0,
      highlights: values.highlights ?? null,
      inclusions: values.inclusions ?? null,
      exclusions: values.exclusions ?? null,
      galleryUrls: values.galleryUrls ?? null,
      tags: values.tags ?? null,
      availability: values.availability ?? "On request",
      status: values.status ?? "draft",
      featured: values.featured ?? false,
    })
    .eq("id", id);

  if (error) throwDbError(error);
  return { success: true } as const;
}

export async function deleteTourRecord(id: number) {
  const { error } = await supabaseAdmin
    .from("tours")
    .delete()
    .eq("id", id);

  if (error) throwDbError(error);
  return { success: true } as const;
}

export async function createDestinationRecord(input: {
  slug: string;
  name: string;
  country: string;
  region?: string;
  kind: "domestic" | "international";
  tagline?: string;
  description?: string;
  imageUrl?: string;
  featured?: boolean;
}) {
  const { error } = await supabaseAdmin
    .from("destinations")
    .insert({
      ...input,
      imageUrl: input.imageUrl ?? null,
      featured: input.featured ?? false,
    });

  if (error) throwDbError(error);
  return { success: true } as const;
}

export async function updateDestinationRecord(input: {
  id: number;
  slug: string;
  name: string;
  country: string;
  region?: string;
  kind: "domestic" | "international";
  tagline?: string;
  description?: string;
  imageUrl?: string;
  featured?: boolean;
}) {
  const { id, ...values } = input;

  const { error } = await supabaseAdmin
    .from("destinations")
    .update({
      ...values,
      imageUrl: values.imageUrl ?? null,
      featured: values.featured ?? false,
    })
    .eq("id", id);

  if (error) throwDbError(error);
  return { success: true } as const;
}

export async function deleteDestinationRecord(id: number) {
  const { count, error: countError } = await supabaseAdmin
    .from("tours")
    .select("id", { count: "exact", head: true })
    .eq("destinationId", id);

  if (countError) throwDbError(countError);

  if ((count ?? 0) > 0) {
    throw new Error(
      "This destination still has tours attached. Reassign or archive those tours before deleting it.",
    );
  }

  const { error } = await supabaseAdmin
    .from("destinations")
    .delete()
    .eq("id", id);

  if (error) throwDbError(error);
  return { success: true } as const;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export async function getSettings() {
  const { data, error } = await supabaseAdmin
    .from("settings")
    .select("settingKey,settingValue");

  if (error) throwDbError(error);

  return Object.fromEntries(
    (data ?? []).map((row) => [row.settingKey, row.settingValue]),
  );
}

export async function getSetting(settingKey: string) {
  const { data, error } = await supabaseAdmin
    .from("settings")
    .select("settingValue")
    .eq("settingKey", settingKey)
    .maybeSingle();

  if (error) throwDbError(error);
  return data?.settingValue;
}

export async function upsertSetting(
  settingKey: string,
  settingValue: string,
) {
  const { error } = await supabaseAdmin
    .from("settings")
    .upsert(
      {
        settingKey,
        settingValue,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: "settingKey" },
    );

  if (error) throwDbError(error);
}
