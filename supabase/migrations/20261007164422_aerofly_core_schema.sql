-- ============================================================
-- AeroFly Tours
-- Drizzle-compatible application schema
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

DO $$
BEGIN
  CREATE TYPE public.user_role AS ENUM (
    'user',
    'owner',
    'manager',
    'marketing',
    'customer_care',
    'staff',
    'counsellor',
    'admin'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.destination_kind AS ENUM (
    'domestic',
    'international'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.tour_status AS ENUM (
    'draft',
    'published',
    'archived'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.enquiry_status AS ENUM (
    'new',
    'contacted',
    'quotation',
    'confirmed',
    'completed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.enquiry_priority AS ENUM (
    'low',
    'normal',
    'high'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.travel_application_type AS ENUM (
    'visa',
    'passport'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.travel_application_urgency AS ENUM (
    'standard',
    'urgent'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.travel_application_status AS ENUM (
    'draft',
    'submitted',
    'under_review',
    'action_required',
    'approved',
    'rejected',
    'completed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.checklist_status AS ENUM (
    'pending',
    'received',
    'approved',
    'rejected',
    'not_applicable'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.document_status AS ENUM (
    'uploaded',
    'under_review',
    'approved',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.callback_status AS ENUM (
    'requested',
    'scheduled',
    'completed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.appointment_mode AS ENUM (
    'phone',
    'video',
    'office'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.appointment_status AS ENUM (
    'requested',
    'confirmed',
    'completed',
    'cancelled',
    'no_show'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.booking_status AS ENUM (
    'pending',
    'confirmed',
    'in_progress',
    'completed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.payment_status AS ENUM (
    'pending',
    'initiated',
    'successful',
    'failed',
    'refunded'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.quotation_status AS ENUM (
    'draft',
    'sent',
    'viewed',
    'accepted',
    'rejected',
    'expired'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.payment_method AS ENUM (
    'upi',
    'bank_transfer',
    'card',
    'cash',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.finance_transaction_type AS ENUM (
    'income',
    'refund',
    'adjustment'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.blog_status AS ENUM (
    'draft',
    'published'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  "openId" varchar(64) NOT NULL UNIQUE,

  name text,

  email varchar(320),

  "stripeCustomerId" varchar(120),

  "loginMethod" varchar(64),

  role public.user_role NOT NULL DEFAULT 'user',

  "createdAt" timestamp NOT NULL DEFAULT now(),

  "updatedAt" timestamp NOT NULL DEFAULT now(),

  "lastSignedIn" timestamp
);


-- ============================================================
-- DESTINATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.destinations (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  slug varchar(160) NOT NULL UNIQUE,

  name varchar(160) NOT NULL,

  country varchar(160) NOT NULL,

  region varchar(160),

  kind public.destination_kind NOT NULL,

  tagline text,

  description text,

  "imageUrl" text,

  featured boolean NOT NULL DEFAULT false,

  "createdAt" timestamp NOT NULL DEFAULT now(),

  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS destinations_kind_idx
  ON public.destinations(kind);

CREATE INDEX IF NOT EXISTS destinations_featured_idx
  ON public.destinations(featured);


-- ============================================================
-- TOUR CATEGORIES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tour_categories (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  slug varchar(160) NOT NULL UNIQUE,

  name varchar(160) NOT NULL,

  description text,

  "imageUrl" text,

  accent varchar(32) DEFAULT 'orange',

  "createdAt" timestamp NOT NULL DEFAULT now()
);


-- ============================================================
-- TOURS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tours (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  slug varchar(180) NOT NULL UNIQUE,

  title varchar(255) NOT NULL,

  "destinationId" integer NOT NULL,

  "categoryId" integer NOT NULL,

  "durationDays" integer NOT NULL,

  "durationNights" integer NOT NULL,

  "priceFrom" numeric(12,2) NOT NULL,

  "originalPrice" numeric(12,2),

  rating numeric(3,1) NOT NULL DEFAULT 4.8,

  "reviewCount" integer NOT NULL DEFAULT 0,

  overview text,

  highlights text[],

  inclusions text[],

  exclusions text[],

  "imageUrl" text,

  "galleryUrls" text[],

  tags text[],

  availability text NOT NULL DEFAULT 'On request',

  status public.tour_status NOT NULL DEFAULT 'published',

  featured boolean NOT NULL DEFAULT false,

  "createdAt" timestamp NOT NULL DEFAULT now(),

  "updatedAt" timestamp NOT NULL DEFAULT now(),

  CONSTRAINT tours_destination_fk
    FOREIGN KEY ("destinationId")
    REFERENCES public.destinations(id),

  CONSTRAINT tours_category_fk
    FOREIGN KEY ("categoryId")
    REFERENCES public.tour_categories(id)
);

CREATE INDEX IF NOT EXISTS tours_destination_idx
  ON public.tours("destinationId");

CREATE INDEX IF NOT EXISTS tours_category_idx
  ON public.tours("categoryId");

CREATE INDEX IF NOT EXISTS tours_status_idx
  ON public.tours(status);

CREATE INDEX IF NOT EXISTS tours_featured_idx
  ON public.tours(featured);


-- ============================================================
-- TOUR ITINERARIES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tour_itineraries (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  "tourId" integer NOT NULL,

  "dayNumber" integer NOT NULL,

  title varchar(255) NOT NULL,

  description text,

  meals text,

  stay text,

  "createdAt" timestamp NOT NULL DEFAULT now(),

  CONSTRAINT tour_itineraries_tour_fk
    FOREIGN KEY ("tourId")
    REFERENCES public.tours(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS tour_itineraries_tour_idx
  ON public.tour_itineraries("tourId");


-- ============================================================
-- ENQUIRIES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.enquiries (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  reference varchar(64) NOT NULL UNIQUE,

  "userId" integer,

  "tourId" integer,

  name varchar(160) NOT NULL,

  email varchar(320),

  phone varchar(40),

  destination varchar(160),

  "travelDates" varchar(160),

  travellers integer NOT NULL DEFAULT 2,

  budget varchar(120),

  "tripType" varchar(120),

  message text,

  status public.enquiry_status NOT NULL DEFAULT 'new',

  priority public.enquiry_priority NOT NULL DEFAULT 'normal',

  "createdAt" timestamp NOT NULL DEFAULT now(),

  "updatedAt" timestamp NOT NULL DEFAULT now(),

  CONSTRAINT enquiries_user_fk
    FOREIGN KEY ("userId")
    REFERENCES public.users(id)
    ON DELETE SET NULL,

  CONSTRAINT enquiries_tour_fk
    FOREIGN KEY ("tourId")
    REFERENCES public.tours(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS enquiries_status_idx
  ON public.enquiries(status);

CREATE INDEX IF NOT EXISTS enquiries_created_at_idx
  ON public.enquiries("createdAt");


-- ============================================================
-- TRAVEL APPLICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.travel_applications (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  reference varchar(64) NOT NULL UNIQUE,

  "userId" integer,

  "assignedTo" integer,

  type public.travel_application_type NOT NULL,

  "serviceType" varchar(160),

  "applicantName" varchar(160) NOT NULL,

  email varchar(320),

  phone varchar(40),

  nationality varchar(120),

  "destinationCountry" varchar(160),

  "travelDate" varchar(120),

  urgency public.travel_application_urgency NOT NULL DEFAULT 'standard',

  status public.travel_application_status NOT NULL DEFAULT 'submitted',

  "customerNotes" text,

  "internalNotes" text,

  "createdAt" timestamp NOT NULL DEFAULT now(),

  "updatedAt" timestamp NOT NULL DEFAULT now(),

  CONSTRAINT travel_applications_user_fk
    FOREIGN KEY ("userId")
    REFERENCES public.users(id)
    ON DELETE SET NULL,

  CONSTRAINT travel_applications_assigned_fk
    FOREIGN KEY ("assignedTo")
    REFERENCES public.users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS travel_applications_user_idx
  ON public.travel_applications("userId");

CREATE INDEX IF NOT EXISTS travel_applications_status_idx
  ON public.travel_applications(status);

CREATE INDEX IF NOT EXISTS travel_applications_type_idx
  ON public.travel_applications(type);


-- ============================================================
-- APPLICATION CHECKLIST ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.application_checklist_items (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  "applicationId" integer NOT NULL,

  "itemKey" varchar(120) NOT NULL,

  label varchar(255) NOT NULL,

  required boolean NOT NULL DEFAULT true,

  status public.checklist_status NOT NULL DEFAULT 'pending',

  notes text,

  CONSTRAINT checklist_application_fk
    FOREIGN KEY ("applicationId")
    REFERENCES public.travel_applications(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS application_checklist_application_idx
  ON public.application_checklist_items("applicationId");


-- ============================================================
-- APPLICATION DOCUMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.application_documents (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  "applicationId" integer NOT NULL,

  "userId" integer,

  "checklistItemId" integer,

  "documentType" varchar(120) NOT NULL,

  "fileName" varchar(255) NOT NULL,

  "fileKey" text NOT NULL,

  "fileUrl" text,

  "mimeType" varchar(160),

  "sizeBytes" integer,

  status public.document_status NOT NULL DEFAULT 'uploaded',

  "reviewerNotes" text,

  "uploadedAt" timestamp NOT NULL DEFAULT now(),

  "reviewedAt" timestamp,

  CONSTRAINT application_documents_application_fk
    FOREIGN KEY ("applicationId")
    REFERENCES public.travel_applications(id)
    ON DELETE CASCADE,

  CONSTRAINT application_documents_user_fk
    FOREIGN KEY ("userId")
    REFERENCES public.users(id)
    ON DELETE SET NULL,

  CONSTRAINT application_documents_checklist_fk
    FOREIGN KEY ("checklistItemId")
    REFERENCES public.application_checklist_items(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS application_documents_application_idx
  ON public.application_documents("applicationId");

CREATE INDEX IF NOT EXISTS application_documents_status_idx
  ON public.application_documents(status);


-- ============================================================
-- APPLICATION EVENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.application_events (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  "applicationId" integer NOT NULL,

  "actorId" integer,

  "fromStatus" text,

  "toStatus" text,

  note text,

  "createdAt" timestamp NOT NULL DEFAULT now(),

  CONSTRAINT application_events_application_fk
    FOREIGN KEY ("applicationId")
    REFERENCES public.travel_applications(id)
    ON DELETE CASCADE,

  CONSTRAINT application_events_actor_fk
    FOREIGN KEY ("actorId")
    REFERENCES public.users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS application_events_application_idx
  ON public.application_events("applicationId");


-- ============================================================
-- CALLBACK REQUESTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.callback_requests (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  reference varchar(64) NOT NULL UNIQUE,

  "userId" integer,

  "enquiryId" integer,

  "assignedTo" integer,

  name varchar(160) NOT NULL,

  email varchar(320),

  phone varchar(40),

  "preferredAt" timestamp,

  reason text,

  status public.callback_status NOT NULL DEFAULT 'requested',

  notes text,

  "createdAt" timestamp NOT NULL DEFAULT now(),

  "updatedAt" timestamp NOT NULL DEFAULT now(),

  CONSTRAINT callback_user_fk
    FOREIGN KEY ("userId")
    REFERENCES public.users(id)
    ON DELETE SET NULL,

  CONSTRAINT callback_enquiry_fk
    FOREIGN KEY ("enquiryId")
    REFERENCES public.enquiries(id)
    ON DELETE SET NULL,

  CONSTRAINT callback_assigned_fk
    FOREIGN KEY ("assignedTo")
    REFERENCES public.users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS callback_requests_status_idx
  ON public.callback_requests(status);

CREATE INDEX IF NOT EXISTS callback_requests_created_idx
  ON public.callback_requests("createdAt");


-- ============================================================
-- APPOINTMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.appointments (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  reference varchar(64) NOT NULL UNIQUE,

  "userId" integer,

  "enquiryId" integer,

  "assignedTo" integer,

  name varchar(160) NOT NULL,

  email varchar(320),

  phone varchar(40),

  "appointmentAt" timestamp NOT NULL,

  "durationMinutes" integer NOT NULL DEFAULT 30,

  mode public.appointment_mode NOT NULL DEFAULT 'phone',

  purpose text,

  status public.appointment_status NOT NULL DEFAULT 'requested',

  "meetingLink" text,

  notes text,

  "createdAt" timestamp NOT NULL DEFAULT now(),

  "updatedAt" timestamp NOT NULL DEFAULT now(),

  CONSTRAINT appointments_user_fk
    FOREIGN KEY ("userId")
    REFERENCES public.users(id)
    ON DELETE SET NULL,

  CONSTRAINT appointments_enquiry_fk
    FOREIGN KEY ("enquiryId")
    REFERENCES public.enquiries(id)
    ON DELETE SET NULL,

  CONSTRAINT appointments_assigned_fk
    FOREIGN KEY ("assignedTo")
    REFERENCES public.users(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS appointments_status_idx
  ON public.appointments(status);

CREATE INDEX IF NOT EXISTS appointments_at_idx
  ON public.appointments("appointmentAt");


-- ============================================================
-- BOOKINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bookings (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  reference varchar(64) NOT NULL UNIQUE,

  "userId" integer,

  "tourId" integer,

  destination varchar(160),

  "travelDates" varchar(160),

  travellers integer NOT NULL DEFAULT 1,

  amount numeric(12,2) NOT NULL,

  "bookingStatus" public.booking_status NOT NULL DEFAULT 'pending',

  "paymentStatus" public.payment_status NOT NULL DEFAULT 'pending',

  "createdAt" timestamp NOT NULL DEFAULT now(),

  "updatedAt" timestamp NOT NULL DEFAULT now(),

  CONSTRAINT bookings_user_fk
    FOREIGN KEY ("userId")
    REFERENCES public.users(id)
    ON DELETE SET NULL,

  CONSTRAINT bookings_tour_fk
    FOREIGN KEY ("tourId")
    REFERENCES public.tours(id)
    ON DELETE SET NULL
);


-- ============================================================
-- QUOTATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.quotations (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  reference varchar(64) NOT NULL UNIQUE,

  "enquiryId" integer,

  "customerId" integer,

  "createdBy" integer NOT NULL,

  "bookingId" integer,

  destination varchar(160),

  "travelDates" varchar(160),

  travellers integer NOT NULL DEFAULT 1,

  subtotal numeric(12,2) NOT NULL DEFAULT 0,

  taxes numeric(12,2) NOT NULL DEFAULT 0,

  discount numeric(12,2) NOT NULL DEFAULT 0,

  total numeric(12,2) NOT NULL DEFAULT 0,

  currency varchar(3) NOT NULL DEFAULT 'INR',

  status public.quotation_status NOT NULL DEFAULT 'draft',

  notes text,

  "validUntil" timestamp,

  "sentAt" timestamp,

  "acceptedAt" timestamp,

  "createdAt" timestamp NOT NULL DEFAULT now(),

  "updatedAt" timestamp NOT NULL DEFAULT now(),

  CONSTRAINT quotations_enquiry_fk
    FOREIGN KEY ("enquiryId")
    REFERENCES public.enquiries(id)
    ON DELETE SET NULL,

  CONSTRAINT quotations_customer_fk
    FOREIGN KEY ("customerId")
    REFERENCES public.users(id)
    ON DELETE SET NULL,

  CONSTRAINT quotations_created_by_fk
    FOREIGN KEY ("createdBy")
    REFERENCES public.users(id),

  CONSTRAINT quotations_booking_fk
    FOREIGN KEY ("bookingId")
    REFERENCES public.bookings(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS quotations_status_idx
  ON public.quotations(status);

CREATE INDEX IF NOT EXISTS quotations_enquiry_idx
  ON public.quotations("enquiryId");

CREATE INDEX IF NOT EXISTS quotations_created_idx
  ON public.quotations("createdAt");


-- ============================================================
-- QUOTATION ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.quotation_items (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  "quotationId" integer NOT NULL,

  description text NOT NULL,

  quantity integer NOT NULL DEFAULT 1,

  "unitPrice" numeric(12,2) NOT NULL DEFAULT 0,

  "lineTotal" numeric(12,2) NOT NULL DEFAULT 0,

  CONSTRAINT quotation_items_quotation_fk
    FOREIGN KEY ("quotationId")
    REFERENCES public.quotations(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS quotation_items_quotation_idx
  ON public.quotation_items("quotationId");


-- ============================================================
-- PAYMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payments (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  reference varchar(64) NOT NULL UNIQUE,

  "bookingId" integer,

  "quotationId" integer,

  "receivedBy" integer NOT NULL,

  amount numeric(12,2) NOT NULL,

  "settlementCurrency" varchar(3) NOT NULL DEFAULT 'INR',

  method public.payment_method NOT NULL,

  status public.payment_status NOT NULL DEFAULT 'successful',

  "transactionReference" text,

  "stripeCheckoutSessionId" varchar(255) UNIQUE,

  "stripePaymentIntentId" varchar(255) UNIQUE,

  notes text,

  "paidAt" timestamp NOT NULL DEFAULT now(),

  "createdAt" timestamp NOT NULL DEFAULT now(),

  CONSTRAINT payments_booking_fk
    FOREIGN KEY ("bookingId")
    REFERENCES public.bookings(id)
    ON DELETE SET NULL,

  CONSTRAINT payments_quotation_fk
    FOREIGN KEY ("quotationId")
    REFERENCES public.quotations(id)
    ON DELETE SET NULL,

  CONSTRAINT payments_received_by_fk
    FOREIGN KEY ("receivedBy")
    REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS payments_booking_idx
  ON public.payments("bookingId");

CREATE INDEX IF NOT EXISTS payments_status_idx
  ON public.payments(status);


-- ============================================================
-- FINANCE TRANSACTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.finance_transactions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  "paymentId" integer,

  "recordedBy" integer NOT NULL,

  type public.finance_transaction_type NOT NULL,

  amount numeric(12,2) NOT NULL,

  description text,

  "occurredAt" timestamp NOT NULL DEFAULT now(),

  "createdAt" timestamp NOT NULL DEFAULT now(),

  CONSTRAINT finance_payment_fk
    FOREIGN KEY ("paymentId")
    REFERENCES public.payments(id)
    ON DELETE SET NULL,

  CONSTRAINT finance_recorded_by_fk
    FOREIGN KEY ("recordedBy")
    REFERENCES public.users(id)
);


-- ============================================================
-- BLOG POSTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.blog_posts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  slug varchar(180) NOT NULL UNIQUE,

  title varchar(255) NOT NULL,

  excerpt text,

  content text NOT NULL,

  category varchar(120),

  "imageUrl" text,

  author varchar(160) NOT NULL DEFAULT 'AeroFly Editorial',

  status public.blog_status NOT NULL DEFAULT 'published',

  "publishedAt" timestamp,

  "createdAt" timestamp NOT NULL DEFAULT now()
);


-- ============================================================
-- TESTIMONIALS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.testimonials (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  name varchar(160) NOT NULL,

  destination varchar(160),

  quote text NOT NULL,

  rating integer NOT NULL DEFAULT 5,

  verified boolean NOT NULL DEFAULT false,

  published boolean NOT NULL DEFAULT false,

  "createdAt" timestamp NOT NULL DEFAULT now()
);


-- ============================================================
-- SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.settings (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  "settingKey" varchar(160) NOT NULL UNIQUE,

  "settingValue" text NOT NULL,

  "updatedAt" timestamp NOT NULL DEFAULT now()
);


-- ============================================================
-- UPDATED-AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_drizzle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS users_updated_at ON public.users;
CREATE TRIGGER users_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.set_drizzle_updated_at();

DROP TRIGGER IF EXISTS destinations_updated_at ON public.destinations;
CREATE TRIGGER destinations_updated_at
BEFORE UPDATE ON public.destinations
FOR EACH ROW
EXECUTE FUNCTION public.set_drizzle_updated_at();

DROP TRIGGER IF EXISTS tours_updated_at ON public.tours;
CREATE TRIGGER tours_updated_at
BEFORE UPDATE ON public.tours
FOR EACH ROW
EXECUTE FUNCTION public.set_drizzle_updated_at();

DROP TRIGGER IF EXISTS enquiries_updated_at ON public.enquiries;
CREATE TRIGGER enquiries_updated_at
BEFORE UPDATE ON public.enquiries
FOR EACH ROW
EXECUTE FUNCTION public.set_drizzle_updated_at();

DROP TRIGGER IF EXISTS travel_applications_updated_at ON public.travel_applications;
CREATE TRIGGER travel_applications_updated_at
BEFORE UPDATE ON public.travel_applications
FOR EACH ROW
EXECUTE FUNCTION public.set_drizzle_updated_at();

DROP TRIGGER IF EXISTS callback_requests_updated_at ON public.callback_requests;
CREATE TRIGGER callback_requests_updated_at
BEFORE UPDATE ON public.callback_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_drizzle_updated_at();

DROP TRIGGER IF EXISTS appointments_updated_at ON public.appointments;
CREATE TRIGGER appointments_updated_at
BEFORE UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.set_drizzle_updated_at();

DROP TRIGGER IF EXISTS bookings_updated_at ON public.bookings;
CREATE TRIGGER bookings_updated_at
BEFORE UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.set_drizzle_updated_at();

DROP TRIGGER IF EXISTS quotations_updated_at ON public.quotations;
CREATE TRIGGER quotations_updated_at
BEFORE UPDATE ON public.quotations
FOR EACH ROW
EXECUTE FUNCTION public.set_drizzle_updated_at();

DROP TRIGGER IF EXISTS settings_updated_at ON public.settings;
CREATE TRIGGER settings_updated_at
BEFORE UPDATE ON public.settings
FOR EACH ROW
EXECUTE FUNCTION public.set_drizzle_updated_at();


-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tour_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tour_itineraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.travel_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.callback_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- PUBLIC CATALOGUE POLICIES
-- ============================================================

DROP POLICY IF EXISTS destinations_public_select
ON public.destinations;

CREATE POLICY destinations_public_select
ON public.destinations
FOR SELECT
TO anon, authenticated
USING (true);


DROP POLICY IF EXISTS tour_categories_public_select
ON public.tour_categories;

CREATE POLICY tour_categories_public_select
ON public.tour_categories
FOR SELECT
TO anon, authenticated
USING (true);


DROP POLICY IF EXISTS tours_public_select
ON public.tours;

CREATE POLICY tours_public_select
ON public.tours
FOR SELECT
TO anon, authenticated
USING (status = 'published');


DROP POLICY IF EXISTS itineraries_public_select
ON public.tour_itineraries;

CREATE POLICY itineraries_public_select
ON public.tour_itineraries
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tours t
    WHERE t.id = "tourId"
      AND t.status = 'published'
  )
);


DROP POLICY IF EXISTS blog_posts_public_select
ON public.blog_posts;

CREATE POLICY blog_posts_public_select
ON public.blog_posts
FOR SELECT
TO anon, authenticated
USING (status = 'published');


DROP POLICY IF EXISTS testimonials_public_select
ON public.testimonials;

CREATE POLICY testimonials_public_select
ON public.testimonials
FOR SELECT
TO anon, authenticated
USING (published = true);