
import React from "react";

type Activity = {
  title?: string;
  description?: string;
  category?: string;
  estimatedCost?: number;
};

type TripDay = {
  day?: number;
  title?: string;
  description?: string;
  activities?: Activity[];
  meals?: string[];
  accommodation?: string;
  estimatedCost?: number;
};

type TripPlan = {
  planId?: string;
  planTitle?: string;
  planVersion?: number;
  preferences?: {
    origin?: string;
    destination?: string;
    startDate?: string;
    endDate?: string;
    durationDays?: number;
    durationNights?: number;
    travellers?: number;
    adults?: number;
    children?: number;
    budget?: number;
    currency?: string;
    travelStyle?: string;
    style?: string;
    accommodation?: string;
    interests?: string[];
    dietary?: string;
    accessibility?: string;
    notes?: string;
  };
  itinerary?: {
    title?: string;
    summary?: string;
    destination?: string;
    durationDays?: number;
    days?: TripDay[];
  };
};

function extractJsonObject(value: string): string | null {
  const marker = "COMPLETE SAVED TRIP PLAN";
  const markerIndex = value.indexOf(marker);

  if (markerIndex === -1) return null;

  const start = value.indexOf("{", markerIndex + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < value.length; i++) {
    const char = value[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;

      if (depth === 0) {
        return value.slice(start, i + 1);
      }
    }
  }

  return null;
}

function formatDate(value?: string) {
  if (!value) return "Not specified";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatMoney(value?: number, currency = "INR") {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Not specified";
  }

  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-IN")}`;
  }
}

function Detail({
  label,
  value,
}: {
  label: string;
  value?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-stone-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
        {label}
      </p>
      <div className="mt-1 break-words text-sm font-semibold text-stone-800">
        {value || "Not specified"}
      </div>
    </div>
  );
}

export default function CustomerTripPlan({
  message,
}: {
  message?: string | null;
}) {
  if (!message?.trim()) return null;

  const jsonText = extractJsonObject(message);
  let plan: TripPlan | null = null;

  if (jsonText) {
    try {
      plan = JSON.parse(jsonText) as TripPlan;
    } catch {
      plan = null;
    }
  }

  // Remove the serialized plan from the customer-facing message.
  const customerMessage = jsonText
    ? message
        .slice(0, message.indexOf("COMPLETE SAVED TRIP PLAN"))
        .trim()
    : message.trim();

  if (!plan) {
    return (
      <section className="rounded-xl border border-stone-200 bg-[#faf7f1] p-4">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-stone-600">
          Customer message
        </h3>
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-stone-700">
          {customerMessage}
        </p>
        {message.includes("COMPLETE SAVED TRIP PLAN") && (
          <p className="mt-3 text-xs text-amber-700">
            The saved trip plan could not be parsed. Check whether the stored
            JSON is complete and valid.
          </p>
        )}
      </section>
    );
  }

  const preferences = plan.preferences ?? {};
  const itinerary = plan.itinerary ?? {};
  const days = Array.isArray(itinerary.days) ? itinerary.days : [];
  const currency = preferences.currency || "INR";

  const travellerCount = preferences.travellers;
  const adults = preferences.adults;
  const children = preferences.children;

  const travellerCountConflict =
    typeof travellerCount === "number" &&
    typeof adults === "number" &&
    typeof children === "number" &&
    travellerCount !== adults + children;

  return (
    <div className="space-y-4 text-sm text-stone-700">
      {/* Booking status */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <span className="mt-0.5 text-lg" aria-hidden="true">
          ⓘ
        </span>
        <div>
          <p className="font-semibold text-amber-900">
            Enquiry only — not a confirmed booking
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            No booking or payment is confirmed by this trip-plan submission.
          </p>
        </div>
      </div>

      {/* Overview */}
      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <div className="border-b border-stone-200 bg-[#faf7f1] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[.15em] text-stone-500">
            Custom trip enquiry
          </p>
          <h3 className="mt-1 text-xl font-semibold text-stone-900">
            {itinerary.title ||
              plan.planTitle ||
              `Trip to ${preferences.destination || itinerary.destination || "destination"}`}
          </h3>
          {itinerary.summary && (
            <p className="mt-2 text-sm leading-6 text-stone-600">
              {itinerary.summary}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
          <Detail
            label="Destination"
            value={preferences.destination || itinerary.destination}
          />
          <Detail
            label="Duration"
            value={
              preferences.durationDays
                ? `${preferences.durationDays} days${
                    preferences.durationNights != null
                      ? ` / ${preferences.durationNights} nights`
                      : ""
                  }`
                : itinerary.durationDays
                  ? `${itinerary.durationDays} days`
                  : undefined
            }
          />
          <Detail
            label="Estimated budget"
            value={formatMoney(preferences.budget, currency)}
          />
          <Detail label="Starting from" value={preferences.origin} />
          <Detail label="Departure" value={formatDate(preferences.startDate)} />
          <Detail label="Return" value={formatDate(preferences.endDate)} />
        </div>
      </section>

      {/* Traveller details */}
      <section className="rounded-2xl border border-stone-200 bg-white p-4">
        <h3 className="mb-3 font-semibold text-stone-900">
          Traveller details
        </h3>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Detail
            label="Saved traveller count"
            value={
              travellerCount != null
                ? `${travellerCount} traveller(s)`
                : undefined
            }
          />
          <Detail
            label="Adults"
            value={adults != null ? adults : undefined}
          />
          <Detail
            label="Children"
            value={children != null ? children : undefined}
          />
        </div>

        {travellerCountConflict && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            Traveller count mismatch: the saved total is {travellerCount},
            but adults plus children equals {adults! + children!}. Confirm
            the correct party size with the customer before preparing an offer.
          </p>
        )}
      </section>

      {/* Preferences */}
      <section className="rounded-2xl border border-stone-200 bg-white p-4">
        <h3 className="mb-3 font-semibold text-stone-900">
          Trip preferences
        </h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Detail
            label="Travel style"
            value={preferences.travelStyle || preferences.style}
          />
          <Detail label="Accommodation" value={preferences.accommodation} />
          <Detail
            label="Interests"
            value={
              preferences.interests?.length
                ? preferences.interests.join(", ")
                : undefined
            }
          />
          <Detail label="Dietary requirements" value={preferences.dietary} />
          <Detail
            label="Accessibility requirements"
            value={preferences.accessibility}
          />
          <Detail label="Additional notes" value={preferences.notes} />
        </div>
      </section>

      {/* Day-by-day itinerary */}
      <section className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-stone-900">
              Day-by-day itinerary
            </h3>
            <p className="mt-1 text-xs text-stone-500">
              Review the suggested activities before preparing the booking offer.
            </p>
          </div>
          <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800">
            {days.length} days
          </span>
        </div>

        {days.length === 0 ? (
          <p className="text-sm text-stone-500">
            No daily itinerary has been saved.
          </p>
        ) : (
          <div className="space-y-3">
            {days.map((day, index) => (
              <details
                key={`${day.day ?? index + 1}-${day.title ?? "day"}`}
                open={index === 0}
                className="group overflow-hidden rounded-xl border border-stone-200"
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 bg-[#faf7f1] p-3 [&::-webkit-details-marker]:hidden">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-xs font-bold text-orange-800">
                    {day.day ?? index + 1}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-stone-900">
                      {day.title || `Day ${day.day ?? index + 1}`}
                    </span>
                    <span className="mt-0.5 block text-xs text-stone-500">
                      {day.activities?.length ?? 0} activities
                    </span>
                  </span>

                  <span className="text-xs text-stone-500">
                    {formatMoney(day.estimatedCost, currency)}
                  </span>
                  <span className="text-stone-500 transition-transform group-open:rotate-180">
                    ▼
                  </span>
                </summary>

                <div className="space-y-4 p-4">
                  {day.description && (
                    <p className="text-sm leading-6 text-stone-600">
                      {day.description}
                    </p>
                  )}

                  {day.activities?.length ? (
                    <div className="space-y-3">
                      {day.activities.map((activity, activityIndex) => (
                        <div
                          key={`${activity.title ?? "activity"}-${activityIndex}`}
                          className="flex gap-3"
                        >
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-orange-500" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="font-medium text-stone-900">
                                {activity.title || "Suggested activity"}
                              </p>
                              {activity.category && (
                                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] capitalize text-stone-600">
                                  {activity.category}
                                </span>
                              )}
                            </div>

                            {activity.description && (
                              <p className="mt-1 text-xs leading-5 text-stone-600">
                                {activity.description}
                              </p>
                            )}

                            {activity.estimatedCost != null && (
                              <p className="mt-1 text-xs text-stone-500">
                                Estimated activity cost:{" "}
                                {formatMoney(activity.estimatedCost, currency)}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-stone-500">
                      No activities specified for this day.
                    </p>
                  )}

                  {day.meals && day.meals.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-semibold text-stone-800">
                        Meals
                      </p>
                      <p className="text-xs text-stone-600">
                        {day.meals.join(", ")}
                      </p>
                    </div>
                  )}

                  {day.accommodation && (
                    <div>
                      <p className="mb-1 text-xs font-semibold text-stone-800">
                        Accommodation
                      </p>
                      <p className="text-xs capitalize text-stone-600">
                        {day.accommodation}
                      </p>
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      {/* Actual customer message */}
      {customerMessage && (
        <section className="rounded-xl border border-stone-200 bg-[#faf7f1] p-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-stone-600">
            Customer message
          </h3>
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-stone-700">
            {customerMessage}
          </p>
        </section>
      )}

      <p className="text-[11px] leading-5 text-stone-500">
        This is a saved suggested plan. Prices, activities, availability and
        travel arrangements must be verified before a booking offer is issued.
      </p>
    </div>
  );
}
