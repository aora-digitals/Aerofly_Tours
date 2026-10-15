
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

type JsonObject = Record<string, unknown>;

type Preferences = {
  origin?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  departureDate?: string;
  returnDate?: string;
  durationDays?: number;
  duration?: number;
  travellers?: number;
  adults?: number;
  children?: number;
  budget?: number | string;
  currency?: string;
  travelStyle?: string;
  interests?: string[] | string;
  accommodation?: string;
  accessibility?: string;
  dietary?: string;
  notes?: string;
  [key: string]: unknown;
};

type Activity = {
  title: string;
  description: string;
  time?: string;
  category?: string;
  estimatedCost?: number;
};

type ItineraryDay = {
  day: number;
  title: string;
  date?: string;
  description: string;
  activities: Activity[];
  meals?: string[];
  accommodation?: string;
  estimatedCost?: number;
};

type Itinerary = {
  title: string;
  summary: string;
  destination: string;
  durationDays: number;
  days: ItineraryDay[];
  travelNotes: string[];
  budgetEstimate: {
    currency: string;
    perPerson: number;
    total: number;
    breakdown: {
      accommodation: number;
      transport: number;
      activities: number;
      food: number;
      other: number;
    };
    disclaimer: string;
    costEstimateAvailable: boolean;
  };
  feasibility: {
    withinBudget: boolean | null;
    explanation: string;
  };
};

type Catalogue = {
  destinations: JsonObject[];
  tours: JsonObject[];
  itineraries: JsonObject[];
};

const MAX_BODY_BYTES = 100_000;
const MAX_DAYS = 30;
const MAX_TRAVELLERS = 30;

function reply(status: number, data: JsonObject): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders,
  });
}

function asObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function asNumber(
  value: unknown,
  fallback: number,
  min = 0,
  max = 1_000_000,
): number {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  if (!Number.isFinite(numberValue)) return fallback;

  return Math.min(max, Math.max(min, numberValue));
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 30);
  }

  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 30);
  }

  return [];
}

function normalizePreferences(value: unknown): Preferences {
  const input = asObject(value);

  return {
    ...input,
    origin: asString(input.origin),
    destination: asString(input.destination),
    startDate: asString(input.startDate || input.departureDate),
    endDate: asString(input.endDate || input.returnDate),
    durationDays: Math.round(
      asNumber(input.durationDays ?? input.duration, 4, 1, MAX_DAYS),
    ),
    travellers: Math.round(
      asNumber(
        input.travellers,
        asNumber(input.adults, 2, 1, MAX_TRAVELLERS),
        1,
        MAX_TRAVELLERS,
      ),
    ),
    budget: asNumber(input.budget, 0, 0, 1_000_000_000),
    currency: asString(input.currency, "INR").toUpperCase().slice(0, 8),
    travelStyle: asString(input.travelStyle, "balanced"),
    interests: asStringArray(input.interests),
    accommodation: asString(input.accommodation, "comfortable"),
    accessibility: asString(input.accessibility),
    dietary: asString(input.dietary),
    notes: asString(input.notes).slice(0, 2000),
  };
}

function getEnv(name: string): string {
  return (Deno.env.get(name) || "").trim();
}

function getSupabaseAdmin(): SupabaseClient {
  const url = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server configuration is missing.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function getAuthenticatedUser(
  request: Request,
  supabase: SupabaseClient,
): Promise<{ id: string; email?: string } | null> {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) return null;

  const { data, error } = await supabase.auth.getUser(match[1]);

  if (error || !data.user) return null;

  return {
    id: data.user.id,
    email: data.user.email,
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");

  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;

  return `${trimmed}/chat/completions`;
}

/**
 * Parse a model response that may contain Markdown code fences or
 * explanatory text around a JSON object.
 */
function parseModelJson(content: string): unknown {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start < 0 || end <= start) {
      throw new Error("Model response contains no JSON object.");
    }

    return JSON.parse(cleaned.slice(start, end + 1));
  }
}


function repairModelJson(content: string): string {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // First, return valid JSON unchanged.
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // Do not silently modify malformed JSON.
  }

  // Detect an incomplete response, which often means the model
  // stopped before finishing its JSON output.
  const lastBrace = cleaned.lastIndexOf("}");
  const lastBracket = cleaned.lastIndexOf("]");

  if (lastBrace < 0 || lastBracket < 0) {
    throw new Error("AI response is incomplete or malformed.");
  }

  throw new Error(
    "AI returned invalid JSON. Retry generation with a stricter prompt.",
  );
}


function extractAssistantContent(payload: JsonObject): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = asObject(choices[0]);
  const message = asObject(firstChoice.message);
  const content = message.content;

  if (typeof content === "string") return content;

  // Some compatible providers return content as text blocks.
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        return asString(asObject(part).text);
      })
      .filter(Boolean)
      .join("\n");
  }

  // Some providers return a direct output_text field.
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  throw new Error("AI provider response did not contain assistant text.");
}




function normalizeBudgetEstimate(
  raw: Record<string, unknown>,
  preferences: Preferences,
) {
  const rawBreakdown =
    raw.breakdown && typeof raw.breakdown === "object"
      ? asObject(raw.breakdown)
      : raw;

  const amount = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const number = Number(value);

    return Number.isFinite(number) && number >= 0
      ? Math.min(number, 1_000_000_000)
      : null;
  };

  const accommodation = amount(rawBreakdown.accommodation);
  const transport = amount(rawBreakdown.transport);
  const activities = amount(rawBreakdown.activities);
  const food = amount(rawBreakdown.food ?? rawBreakdown.meals);
  const other = amount(rawBreakdown.other);

  const categoryValues = [
    accommodation,
    transport,
    activities,
    food,
    other,
  ];

  const hasBreakdown = categoryValues.some(
    (value) => value !== null,
  );

  const calculatedTotal = hasBreakdown
    ? categoryValues.reduce<number>(
        (sum, value) => sum + (value ?? 0),
        0,
      )
    : null;

  const suppliedTotal = amount(raw.total);

  // A breakdown is more useful than a conflicting model-supplied total.
  const total = calculatedTotal ?? suppliedTotal;

  const travellerCount = Math.round(
    asNumber(
      preferences.travellers,
      2,
      1,
      MAX_TRAVELLERS,
    ),
  );

  const budget = amount(preferences.budget);

  const currencyValue = asString(
    raw.currency || preferences.currency,
    "INR",
  ).toUpperCase();

  const currency = /^[A-Z]{3}$/.test(currencyValue)
    ? currencyValue
    : "INR";

  const withinBudget: boolean | null =
    total !== null && budget !== null && budget > 0
      ? total <= budget
      : null;

  const formatMoney = (value: number) =>
    `${currency} ${Math.round(value).toLocaleString("en-IN")}`;

  const feasibilityExplanation =
    total === null
      ? "A reliable total could not be calculated because the AI did not provide usable cost estimates."
      : budget === null || budget <= 0
        ? "Budget feasibility could not be determined because a valid total trip budget was not provided."
        : withinBudget
          ? `The estimated total trip cost of ${formatMoney(total)} is within your total group budget of ${formatMoney(budget)}.`
          : `The estimated total trip cost of ${formatMoney(total)} exceeds your total group budget of ${formatMoney(budget)} by ${formatMoney(total - budget)}. This itinerary needs a more economical alternative.`;

  const notes = Array.isArray(raw.notes)
    ? raw.notes.filter(
        (item): item is string => typeof item === "string",
      )
    : [];

  if (total === null) {
    notes.push("Total cost is unavailable; do not treat it as zero.");
  }

  if (withinBudget === false && total !== null && budget !== null) {
    notes.push(
      `Over budget by ${formatMoney(total - budget)} for all travellers combined.`,
    );
  }

  return {
    currency,
    total: total === null ? 0 : Math.round(total),
perPerson:
  total !== null && travellerCount > 0
    ? Math.round(total / travellerCount)
    : 0,
costEstimateAvailable: total !== null,

    breakdown: {
      accommodation: accommodation ?? 0,
      transport: transport ?? 0,
      activities: activities ?? 0,
      food: food ?? 0,
      other: other ?? 0,
    },

    disclaimer:
      typeof raw.disclaimer === "string"
        ? raw.disclaimer
        : "Planning estimate only. Prices, availability, transport, accommodation, and attraction opening hours are not verified live facts. Confirm all costs before booking.",

    notes,
    withinBudget,
    feasibilityExplanation,
  };
}



function normalizeItinerary(
  value: unknown,
  preferences: Preferences,
): Itinerary {
  const input = asObject(value);
  const rawDays = Array.isArray(input.days)
    ? input.days
    : [];

  const durationDays = Math.round(
    asNumber(
      input.durationDays,
      asNumber(
        preferences.durationDays,
        4,
        1,
        MAX_DAYS,
      ),
      1,
      MAX_DAYS,
    ),
  );

  // Normalize each day and its activities.
  const days: ItineraryDay[] = rawDays
    .slice(0, durationDays)
    .map((rawDay, index) => {
      const day = asObject(rawDay);

      const rawActivities = Array.isArray(day.activities)
        ? day.activities
        : [];

      const activities: Activity[] = rawActivities
        .slice(0, 12)
        .map((rawActivity) => {
          const activity = asObject(rawActivity);

          return {
            title: asString(
              activity.title,
              "Suggested activity",
            ).slice(0, 180),

            description: asString(
              activity.description,
              "Explore the area at your own pace.",
            ).slice(0, 1500),

            ...(activity.time
              ? {
                  time: asString(
                    activity.time,
                  ).slice(0, 80),
                }
              : {}),

            ...(activity.category
              ? {
                  category: asString(
                    activity.category,
                  ).slice(0, 80),
                }
              : {}),

            estimatedCost: asNumber(
              activity.estimatedCost,
              0,
              0,
              1_000_000,
            ),
          };
        });

      return {
        day: index + 1,

        title: asString(
          day.title,
          `Day ${index + 1}`,
        ).slice(0, 180),

        ...(day.date
          ? {
              date: asString(
                day.date,
              ).slice(0, 30),
            }
          : {}),

        description: asString(
          day.description,
          "Enjoy this part of your trip at a relaxed pace.",
        ).slice(0, 1500),

        activities,
        meals: asStringArray(day.meals),

        accommodation: asString(
          day.accommodation,
        ).slice(0, 300),

        estimatedCost: asNumber(
          day.estimatedCost,
          0,
          0,
          10_000_000,
        ),
      };
    });

  // Fill any missing days without exceeding the requested duration.
  while (days.length < durationDays) {
    const nextDay = days.length + 1;

    days.push({
      day: nextDay,
      title: `Day ${nextDay}`,
      description:
        "Keep this day flexible for sightseeing, rest, and local exploration.",

      activities: [
        {
          title: "Explore at your own pace",
          description:
            "Choose a nearby attraction after checking opening hours and local travel conditions.",
          category: "flexible",
          estimatedCost: 0,
        },
      ],

      meals: [],
      accommodation: "",
      estimatedCost: 0,
    });
  }

  // Calculate the budget once and reuse the normalized result.
  const normalizedBudget = normalizeBudgetEstimate(
    asObject(input.budgetEstimate),
    preferences,
  );

  return {
    title: asString(
      input.title,
      `Custom trip to ${asString(
        preferences.destination,
        "your destination",
      )}`,
    ).slice(0, 180),

    summary: asString(
      input.summary,
      "A suggested itinerary tailored to your travel preferences.",
    ).slice(0, 3000),

    destination: asString(
      input.destination,
      asString(
        preferences.destination,
        "Your destination",
      ),
    ).slice(0, 180),

    durationDays,
    days,

    travelNotes: asStringArray(input.travelNotes),

   
budgetEstimate: {
  currency: normalizedBudget.currency,
  perPerson: normalizedBudget.perPerson,
  total: normalizedBudget.total,
  breakdown: normalizedBudget.breakdown,
  disclaimer: normalizedBudget.disclaimer,
  costEstimateAvailable: normalizedBudget.costEstimateAvailable,
},

feasibility: {
  withinBudget: normalizedBudget.withinBudget,
  explanation: normalizedBudget.feasibilityExplanation,
},

  };
}



// function makeFallbackItinerary(preferences: Preferences): Itinerary {
//   const destination = asString(preferences.destination, "your destination");
//   const origin = asString(preferences.origin);
//   const duration = Math.round(
//     asNumber(preferences.durationDays, 4, 1, MAX_DAYS),
//   );
//   const travellers = Math.round(
//     asNumber(preferences.travellers, 2, 1, MAX_TRAVELLERS),
//   );
//   const currency = asString(preferences.currency, "INR").toUpperCase();

//   const budgetTotal = Math.round(
//     asNumber(preferences.budget, 0, 0, 1_000_000_000),
//   );

//   const estimatedTotal =
//     budgetTotal > 0
//       ? budgetTotal
//       : duration * travellers * (currency === "INR" ? 3500 : 50);

//   const days: ItineraryDay[] = Array.from(
//     { length: duration },
//     (_, index) => {
//       const dayNumber = index + 1;

//       return {
//         day: dayNumber,
//         title:
//           dayNumber === 1
//             ? `Arrival and introduction to ${destination}`
//             : dayNumber === duration
//               ? `Final explorations and departure`
//               : `Explore ${destination} — Day ${dayNumber}`,
//         description:
//           dayNumber === 1
//             ? "Arrive, settle in, and explore nearby areas depending on your arrival time."
//             : dayNumber === duration
//               ? "Enjoy a relaxed morning, allow time for checkout, and proceed to your departure point."
//               : "Choose a main attraction, explore the surrounding area, and keep time for meals and rest.",
//         activities: [
//           {
//             title:
//               dayNumber === 1
//                 ? "Arrival and check-in"
//                 : dayNumber === duration
//                   ? "Leisure time and departure preparation"
//                   : "Explore a local attraction",
//             description:
//               dayNumber === 1
//                 ? "Confirm your transport and accommodation arrangements before departure."
//                 : dayNumber === duration
//                   ? "Confirm checkout and onward transport arrangements."
//                   : "Select an attraction that matches your interests and verify its hours before visiting.",
//             category: "sightseeing",
//             estimatedCost: 0,
//           },
//           {
//             title: "Local food and free time",
//             description:
//               "Explore local dining options that match your dietary requirements and keep time flexible.",
//             category: "food",
//             estimatedCost: 0,
//           },
//         ],
//         meals: [],
//         accommodation: asString(preferences.accommodation, "To be selected"),
//         estimatedCost: Math.round(estimatedTotal / duration),
//       };
//     },
//   );

//   return {
//     title: `Custom ${duration}-day trip to ${destination}`,
//     summary:
//       `A starter itinerary for ${destination} based on your preferences. ` +
//       (origin ? `Your stated origin is ${origin}. ` : "") +
//       "This fallback plan uses general activity suggestions and does not claim live availability.",
//     destination,
//     durationDays: duration,
//     days,
//     travelNotes: [
//       "This is a fallback itinerary because AI generation was unavailable.",
//       "Specific attractions have not been selected or verified for this destination.",
//       "Check travel requirements, local transport, opening hours, and accommodation availability before travelling.",
//       "All costs are planning estimates, not verified live prices.",
//     ],
//     budgetEstimate: {
//       currency,
//       perPerson: Math.round(estimatedTotal / travellers),
//       total: estimatedTotal,
//       breakdown: {
//         accommodation: 0,
//         transport: 0,
//         activities: 0,
//         food: 0,
//         other: 0,
//       },
//       disclaimer:
//         "Fallback estimate only. Cost breakdowns and live prices have not been verified. Obtain current quotes before booking.",
//     },
//   };
// }


function makeFallbackItinerary(_preferences: Preferences): never {
  throw new Error(
    "AI itinerary generation failed. Please check the AI provider configuration and try again. No generic itinerary was substituted.",
  );
}

async function loadCatalogue(
  supabase: SupabaseClient,
): Promise<Catalogue> {
  const [destinationsResult, toursResult] = await Promise.all([
    supabase
      .from("destinations")
      .select(
        'id,slug,name,country,region,kind,tagline,description,"imageUrl",featured',
      )
      .order("featured", { ascending: false })
      .limit(100),
    supabase
      .from("tours")
      .select(
        'id,slug,title,"destinationId","durationDays","durationNights","priceFrom",rating,overview,highlights,inclusions,exclusions,"imageUrl",tags,availability,status,featured',
      )
      .eq("status", "published")
      .order("featured", { ascending: false })
      .limit(100),
  ]);

  if (destinationsResult.error) {
    console.error("Destination catalogue query failed", destinationsResult.error.message);
  }

  if (toursResult.error) {
    console.error("Tour catalogue query failed", toursResult.error.message);
  }

  const destinations = (destinationsResult.data || []) as JsonObject[];
  const tours = (toursResult.data || []) as JsonObject[];

  const tourIds = tours
    .map((tour) => tour.id)
    .filter((id): id is number => typeof id === "number")
    .slice(0, 100);

  let itineraries: JsonObject[] = [];

  if (tourIds.length > 0) {
    const result = await supabase
      .from("tour_itineraries")
      .select('id,"tourId","dayNumber",title,description,meals,stay')
      .in("tourId", tourIds)
      .order("dayNumber", { ascending: true })
      .limit(300);

    if (result.error) {
      console.error("Tour itinerary query failed", result.error.message);
    } else {
      itineraries = (result.data || []) as JsonObject[];
    }
  }

  return { destinations, tours, itineraries };
}


function extractJsonObject(content: string): string {
  const text = content
    .replace(/^\uFEFF/, "")
    .trim();

  const start = text.indexOf("{");

  if (start === -1) {
    throw new Error("AI response contains no JSON object.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

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
        return text.slice(start, i + 1);
      }
    }
  }

  throw new Error(
    "AI response contains an incomplete JSON object. " +
    "The output may have been truncated.",
  );
}


async function generateWithAI(
  preferences: Preferences,
  catalogue: Catalogue,
): Promise<Itinerary | null> {
  const apiKey = getEnv("AI_API_KEY");
  const baseUrl = getEnv("AI_BASE_URL");
  const model = getEnv("AI_MODEL");

  if (!apiKey || !baseUrl || !model) {
    console.error("AI planner configuration is incomplete", {
      hasApiKey: Boolean(apiKey),
      hasBaseUrl: Boolean(baseUrl),
      hasModel: Boolean(model),
    });
    return null;
  }

  const durationDays = Math.round(
    asNumber(preferences.durationDays, 4, 1, MAX_DAYS),
  );
  const travellers = Math.round(
  asNumber(
    preferences.travellers,
    asNumber(preferences.adults, 2, 1, MAX_TRAVELLERS) +
      asNumber(preferences.children, 0, 0, MAX_TRAVELLERS),
    1,
    MAX_TRAVELLERS,
  ),
);
  const currency = asString(preferences.currency, "INR").toUpperCase();

  const systemPrompt = `
You are the professional itinerary designer for AeroFly Tours.
Create a useful, destination-specific travel itinerary using the traveller's
preferences and available catalogue information.

OUTPUT:
Return exactly one valid JSON object. No Markdown, code fences, or prose.
Return exactly ${durationDays} day objects, numbered 1 through ${durationDays}.

SCHEMA:
{
  "title": "Short, natural trip title",
  "summary": "Personalized trip overview",
  "destination": "Destination",
  "durationDays": ${durationDays},
  "days": [
    {
      "day": 1,
      "title": "A short, natural heading without the words Day 1 or Day 2",
      "date": "",
      "description": "Specific plan for this day",
      "destination": "Area or city for this day",
      "activities": [
        {
          "title": "Specific activity",
          "description": "Useful practical detail",
          "location": "Specific place or area",
          "time": "Suggested time such as 09:00",
          "durationMinutes": 90,
          "category": "sightseeing",
          "estimatedCost": 1200,
          "costCurrency": "${currency}"
        }
      ],
      "meals": ["Optional meal suggestion"],
      "accommodation": "Accommodation area or suggestion",
      "practicalNotes": ["Useful day-specific note"],
      "estimatedCost": 8000
    }
  ],
  "travelNotes": ["Important planning note"],
  "budgetEstimate": {
    "currency": "${currency}",
    "perPerson": 40000,
    "total": 80000,
    "breakdown": {
      "accommodation": 30000,
      "transport": 15000,
      "activities": 12000,
      "food": 15000,
      "other": 8000
    },
    "disclaimer": "Planning estimate only"
  }
}

CONTENT REQUIREMENTS:
1. Personalize the trip using origin, destination, dates, duration, interests,
   traveller ages/group, budget, pace, accommodation, dietary and accessibility
   preferences when supplied.
2. Every day must have a distinct purpose, natural title, and specific plan.
   Do not repeat generic titles such as "Explore the destination — Day N".
3. Do not put day numbers in day titles. The separate numeric "day" field
   identifies each day.
4. Provide exactly 3 meaningful activities per day. Keep each activity
description concise, specific, and practical. Avoid repeating activities.
5. Prefer known attractions and areas that can reasonably be associated with
   the destination. Do not fabricate exact addresses or claim facts are verified.
6. Plan sensible geographic groupings and a realistic pace. Include arrival
   and departure logistics on the appropriate days.
7. Use "durationMinutes" as a positive integer when estimable. Use "time" for
   a suggested start time. Never use a duration of zero to mean unknown.

8. All budget figures must represent the entire trip for all travellers
   combined, unless a field explicitly says per-person.

9. The requested budget is a hard planning constraint, not merely a preference.
   First prioritize realistic accommodation, transport, meals and activities
   that fit the requested total budget. Avoid luxury options when they would
   make the trip unaffordable.

10. Calculate the group total from accommodation, transport, activities, food
    and other expenses. The total must equal the sum of those categories.
    perPerson must equal total divided by the number of travellers.

11. If a realistic itinerary cannot fit the requested budget, explain why and
    provide the most economical realistic alternative. Never claim that an
    over-budget itinerary is within budget. Never reduce cost numbers just to
    make the plan appear affordable.

12. Include flights from the supplied origin when they are part of the requested
    trip. If flights are excluded, state that clearly in travelNotes.

13. Do not invent verified prices. Cost estimates must be clearly identified as
    estimates and assumptions must be explained.

11. Use actual published AeroFly tours only when supported by the supplied
    catalogue. Never invent tour IDs, package prices, hotel bookings,
    reservations, opening hours or live availability.
12. Keep meals and practicalNotes as arrays, even when empty.
13. Output valid JSON with the exact property names above. All budget and
    cost values must be numbers, never currency-formatted strings.
14. This is a proposed itinerary, not a confirmed booking.
`.trim();

  const userPrompt = {
    preferences,
    travellerCount: travellers,
    requestedDurationDays: durationDays,
    requestedCurrency: currency,
    budgetConstraint: {
    amount: preferences.budget,
    currency,
    scope: "TOTAL for all travellers combined for the entire trip",
    isHardConstraint: true,
    instruction:
      "Create the most realistic itinerary possible within this total budget. " +
      "If infeasible, explain the shortfall and propose a cheaper alternative. " +
      "Do not claim an over-budget itinerary is within budget.",
  },
    existingAeroFlyCatalogue: {
      destinations: catalogue.destinations.slice(0, 60),
      publishedTours: catalogue.tours.slice(0, 60),
      tourItinerarySamples: catalogue.itineraries.slice(0, 120),
    },
    task:
  "Create a complete but concise personalized itinerary. Return every " +
  "requested day and all required JSON fields. Keep activity descriptions " +
  "brief to avoid response truncation. Ensure activities are distinct " +
  "and destination-specific. Return complete valid JSON.",
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(normalizeBaseUrl(baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 6000,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify(userPrompt),
          },
        ],
      }),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error("AI itinerary provider HTTP error", {
        status: response.status,
        bodyPreview: responseText.slice(0, 1200),
      });
      return null;
    }

    let payload: JsonObject;

    try {
      payload = asObject(JSON.parse(responseText));
      
const choices = Array.isArray(payload.choices)
  ? payload.choices
  : [];

const firstChoice = asObject(choices[0]);

console.info("AI provider response diagnostics", {
  model,
  finishReason: firstChoice.finish_reason ?? "unknown",
  usage: payload.usage ?? null,
});

    } catch {
      console.error("AI provider returned invalid response JSON", {
        contentType: response.headers.get("content-type"),
        bodyPreview: responseText.slice(0, 800),
      });
      return null;
    }

    let assistantContent: string;

    try {
      assistantContent = extractAssistantContent(payload);
    } catch (error) {
      console.error(
        "Could not extract AI itinerary content",
        error instanceof Error ? error.message : "Unknown error",
      );
      return null;
    }

    try {
      
let parsed: unknown;

const jsonCandidate = extractJsonObject(assistantContent);

try {
  // First accept valid JSON without modifying the provider response.
  parsed = JSON.parse(jsonCandidate);
} catch (originalParseError) {
  try {
    // Attempt your existing repair only when ordinary parsing fails.
    const repairedJson = repairModelJson(jsonCandidate);
    parsed = JSON.parse(repairedJson);
  } catch (repairError) {
    console.error("AI itinerary JSON parsing failed", {
      originalParseError:
        originalParseError instanceof Error
          ? originalParseError.message
          : String(originalParseError),

      repairError:
        repairError instanceof Error
          ? repairError.message
          : String(repairError),

      contentLength: assistantContent.length,
      contentStart: assistantContent.slice(0, 500),
      contentEnd: assistantContent.slice(-1000),
    });

    throw new Error(
      "AI returned malformed JSON. Check the logged parse errors " +
      "and whether the provider truncated the response.",
    );
  }
}

const itinerary = normalizeItinerary(parsed, preferences);


      console.info("Normalized AI budget diagnostic", {
  requestedBudget: preferences.budget,
  travellers,
  budgetEstimate: itinerary.budgetEstimate,
  feasibility: itinerary.feasibility,
});

      if (
        !itinerary ||
        !Array.isArray(itinerary.days) ||
        itinerary.days.length !== durationDays
      ) {
        console.error("AI itinerary failed duration validation", {
          expectedDays: durationDays,
          actualDays: itinerary?.days?.length ?? 0,
        });
        return null;
      }

      // Reject generic/repeated output rather than silently presenting it
      // as a successfully generated personalized itinerary.
      const dayTitles = itinerary.days.map((day) =>
        asString(day.title).trim().toLowerCase()
      );

      const uniqueTitles = new Set(dayTitles);

      if (
        dayTitles.some((title) => !title) ||
        uniqueTitles.size < Math.min(durationDays, 3)
      ) {
        console.error("AI itinerary contains missing or repeated day titles");
        return null;
      }

      console.info("AI itinerary generated successfully", {
        model,
        durationDays,
        activityCount: itinerary.days.reduce(
          (total, day) => total + (day.activities?.length ?? 0),
          0,
        ),
      });

      return itinerary;
    } catch (error) {
      console.error(
        "AI itinerary content could not be normalized",
        error instanceof Error ? error.message : "Unknown parsing error",
        { contentPreview: assistantContent.slice(0, 1000) },
      );
      return null;
    }
  } catch (error) {
    console.error("AI itinerary request failed", {
      reason:
        error instanceof Error
          ? error.name === "AbortError"
            ? "Provider request timed out after 45 seconds"
            : error.message
          : "Unknown network error",
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}


function createReference(): string {
  const randomPart = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `AF-${new Date().getUTCFullYear()}-${randomPart.toUpperCase()}`;
}

function getDateRange(preferences: Preferences): string {
  const start = asString(preferences.startDate || preferences.departureDate);
  const end = asString(preferences.endDate || preferences.returnDate);

  if (start && end) return `${start} to ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;

  return `${asNumber(preferences.durationDays, 1, 1, MAX_DAYS)} day(s); dates to be confirmed`;
}

async function getOwnedPlan(
  supabase: SupabaseClient,
  planId: string,
  ownerId: string,
): Promise<JsonObject | null> {
  if (!planId) return null;

  const { data, error } = await supabase
    .from("trip_plans")
    .select("*")
    .eq("id", planId)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    console.error("Trip plan lookup failed", error.message);
    throw new Error("Could not retrieve the trip plan.");
  }

  return (data as JsonObject | null) ?? null;
}

async function savePlan(
  supabase: SupabaseClient,
  ownerId: string,
  body: JsonObject,
): Promise<JsonObject> {
  const planId = asString(body.planId);
  const preferences = normalizePreferences(body.preferences);
  const itinerary = normalizeItinerary(
    body.itinerary,
    preferences,
  );
  const title = asString(body.title, itinerary.title).slice(0, 180);

  let plan: JsonObject;

  if (planId) {
    const existing = await getOwnedPlan(supabase, planId, ownerId);

    if (!existing) {
      throw new Error("Trip plan not found or you do not have access to it.");
    }

    const nextVersion = Math.max(
      1,
      Math.round(asNumber(existing.current_version, 0, 0, 100_000)) + 1,
    );

    const { data: updated, error: updateError } = await supabase
      .from("trip_plans")
      .update({
        title,
        preferences,
        current_version: nextVersion,
        status: "ready",
        updated_at: new Date().toISOString(),
      })
      .eq("id", planId)
      .eq("owner_id", ownerId)
      .select("*")
      .single();

    if (updateError || !updated) {
      console.error("Trip plan update failed", updateError?.message);
      throw new Error("Could not update the trip plan.");
    }

    plan = updated as JsonObject;

    const { error: versionError } = await supabase
      .from("trip_plan_versions")
      .insert({
        plan_id: planId,
        version_number: nextVersion,
        itinerary,
        budget_estimate: itinerary.budgetEstimate,
        change_summary: asString(body.changeSummary, "Updated itinerary").slice(
          0,
          500,
        ),
      });

    if (versionError) {
      console.error("Trip plan version insert failed", versionError.message);
      throw new Error("Plan updated, but its version could not be saved.");
    }
  } else {
    const { data: created, error: createError } = await supabase
      .from("trip_plans")
      .insert({
        owner_id: ownerId,
        title,
        preferences,
        status: "ready",
        current_version: 1,
      })
      .select("*")
      .single();

    if (createError || !created) {
      console.error("Trip plan creation failed", createError?.message);
      throw new Error("Could not create the trip plan.");
    }

    plan = created as JsonObject;

    const { error: versionError } = await supabase
      .from("trip_plan_versions")
      .insert({
        plan_id: created.id,
        version_number: 1,
        itinerary,
        budget_estimate: itinerary.budgetEstimate,
        change_summary: "Initial itinerary",
      });

    if (versionError) {
      console.error("Initial itinerary version insert failed", versionError.message);

      await supabase
        .from("trip_plans")
        .delete()
        .eq("id", created.id)
        .eq("owner_id", ownerId);

      throw new Error("Could not save the initial itinerary version.");
    }
  }

  return { plan, itinerary };
}

async function handleRequest(
  request: Request,
  supabase: SupabaseClient,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return reply(405, { error: "Method not allowed." });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);

  if (contentLength > MAX_BODY_BYTES) {
    return reply(413, { error: "Request body is too large." });
  }

  let body: JsonObject;

  try {
    const text = await request.text();

    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
      return reply(413, { error: "Request body is too large." });
    }

    body = asObject(JSON.parse(text));
  } catch {
    return reply(400, { error: "Request body must be valid JSON." });
  }

  const action = asString(body.action);

  const user = await getAuthenticatedUser(request, supabase);

  // Generating a plan can work without an account. Saving, retrieving,
  // deleting, and submitting enquiries require an authenticated customer.
  const requiresAuth = [
    "save",
    "list",
    "get",
    "delete",
    "submit-enquiry",
  ].includes(action);

  if (requiresAuth && !user) {
    return reply(401, {
      error: "Please sign in to save or manage your trip plans.",
    });
  }

  if (action === "generate") {
    const preferences = normalizePreferences(body.preferences);

    if (!preferences.destination) {
      return reply(400, { error: "Please provide a destination." });
    }

    const catalogue = await loadCatalogue(supabase);
    const aiItinerary = await generateWithAI(preferences, catalogue);
    const usedFallback = !aiItinerary;
    const itinerary = aiItinerary || makeFallbackItinerary(preferences);

    return reply(200, {
      itinerary,
      preferences,
      catalogue,
      usedFallback,
      verifiedFactsNote:
        "Catalogue packages come from AeroFly Tours data. AI-generated activities and all cost estimates are suggestions, not verified live prices or availability.",
      message: usedFallback
        ? "AI generation was unavailable, so a starter itinerary has been created. You can edit it and try generating again later."
        : "Your suggested itinerary is ready. Review all costs and travel details before making decisions.",
    });
  }

  if (action === "save") {
    try {
      const result = await savePlan(supabase, user!.id, body);
      return reply(200, result);
    } catch (error) {
      return reply(400, {
        error:
          error instanceof Error ? error.message : "Could not save the trip plan.",
      });
    }
  }

  if (action === "list") {
    const { data, error } = await supabase
      .from("trip_plans")
      .select("id,title,status,current_version,created_at,updated_at")
      .eq("owner_id", user!.id)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Trip plan list failed", error.message);
      return reply(500, { error: "Could not load your saved trip plans." });
    }

    return reply(200, { plans: data || [] });
  }

  if (action === "get") {
    const planId = asString(body.planId);

    if (!planId) {
      return reply(400, { error: "A planId is required." });
    }

    const plan = await getOwnedPlan(supabase, planId, user!.id);

    if (!plan) {
      return reply(404, { error: "Trip plan not found." });
    }

    const { data: versions, error } = await supabase
      .from("trip_plan_versions")
      .select("*")
      .eq("plan_id", planId)
      .order("version_number", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Trip plan versions lookup failed", error.message);
      return reply(500, { error: "Could not load itinerary versions." });
    }

    return reply(200, {
      plan,
      versions: versions || [],
      itinerary: versions?.[0]?.itinerary ?? null,
    });
  }

  if (action === "delete") {
    const planId = asString(body.planId);

    if (!planId) {
      return reply(400, { error: "A planId is required." });
    }

    const existing = await getOwnedPlan(supabase, planId, user!.id);

    if (!existing) {
      return reply(404, { error: "Trip plan not found." });
    }

    const { error } = await supabase
      .from("trip_plans")
      .delete()
      .eq("id", planId)
      .eq("owner_id", user!.id);

    if (error) {
      console.error("Trip plan delete failed", error.message);
      return reply(500, { error: "Could not delete the trip plan." });
    }

    return reply(200, { success: true, deletedId: planId });
  }

  
if (action === "submit-enquiry") {
  if (body.confirmed !== true) {
    return reply(400, {
      error: "Explicit confirmation is required before submitting an enquiry.",
    });
  }

  const preferences = normalizePreferences(body.preferences);
  const contact = asObject(body.contact);

  const name = asString(contact.name);
  const email = asString(contact.email || user!.email);
  const phone = asString(contact.phone);

  if (!name || (!email && !phone)) {
    return reply(400, {
      error: "Provide your name and at least an email address or phone number.",
    });
  }

  // Load the authoritative saved plan and its latest itinerary version.
  const planId = asString(body.planId);

  if (!planId) {
    return reply(400, {
      error: "Save your itinerary before submitting a custom-trip enquiry.",
    });
  }

 let ownedPlan: JsonObject | null;

try {
  ownedPlan = await getOwnedPlan(supabase, planId, user!.id);
} catch (error) {
  console.error(
    "Failed to verify saved trip plan",
    error instanceof Error ? error.message : error,
  );

  return reply(500, {
    error: "Unable to verify your saved trip plan. Please try again.",
  });
}

if (!ownedPlan) {
  return reply(404, {
    error: "The saved trip plan could not be found for your account.",
  });
}

  const { data: latestVersion, error: versionError } = await supabase
    .from("trip_plan_versions")
    .select("version_number, itinerary, budget_estimate")
    .eq("plan_id", planId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versionError) {
    console.error("Failed to load saved trip itinerary", versionError.message);
    return reply(500, {
      error: "Unable to load your saved itinerary. Please try again.",
    });
  }

  if (!latestVersion) {
    return reply(400, {
      error: "Save a generated itinerary before submitting your enquiry.",
    });
  }

  // Use the saved version, not a potentially incomplete client-side itinerary.
  const savedPreferences = normalizePreferences(ownedPlan.preferences);
  const itinerary = normalizeItinerary(
    latestVersion.itinerary,
    savedPreferences,
  );

  const budgetEstimate =
    latestVersion.budget_estimate &&
    typeof latestVersion.budget_estimate === "object"
      ? latestVersion.budget_estimate
      : itinerary.budgetEstimate;

  const currency = asString(
    asObject(budgetEstimate).currency,
    itinerary.budgetEstimate.currency,
  );

  const total = asNumber(
    asObject(budgetEstimate).total,
    itinerary.budgetEstimate.total,
    0,
    Number.MAX_SAFE_INTEGER,
  );

  const travellers = Math.round(
    asNumber(
      savedPreferences.travellers,
      2,
      1,
      MAX_TRAVELLERS,
    ),
  );

  const fullPlan = {
    planId: ownedPlan.id,
    planTitle: ownedPlan.title,
    planVersion: latestVersion.version_number,
    preferences: savedPreferences,
    itinerary,
    budgetEstimate,
  };

  const message = [
    "Custom trip enquiry created from the AeroFly Tours AI Trip Planner.",
    "",
    `Itinerary: ${itinerary.title}`,
    `Destination: ${itinerary.destination}`,
    `Duration: ${itinerary.durationDays} day(s)`,
    `Travellers: ${travellers}`,
    `Estimated budget: ${currency} ${total}`,
    "",
    "This is an enquiry only. It is not a confirmed booking or payment.",
    "",
    "COMPLETE SAVED TRIP PLAN",
    JSON.stringify(fullPlan, null, 2),
  ].join("\n");

  const enquiry = {
    reference: createReference(),
    name: name.slice(0, 160),
    email: email.slice(0, 320) || null,
    phone: phone.slice(0, 40) || null,
    customer_auth_id: user!.id,
    destination: asString(
      savedPreferences.destination,
      itinerary.destination,
    ).slice(0, 160),
    travelDates: getDateRange(savedPreferences).slice(0, 160),
    travellers,
    budget: `${currency} ${total} (estimate)`.slice(0, 120),
    tripType: "Custom AI Trip Plan",
    message,
    status: "new",
    priority: "normal",
  };

  const { data: createdEnquiry, error: enquiryError } = await supabase
    .from("enquiries")
    .insert(enquiry)
    .select("id,reference,status,createdAt")
    .single();

  if (enquiryError || !createdEnquiry) {
    console.error(
      "Custom trip enquiry creation failed",
      enquiryError?.message,
    );

    return reply(500, {
      error:
        "The enquiry could not be submitted. Your itinerary has not been booked.",
    });
  }

  const { error: updateError } = await supabase
    .from("trip_plans")
    .update({
      status: "enquiry_submitted",
      updated_at: new Date().toISOString(),
    })
    .eq("id", planId)
    .eq("owner_id", user!.id);

  if (updateError) {
    // The enquiry already exists; do not misreport it as a failed submission.
    console.error(
      "Enquiry created but plan status update failed",
      updateError.message,
    );
  }

  return reply(201, {
    success: true,
    enquiry: createdEnquiry,
    message:
      "Your custom trip enquiry has been submitted. AeroFly Tours must review it and issue any booking proposal separately. No booking or payment has been created.",
  });
}


  return reply(400, {
    error:
      "Unsupported action. Use generate, save, list, get, delete, or submit-enquiry.",
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let supabase: SupabaseClient;

  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    console.error(
      "Supabase function configuration error",
      error instanceof Error ? error.message : "Unknown configuration error",
    );
    return reply(500, {
      error: "Server configuration is incomplete.",
    });
  }

  try {
    return await handleRequest(request, supabase);
  } catch (error) {
    console.error(
      "AI trip planner request failed",
      error instanceof Error ? error.message : "Unknown error",
    );

    return reply(500, {
      error: "The trip planner encountered an unexpected error.",
    });
  }
});
