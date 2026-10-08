import { and, count, desc, eq, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  appointments,
  blogPosts,
  bookings,
  callbackRequests,
  destinations,
  enquiries,
  financeTransactions,
  InsertUser,
  payments,
  quotationItems,
  quotations,
  settings,
  testimonials,
  tourCategories,
  tourItineraries,
  tours,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  values.lastSignedIn = user.lastSignedIn ?? new Date();
  updateSet.lastSignedIn = values.lastSignedIn;
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "owner";
    updateSet.role = "owner";
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return rows[0];
}

export async function getUserByEmail(email: string) {
  const db = await getDb();

  if (!db) {
    return undefined;
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedEmail) {
    return undefined;
  }

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  return rows[0];
}

export async function listTeamMembers() {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: users.id, name: users.name, email: users.email, role: users.role, lastSignedIn: users.lastSignedIn, createdAt: users.createdAt })
    .from(users)
    .orderBy(desc(users.createdAt));
}

export async function updateTeamMemberRole(id: number, role: "user" | "owner" | "manager" | "marketing" | "customer_care" | "staff" | "counsellor") {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.update(users).set({ role }).where(eq(users.id, id));
  return { success: true } as const;
}

export async function listTours(input: { search?: string; kind?: "domestic" | "international"; category?: string; featured?: boolean; limit?: number } = {}) {
  try {
  const db = await getDb();
  if (!db) return [];
  const predicates = [eq(tours.status, "published")];
  if (input.kind) predicates.push(eq(destinations.kind, input.kind));
  if (input.featured !== undefined) predicates.push(eq(tours.featured, input.featured));
  if (input.category) predicates.push(eq(tourCategories.slug, input.category));
  if (input.search) {
    const term = `%${input.search}%`;
    predicates.push(or(like(tours.title, term), like(destinations.name, term), like(destinations.country, term))!);
  }
  const rows = await db
    .select({
      id: tours.id,
      slug: tours.slug,
      title: tours.title,
      durationDays: tours.durationDays,
      durationNights: tours.durationNights,
      priceFrom: tours.priceFrom,
      originalPrice: tours.originalPrice,
      rating: tours.rating,
      reviewCount: tours.reviewCount,
      overview: tours.overview,
      highlights: tours.highlights,
      imageUrl: tours.imageUrl,
      tags: tours.tags,
      availability: tours.availability,
      featured: tours.featured,
      destination: destinations.name,
      country: destinations.country,
      kind: destinations.kind,
      category: tourCategories.name,
      categorySlug: tourCategories.slug,
    })
    .from(tours)
    .innerJoin(destinations, eq(tours.destinationId, destinations.id))
    .innerJoin(tourCategories, eq(tours.categoryId, tourCategories.id))
    .where(and(...predicates))
    .orderBy(desc(tours.featured), desc(tours.createdAt))
    .limit(input.limit ?? 24);
  return rows;
  } catch (error) {
    console.error("========== LIST TOURS DB ERROR ==========");
    console.error(error);
    console.error("CAUSE:", (error as any)?.cause);
    console.error("CAUSE MESSAGE:", (error as any)?.cause?.message);
    console.error("CAUSE CODE:", (error as any)?.cause?.code);
    console.error("==========================================");
    throw error;
  }
}

export async function getTourBySlug(slug: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .select({
      id: tours.id,
      slug: tours.slug,
      title: tours.title,
      durationDays: tours.durationDays,
      durationNights: tours.durationNights,
      priceFrom: tours.priceFrom,
      originalPrice: tours.originalPrice,
      rating: tours.rating,
      reviewCount: tours.reviewCount,
      overview: tours.overview,
      highlights: tours.highlights,
      inclusions: tours.inclusions,
      exclusions: tours.exclusions,
      imageUrl: tours.imageUrl,
      galleryUrls: tours.galleryUrls,
      tags: tours.tags,
      availability: tours.availability,
      destination: destinations.name,
      country: destinations.country,
      kind: destinations.kind,
      category: tourCategories.name,
    })
    .from(tours)
    .innerJoin(destinations, eq(tours.destinationId, destinations.id))
    .innerJoin(tourCategories, eq(tours.categoryId, tourCategories.id))
    .where(and(eq(tours.slug, slug), eq(tours.status, "published")))
    .limit(1);
  if (!rows[0]) return undefined;
  const itinerary = await db.select().from(tourItineraries).where(eq(tourItineraries.tourId, rows[0].id)).orderBy(tourItineraries.dayNumber);
  return { ...rows[0], itinerary };
}

export async function listDestinations(kind?: "domestic" | "international") {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(destinations).where(kind ? eq(destinations.kind, kind) : undefined).orderBy(desc(destinations.featured), destinations.name);
}

export async function listCategories() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tourCategories).orderBy(tourCategories.name);
}

export async function listBlogPosts(limit = 6) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(blogPosts).where(eq(blogPosts.status, "published")).orderBy(desc(blogPosts.publishedAt), desc(blogPosts.createdAt)).limit(limit);
}

export async function listTestimonials() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(testimonials).where(and(eq(testimonials.published, true), eq(testimonials.verified, true))).orderBy(desc(testimonials.createdAt)).limit(6);
}

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
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const reference = `AF-${Date.now().toString(36).toUpperCase()}`;
  await db.insert(enquiries).values({ ...input, reference, travellers: input.travellers ?? 2 });
  return { reference };
}

export async function createCallbackRequest(input: { userId?: number; enquiryId?: number; name: string; email: string; phone: string; preferredAt?: Date; reason: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  if (input.preferredAt && input.preferredAt.getTime() < Date.now()) throw new Error("Preferred callback time must be in the future");
  const reference = `CB-${Date.now().toString(36).toUpperCase()}`;
  await db.insert(callbackRequests).values({ ...input, reference });
  return { reference };
}

export async function createAppointment(input: { userId?: number; enquiryId?: number; name: string; email: string; phone: string; appointmentAt: Date; durationMinutes: number; mode: "phone" | "video" | "office"; purpose: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  if (input.appointmentAt.getTime() < Date.now()) throw new Error("Appointment time must be in the future");
  const [conflict] = await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.appointmentAt, input.appointmentAt), or(eq(appointments.status, "requested"), eq(appointments.status, "confirmed")))).limit(1);
  if (conflict) throw new Error("That appointment time is already requested. Please choose another time.");
  const reference = `AP-${Date.now().toString(36).toUpperCase()}`;
  await db.insert(appointments).values({ ...input, reference });
  return { reference };
}

export async function listCustomerCallbacks(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(callbackRequests).where(eq(callbackRequests.userId, userId)).orderBy(desc(callbackRequests.createdAt));
}

export async function listCustomerAppointments(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(appointments).where(eq(appointments.userId, userId)).orderBy(desc(appointments.appointmentAt));
}

export async function listSupportCallbacks() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(callbackRequests).orderBy(desc(callbackRequests.createdAt)).limit(100);
}

export async function listSupportAppointments() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(appointments).orderBy(desc(appointments.appointmentAt)).limit(100);
}

export async function updateCallbackRequest(input: { id: number; status: "requested" | "scheduled" | "completed" | "cancelled"; assignedTo?: number; notes?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.update(callbackRequests).set({ status: input.status, assignedTo: input.assignedTo, notes: input.notes }).where(eq(callbackRequests.id, input.id));
  return { success: true } as const;
}

export async function updateAppointment(input: { id: number; status: "requested" | "confirmed" | "completed" | "cancelled" | "no_show"; assignedTo?: number; meetingLink?: string; notes?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.update(appointments).set({ status: input.status, assignedTo: input.assignedTo, meetingLink: input.meetingLink, notes: input.notes }).where(eq(appointments.id, input.id));
  return { success: true } as const;
}

export async function listCustomerEnquiries(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(enquiries).where(eq(enquiries.userId, userId)).orderBy(desc(enquiries.createdAt));
}

export async function listCustomerBookings(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bookings).where(eq(bookings.userId, userId)).orderBy(desc(bookings.createdAt));
}

export async function listCustomerQuotations(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(quotations).where(eq(quotations.customerId, userId)).orderBy(desc(quotations.createdAt));
}

export async function listCustomerPayments(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ payment: payments, quotation: quotations, booking: bookings })
    .from(payments)
    .leftJoin(quotations, eq(payments.quotationId, quotations.id))
    .leftJoin(bookings, eq(payments.bookingId, bookings.id))
    .where(or(eq(quotations.customerId, userId), eq(bookings.userId, userId)))
    .orderBy(desc(payments.createdAt));
}

export async function getCustomerQuotation(quotationId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [quotation] = await db.select().from(quotations).where(and(eq(quotations.id, quotationId), eq(quotations.customerId, userId))).limit(1);
  return quotation;
}

export async function createPendingStripePayment(input: { quotationId: number; bookingId?: number; userId: number; checkoutSessionId: string; paymentIntentId?: string; amount: string; settlementCurrency?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const reference = `PM-${Date.now().toString(36).toUpperCase()}`;
  await db.insert(payments).values({ reference, bookingId: input.bookingId, quotationId: input.quotationId, receivedBy: input.userId, amount: input.amount, settlementCurrency: input.settlementCurrency ?? "INR", method: "card", status: "pending", stripeCheckoutSessionId: input.checkoutSessionId, stripePaymentIntentId: input.paymentIntentId });
  return reference;
}

export async function reconcileStripePayment(input: { checkoutSessionId: string; paymentIntentId?: string; status: "successful" | "failed" }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [payment] = await db.select().from(payments).where(eq(payments.stripeCheckoutSessionId, input.checkoutSessionId)).limit(1);
  if (!payment) return { found: false } as const;
  await db.update(payments).set({ status: input.status, stripePaymentIntentId: input.paymentIntentId ?? payment.stripePaymentIntentId, paidAt: input.status === "successful" ? new Date() : payment.paidAt }).where(eq(payments.id, payment.id));
  if (input.status === "successful") {
    if (payment.bookingId) await db.update(bookings).set({ paymentStatus: "successful", bookingStatus: "confirmed" }).where(eq(bookings.id, payment.bookingId));
    const [existingLedgerEntry] = await db.select({ id: financeTransactions.id }).from(financeTransactions).where(eq(financeTransactions.paymentId, payment.id)).limit(1);
    if (!existingLedgerEntry) await db.insert(financeTransactions).values({ paymentId: payment.id, recordedBy: payment.receivedBy, type: "income", amount: payment.amount, description: `Stripe payment ${payment.reference}` });
  }
  return { found: true, paymentId: payment.id } as const;
}

export async function markPaymentRefunded(paymentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment) throw new Error("Payment not found");
  await db.update(payments).set({ status: "refunded" }).where(eq(payments.id, paymentId));
  if (payment.bookingId) await db.update(bookings).set({ paymentStatus: "refunded", bookingStatus: "cancelled" }).where(eq(bookings.id, payment.bookingId));
  await db.insert(financeTransactions).values({ paymentId, recordedBy: payment.receivedBy, type: "refund", amount: payment.amount, description: `Refund ${payment.reference}` });
  return { success: true } as const;
}

export async function getPaymentById(paymentId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  return payment;
}

export async function listSalesQuotations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(quotations).orderBy(desc(quotations.createdAt)).limit(80);
}

export async function listSalesBookings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bookings).orderBy(desc(bookings.createdAt)).limit(80);
}

export async function listFinanceTransactions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(financeTransactions).orderBy(desc(financeTransactions.occurredAt)).limit(100);
}

export async function listFinancePayments() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(payments).orderBy(desc(payments.paidAt)).limit(100);
}

export async function getFinanceSummary() {
  const db = await getDb();
  if (!db) return { collected: 0, pending: 0, refunds: 0, payments: 0 };
  const [collected] = await db.select({ value: sql<string>`coalesce(sum(case when ${payments.status} = 'successful' then ${payments.amount} else 0 end), 0)` }).from(payments);
  const [pending] = await db.select({ value: sql<string>`coalesce(sum(case when ${payments.status} = 'pending' then ${payments.amount} else 0 end), 0)` }).from(payments);
  const [refunds] = await db.select({ value: sql<string>`coalesce(sum(case when ${payments.status} = 'refunded' then ${payments.amount} else 0 end), 0)` }).from(payments);
  const [paymentCount] = await db.select({ value: count() }).from(payments);
  return { collected: Number(collected?.value ?? 0), pending: Number(pending?.value ?? 0), refunds: Number(refunds?.value ?? 0), payments: paymentCount?.value ?? 0 };
}

export async function getMonthlyStripeRevenue(year: number, month: number) {
  const db = await getDb();
  if (!db) return { year, month, grossRevenue: 0, refunds: 0, netRevenue: 0, transactionCount: 0, rows: [] };
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const rows = await db.select({ transaction: financeTransactions, payment: payments, booking: bookings, quotation: quotations })
    .from(financeTransactions)
    .innerJoin(payments, eq(financeTransactions.paymentId, payments.id))
    .leftJoin(bookings, eq(payments.bookingId, bookings.id))
    .leftJoin(quotations, eq(payments.quotationId, quotations.id))
    .where(and(eq(payments.method, "card"), sql`${payments.stripeCheckoutSessionId} is not null`, sql`${financeTransactions.occurredAt} >= ${start}`, sql`${financeTransactions.occurredAt} < ${end}`))
    .orderBy(desc(financeTransactions.occurredAt));
  const grossRevenue = rows.filter((row) => row.transaction.type === "income").reduce((sum, row) => sum + Number(row.transaction.amount), 0);
  const refunds = rows.filter((row) => row.transaction.type === "refund").reduce((sum, row) => sum + Number(row.transaction.amount), 0);
  return { year, month, grossRevenue, refunds, netRevenue: grossRevenue - refunds, transactionCount: rows.length, rows };
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
  items: Array<{ description: string; quantity: number; unitPrice: number }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  if (!input.items.length) throw new Error("At least one quotation item is required");
  const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const taxes = input.taxes ?? 0;
  const discount = input.discount ?? 0;
  const total = subtotal + taxes - discount;
  if (total <= 0) throw new Error("Quotation total must be greater than zero");
  let customerId = input.customerId;
  if (!customerId && input.enquiryId) {
    const [enquiry] = await db.select({ userId: enquiries.userId }).from(enquiries).where(eq(enquiries.id, input.enquiryId)).limit(1);
    customerId = enquiry?.userId ?? undefined;
  }
  const reference = `QT-${Date.now().toString(36).toUpperCase()}`;
  await db.insert(quotations).values({ reference, enquiryId: input.enquiryId, customerId, createdBy: input.createdBy, destination: input.destination, travelDates: input.travelDates, travellers: input.travellers, subtotal: subtotal.toFixed(2), taxes: taxes.toFixed(2), discount: discount.toFixed(2), total: total.toFixed(2), notes: input.notes, validUntil: input.validUntil });
  const [quote] = await db.select({ id: quotations.id }).from(quotations).where(eq(quotations.reference, reference)).limit(1);
  if (!quote) throw new Error("Quotation could not be created");
  await db.insert(quotationItems).values(input.items.map((item) => ({ quotationId: quote.id, description: item.description, quantity: item.quantity, unitPrice: item.unitPrice.toFixed(2), lineTotal: (item.quantity * item.unitPrice).toFixed(2) })));
  return { id: quote.id, reference };
}

export async function updateQuotationStatus(id: number, status: "draft" | "sent" | "viewed" | "accepted" | "rejected" | "expired") {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [current] = await db.select({ status: quotations.status }).from(quotations).where(eq(quotations.id, id)).limit(1);
  if (!current) throw new Error("Quotation not found");
  const transitions: Record<typeof current.status, readonly string[]> = { draft: ["sent", "rejected"], sent: ["viewed", "accepted", "rejected", "expired"], viewed: ["accepted", "rejected", "expired"], accepted: [], rejected: [], expired: [] };
  if (!transitions[current.status].includes(status)) throw new Error(`Quotation cannot move from ${current.status} to ${status}`);
  await db.update(quotations).set({ status, sentAt: status === "sent" ? new Date() : undefined, acceptedAt: status === "accepted" ? new Date() : undefined }).where(eq(quotations.id, id));
  return { success: true } as const;
}

export async function convertQuotationToBooking(quotationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [quote] = await db.select().from(quotations).where(eq(quotations.id, quotationId)).limit(1);
  if (!quote) throw new Error("Quotation not found");
  if (quote.status !== "accepted") throw new Error("Only an accepted quotation can become a booking");
  if (quote.bookingId) return { bookingId: quote.bookingId, reference: `BK-${quote.bookingId}` };
  const reference = `BK-${Date.now().toString(36).toUpperCase()}`;
  await db.insert(bookings).values({ reference, userId: quote.customerId, destination: quote.destination, travelDates: quote.travelDates, travellers: quote.travellers, amount: quote.total, bookingStatus: "pending", paymentStatus: "pending" });
  const [booking] = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.reference, reference)).limit(1);
  if (!booking) throw new Error("Booking could not be created");
  await db.update(quotations).set({ bookingId: booking.id }).where(eq(quotations.id, quotationId));
  return { bookingId: booking.id, reference };
}

export async function recordPayment(input: { bookingId?: number; quotationId?: number; receivedBy: number; amount: number; method: "upi" | "bank_transfer" | "card" | "cash" | "other"; transactionReference?: string; notes?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  if (!input.bookingId && !input.quotationId) throw new Error("A payment must be linked to a booking or quotation");
  if (input.amount <= 0) throw new Error("Payment amount must be greater than zero");
  const reference = `PM-${Date.now().toString(36).toUpperCase()}`;
  await db.insert(payments).values({ reference, bookingId: input.bookingId, quotationId: input.quotationId, receivedBy: input.receivedBy, amount: input.amount.toFixed(2), method: input.method, transactionReference: input.transactionReference, notes: input.notes, status: "successful" });
  const [payment] = await db.select({ id: payments.id }).from(payments).where(eq(payments.reference, reference)).limit(1);
  if (!payment) throw new Error("Payment could not be recorded");
  await db.insert(financeTransactions).values({ paymentId: payment.id, recordedBy: input.receivedBy, type: "income", amount: input.amount.toFixed(2), description: `Payment ${reference}` });
  if (input.bookingId) await db.update(bookings).set({ paymentStatus: "successful", bookingStatus: "confirmed" }).where(eq(bookings.id, input.bookingId));
  return { reference };
}

export async function getAdminStats() {
  const db = await getDb();
  if (!db) return { enquiries: 0, newEnquiries: 0, activeBookings: 0, customers: 0, publishedTours: 0, revenue: 0 };
  const [enquiryCount] = await db.select({ value: count() }).from(enquiries);
  const [newCount] = await db.select({ value: count() }).from(enquiries).where(eq(enquiries.status, "new"));
  const [bookingCount] = await db.select({ value: count() }).from(bookings).where(and(eq(bookings.bookingStatus, "confirmed"), eq(bookings.paymentStatus, "successful")));
  const [customerCount] = await db.select({ value: count() }).from(users).where(eq(users.role, "user"));
  const [tourCount] = await db.select({ value: count() }).from(tours).where(eq(tours.status, "published"));
  const [revenueRow] = await db.select({ value: sql<string>`coalesce(sum(${bookings.amount}), 0)` }).from(bookings).where(eq(bookings.paymentStatus, "successful"));
  return { enquiries: enquiryCount?.value ?? 0, newEnquiries: newCount?.value ?? 0, activeBookings: bookingCount?.value ?? 0, customers: customerCount?.value ?? 0, publishedTours: tourCount?.value ?? 0, revenue: Number(revenueRow?.value ?? 0) };
}

export async function listAdminEnquiries() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(enquiries).orderBy(desc(enquiries.createdAt)).limit(40);
}

export async function listAdminTours() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: tours.id,
      slug: tours.slug,
      title: tours.title,
      destinationId: tours.destinationId,
      categoryId: tours.categoryId,
      durationDays: tours.durationDays,
      durationNights: tours.durationNights,
      priceFrom: tours.priceFrom,
      originalPrice: tours.originalPrice,
      rating: tours.rating,
      reviewCount: tours.reviewCount,
      overview: tours.overview,
      highlights: tours.highlights,
      inclusions: tours.inclusions,
      exclusions: tours.exclusions,
      imageUrl: tours.imageUrl,
      tags: tours.tags,
      availability: tours.availability,
      status: tours.status,
      featured: tours.featured,
      destination: destinations.name,
      country: destinations.country,
      category: tourCategories.name,
    })
    .from(tours)
    .innerJoin(destinations, eq(tours.destinationId, destinations.id))
    .innerJoin(tourCategories, eq(tours.categoryId, tourCategories.id))
    .orderBy(desc(tours.updatedAt));
}

export async function listAdminDestinations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(destinations).orderBy(desc(destinations.featured), destinations.name);
}

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
  tags?: string;
  availability?: string;
  status?: "draft" | "published" | "archived";
  featured?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.insert(tours).values({
    ...input,
    priceFrom: String(input.priceFrom),
    originalPrice: input.originalPrice === undefined ? null : String(input.originalPrice),
    rating: String(input.rating ?? 4.8),
    reviewCount: input.reviewCount ?? 0,
    availability: input.availability ?? "On request",
    status: input.status ?? "draft",
    featured: input.featured ?? false,
  });
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
  tags?: string;
  availability?: string;
  status?: "draft" | "published" | "archived";
  featured?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const { id, ...values } = input;
  await db.update(tours).set({
    ...values,
    priceFrom: String(values.priceFrom),
    originalPrice: values.originalPrice === undefined ? null : String(values.originalPrice),
    rating: String(values.rating ?? 4.8),
    reviewCount: values.reviewCount ?? 0,
    availability: values.availability ?? "On request",
    status: values.status ?? "draft",
    featured: values.featured ?? false,
  }).where(eq(tours.id, id));
  return { success: true } as const;
}

export async function deleteTourRecord(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.delete(tours).where(eq(tours.id, id));
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
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  await db.insert(destinations).values({ ...input, imageUrl: input.imageUrl ?? null, featured: input.featured ?? false });
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
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const { id, ...values } = input;
  await db.update(destinations).set({ ...values, imageUrl: values.imageUrl ?? null, featured: values.featured ?? false }).where(eq(destinations.id, id));
  return { success: true } as const;
}

export async function deleteDestinationRecord(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");
  const [linked] = await db.select({ value: count() }).from(tours).where(eq(tours.destinationId, id));
  if ((linked?.value ?? 0) > 0) throw new Error("This destination still has tours attached. Reassign or archive those tours before deleting it.");
  await db.delete(destinations).where(eq(destinations.id, id));
  return { success: true } as const;
}

export async function getSettings() {
  const db = await getDb();
  if (!db) return {};
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((row) => [row.settingKey, row.settingValue]));
}

export async function getSetting(settingKey: string) {
  const db = await getDb();
  if (!db) return undefined;
  const [row] = await db.select({ settingValue: settings.settingValue }).from(settings).where(eq(settings.settingKey, settingKey)).limit(1);
  return row?.settingValue;
}

export async function upsertSetting(settingKey: string, settingValue: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(settings).values({ settingKey, settingValue }).onDuplicateKeyUpdate({ set: { settingValue } });
}
