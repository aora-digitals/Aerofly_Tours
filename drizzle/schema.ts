import {
  boolean,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  stripeCustomerId: varchar("stripeCustomerId", { length: 120 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "owner", "manager", "marketing", "customer_care", "staff", "counsellor", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const destinations = mysqlTable("destinations", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 160 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  country: varchar("country", { length: 120 }).notNull(),
  region: varchar("region", { length: 120 }),
  kind: mysqlEnum("kind", ["domestic", "international"]).notNull(),
  tagline: varchar("tagline", { length: 255 }),
  description: text("description"),
  imageUrl: text("imageUrl"),
  featured: boolean("featured").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  kindIdx: index("destinations_kind_idx").on(table.kind),
  featuredIdx: index("destinations_featured_idx").on(table.featured),
}));

export const tourCategories = mysqlTable("tour_categories", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  imageUrl: text("imageUrl"),
  accent: varchar("accent", { length: 30 }).default("orange"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const tours = mysqlTable("tours", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 180 }).notNull().unique(),
  title: varchar("title", { length: 220 }).notNull(),
  destinationId: int("destinationId").notNull().references(() => destinations.id),
  categoryId: int("categoryId").notNull().references(() => tourCategories.id),
  durationDays: int("durationDays").notNull(),
  durationNights: int("durationNights").notNull(),
  priceFrom: decimal("priceFrom", { precision: 12, scale: 2 }).notNull(),
  originalPrice: decimal("originalPrice", { precision: 12, scale: 2 }),
  rating: decimal("rating", { precision: 3, scale: 1 }).default("4.8").notNull(),
  reviewCount: int("reviewCount").default(0).notNull(),
  overview: text("overview").notNull(),
  highlights: text("highlights"),
  inclusions: text("inclusions"),
  exclusions: text("exclusions"),
  imageUrl: text("imageUrl").notNull(),
  galleryUrls: text("galleryUrls"),
  tags: varchar("tags", { length: 500 }),
  availability: varchar("availability", { length: 100 }).default("On request").notNull(),
  status: mysqlEnum("status", ["draft", "published", "archived"]).default("published").notNull(),
  featured: boolean("featured").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  destinationIdx: index("tours_destination_idx").on(table.destinationId),
  categoryIdx: index("tours_category_idx").on(table.categoryId),
  statusIdx: index("tours_status_idx").on(table.status),
  featuredIdx: index("tours_featured_idx").on(table.featured),
}));

export const tourItineraries = mysqlTable("tour_itineraries", {
  id: int("id").autoincrement().primaryKey(),
  tourId: int("tourId").notNull().references(() => tours.id),
  dayNumber: int("dayNumber").notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  description: text("description").notNull(),
  meals: varchar("meals", { length: 160 }),
  stay: varchar("stay", { length: 160 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ tourIdx: index("itinerary_tour_idx").on(table.tourId) }));

export const enquiries = mysqlTable("enquiries", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 32 }).notNull().unique(),
  userId: int("userId").references(() => users.id),
  tourId: int("tourId").references(() => tours.id),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  destination: varchar("destination", { length: 160 }),
  travelDates: varchar("travelDates", { length: 120 }),
  travellers: int("travellers").default(2).notNull(),
  budget: varchar("budget", { length: 80 }),
  tripType: varchar("tripType", { length: 80 }),
  message: text("message"),
  status: mysqlEnum("status", ["new", "contacted", "quotation", "confirmed", "completed", "cancelled"]).default("new").notNull(),
  priority: mysqlEnum("priority", ["low", "normal", "high"]).default("normal").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  statusIdx: index("enquiries_status_idx").on(table.status),
  createdIdx: index("enquiries_created_idx").on(table.createdAt),
}));

export const travelApplications = mysqlTable("travel_applications", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 32 }).notNull().unique(),
  userId: int("userId").references(() => users.id),
  assignedTo: int("assignedTo").references(() => users.id),
  type: mysqlEnum("type", ["visa", "passport"]).notNull(),
  serviceType: varchar("serviceType", { length: 120 }).notNull(),
  applicantName: varchar("applicantName", { length: 160 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  nationality: varchar("nationality", { length: 120 }).notNull(),
  destinationCountry: varchar("destinationCountry", { length: 120 }),
  travelDate: varchar("travelDate", { length: 40 }),
  urgency: mysqlEnum("urgency", ["standard", "urgent"]).default("standard").notNull(),
  status: mysqlEnum("status", ["draft", "submitted", "under_review", "action_required", "approved", "rejected", "completed", "cancelled"]).default("submitted").notNull(),
  customerNotes: text("customerNotes"),
  internalNotes: text("internalNotes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ userIdx: index("travel_applications_user_idx").on(table.userId), statusIdx: index("travel_applications_status_idx").on(table.status), typeIdx: index("travel_applications_type_idx").on(table.type) }));

export const applicationChecklistItems = mysqlTable("application_checklist_items", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("applicationId").notNull().references(() => travelApplications.id),
  itemKey: varchar("itemKey", { length: 100 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  required: boolean("required").default(true).notNull(),
  status: mysqlEnum("status", ["pending", "received", "approved", "rejected", "not_applicable"]).default("pending").notNull(),
  notes: text("notes"),
}, (table) => ({ applicationIdx: index("application_checklist_application_idx").on(table.applicationId) }));

export const applicationDocuments = mysqlTable("application_documents", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("applicationId").notNull().references(() => travelApplications.id),
  userId: int("userId").references(() => users.id),
  checklistItemId: int("checklistItemId").references(() => applicationChecklistItems.id),
  documentType: varchar("documentType", { length: 120 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  fileUrl: varchar("fileUrl", { length: 700 }).notNull(),
  mimeType: varchar("mimeType", { length: 120 }).notNull(),
  sizeBytes: int("sizeBytes").notNull(),
  status: mysqlEnum("status", ["uploaded", "under_review", "approved", "rejected"]).default("uploaded").notNull(),
  reviewerNotes: text("reviewerNotes"),
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt"),
}, (table) => ({ applicationIdx: index("application_documents_application_idx").on(table.applicationId), statusIdx: index("application_documents_status_idx").on(table.status) }));

export const applicationEvents = mysqlTable("application_events", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("applicationId").notNull().references(() => travelApplications.id),
  actorId: int("actorId").references(() => users.id),
  fromStatus: varchar("fromStatus", { length: 40 }),
  toStatus: varchar("toStatus", { length: 40 }).notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ applicationIdx: index("application_events_application_idx").on(table.applicationId) }));

export const callbackRequests = mysqlTable("callback_requests", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 32 }).notNull().unique(),
  userId: int("userId").references(() => users.id),
  enquiryId: int("enquiryId").references(() => enquiries.id),
  assignedTo: int("assignedTo").references(() => users.id),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  preferredAt: timestamp("preferredAt"),
  reason: varchar("reason", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["requested", "scheduled", "completed", "cancelled"]).default("requested").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ statusIdx: index("callback_requests_status_idx").on(table.status), createdIdx: index("callback_requests_created_idx").on(table.createdAt) }));

export const appointments = mysqlTable("appointments", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 32 }).notNull().unique(),
  userId: int("userId").references(() => users.id),
  enquiryId: int("enquiryId").references(() => enquiries.id),
  assignedTo: int("assignedTo").references(() => users.id),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  appointmentAt: timestamp("appointmentAt").notNull(),
  durationMinutes: int("durationMinutes").default(30).notNull(),
  mode: mysqlEnum("mode", ["phone", "video", "office"]).default("phone").notNull(),
  purpose: varchar("purpose", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["requested", "confirmed", "completed", "cancelled", "no_show"]).default("requested").notNull(),
  meetingLink: varchar("meetingLink", { length: 500 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ statusIdx: index("appointments_status_idx").on(table.status), appointmentAtIdx: index("appointments_at_idx").on(table.appointmentAt) }));

export const bookings = mysqlTable("bookings", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 32 }).notNull().unique(),
  userId: int("userId").references(() => users.id),
  tourId: int("tourId").references(() => tours.id),
  destination: varchar("destination", { length: 160 }).notNull(),
  travelDates: varchar("travelDates", { length: 120 }).notNull(),
  travellers: int("travellers").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  bookingStatus: mysqlEnum("bookingStatus", ["pending", "confirmed", "in_progress", "completed", "cancelled"]).default("pending").notNull(),
  paymentStatus: mysqlEnum("paymentStatus", ["pending", "initiated", "successful", "failed", "refunded"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const quotations = mysqlTable("quotations", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 32 }).notNull().unique(),
  enquiryId: int("enquiryId").references(() => enquiries.id),
  customerId: int("customerId").references(() => users.id),
  createdBy: int("createdBy").notNull().references(() => users.id),
  bookingId: int("bookingId").references(() => bookings.id),
  destination: varchar("destination", { length: 160 }).notNull(),
  travelDates: varchar("travelDates", { length: 120 }).notNull(),
  travellers: int("travellers").notNull(),
  subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
  taxes: decimal("taxes", { precision: 12, scale: 2 }).default("0").notNull(),
  discount: decimal("discount", { precision: 12, scale: 2 }).default("0").notNull(),
  total: decimal("total", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("INR").notNull(),
  status: mysqlEnum("status", ["draft", "sent", "viewed", "accepted", "rejected", "expired"]).default("draft").notNull(),
  notes: text("notes"),
  validUntil: timestamp("validUntil"),
  sentAt: timestamp("sentAt"),
  acceptedAt: timestamp("acceptedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ statusIdx: index("quotations_status_idx").on(table.status), enquiryIdx: index("quotations_enquiry_idx").on(table.enquiryId), createdIdx: index("quotations_created_idx").on(table.createdAt) }));

export const quotationItems = mysqlTable("quotation_items", {
  id: int("id").autoincrement().primaryKey(),
  quotationId: int("quotationId").notNull().references(() => quotations.id),
  description: varchar("description", { length: 255 }).notNull(),
  quantity: int("quantity").default(1).notNull(),
  unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
  lineTotal: decimal("lineTotal", { precision: 12, scale: 2 }).notNull(),
}, (table) => ({ quotationIdx: index("quotation_items_quote_idx").on(table.quotationId) }));

export const payments = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  reference: varchar("reference", { length: 32 }).notNull().unique(),
  bookingId: int("bookingId").references(() => bookings.id),
  quotationId: int("quotationId").references(() => quotations.id),
  receivedBy: int("receivedBy").notNull().references(() => users.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  settlementCurrency: varchar("settlementCurrency", { length: 3 }).default("INR").notNull(),
  method: mysqlEnum("method", ["upi", "bank_transfer", "card", "cash", "other"]).notNull(),
  status: mysqlEnum("status", ["pending", "successful", "failed", "refunded"]).default("successful").notNull(),
  transactionReference: varchar("transactionReference", { length: 120 }),
  stripeCheckoutSessionId: varchar("stripeCheckoutSessionId", { length: 120 }).unique(),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 120 }).unique(),
  notes: text("notes"),
  paidAt: timestamp("paidAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ bookingIdx: index("payments_booking_idx").on(table.bookingId), statusIdx: index("payments_status_idx").on(table.status) }));

export const financeTransactions = mysqlTable("finance_transactions", {
  id: int("id").autoincrement().primaryKey(),
  paymentId: int("paymentId").references(() => payments.id),
  recordedBy: int("recordedBy").notNull().references(() => users.id),
  type: mysqlEnum("type", ["income", "refund", "adjustment"]).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  description: varchar("description", { length: 255 }).notNull(),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const blogPosts = mysqlTable("blog_posts", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 180 }).notNull().unique(),
  title: varchar("title", { length: 220 }).notNull(),
  excerpt: text("excerpt").notNull(),
  content: text("content").notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  imageUrl: text("imageUrl").notNull(),
  author: varchar("author", { length: 120 }).default("AeroFly Editorial"),
  status: mysqlEnum("status", ["draft", "published"]).default("published").notNull(),
  publishedAt: timestamp("publishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const testimonials = mysqlTable("testimonials", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  destination: varchar("destination", { length: 120 }).notNull(),
  quote: text("quote").notNull(),
  rating: int("rating").default(5).notNull(),
  verified: boolean("verified").default(false).notNull(),
  published: boolean("published").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  settingKey: varchar("settingKey", { length: 120 }).notNull().unique(),
  settingValue: text("settingValue").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Destination = typeof destinations.$inferSelect;
export type Tour = typeof tours.$inferSelect;
export type TourCategory = typeof tourCategories.$inferSelect;
export type Enquiry = typeof enquiries.$inferSelect;
export type TravelApplication = typeof travelApplications.$inferSelect;
export type ApplicationChecklistItem = typeof applicationChecklistItems.$inferSelect;
export type ApplicationDocument = typeof applicationDocuments.$inferSelect;
export type ApplicationEvent = typeof applicationEvents.$inferSelect;
export type CallbackRequest = typeof callbackRequests.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Quotation = typeof quotations.$inferSelect;
export type QuotationItem = typeof quotationItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type FinanceTransaction = typeof financeTransactions.$inferSelect;
