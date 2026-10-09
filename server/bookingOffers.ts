import { createServerSupabaseClient } from "./_core/supabase";

function fail(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

function supabase(accessToken: string) {
  if (!accessToken) throw new Error("A valid Supabase session is required.");
  return createServerSupabaseClient(accessToken);
}

export async function recordCrmEnquiry(
  accessToken: string,
  input: {
    name: string; email: string; phone: string; destination?: string; travelDates?: string;
    travellers: number; budget?: string; tripType?: string; message?: string; tourId?: number;
    source: "phone" | "office" | "website" | "callback" | "appointment" | "other";
  },
) {
  const db = supabase(accessToken);
  const { data, error } = await db.rpc("crm_record_enquiry", {
    p_name: input.name,
    p_email: input.email,
    p_phone: input.phone,
    p_destination: input.destination ?? null,
    p_travel_dates: input.travelDates ?? null,
    p_travellers: input.travellers,
    p_budget: input.budget ?? null,
    p_trip_type: input.tripType ?? null,
    p_message: input.message ?? null,
    p_tour_id: input.tourId ?? null,
    p_source: input.source,
  });
  if (error) fail(error, "Unable to record the enquiry.");
  return data as { id: number; reference: string; customer_linked: boolean };
}

/** Customer-facing list. RLS limits quotations/items to the signed-in customer. */
export async function listMyBookingOffers(accessToken: string) {
  const db = supabase(accessToken);
  const { data, error } = await db
    .from("quotations")
    .select(`
      id,reference,enquiryId,destination,travelDates,travellers,subtotal,taxes,discount,total,currency,status,notes,validUntil,sentAt,acceptedAt,createdAt,bookingId,booking_details,customer_response,customer_response_note,response_at,offer_version,
      items:quotation_items(id,description,quantity,unitPrice,lineTotal)
    `)
    .not("sentAt", "is", null)
    .order("createdAt", { ascending: false });
  if (error) fail(error, "Unable to load your booking offers.");
  return data ?? [];
}

/** Staff issues a quote/offer only against an existing enquiry with a linked customer identity. */
export async function issueBookingOffer(
  accessToken: string,
  _staffLegacyUserId: number,
  input: {
    enquiryId: number;
    departureId: number;
    adults: number;
    children: number;
    infants: number;
    singleRooms?: number;
    discount?: number;
    additionalFees?: number;
    taxRate?: number;
    validUntil: string;
    inclusions?: string[];
    exclusions?: string[];
    specialConditions?: string;
    paymentTerms?: string;
    cancellationTerms?: string;
    customerNotes?: string;
  },
) {
  const db = supabase(accessToken);

  if (!Number.isInteger(input.enquiryId) || input.enquiryId < 1) {
    throw new Error("Select a valid enquiry.");
  }

  if (!Number.isInteger(input.departureId) || input.departureId < 1) {
    throw new Error("Select a valid departure.");
  }

  if (
    !Number.isInteger(input.adults) ||
    input.adults < 1 ||
    !Number.isInteger(input.children ?? 0) ||
    (input.children ?? 0) < 0 ||
    !Number.isInteger(input.infants ?? 0) ||
    (input.infants ?? 0) < 0
  ) {
    throw new Error("Enter valid adult, child and infant counts.");
  }

  if (new Date(input.validUntil).getTime() <= Date.now()) {
    throw new Error("The proposal expiry must be in the future.");
  }

  const { data, error } = await db.rpc("staff_issue_booking_offer", {
    p_enquiry_id: input.enquiryId,
    p_departure_id: input.departureId,
    p_adults: input.adults,
    p_children: input.children ?? 0,
    p_infants: input.infants ?? 0,
    p_single_rooms: input.singleRooms ?? 0,
    p_discount: input.discount ?? 0,
    p_additional_fees: input.additionalFees ?? 0,
    p_tax_rate: input.taxRate ?? 0,
    p_expiry: input.validUntil,
    p_inclusions: input.inclusions ?? [],
    p_exclusions: input.exclusions ?? [],
    p_special_conditions: input.specialConditions ?? null,
    p_payment_terms: input.paymentTerms ?? null,
    p_cancellation_terms: input.cancellationTerms ?? null,
    p_customer_notes: input.customerNotes ?? null,
  });

  if (error) {
    throw new Error(error.message || "Unable to issue the booking proposal.");
  }

  if (!data || typeof data !== "object") {
    throw new Error("The database did not return the issued proposal.");
  }

  return data as {
    id: number;
    reference: string;
    version: number;
    subtotal: number;
    tax: number;
    discount: number;
    total: number;
    currency: string;
  };
}


export async function listOfferDepartures(accessToken: string) {
  const db = supabase(accessToken);
  const today = new Date().toISOString().slice(0, 10);

  const { data: departureRows, error: departureError } = await db
    .from("tour_departures")
    .select(
      "id,tourId,departure_date,return_date,label,seats_available,status,departure_city,adult_price,child_price,infant_price,single_supplement,booking_cutoff",
    )
    .in("status", ["available", "limited"])
    .gte("departure_date", today)
    .order("departure_date", { ascending: true });

  if (departureError) {
    fail(departureError, "Unable to load available tour departures.");
  }

  if (!departureRows?.length) return [];

const tourIds: number[] = [];

departureRows.forEach((row) => {
  if (tourIds.indexOf(row.tourId) === -1) {
    tourIds.push(row.tourId);
  }
});

  const { data: tours, error: toursError } = await db
    .from("tours")
    .select("id,title,status")
    .in("id", tourIds)
    .eq("status", "published");

  if (toursError) {
    fail(toursError, "Unable to load departure tour details.");
  }

  const titles = new Map(
    (tours ?? []).map((tour) => [tour.id, tour.title]),
  );

  return departureRows
    .filter((departure) => titles.has(departure.tourId))
    .map((departure) => ({
      ...departure,
      tourTitle: titles.get(departure.tourId) ?? "Tour",
    }));
}


export async function respondToBookingOffer(
  accessToken: string,
  input: { quotationId: number; action: "accept" | "reject" | "request_changes" | "cancel"; message?: string },
) {
  const db = supabase(accessToken);
  const { data, error } = await db.rpc("customer_respond_to_booking_offer", {
    p_quotation_id: input.quotationId,
    p_action: input.action,
    p_message: input.message?.trim() || null,
  });
  if (error) fail(error, "Unable to update this booking offer.");
  return data;
}

export async function reviewBookingCancellation(
  accessToken: string,
  input: {
    requestId: number;
    decision: "approve" | "reject";
    response?: string;
  },
) {
  const db = supabase(accessToken);

  const { data, error } = await db.rpc(
    "crm_review_booking_cancellation",
    {
      p_request_id: input.requestId,
      p_decision: input.decision,
      p_response: input.response?.trim() || null,
    },
  );

  if (error) {
    fail(error, "Unable to review the cancellation request.");
  }

  return data;
}
