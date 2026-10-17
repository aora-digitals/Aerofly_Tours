import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { ASSIGNABLE_ROLES, type WorkspacePermission } from "@shared/types";
import { hasDatabaseWorkspacePermission, hasDatabasePermission, hasGlobalDatabasePermission } from "./_core/workspaceAuthorization";
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
  listAdminDestinations,
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
  listDestinations,
  listTestimonials,
  listTours,
  listTeamMembers,
  convertQuotationToBooking,
  createQuotation,
  recordPayment,
  updateQuotationStatus,
  updateDestinationRecord,
  updateTourRecord,
} from "./db";
import { createCustomerCheckout, refundCustomerPayment } from "./stripe";
import {
  getPublicDestinationBySlug,
  getPublicHomepage,
  getPublicServiceBySlug,
  getPublicTourBySlug,
  listPublicCategories,
  listPublicDestinations,
  listPublicServices,
  listPublicTours,
  recordPublicTourView,
} from "./publicCatalog";
import { detectCurrency } from "./currency";
import { createCustomerAppointment, createCustomerCallback, createCustomerEnquiry } from "./customer";
import {
  addAppointmentNote, addCallbackNote, addEnquiryNote, assignCrmEnquiry, getCrmCustomer, getCrmDashboard, getCrmEnquiry, listCrmAppointments, listCrmCallbacks, listCrmCustomers, listCrmDepartments, listCrmEnquiries, listCrmStaff, updateCrmAppointment, updateCrmCallback, updateCrmEnquiry,
} from "./crm";
import {
  issueBookingOffer,
  listMyBookingOffers,
  listOfferDepartures,
  recordCrmEnquiry,
  respondToBookingOffer,
  reviewBookingCancellation,
} from "./bookingOffers";

const permissionProcedure = (permission: WorkspacePermission) => protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.supabaseAccessToken) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase-authenticated session is required." });
  }
  const allowed = await hasDatabaseWorkspacePermission(ctx.supabaseAccessToken, permission);
  if (!allowed) {
    throw new TRPCError({ code: "FORBIDDEN", message: `This action requires the database permission for ${permission}.` });
  }
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
    home: publicProcedure
  .input(
    z.object({
      language: z.enum(["en", "mr", "hi"]).optional(),
    }).optional(),
  )
  .query(async ({ input }) => {
      const [catalogue, blogs, testimonials, settings] = await Promise.all([
        getPublicHomepage(input?.language ?? "en"),
        listBlogPosts(3),
        listTestimonials(),
        getSettings(),
      ]);
      return { ...catalogue, blogs, testimonials, settings };
    }),
    tours: publicProcedure.input(z.object({
      search: z.string().optional(),
      kind: z.enum(["domestic", "international"]).optional(),
      category: z.string().optional(),
      destination: z.string().optional(),
      minPrice: z.number().nonnegative().optional(),
      maxPrice: z.number().nonnegative().optional(),
      minDuration: z.number().int().positive().optional(),
      maxDuration: z.number().int().positive().optional(),
      travelType: z.string().optional(),
      language: z.enum(["en", "mr", "hi"]).optional(),
      sort: z.enum(["featured", "newest", "price_asc", "price_desc", "duration", "rating", "popular", "most_enquired"]).optional(),
      page: z.number().int().positive().optional(),
      pageSize: z.number().int().min(1).max(48).optional(),
    }).optional()).query(({ input }) => listPublicTours(input ?? {})),
    tour: publicProcedure.input(z.object({ slug: z.string().min(1) })).query(({ input }) => getPublicTourBySlug(input.slug)),
    recordTourView: publicProcedure.input(z.object({ tourId: z.number().int().positive() })).mutation(({ input }) => recordPublicTourView(input.tourId)),
    destinations: publicProcedure.input(z.object({
      search: z.string().optional(),
      kind: z.enum(["domestic", "international"]).optional(),
      region: z.string().optional(),
      language: z.enum(["en", "mr", "hi"]).optional(),
      featured: z.boolean().optional(),
    }).optional()).query(({ input }) => listPublicDestinations(input ?? {})),
    destination: publicProcedure.input(z.object({ slug: z.string().min(1),language: z.enum(["en", "mr", "hi"]).optional() })).query(({ input }) => getPublicDestinationBySlug(input.slug,input.language ?? "en",)),
    categories: publicProcedure.query(() => listPublicCategories()),
    services: publicProcedure.query(() => listPublicServices()),
    service: publicProcedure.input(z.object({ slug: z.string().min(1) })).query(({ input }) => getPublicServiceBySlug(input.slug)),
    blog: publicProcedure.query(() => listBlogPosts(12)),
  }),
  enquiries: router({
    create: publicProcedure.input(enquiryInput).mutation(async ({ ctx, input }) => ctx.user ? createCustomerEnquiry(ctx.user, input, ctx.supabaseAccessToken ?? undefined) : createEnquiry(input)),
    mine: protectedProcedure.query(({ ctx }) => listCustomerEnquiries(ctx.user.id)),
  }),
  callback: router({
    request: publicProcedure.input(callbackInput).mutation(({ ctx, input }) => ctx.user ? createCustomerCallback(ctx.user, input, ctx.supabaseAccessToken ?? undefined) : createCallbackRequest(input)),
  }),
  appointment: router({
    book: publicProcedure.input(appointmentInput).mutation(({ ctx, input }) => ctx.user ? createCustomerAppointment(ctx.user, input, ctx.supabaseAccessToken ?? undefined) : createAppointment(input)),
  }),
  currency: router({
    config: publicProcedure.query(({ ctx }) => detectCurrency(ctx.req.headers as Record<string, unknown>)),
  }),
  customer: router({
    dashboard: protectedProcedure.query(async ({ ctx }) => {
      const [enquiries, bookings, quotations, payments, callbacks, appointments] = await Promise.all([listCustomerEnquiries(ctx.user.id), listCustomerBookings(ctx.user.id), listCustomerQuotations(ctx.user.id), listCustomerPayments(ctx.user.id), listCustomerCallbacks(ctx.user.id), listCustomerAppointments(ctx.user.id)]);
      return { enquiries, bookings, quotations, payments, callbacks, appointments, user: ctx.user };
    }),
createCheckout: protectedProcedure
  .input(
    z.object({
      quotationId: z.number().int().positive(),
      requestedCurrency: z.string().length(3).optional(),
    })
  )
  .mutation(({ ctx, input }) =>
    createCustomerCheckout({
      quotationId: input.quotationId,
      requestedCurrency: input.requestedCurrency,
      user: ctx.user as import("./db.ts").User,
      origin:
        ctx.req.headers.origin ??
        `${ctx.req.protocol}://${ctx.req.get("host")}`,
    })
  ),
  offers: protectedProcedure.query(({ ctx }) => {
  if (!ctx.supabaseAccessToken) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "A Supabase session is required.",
    });
  }

  return listMyBookingOffers(ctx.supabaseAccessToken);
}),

respondToOffer: protectedProcedure
  .input(z.object({
    quotationId: z.number().int().positive(),
    action: z.enum([
      "accept",
      "reject",
      "request_changes",
      "cancel",
    ]),
    message: z.string().max(2000).optional(),
  }))
  .mutation(({ ctx, input }) => {
    if (!ctx.supabaseAccessToken) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "A Supabase session is required.",
      });
    }

    return respondToBookingOffer(ctx.supabaseAccessToken, input);
  }),
  }),

crm: router({
    
recordEnquiry: permissionProcedure("crm")
  .input(z.object({
    name: z.string().min(2).max(160),
    email: z.string().email(),
    phone: z.string().min(7).max(40),
    destination: z.string().max(160).optional(),
    travelDates: z.string().max(160).optional(),
    travellers: z.number().int().min(1).max(100),
    budget: z.string().max(120).optional(),
    tripType: z.string().max(120).optional(),
    message: z.string().max(2000).optional(),
    source: z.enum([
      "phone",
      "office",
      "website",
      "callback",
      "appointment",
      "other",
    ]),
  }))
  .mutation(({ ctx, input }) => {
    if (!ctx.supabaseAccessToken) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "A Supabase session is required.",
      });
    }

    return recordCrmEnquiry(ctx.supabaseAccessToken, input);
  }),

  reviewCancellation: permissionProcedure("crm")
  .input(z.object({
    requestId: z.number().int().positive(),
    decision: z.enum(["approve", "reject"]),
    response: z.string().max(2000).optional(),
  }))
  .mutation(({ ctx, input }) => {
    if (!ctx.supabaseAccessToken) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "A Supabase session is required.",
      });
    }

    return reviewBookingCancellation(
      ctx.supabaseAccessToken,
      input,
    );
  }),

departures: permissionProcedure("quotes").query(({ ctx }) => {
  if (!ctx.supabaseAccessToken) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "A Supabase session is required.",
    });
  }

  return listOfferDepartures(ctx.supabaseAccessToken);
}),

    dashboard: permissionProcedure("crm").query(({ ctx }) => {
      if (!ctx.supabaseAccessToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase session is required." });
      return getCrmDashboard(ctx.supabaseAccessToken);
    }),
    enquiries: permissionProcedure("crm").input(z.object({
      page: z.number().int().positive().optional(),
      pageSize: z.number().int().min(10).max(50).optional(),
      search: z.string().max(80).optional(),
      status: z.enum(["new","assigned","contacted","follow_up","qualified","quotation","converted","confirmed","completed","lost","closed","cancelled"]).optional(),
      priority: z.enum(["low","normal","high"]).optional(),
      assignedEmployeeId: z.string().uuid().optional(),
      departmentId: z.string().uuid().optional(),
    }).optional()).query(({ ctx, input }) => {
      if (!ctx.supabaseAccessToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase session is required." });
      return listCrmEnquiries(ctx.supabaseAccessToken, input ?? {});
    }),
    enquiry: permissionProcedure("crm").input(z.object({ id: z.number().int().positive() })).query(({ ctx, input }) => {
      if (!ctx.supabaseAccessToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase session is required." });
      return getCrmEnquiry(ctx.supabaseAccessToken, input.id);
    }),
    updateEnquiry: permissionProcedure("crm").input(z.object({
      id: z.number().int().positive(),
      status: z.enum(["new","assigned","contacted","follow_up","qualified","quotation","converted","confirmed","completed","lost","closed","cancelled"]).optional(),
      priority: z.enum(["low","normal","high"]).optional(),
      source: z.string().max(80).optional(),
      followUpAt: z.string().datetime().nullable().optional(),
      destination: z.string().max(160).nullable().optional(),
      travelDates: z.string().max(160).nullable().optional(),
      travellers: z.number().int().min(1).max(100).optional(),
      budget: z.string().max(120).nullable().optional(),
      tripType: z.string().max(120).nullable().optional(),
    }).refine((value) => Object.keys(value).some((key) => key !== "id"), "Provide at least one field to update")).mutation(({ ctx, input }) => {
      if (!ctx.supabaseAccessToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase session is required." });
      return updateCrmEnquiry(ctx.supabaseAccessToken, input);
    }),
    assignEnquiry: permissionProcedure("crm").input(z.object({ enquiryId: z.number().int().positive(), employeeId: z.string().uuid(), departmentId: z.string().uuid() })).mutation(({ ctx, input }) => {
      if (!ctx.supabaseAccessToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase session is required." });
      return assignCrmEnquiry(ctx.supabaseAccessToken, input);
    }),
    addEnquiryNote: permissionProcedure("crm").input(z.object({ enquiryId: z.number().int().positive(), body: z.string().min(1).max(5000) })).mutation(({ ctx, input }) => {
      if (!ctx.supabaseAccessToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase session is required." });
      return addEnquiryNote(ctx.supabaseAccessToken, input.enquiryId, input.body);
    }),
    customers: permissionProcedure("crm").input(z.object({ page: z.number().int().positive().optional(), pageSize: z.number().int().min(10).max(50).optional(), search: z.string().max(80).optional() }).optional()).query(({ ctx, input }) => {
      if (!ctx.supabaseAccessToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase session is required." });
      return listCrmCustomers(ctx.supabaseAccessToken, input ?? {});
    }),
    customer: permissionProcedure("crm").input(z.object({ id: z.string().uuid() })).query(({ ctx, input }) => {
      if (!ctx.supabaseAccessToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase session is required." });
      return getCrmCustomer(ctx.supabaseAccessToken, input.id);
    }),
    addAppointmentNote: permissionProcedure("crm").input(z.object({ appointmentId: z.number().int().positive(), body: z.string().min(1).max(5000) })).mutation(({ ctx, input }) => {
      if (!ctx.supabaseAccessToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase session is required." });
      return addAppointmentNote(ctx.supabaseAccessToken, input.appointmentId, input.body);
    }),
    appointments: permissionProcedure("crm").input(z.object({ page: z.number().int().positive().optional(), pageSize: z.number().int().min(10).max(50).optional() }).optional()).query(({ ctx, input }) => {
      if (!ctx.supabaseAccessToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase session is required." });
      return listCrmAppointments(ctx.supabaseAccessToken, input?.page ?? 1, input?.pageSize ?? 20);
    }),
    updateAppointment: permissionProcedure("crm").input(z.object({ id: z.number().int().positive(), status: z.enum(["requested","confirmed","rescheduled","completed","cancelled","no_show"]).optional(), assignedEmployeeId: z.string().uuid().nullable().optional(), assignedDepartmentId: z.string().uuid().nullable().optional(), meetingLink: z.string().url().nullable().optional(), followUpAt: z.string().datetime().nullable().optional(), notes: z.string().max(5000).nullable().optional() })).mutation(({ ctx, input }) => {
      if (!ctx.supabaseAccessToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase session is required." });
      return updateCrmAppointment(ctx.supabaseAccessToken, input);
    }),
    addCallbackNote: permissionProcedure("crm").input(z.object({ callbackId: z.number().int().positive(), body: z.string().min(1).max(5000) })).mutation(({ ctx, input }) => {
      if (!ctx.supabaseAccessToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase session is required." });
      return addCallbackNote(ctx.supabaseAccessToken, input.callbackId, input.body);
    }),
    callbacks: permissionProcedure("crm").input(z.object({ page: z.number().int().positive().optional(), pageSize: z.number().int().min(10).max(50).optional() }).optional()).query(({ ctx, input }) => {
      if (!ctx.supabaseAccessToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase session is required." });
      return listCrmCallbacks(ctx.supabaseAccessToken, input?.page ?? 1, input?.pageSize ?? 20);
    }),
    updateCallback: permissionProcedure("crm").input(z.object({ id: z.number().int().positive(), status: z.enum(["requested","pending","assigned","in_progress","scheduled","completed","cancelled"]).optional(), priority: z.enum(["low","normal","high"]).optional(), assignedEmployeeId: z.string().uuid().nullable().optional(), assignedDepartmentId: z.string().uuid().nullable().optional(), notes: z.string().max(5000).nullable().optional() })).mutation(({ ctx, input }) => {
      if (!ctx.supabaseAccessToken) throw new TRPCError({ code: "UNAUTHORIZED", message: "A Supabase session is required." });
      return updateCrmCallback(ctx.supabaseAccessToken, input);
    }),
    staff: permissionProcedure("crm").query(() => listCrmStaff()),
    departments: permissionProcedure("crm").query(() => listCrmDepartments()),
    
issueOffer: permissionProcedure("quotes")
  .input(z.object({
    enquiryId: z.number().int().positive(),
    departureId: z.number().int().positive(),
    adults: z.number().int().min(1).max(100),
    children: z.number().int().min(0).max(100).default(0),
    infants: z.number().int().min(0).max(100).default(0),
    singleRooms: z.number().int().min(0).max(100).default(0),
    discount: z.number().min(0).default(0),
    additionalFees: z.number().min(0).default(0),
    taxRate: z.number().min(0).max(100).default(0),
    validUntil: z.string().datetime(),
    inclusions: z.array(z.string().max(255)).max(50).default([]),
    exclusions: z.array(z.string().max(255)).max(50).default([]),
    specialConditions: z.string().max(3000).optional(),
    paymentTerms: z.string().max(2000).optional(),
    cancellationTerms: z.string().max(3000).optional(),
    customerNotes: z.string().max(3000).optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    if (!ctx.supabaseAccessToken || !ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "A valid staff session is required." });
    }
    if (!(await hasDatabasePermission(ctx.supabaseAccessToken, ["bookings.manage"]))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Issuing a booking proposal requires bookings.manage." });
    }
    return issueBookingOffer(ctx.supabaseAccessToken, ctx.user.id, input);
  }),
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
    overview: permissionProcedure("overview").query(async ({ ctx }) => {
      if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["admin.dashboard.read"]))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Use the organization-scoped ERP dashboard for this role." });
      }
      const stats = await getAdminStats();
      if (!ctx.supabaseAccessToken || !(await hasDatabaseWorkspacePermission(ctx.supabaseAccessToken, "crm"))) {
        return { stats: { ...stats, enquiries: 0, newEnquiries: 0 }, enquiries: [] };
      }
      const pipeline = await listCrmEnquiries(ctx.supabaseAccessToken, { page: 1, pageSize: 8 });
      return {
        stats: { ...stats, enquiries: pipeline.total, newEnquiries: pipeline.items.filter((item: any) => item.status === "new").length },
        enquiries: pipeline.items,
      };
    }),
    catalogue: router({
      list: permissionProcedure("catalogue").query(async () => {
        const [tours, destinations, categories] = await Promise.all([listAdminTours(), listAdminDestinations(), listCategories()]);
        return { tours, destinations, categories };
      }),
      createTour: permissionProcedure("catalogue").input(tourInput).mutation(async ({ ctx, input }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["tours.manage"]))) throw new TRPCError({ code: "FORBIDDEN", message: "This legacy catalogue mutation is restricted to globally authorized administrators." });
        return createTourRecord(input);
      }),
      updateTour: permissionProcedure("catalogue").input(tourInput.extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["tours.manage"]))) throw new TRPCError({ code: "FORBIDDEN", message: "This legacy catalogue mutation is restricted to globally authorized administrators." });
        return updateTourRecord(input);
      }),
      deleteTour: permissionProcedure("catalogue").input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["tours.manage"]))) throw new TRPCError({ code: "FORBIDDEN", message: "This legacy catalogue mutation is restricted to globally authorized administrators." });
        return deleteTourRecord(input.id);
      }),
      createDestination: permissionProcedure("catalogue").input(destinationInput).mutation(async ({ ctx, input }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["tours.manage"]))) throw new TRPCError({ code: "FORBIDDEN", message: "This legacy catalogue mutation is restricted to globally authorized administrators." });
        return createDestinationRecord(input);
      }),
      updateDestination: permissionProcedure("catalogue").input(destinationInput.extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["tours.manage"]))) throw new TRPCError({ code: "FORBIDDEN", message: "This legacy catalogue mutation is restricted to globally authorized administrators." });
        return updateDestinationRecord(input);
      }),
      deleteDestination: permissionProcedure("catalogue").input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["tours.manage"]))) throw new TRPCError({ code: "FORBIDDEN", message: "This legacy catalogue mutation is restricted to globally authorized administrators." });
        return deleteDestinationRecord(input.id);
      }),
    }),
    team: router({
      list: permissionProcedure("team").query(async ({ ctx }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["employees.read"]))) throw new TRPCError({ code: "FORBIDDEN", message: "Use organization-scoped employee management for this role." });
        return listTeamMembers();
      }),
      updateRole: permissionProcedure("team").input(z.object({ id: z.number().int().positive(), role: z.enum(ASSIGNABLE_ROLES) })).mutation(async ({ ctx }) => {
        if (!(await hasDatabasePermission(ctx.supabaseAccessToken, ["roles.manage"]))) throw new TRPCError({ code: "FORBIDDEN", message: "Role assignment requires roles.manage." });
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Legacy role changes are disabled. Assign Supabase Auth roles through the audited admin-organization Edge Function." });
      }),
    }),
    sales: router({
      dashboard: permissionProcedure("quotes").query(async ({ ctx }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["bookings.read"]))) throw new TRPCError({ code: "FORBIDDEN", message: "Use the RLS-scoped Sales workspace for this role." });
        const [quotations, bookings] = await Promise.all([listSalesQuotations(), listSalesBookings()]);
        return { quotations, bookings };
      }),
      createQuotation: permissionProcedure("quotes").input(quotationInput).mutation(async ({ ctx, input }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["bookings.manage"]))) throw new TRPCError({ code: "FORBIDDEN", message: "Use the scoped staff-issued booking proposal flow for this role." });
        return createQuotation({ ...input, createdBy: ctx.user.id });
      }),
      updateQuotationStatus: permissionProcedure("quotes").input(z.object({ id: z.number().int().positive(), status: z.enum(["draft", "sent", "viewed", "accepted", "rejected", "expired"]) })).mutation(async ({ ctx, input }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["bookings.manage"]))) throw new TRPCError({ code: "FORBIDDEN", message: "Use the scoped staff-issued booking proposal flow for this role." });
        return updateQuotationStatus(input.id, input.status);
      }),
      convertToBooking: permissionProcedure("bookings").input(z.object({ quotationId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["bookings.manage"]))) throw new TRPCError({ code: "FORBIDDEN", message: "Use the scoped staff-issued booking proposal flow for this role." });
        return convertQuotationToBooking(input.quotationId);
      }),
    }),
    finance: router({
      dashboard: permissionProcedure("finance").query(async ({ ctx }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["finance.read"]))) throw new TRPCError({ code: "FORBIDDEN", message: "Use the RLS-scoped Finance workspace for this role." });
        const [summary, payments, transactions] = await Promise.all([getFinanceSummary(), listFinancePayments(), listFinanceTransactions()]);
        return { summary, payments, transactions };
      }),
      monthlyStripeRevenue: permissionProcedure("finance").input(z.object({ year: z.number().int().min(2020).max(2200), month: z.number().int().min(1).max(12) })).query(async ({ ctx, input }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["finance.read"]))) throw new TRPCError({ code: "FORBIDDEN", message: "Monthly global revenue is restricted to globally authorized finance administrators." });
        return getMonthlyStripeRevenue(input.year, input.month);
      }),
      recordPayment: permissionProcedure("finance").input(paymentInput).mutation(async ({ ctx, input }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["finance.manage"]))) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This legacy global payment write is disabled for organization-scoped staff. Use the audited Phase 6 payment workflow." });
        }
        return recordPayment({ ...input, receivedBy: ctx.user.id });
      }),
      refundPayment: permissionProcedure("finance").input(z.object({ paymentId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
        if (!(await hasGlobalDatabasePermission(ctx.supabaseAccessToken, ["refunds.manage"]))) {
          throw new TRPCError({ code: "FORBIDDEN", message: "This legacy global refund operation is disabled for organization-scoped staff. Use the audited Phase 6 refund workflow." });
        }
        return refundCustomerPayment(input.paymentId);
      }),
    }),
    support: router({
      dashboard: permissionProcedure("enquiries").query(async ({ ctx }) => {
        if (!ctx.supabaseAccessToken || !(await hasDatabaseWorkspacePermission(ctx.supabaseAccessToken, "crm"))) return { callbacks: [], appointments: [] };
        const [callbacks, appointments] = await Promise.all([listCrmCallbacks(ctx.supabaseAccessToken, 1, 100), listCrmAppointments(ctx.supabaseAccessToken, 1, 100)]);
        return { callbacks: callbacks.items, appointments: appointments.items };
      }),
      updateCallback: permissionProcedure("enquiries").input(z.object({ id: z.number().int().positive(), status: z.enum(["requested", "pending", "assigned", "in_progress", "scheduled", "completed", "cancelled"]), assignedTo: z.number().int().positive().optional(), notes: z.string().max(5000).optional() })).mutation(async ({ ctx, input }) => {
        if (!ctx.supabaseAccessToken || !(await hasDatabaseWorkspacePermission(ctx.supabaseAccessToken, "crm"))) throw new TRPCError({ code: "FORBIDDEN", message: "CRM access is required." });
        return updateCrmCallback(ctx.supabaseAccessToken, { id: input.id, status: input.status, notes: input.notes ?? null });
      }),
      updateAppointment: permissionProcedure("enquiries").input(z.object({ id: z.number().int().positive(), status: z.enum(["requested", "confirmed", "rescheduled", "completed", "cancelled", "no_show"]), assignedTo: z.number().int().positive().optional(), meetingLink: z.string().url().optional().or(z.literal("")), notes: z.string().max(5000).optional() })).mutation(async ({ ctx, input }) => {
        if (!ctx.supabaseAccessToken || !(await hasDatabaseWorkspacePermission(ctx.supabaseAccessToken, "crm"))) throw new TRPCError({ code: "FORBIDDEN", message: "CRM access is required." });
        return updateCrmAppointment(ctx.supabaseAccessToken, { id: input.id, status: input.status, meetingLink: input.meetingLink || null, notes: input.notes ?? null });
      }),
    }),
  }),
});

export type AppRouter = typeof appRouter;
