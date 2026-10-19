import { createServerSupabaseClient } from "./_core/supabase";

function fail(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

function supabase(accessToken: string) {
  if (!accessToken) throw new Error("A valid Supabase session is required.");
  return createServerSupabaseClient(accessToken);
}

export async function createManualTourDeparture(
  accessToken: string,
  input: {
    tourId: number;
    departureDate: string;
    returnDate?: string;
    departureCity?: string;
    adultPrice: number;
    childPrice: number;
    infantPrice: number;
    singleSupplement: number;
    capacity: number;
  },
): Promise<number> {
  const db = supabase(accessToken);

  const { data, error } = await db.rpc(
    "staff_create_manual_tour_departure",
    {
      p_tour_id: input.tourId,
      p_departure_date: input.departureDate,
      p_return_date: input.returnDate || null,
      p_departure_city: input.departureCity || null,
      p_adult_price: input.adultPrice,
      p_child_price: input.childPrice,
      p_infant_price: input.infantPrice,
      p_single_supplement: input.singleSupplement,
      p_capacity: input.capacity,
    },
  );

  if (error) {
    throw new Error(
      error.message || "Unable to create the manual departure.",
    );
  }

  const departureId = Number(data);

  if (!Number.isInteger(departureId) || departureId < 1) {
    throw new Error("The database did not return a valid departure ID.");
  }

  return departureId;
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

/** Customer-facing list of offers, their immutable versions and event history. */
export async function listMyBookingOffers(accessToken: string) {
  const db = supabase(accessToken);

  const {
    data: { user },
    error: authError,
  } = await db.auth.getUser();

  if (authError || !user) {
    throw new Error("A valid customer session is required.");
  }

  const { data, error } = await db
    .from("quotations")
    .select(`
      id,
      reference,
      enquiryId,
      destination,
      travelDates,
      travellers,
      subtotal,
      taxes,
      discount,
      total,
      currency,
      status,
      notes,
      validUntil,
      sentAt,
      acceptedAt,
      createdAt,
      bookingId,
      booking_details,
      customer_response,
      customer_response_note,
      response_at,
      offer_version,
      items:quotation_items(
        id,
        description,
        quantity,
        unitPrice,
        lineTotal
      ),
      versions:booking_offer_versions(
        id,
        version_number,
        created_at,
        snapshot
      ),
      events:booking_offer_events(
        id,
        action,
        message,
        actor_type,
        created_at
      )
    `)
    .eq("customer_auth_id", user.id)
    .in("status", [
      "sent",
      "viewed",
      "accepted",
      "expired",
      "rejected",
    ])
    .order("createdAt", { ascending: false });

  if (error) {
    fail(error, "Unable to load your booking offers.");
  }

  return (data ?? []).map((offer) => ({
    ...offer,
    versions: [...(offer.versions ?? [])].sort(
      (a, b) => b.version_number - a.version_number,
    ),
    events: [...(offer.events ?? [])].sort(
      (a, b) =>
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime(),
    ),
  }));
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



/**
 * Staff CRM summary for the existing enquiry.
 * This does not create or update enquiries or quotations.
 */
export async function getEnquiryOfferSummary(
  accessToken: string,
  enquiryId: number,
) {
  const db = supabase(accessToken);

  if (!Number.isInteger(enquiryId) || enquiryId < 1) {
    throw new Error("Select a valid enquiry.");
  }

  const { data, error } = await db
    .from("quotations")
    .select(`
      id,
      reference,
      "enquiryId",
      status,
      proposal_status,
      customer_response,
      customer_response_note,
      response_at,
      offer_version,
      "sentAt",
      total,
      currency,
      "validUntil"
    `)
    .eq("enquiryId", enquiryId)
    .order("offer_version", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    fail(error, "Unable to load booking-offer history for this enquiry.");
  }

  const offers = data ?? [];

  // Show one current quotation per enquiry in the CRM summary.
  // Historical revisions are retained in booking_offer_versions.
  const current = offers[0] ?? null;

  return {
    current,
    history: offers,
    hasChangeRequest:
      current?.customer_response === "changes_requested" ||
      current?.proposal_status === "EDIT_REQUESTED",
    changeRequestMessage:
      current?.customer_response === "changes_requested" ||
      current?.proposal_status === "EDIT_REQUESTED"
        ? current?.customer_response_note ?? null
        : null,
  };
}
