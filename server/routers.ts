import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { ASSIGNABLE_ROLES, hasWorkspacePermission, type WorkspacePermission } from "@shared/types";
import {
  createAppointment,
  createCallbackRequest,
  createDestinationRecord,
  createEnquiry,
  createTourRecord,
  deleteDestinationRecord,
  deleteTourRecord,
  getAdminStats,
  getFinanceSummary,
  getMonthlyStripeRevenue,
  getSettings,
  getTourBySlug,
  listAdminDestinations,
  listAdminEnquiries,
  listAdminTours,
  listCustomerAppointments,
  listFinancePayments,
  listFinanceTransactions,
  listSalesBookings,
  listSalesQuotations,
  listBlogPosts,
  listCategories,
  listCustomerBookings,
  listCustomerCallbacks,
  listCustomerEnquiries,
  listCustomerPayments,
  listCustomerQuotations,
  listSupportAppointments,
  listSupportCallbacks,
  listDestinations,
  listTestimonials,
  listTours,
  listTeamMembers,
  convertQuotationToBooking,
  createQuotation,
  recordPayment,
  updateQuotationStatus,
  updateTeamMemberRole,
  updateAppointment,
  updateCallbackRequest,
  updateDestinationRecord,
  updateTourRecord,
} from "./db";
import { createCustomerCheckout, refundCustomerPayment } from "./stripe";
import { detectCurrency } from "./currency";

const permissionProcedure = (permission: WorkspacePermission) => protectedProcedure.use(({ ctx, next }) => {
  if (!hasWorkspacePermission(ctx.user.role, permission)) throw new TRPCError({ code: "FORBIDDEN", message: `This workspace action requires the ${permission} permission` });
  return next({ ctx });
});

const enquiryInput = z.object({
  tourId: z.number().optional(),
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(7),
  destination: z.string().optional(),
  travelDates: z.string().optional(),
  travellers: z.number().int().min(1).max(30).optional(),
  budget: z.string().optional(),
  tripType: z.string().optional(),
  message: z.string().max(2000).optional(),
});

const callbackInput = z.object({
  enquiryId: z.number().int().positive().optional(),
  name: z.string().min(2).max(160),
  email: z.string().email(),
  phone: z.string().min(7).max(40),
  preferredAt: z.coerce.date().optional(),
  reason: z.string().min(3).max(255),
});

const appointmentInput = z.object({
  enquiryId: z.number().int().positive().optional(),
  name: z.string().min(2).max(160),
  email: z.string().email(),
  phone: z.string().min(7).max(40),
  appointmentAt: z.coerce.date(),
  durationMinutes: z.number().int().min(15).max(90).default(30),
  mode: z.enum(["phone", "video", "office"]),
  purpose: z.string().min(3).max(255),
});

const destinationInput = z.object({
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  name: z.string().min(2).max(160),
  country: z.string().min(2).max(120),
  region: z.string().max(120).optional(),
  kind: z.enum(["domestic", "international"]),
  tagline: z.string().max(255).optional(),
  description: z.string().max(5000).optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
  featured: z.boolean().default(false),
});

const tourInput = z.object({
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers, and hyphens only"),
  title: z.string().min(3).max(220),
  destinationId: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().positive(),
  durationDays: z.coerce.number().int().min(1).max(90),
  durationNights: z.coerce.number().int().min(0).max(90),
  priceFrom: z.coerce.number().positive(),
  originalPrice: z.coerce.number().positive().optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  reviewCount: z.coerce.number().int().min(0).optional(),
  overview: z.string().min(20).max(5000),
  highlights: z.string().max(3000).optional(),
  inclusions: z.string().max(3000).optional(),
  exclusions: z.string().max(3000).optional(),
  imageUrl: z.string().url(),
  tags: z.string().max(500).optional(),
  availability: z.string().max(100).optional(),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  featured: z.boolean().default(false),
});

const quotationInput = z.object({
  enquiryId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  destination: z.string().min(2).max(160),
  travelDates: z.string().min(2).max(120),
  travellers: z.coerce.number().int().min(1).max(50),
  taxes: z.coerce.number().min(0).default(0),
  discount: z.coerce.number().min(0).default(0),
  notes: z.string().max(3000).optional(),
  validUntil: z.coerce.date().optional(),
  items: z.array(z.object({ description: z.string().min(2).max(255), quantity: z.coerce.number().int().min(1).max(100), unitPrice: z.coerce.number().positive() })).min(1).max(30),
});

const paymentInput = z.object({
  bookingId: z.coerce.number().int().positive().optional(),
  quotationId: z.coerce.number().int().positive().optional(),
  amount: z.coerce.number().positive(),
  method: z.enum(["upi", "bank_transfer", "card", "cash", "other"]),
  transactionReference: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
}).refine((input) => Boolean(input.bookingId || input.quotationId), { message: "Link the payment to a booking or quotation" });

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  content: router({
    home: publicProcedure.query(async () => {
      const [featuredTours, destinations, categories, blogs, testimonials, settings] = await Promise.all([
        listTours({ featured: true, limit: 6 }),
        listDestinations(),
        listCategories(),
        listBlogPosts(3),
        listTestimonials(),
        getSettings(),
      ]);
      return { featuredTours, destinations, categories, blogs, testimonials, settings };
    }),
    tours: publicProcedure.input(z.object({ search: z.string().optional(), kind: z.enum(["domestic", "international"]).optional(), category: z.string().optional() }).optional()).query(({ input }) => listTours(input ?? {})),
    tour: publicProcedure.input(z.object({ slug: z.string() })).query(({ input }) => getTourBySlug(input.slug)),
    destinations: publicProcedure.input(z.object({ kind: z.enum(["domestic", "international"]).optional() }).optional()).query(({ input }) => listDestinations(input?.kind)),
    categories: publicProcedure.query(() => listCategories()),
    blog: publicProcedure.query(() => listBlogPosts(12)),
  }),
  enquiries: router({
    create: publicProcedure.input(enquiryInput).mutation(async ({ ctx, input }) => createEnquiry({ ...input, userId: ctx.user?.id })),
    mine: protectedProcedure.query(({ ctx }) => listCustomerEnquiries(ctx.user.id)),
  }),
  callback: router({
    request: publicProcedure.input(callbackInput).mutation(({ ctx, input }) => createCallbackRequest({ ...input, userId: ctx.user?.id })),
  }),
  appointment: router({
    book: publicProcedure.input(appointmentInput).mutation(({ ctx, input }) => createAppointment({ ...input, userId: ctx.user?.id })),
  }),
  currency: router({
    config: publicProcedure.query(({ ctx }) => detectCurrency(ctx.req.headers as Record<string, unknown>)),
  }),
  customer: router({
    dashboard: protectedProcedure.query(async ({ ctx }) => {
      const [enquiries, bookings, quotations, payments, callbacks, appointments] = await Promise.all([listCustomerEnquiries(ctx.user.id), listCustomerBookings(ctx.user.id), listCustomerQuotations(ctx.user.id), listCustomerPayments(ctx.user.id), listCustomerCallbacks(ctx.user.id), listCustomerAppointments(ctx.user.id)]);
      return { enquiries, bookings, quotations, payments, callbacks, appointments, user: ctx.user };
    }),
    createCheckout: protectedProcedure.input(z.object({ quotationId: z.number().int().positive(), requestedCurrency: z.string().length(3).optional() })).mutation(({ ctx, input }) => createCustomerCheckout({ quotationId: input.quotationId, requestedCurrency: input.requestedCurrency, user: ctx.user, origin: ctx.req.headers.origin ?? `${ctx.req.protocol}://${ctx.req.get("host")}` })),
  }),
  ai: router({
    tripPlanner: publicProcedure.input(z.object({
      message: z.string().min(3).max(1200),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) })).max(10).optional(),
    })).mutation(async ({ input }) => {
      const [tours, destinations] = await Promise.all([listTours({ limit: 12 }), listDestinations()]);
      const catalogue = [
        "Destinations:",
        ...destinations.slice(0, 12).map((item) => `- ${item.name}, ${item.country}: ${item.tagline ?? ""}`),
        "Tours:",
        ...tours.slice(0, 12).map((item) => `- ${item.title} in ${item.destination}, ${item.country}; ${item.durationDays} days; from INR ${item.priceFrom}`),
      ].join("\n");
      const response = await invokeLLM({
        messages: [
          { role: "system", content: `You are AeroFly's warm, practical travel concierge for customers in India. Give concise, specific trip guidance using only the catalogue context below for named AeroFly packages. You may suggest a custom trip when no catalogue route fits. Ask one useful follow-up question when the request is vague. Do not invent live prices, availability, visa rules, or bookings. Keep answers under 180 words and format with short paragraphs or bullets.\n\n${catalogue}` },
          ...(input.history ?? []),
          { role: "user", content: input.message },
        ],
        max_tokens: 500,
      });
      const content = response.choices?.[0]?.message?.content;
      const reply = typeof content === "string" ? content : content?.filter((part) => part.type === "text").map((part) => part.text).join(" ") ?? "I’m sorry, I couldn’t shape that route just now. Try telling me your destination, dates, and travel style.";
      return { reply };
    }),
  }),
  admin: router({
    overview: permissionProcedure("overview").query(async () => {
      const [stats, enquiries] = await Promise.all([getAdminStats(), listAdminEnquiries()]);
      return { stats, enquiries };
    }),
    catalogue: router({
      list: permissionProcedure("catalogue").query(async () => {
        const [tours, destinations, categories] = await Promise.all([listAdminTours(), listAdminDestinations(), listCategories()]);
        return { tours, destinations, categories };
      }),
      createTour: permissionProcedure("catalogue").input(tourInput).mutation(({ input }) => createTourRecord(input)),
      updateTour: permissionProcedure("catalogue").input(tourInput.extend({ id: z.number().int().positive() })).mutation(({ input }) => updateTourRecord(input)),
      deleteTour: permissionProcedure("catalogue").input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => deleteTourRecord(input.id)),
      createDestination: permissionProcedure("catalogue").input(destinationInput).mutation(({ input }) => createDestinationRecord(input)),
      updateDestination: permissionProcedure("catalogue").input(destinationInput.extend({ id: z.number().int().positive() })).mutation(({ input }) => updateDestinationRecord(input)),
      deleteDestination: permissionProcedure("catalogue").input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => deleteDestinationRecord(input.id)),
    }),
    team: router({
      list: permissionProcedure("team").query(() => listTeamMembers()),
      updateRole: permissionProcedure("team").input(z.object({ id: z.number().int().positive(), role: z.enum(ASSIGNABLE_ROLES) })).mutation(({ ctx, input }) => {
        if (ctx.user.id === input.id && input.role !== "owner") throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot remove your own owner access" });
        return updateTeamMemberRole(input.id, input.role);
      }),
    }),
    sales: router({
      dashboard: permissionProcedure("quotes").query(async () => {
        const [quotations, bookings] = await Promise.all([listSalesQuotations(), listSalesBookings()]);
        return { quotations, bookings };
      }),
      createQuotation: permissionProcedure("quotes").input(quotationInput).mutation(({ ctx, input }) => createQuotation({ ...input, createdBy: ctx.user.id })),
      updateQuotationStatus: permissionProcedure("quotes").input(z.object({ id: z.number().int().positive(), status: z.enum(["draft", "sent", "viewed", "accepted", "rejected", "expired"]) })).mutation(({ input }) => updateQuotationStatus(input.id, input.status)),
      convertToBooking: permissionProcedure("bookings").input(z.object({ quotationId: z.number().int().positive() })).mutation(({ input }) => convertQuotationToBooking(input.quotationId)),
    }),
    finance: router({
      dashboard: permissionProcedure("finance").query(async () => {
        const [summary, payments, transactions] = await Promise.all([getFinanceSummary(), listFinancePayments(), listFinanceTransactions()]);
        return { summary, payments, transactions };
      }),
      monthlyStripeRevenue: permissionProcedure("finance").input(z.object({ year: z.number().int().min(2020).max(2200), month: z.number().int().min(1).max(12) })).query(({ input }) => getMonthlyStripeRevenue(input.year, input.month)),
      recordPayment: permissionProcedure("finance").input(paymentInput).mutation(({ ctx, input }) => recordPayment({ ...input, receivedBy: ctx.user.id })),
      refundPayment: permissionProcedure("finance").input(z.object({ paymentId: z.number().int().positive() })).mutation(({ input }) => refundCustomerPayment(input.paymentId)),
    }),
    support: router({
      dashboard: permissionProcedure("enquiries").query(async () => {
        const [callbacks, appointments] = await Promise.all([listSupportCallbacks(), listSupportAppointments()]);
        return { callbacks, appointments };
      }),
      updateCallback: permissionProcedure("enquiries").input(z.object({ id: z.number().int().positive(), status: z.enum(["requested", "scheduled", "completed", "cancelled"]), assignedTo: z.number().int().positive().optional(), notes: z.string().max(1000).optional() })).mutation(({ input }) => updateCallbackRequest(input)),
      updateAppointment: permissionProcedure("enquiries").input(z.object({ id: z.number().int().positive(), status: z.enum(["requested", "confirmed", "completed", "cancelled", "no_show"]), assignedTo: z.number().int().positive().optional(), meetingLink: z.string().url().optional().or(z.literal("")), notes: z.string().max(1000).optional() })).mutation(({ input }) => updateAppointment(input)),
    }),
  }),
});

export type AppRouter = typeof appRouter;
