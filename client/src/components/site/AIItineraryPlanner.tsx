
import {
  ArrowLeft,
  Check,Clock,Loader2, Pencil, Plus, Save, Sparkles, Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Link } from "wouter";
import { toast } from "sonner";

type Preferences = {
  origin: string;
  destination: string;
  startDate?: string;
  endDate?: string;
  durationDays: number;
  adults: number;
  children: number;
  // infants: number;
  budget: number;
  currency: string;
  style: string;
  interests: string[];
  accommodation?: string;
  accessibility?: string;
  dietary?: string;
  otherRequirements?: string;
};

type Activity = {
  title: string;
  location: string;
  description: string;
  durationMinutes: number;
  estimatedCost: number;
  costCurrency: string;
  costBasis: "per_person" | "per_group" | "included" | "unknown";
  transportSuggestion: string;
  mealSuggestion: string | null;
  sourceType: "aerofly_catalogue" | "general_suggestion";
  catalogueTourSlug: string | null;
};

type Day = {
  dayNumber: number;
  day:number;
  date: string | null;
  destination: string;
  title: string;
  activities: Activity[];
  practicalNotes: string[];
};

type Itinerary = {
  title: string;
  summary: string;
  currency: string;
  assumptions: string[];
  days: Day[];
 budgetEstimate: {
    currency: string;
    breakdown: {
      transport: number | null;
      accommodation: number | null;
      activities: number | null;
      food?: number | null;
      meals?: number | null;
      other: number | null;
    };
    total: number | null;
    notes: string[];
  };
  feasibility: {
    withinBudget: boolean | null;
    explanation: string;
  };
};


type SavedPlan = {
  id: string;
  title: string;
  current_version: number;
  status: string;
  preferences?: Preferences;
};


type Version = {
  version_number: number;
  itinerary: Itinerary;
  budget_estimate: Itinerary["budgetEstimate"];
};

const blankPreferences: Preferences = {
  origin: "",
  destination: "",
  durationDays: 5,
  adults: 2,
  children: 0,
  // infants: 0,
  budget: 80000,
  currency: "INR",
  style: "balanced",
  interests: [],
};


function money(
  amount: number | string | null | undefined,
  currency?: string | null,
): string {
  const numericAmount =
    typeof amount === "number"
      ? amount
      : Number(amount ?? 0);

  const safeAmount = Number.isFinite(numericAmount)
    ? numericAmount
    : 0;

  const candidate = (currency || "INR").trim().toUpperCase();

  // Intl.NumberFormat throws when the currency code is invalid.
  const safeCurrency = /^[A-Z]{3}$/.test(candidate)
    ? candidate
    : "INR";

  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 0,
    }).format(safeAmount);
  } catch {
    return `${safeCurrency} ${Math.round(safeAmount).toLocaleString("en-IN")}`;
  }
}


export default function AIItineraryPlanner() {
  const [preferences, setPreferences] = useState<Preferences>(blankPreferences);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [planId, setPlanId] = useState<string | null>(null);
  const [planTitle, setPlanTitle] = useState("My travel plan");
  const [version, setVersion] = useState(0);
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [enquiryOpen, setEnquiryOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [contact, setContact] = useState({ name: "", email: "", phone: "" });
const [showForm, setShowForm] = useState(true);
const [editingActivity, setEditingActivity] = useState<{
  dayIndex: number;
  activityIndex: number;
} | null>(null);

const [activityDraft, setActivityDraft] = useState<Activity | null>(null);


type ActivityEditorState = {
  dayIndex: number;
  activityIndex: number | null; // null means a new activity
  draft: Activity;
};

const [activityEditor, setActivityEditor] =
  useState<ActivityEditorState | null>(null);

const startAddActivity = (dayIndex: number, day: Day) => {
  setActivityEditor({
    dayIndex,
    activityIndex: null,
    draft: {
      title: "",
      location: day.destination ?? "",
      description: "",
      durationMinutes: 60,
      estimatedCost: 0,
      costCurrency: itinerary?.currency || "INR",
      costBasis: "unknown",
      transportSuggestion: "",
      mealSuggestion: null,
      sourceType: "general_suggestion",
      catalogueTourSlug: null,
    },
  });
};

const startEditActivity = (
  dayIndex: number,
  activityIndex: number,
  activity: Activity,
) => {
  setActivityEditor({
    dayIndex,
    activityIndex,
    draft: { ...activity },
  });
};

const updateActivityDraft = <K extends keyof Activity>(
  field: K,
  value: Activity[K],
) => {
  setActivityEditor((current) =>
    current
      ? {
          ...current,
          draft: {
            ...current.draft,
            [field]: value,
          },
        }
      : current,
  );
};

const saveActivityDraft = () => {
  if (!activityEditor) return;

  if (!activityEditor.draft.title.trim()) {
    alert("Please enter an activity title.");
    return;
  }

  setItinerary((current) => {
    if (!current) return current;

    return {
      ...current,
      days: current.days.map((day, index) => {
        if (index !== activityEditor.dayIndex) return day;

        const activities = [...day.activities];

        if (activityEditor.activityIndex === null) {
          activities.push(activityEditor.draft);
        } else {
          activities[activityEditor.activityIndex] =
            activityEditor.draft;
        }

        return { ...day, activities };
      }),
    };
  });

  setActivityEditor(null);
};

const cancelActivityEdit = () => {
  setActivityEditor(null);
};


const renderActivityForm = (editor: ActivityEditorState) => {
  const fieldClass =
    "w-full rounded-lg border border-[#dedad2] bg-white px-3 py-2 text-sm text-[#25231f] outline-none focus:border-orange-500";

  const labelClass =
    "mb-1 block text-xs font-semibold text-[#77736c]";

  return (
    <div className="rounded-xl border border-orange-200 bg-[#fffaf4] p-4">
      <h4 className="mb-4 font-bold text-[#25231f]">
        {editor.activityIndex === null
          ? "Add new activity"
          : "Edit activity"}
      </h4>

      <div className="space-y-3">
        <div>
          <label className={labelClass}>Activity title *</label>
          <input
            className={fieldClass}
            value={editor.draft.title}
            onChange={(e) =>
              updateActivityDraft("title", e.target.value)
            }
            placeholder="e.g. Visit Dal Lake"
          />
        </div>

        <div>
          <label className={labelClass}>Location</label>
          <input
            className={fieldClass}
            value={editor.draft.location}
            onChange={(e) =>
              updateActivityDraft("location", e.target.value)
            }
            placeholder="Attraction or area"
          />
        </div>

        <div>
          <label className={labelClass}>Description</label>
          <textarea
            className={fieldClass}
            rows={3}
            value={editor.draft.description}
            onChange={(e) =>
              updateActivityDraft("description", e.target.value)
            }
            placeholder="Describe the activity"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Duration (minutes)</label>
            <input
              type="number"
              min={1}
              className={fieldClass}
              value={editor.draft.durationMinutes}
              onChange={(e) =>
                updateActivityDraft(
                  "durationMinutes",
                  Math.max(1, Number(e.target.value) || 1),
                )
              }
            />
          </div>

          <div>
            <label className={labelClass}>Estimated cost</label>
            <input
              type="number"
              min={0}
              className={fieldClass}
              value={editor.draft.estimatedCost}
              onChange={(e) =>
                updateActivityDraft(
                  "estimatedCost",
                  Math.max(0, Number(e.target.value) || 0),
                )
              }
            />
          </div>

          <div>
            <label className={labelClass}>Currency</label>
            <input
              maxLength={3}
              className={fieldClass}
              value={editor.draft.costCurrency}
              onChange={(e) =>
                updateActivityDraft(
                  "costCurrency",
                  e.target.value.toUpperCase(),
                )
              }
            />
          </div>

          <div>
            <label className={labelClass}>Cost applies to</label>
            <select
              className={fieldClass}
              value={editor.draft.costBasis}
              onChange={(e) =>
                updateActivityDraft(
                  "costBasis",
                  e.target.value as Activity["costBasis"],
                )
              }
            >
              <option value="per_person">Per person</option>
              <option value="per_group">Entire group</option>
              <option value="included">Included</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>Transport suggestion</label>
          <textarea
            rows={2}
            className={fieldClass}
            value={editor.draft.transportSuggestion}
            onChange={(e) =>
              updateActivityDraft(
                "transportSuggestion",
                e.target.value,
              )
            }
            placeholder="Taxi, public transport, walking..."
          />
        </div>

        <div>
          <label className={labelClass}>Meal suggestion</label>
          <input
            className={fieldClass}
            value={editor.draft.mealSuggestion ?? ""}
            onChange={(e) =>
              updateActivityDraft(
                "mealSuggestion",
                e.target.value || null,
              )
            }
            placeholder="Optional meal suggestion"
          />
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={cancelActivityEdit}
            className="rounded-lg border border-[#dedad2] px-4 py-2 text-sm text-[#77736c]"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={saveActivityDraft}
            className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
          >
            {editor.activityIndex === null
              ? "Add activity"
              : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
};


  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setPreferences((current) => ({ ...current, [key]: value }));

  
async function invoke<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { data, error: invokeError } =
    await supabase.functions.invoke<T>("ai-trip-planner", {
      body: { action, ...payload },
    });

  if (invokeError) {
    throw new Error(invokeError.message);
  }

  if (data == null) {
    throw new Error("The trip planner returned no data.");
  }

  // Narrow the response safely without asserting that arbitrary T
  // necessarily contains an error property.
  if (
    typeof data === "object" &&
    "error" in data &&
    typeof data.error === "string"
  ) {
    throw new Error(data.error);
  }

  return data;
}


function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

  
async function generate() {
  if (busy) return;

  setBusy(true);
  setError("");
  setNotice("");

  try {
    const durationDays = calculateDurationDays(
      preferences.startDate ?? "",
      preferences.endDate ?? "",
    );

    if (durationDays <= 0) {
      setError("Please select an end date after the start date.");
      return;
    }

    const result = await invoke<{
      itinerary: Itinerary;
      preferences: Preferences;
      verifiedFactsNote?: string;
      usedFallback?: boolean;
      message?: string;
    }>("generate", {
      preferences: {
        ...preferences,
        durationDays,
        durationNights: durationDays - 1,
      },
    });

    if (!result?.itinerary || !Array.isArray(result.itinerary.days)) {
      throw new Error(
        "The planner returned an incomplete itinerary. Please try again.",
      );
    }

    const finalPreferences = result.preferences ?? {
      ...preferences,
      durationDays,
    };

    // Persist the generated itinerary in Supabase.
    const saved = await invoke<{
      plan: SavedPlan;
      itinerary: Itinerary;
    }>("save", {
      planId: planId || undefined,
      title: result.itinerary.title,
      preferences: finalPreferences,
      itinerary: result.itinerary,
      changeSummary: planId
        ? "Regenerated itinerary"
        : "Initial itinerary",
    });

    if (!saved?.plan?.id) {
      throw new Error(
        "The itinerary was generated, but the saved plan was not returned.",
      );
    }

    // Update the current plan and display the generated itinerary.
    setPlanId(saved.plan.id);
    setItinerary(result.itinerary);
    setPreferences(finalPreferences);
    setVersion(saved.plan.current_version || 1);
    setShowForm(false);

    // Refresh the Saved Plans section after persistence succeeds.
    await loadPlans();

    setNotice(
      result.usedFallback
        ? result.message ??
            "Your itinerary was generated and saved."
        : "Your itinerary was generated and saved successfully. Review all costs and travel details before booking.",
    );
  } catch (err) {
    console.error("Trip itinerary generation/save failed:", err);

    setError(
      err instanceof Error
        ? err.message
        : "Unable to generate and save your itinerary. Please try again.",
    );
  } finally {
    setBusy(false);
  }
}


  async function loadPlans() {
    try {
      const result = await invoke<{ plans: SavedPlan[] }>("list");
      setPlans(result.plans);
      console.log(plans)
    } catch {
      // Guests can still generate an itinerary. Saved plans require sign-in.
      setPlans([]);
    }
  }

  useEffect(() => {
    void loadPlans();
  }, []);

  async function save() {
    if (!itinerary) return;
    setBusy(true);
    setError("");

    try {
      const result = await invoke<{
        success: boolean;
        planId: string;
        version: number;
      }>("save", {
        planId,
        title: planTitle,
        preferences,
        itinerary,
        changeSummary: "Saved itinerary from planner",
      });

      setPlanId(result.planId);
      setVersion(result.version);
      toast(`Saved successfully as version ${result.version}.`);
      await loadPlanVersions(result.planId);
      await loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the itinerary. Sign in if required.");
    } finally {
      setBusy(false);
    }
  }

  async function loadPlanVersions(id: string) {
    const result = await invoke<{ plan: SavedPlan; versions: Version[] }>(
      "get",
      { planId: id },
    );

    setPlanId(id);
    setPlanTitle(result.plan.title);
    setPreferences(result.plan.preferences as Preferences);
    setVersions(result.versions);

    const current = result.versions.find(
      (v) => v.version_number === result.plan.current_version,
    );

    if (current) {
      setItinerary(current.itinerary);
      setVersion(current.version_number);
      console.log("itinerary:" ,current.itinerary)
    }
  }

  async function deletePlan(id: string) {
    if (!window.confirm("Delete this saved trip and all its versions?")) return;

    try {
      await invoke("delete", { planId: id });
      if (planId === id) {
        setPlanId(null);
        setItinerary(null);
        setVersions([]);
        setVersion(0);
      }
      await loadPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete this plan.");
    }
  }

  function editActivity(
    dayIndex: number,
    activityIndex: number,
    patch: Partial<Activity>,
  ) {
    setItinerary((current) => {
      if (!current) return current;
      const days = current.days.map((day, index) => {
        if (index !== dayIndex) return day;
        return {
          ...day,
          activities: day.activities.map((activity, i) =>
            i === activityIndex ? { ...activity, ...patch } : activity,
          ),
        };
      });
      return { ...current, days };
    });
  }

  function removeActivity(dayIndex: number, activityIndex: number) {
    setItinerary((current) => {
      if (!current) return current;
      return {
        ...current,
        days: current.days.map((day, index) =>
          index !== dayIndex
            ? day
            : {
                ...day,
                activities: day.activities.filter((_, i) => i !== activityIndex),
              },
        ),
      };
    });
  }

  function addActivity(dayIndex: number) {
    setItinerary((current) => {
      if (!current) return current;

      return {
        ...current,
        days: current.days.map((day, index) =>
          index !== dayIndex
            ? day
            : {
                ...day,
                activities: [
                  ...day.activities,
                  {
                    title: "New activity",
                    location: day.destination,
                    description: "Edit this activity to describe your plans.",
                    durationMinutes: 60,
                    estimatedCost: 0,
                    costCurrency: current.currency,
                    costBasis: "unknown",
                    transportSuggestion: "Confirm local transport before travelling.",
                    mealSuggestion: null,
                    sourceType: "general_suggestion",
                    catalogueTourSlug: null,
                  },
                ],
              },
        ),
      };
    });
  }

  
const updateActivity = (
  dayIndex: number,
  activityIndex: number,
  updates: Partial<Activity>,
) => {
  setItinerary((current) => {
    if (!current) return current;

    return {
      ...current,
      days: current.days.map((day, dIndex) => {
        if (dIndex !== dayIndex) return day;

        return {
          ...day,
          activities: day.activities.map((activity, aIndex) =>
            aIndex === activityIndex
              ? { ...activity, ...updates }
              : activity,
          ),
        };
      }),
    };
  });
};


  function startEditingActivity(dayIndex: number, activityIndex: number) {
  const activity = itinerary?.days[dayIndex]?.activities[activityIndex];
  if (!activity) return;

  setEditingActivity({ dayIndex, activityIndex });
  setActivityDraft({ ...activity });
}

function cancelEditingActivity() {
  setEditingActivity(null);
  setActivityDraft(null);
}

function saveEditingActivity() {
  if (!editingActivity || !activityDraft) return;

  if (!activityDraft.title.trim()) {
    setError("Please enter an activity title.");
    return;
  }

  editActivity(
    editingActivity.dayIndex,
    editingActivity.activityIndex,
    {
      ...activityDraft,
      title: activityDraft.title.trim(),
      location: activityDraft.location.trim(),
      description: activityDraft.description.trim(),
    },
  );

  setError("");
  setEditingActivity(null);
  setActivityDraft(null);
}

  
function formatTripValue(value: unknown): string {
  if (value == null) return "";

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    return value.map(formatTripValue).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;

    // Prefer a human-readable label when the object has one.
    for (const key of [
      "title",
      "name",
      "description",
      "activity",
      "label",
      "location",
      "type",
    ]) {
      if (typeof obj[key] === "string" && obj[key].trim()) {
        return obj[key];
      }
    }

    // Otherwise display its fields as readable text.
    return Object.entries(obj)
      .filter(([, fieldValue]) => fieldValue != null && fieldValue !== "")
      .map(([key, fieldValue]) => {
        const label = key
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/[_-]/g, " ")
          .replace(/^./, (char) => char.toUpperCase());

        return `${label}: ${formatTripValue(fieldValue)}`;
      })
      .join(" · ");
  }

  return "";
}



async function submitEnquiry() {
  if (!planId || !itinerary || !confirmed) {
    setError("Save the itinerary and confirm the information you want to share.");
    return;
  }

  if (!contact.name.trim() || (!contact.email.trim() && !contact.phone.trim())) {
    setError("Enter your name and at least an email address or phone number.");
    return;
  }

  setBusy(true);
  setError("");
  setNotice("");

  try {
    const result = await invoke<{
      success: boolean;
      enquiry: {
        id: number;
        reference: string;
        status: string;
      };
      message: string;
    }>("submit-enquiry", {
      planId,
      confirmed: true,
      contact: {
        name: contact.name.trim(),
        email: contact.email.trim(),
        phone: contact.phone.trim(),
      },
    });

    if (!result?.success || !result.enquiry?.reference) {
      throw new Error("The enquiry response was incomplete. Please check your enquiries before retrying.");
    }

    toast.success("Custom-trip enquiry submitted successfully", {
  description: `Reference: ${result.enquiry.reference}`,
});

    setNotice(
      `${result.message} Reference: ${result.enquiry.reference}`,
    );
    setEnquiryOpen(false);
    setConfirmed(false);

    await loadPlans();
  } catch (err) {
    console.error("Custom trip enquiry submission failed:", err);

    setError(
      err instanceof Error
        ? err.message
        : "Unable to submit your enquiry. Please try again.",
    );
  } finally {
    setBusy(false);
  }
}


  function calculateDurationDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 0;

  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start
  ) {
    return 0;
  }

  return Math.round(
    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
  );
}

const durationDays = calculateDurationDays(
  preferences.startDate ?? "", 
  preferences.endDate ?? ""
);

const durationNights = durationDays > 0 ? durationDays - 1 : 0;

  return (
    <>
    <section className="w-full text-[#25231f]">
        <div className="mx-auto w-full max-w-none">
          <Link href="/" className="mb-4 flex items-center gap-2 text-[12px] font-bold text-[#6f6c66] hover:text-[#c94d1c]">
    <ArrowLeft size={14} /> Back home
    </Link>
          <div className="eyebrow flex items-center gap-2">
            <Sparkles size={14} /> AI trip planner
          </div>
          <h1 className="display mt-3 text-4xl font-extrabold sm:text-6xl ">
            Your trip, thoughtfully <span className="text-[#f26b35]">planned.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[#77736c]">
            Build a day-by-day travel plan, edit activities, compare saved
            versions, and ask AeroFly to review your custom trip.
          </p>

         
<div className="mt-8 space-y-8">
  {/* LANDSCAPE FORM — full width above the draft */}
  {(!itinerary || showForm) && <section className="rounded-2xl border border-[#e4dbcf] bg-white p-5 sm:p-7">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-['Manrope'] text-xl font-extrabold">
          Your trip preferences
        </h2>
        <p className="mt-1 text-sm text-[#77736c]">
          Complete the essentials and optionally personalise your journey.
        </p>
      </div>

      <span className="rounded-full bg-[#f7f5f1] px-3 py-1.5 text-xs font-semibold text-[#77736c]">
        Step 1 · Plan your trip
      </span>
    </div>

<div className="mt-6 grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">      <Field label="Departure city">
        <input
          className="field"
          maxLength={100}
          value={preferences.origin}
          onChange={(e) => update("origin", e.target.value)}
          placeholder="Pune"
        />
      </Field>

      <Field label="Destination or region">
        <input
          className="field"
          maxLength={160}
          required
          value={preferences.destination}
          onChange={(e) => update("destination", e.target.value)}
          placeholder="Kerala, Japan…"
        />
      </Field>


      <Field label="Adults">
        <input
          className="field"
          type="number"
          min={1}
          max={30}
          value={preferences.adults}
          onChange={(e) => update("adults", Number(e.target.value))}
        />
      </Field>

      <Field label="Children">
        <input
          className="field"
          type="number"
          min={0}
          max={30}
          value={preferences.children}
          onChange={(e) => update("children", Number(e.target.value))}
        />
      </Field>

      {/* <Field label="Infants">
        <input
          className="field"
          type="number"
          min={0}
          max={30}
          value={preferences.infants}
          onChange={(e) => update("infants", Number(e.target.value))}
        />
      </Field> */}

      <Field label="Budget">
        <input
          className="field"
          type="number"
          min={0}
          value={preferences.budget}
          onChange={(e) => update("budget", Number(e.target.value))}
        />
      </Field>

      <Field label="Currency">
        <select
          className="field"
          value={preferences.currency}
          onChange={(e) => update("currency", e.target.value)}
        >
          <option value="INR">INR ₹</option>
          <option value="USD">USD $</option>
          <option value="EUR">EUR €</option>
          <option value="GBP">GBP £</option>
          <option value="AED">AED</option>
        </select>
      </Field>

      <Field label="Travel style">
        <select
          className="field"
          value={preferences.style}
          onChange={(e) => update("style", e.target.value)}
        >
          {[
            "balanced",
            "family",
            "honeymoon",
            "adventure",
            "culture",
            "relaxation",
            "luxury",
            "budget",
          ].map((style) => (
            <option key={style} value={style}>
              {style.charAt(0).toUpperCase() + style.slice(1)}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Interests (comma-separated)">
        <input
          className="field"
          value={preferences.interests.join(", ")}
          onChange={(e) =>
            update(
              "interests",
              e.target.value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean)
                .slice(0, 12),
            )
          }
          placeholder="Food, nature, museums"
        />
      </Field>

      <Field label="Accommodation (optional)">
        <input
          className="field"
          maxLength={100}
          value={preferences.accommodation ?? ""}
          onChange={(e) => update("accommodation", e.target.value)}
          placeholder="Boutique hotel"
        />
      </Field>

      <Field label="Dietary requirements (optional)">
        <input
          className="field"
          maxLength={500}
          value={preferences.dietary ?? ""}
          onChange={(e) => update("dietary", e.target.value)}
          placeholder="Vegetarian, allergies…"
        />
      </Field>

      <Field label="Accessibility needs (optional)">
        <input
          className="field"
          maxLength={500}
          value={preferences.accessibility ?? ""}
          onChange={(e) => update("accessibility", e.target.value)}
          placeholder="Step-free access…"
        />
      </Field>
    </div>
       
<div className="mt-5">
  <label className="mb-3 block text-sm font-semibold text-[#51483f]">
    Travel timeline
  </label>

<div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[160px_160px_auto]">    <Field label="Start date">
      <input
        type="date"
        value={preferences.startDate}
        min={new Date().toISOString().slice(0, 10)}
        onChange={(e) =>
          setPreferences((prev) => ({
            ...prev,
            startDate: e.target.value,
            endDate:
              prev.endDate && prev.endDate < e.target.value
                ? ""
                : prev.endDate,
          }))
        }
        className="field w-full min-w-0"
        required
      />
    </Field>

    <Field label="End date">
      <input
        type="date"
        value={preferences.endDate}
        min={preferences.startDate || new Date().toISOString().slice(0, 10)}
        onChange={(e) =>
          setPreferences((prev) => ({
            ...prev,
            endDate: e.target.value,
          }))
        }
        className="field w-full min-w-0"
        required
      />
    </Field>

    {preferences.endDate && (
<div className="flex min-h-12 items-center">
          {durationDays > 0 ? (
          <p className="whitespace-nowrap rounded-lg border border-[#e4dbcf] bg-[#f7f5f1] px-3 py-2 text-sm font-semibold text-[#51483f]">
            {durationDays} {durationDays === 1 ? "day" : "days"} ·{" "}
            {durationNights} {durationNights === 1 ? "night" : "nights"}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select valid dates
          </p>
        )}
      </div>
    )}
  </div>
</div>


      <div className="mt-4 sm:col-span-2 lg:col-span-3 xl:col-span-4">
        <Field label="Other requirements (optional)">
          <textarea
            className="field min-h-20"
            maxLength={1000}
            value={preferences.otherRequirements ?? ""}
            onChange={(e) => update("otherRequirements", e.target.value)}
            placeholder="Anything else we should consider for your trip?"
          />
        </Field>
      </div>

    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[#eee9e1] pt-5">
      <p className="max-w-xl text-xs leading-5 text-[#77736c]">
        Required: departure city, destination and duration. Optional preferences
        can be left blank. Generated costs are estimates, not confirmed quotes.
      </p>

      <button
        type="button"
        onClick={generate}
        disabled={
          busy ||
          !preferences.origin.trim() ||
          !preferences.destination.trim() ||
          preferences.durationDays < 1 ||
          preferences.durationDays > 30 ||
          (Boolean(preferences.startDate) &&
            Boolean(preferences.endDate) &&
            preferences.endDate! < preferences.startDate!)
        }
        className="btn btn-primary min-w-42"
      >
        {busy ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <Sparkles size={15} />
        )}
        Generate Plan
      </button>
    </div>

    {error && (
      <p role="alert" className="mt-4 text-sm text-red-700">
        {error}
      </p>
    )}

    {notice && (
      <p role="status" className="mt-3 text-xs leading-5 text-[#77736c]">
        {notice}
      </p>
    )}
  </section>}

  {/* FULL-WIDTH DRAFT — below the preferences form */}
 
<section className="min-w-0">
  {itinerary && (
    <>
      {/* Itinerary header */}
      <div className="rounded-2xl bg-[#20201e] p-5 text-white sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="eyebrow text-[#ffac88]">
              Custom AI itinerary · Not a booking
            </div>

            <input
              value={planTitle}
              maxLength={160}
              onChange={(e) => setPlanTitle(e.target.value)}
              aria-label="Trip plan title"
              className="mt-3 w-full border-0 border-b border-white/20 bg-transparent py-2 font-['Manrope'] text-2xl font-extrabold text-white focus:border-[#f26b35] focus:outline-none"
            />

            <p className="mt-3 text-sm leading-6 text-white/70">
              {itinerary.summary}
            </p>

            {version > 0 && (
              <p className="mt-2 text-xs text-[#ffac88]">
                Saved version {version}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="btn btn-primary"
            >
              <Save size={14} />
              {busy ? "Saving..." : "Save version"}
            </button>

            <button
              type="button"
              onClick={() => setShowForm(true)}
              disabled={busy}
              className="btn border border-white/20 text-white"
            >
              <Sparkles size={14} /> Regenerate
            </button>

            <button
              type="button"
              onClick={() => setEnquiryOpen(true)}
              disabled={!planId || busy}
              className="btn border border-white/20 text-white"
            >
              Request custom-trip review
            </button>
          </div>
        </div>
      </div>

      {/* Budget summary */}
      <section className="mt-5 rounded-2xl border border-[#e4dbcf] bg-white p-5 sm:p-6">
        <p className="text-sm text-[#77736c]">
          Estimated total trip budget
        </p>

        <p className="mt-1 font-['Manrope'] text-3xl font-extrabold text-[#25231f]">
          {itinerary.budgetEstimate.total != null
            ? money(
                itinerary.budgetEstimate.total,
                itinerary.budgetEstimate.currency || itinerary.currency,
              )
            : "Estimate unavailable"}
        </p>

        <p className="mt-2 text-xs text-[#77736c]">
          Planning estimate only. Confirm current prices and availability with AeroFly Tours.
        </p>

        
<div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
  {(
    [
      ["Transport", itinerary.budgetEstimate.breakdown?.transport],
      ["Accommodation", itinerary.budgetEstimate.breakdown?.accommodation],
      ["Activities", itinerary.budgetEstimate.breakdown?.activities],
      [
        "Meals",
        itinerary.budgetEstimate.breakdown?.food ??
          itinerary.budgetEstimate.breakdown?.meals,
      ],
      ["Other", itinerary.budgetEstimate.breakdown?.other],
    ] as const
  ).map(([label, amount]) => (
    <div
      key={label}
      className="rounded-xl bg-[#f7f5f1] p-3"
    >
      <p className="text-xs text-[#77736c]">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-[#25231f]">
        {typeof amount === "number" && Number.isFinite(amount)
          ? money(
              amount,
              itinerary.budgetEstimate.currency || itinerary.currency || "INR",
            )
          : "Not estimated"}
      </p>
    </div>
  ))}
</div>


        {(itinerary.budgetEstimate.notes || []).length > 0 && (
          <ul className="mt-4 space-y-1">
            {itinerary.budgetEstimate.notes.map((note, index) => (
              <li
                key={index}
                className="text-xs leading-5 text-[#77736c]"
              >
                • {note}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Daily itinerary */}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {itinerary.days.map((day, dayIndex) => (
          <article
            key={`${day.dayNumber}-${dayIndex}`}
            className="min-w-0 rounded-2xl border border-[#e4dbcf] bg-white p-4 sm:p-5"
          >
            <div className="eyebrow">
              Day {day.dayNumber || day.day}
              {day.date ? ` · ${day.date}` : ""}
            </div>

            <h3 className="mt-2 font-['Manrope'] text-xl font-extrabold">
              {day.title
                .replace(/^day\s*\d+\s*[:—–-]?\s*/i, "")
                .replace(/\s*[-—–:]\s*day\s*\d+\s*$/i, "")}
            </h3>

            {day.destination && (
              <p className="mt-1 text-xs text-[#77736c]">
                {day.destination}
              </p>
            )}

           

<div className="mt-4 space-y-3">
  {day.activities.map((activity, activityIndex) => {
    const isEditing =
      activityEditor?.dayIndex === dayIndex &&
      activityEditor.activityIndex === activityIndex;

    if (isEditing && activityEditor) {
      return (
        <div key={`${day.dayNumber}-${activityIndex}`}>
          {renderActivityForm(activityEditor)}
        </div>
      );
    }

    return (
      <div
        key={`${day.dayNumber}-${activityIndex}`}
        className="rounded-xl bg-[#f7f5f1] p-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="font-bold text-[#25231f]">
              {activity.title || "Untitled activity"}
            </h4>

            {activity.location && (
              <p className="mt-1 text-xs text-[#77736c]">
                {activity.location}
              </p>
            )}

            {activity.description && (
              <p className="mt-2 text-xs leading-5 text-[#77736c]">
                {activity.description}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-[#77736c]">
              <span>
                {activity.durationMinutes > 0
                  ? `${activity.durationMinutes} min`
                  : "Duration not estimated"}
              </span>

              <span>
                {activity.costBasis === "included"
                  ? "Included"
                  : activity.estimatedCost > 0
                    ? money(
                        activity.estimatedCost,
                        activity.costCurrency || itinerary.currency,
                      )
                    : "Cost estimate unavailable"}
              </span>
            </div>

            {activity.transportSuggestion && (
              <p className="mt-2 text-xs leading-5 text-[#77736c]">
                <strong>Transport:</strong>{" "}
                {activity.transportSuggestion}
              </p>
            )}

            {activity.mealSuggestion && (
              <p className="mt-2 text-xs leading-5 text-[#77736c]">
                <strong>Meal suggestion:</strong>{" "}
                {activity.mealSuggestion}
              </p>
            )}

            <p className="mt-2 text-[10px] text-[#77736c]">
              {activity.sourceType === "aerofly_catalogue"
                ? "AeroFly catalogue activity"
                : "General travel suggestion"}
              {activity.costBasis === "per_person"
                ? " · Cost per person"
                : activity.costBasis === "per_group"
                  ? " · Cost for the group"
                  : ""}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() =>
                startEditActivity(dayIndex, activityIndex, activity)
              }
              className="rounded-lg px-3 py-2 text-xs font-semibold text-orange-700 hover:bg-orange-50"
              aria-label={`Edit ${activity.title}`}
            >
              <Pencil size={14} />
            </button>

            <button
              type="button"
              onClick={() =>
                removeActivity(dayIndex, activityIndex)
              }
              className="rounded-lg p-2 text-[#77736c] hover:bg-red-50 hover:text-red-700"
              aria-label={`Remove ${activity.title}`}
              title="Delete activity"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  })}

  {/* New activity form appears only after Add activity is clicked */}
  {activityEditor?.dayIndex === dayIndex &&
    activityEditor.activityIndex === null &&
    renderActivityForm(activityEditor)}

  {day.activities.length === 0 &&
    !(
      activityEditor?.dayIndex === dayIndex &&
      activityEditor.activityIndex === null
    ) && (
      <p className="rounded-xl bg-[#f7f5f1] p-3 text-sm text-[#77736c]">
        No activities have been added to this day yet.
      </p>
    )}
</div>



            {(day.practicalNotes ?? []).length > 0 && (
              <div className="mt-4 space-y-2">
                {day.practicalNotes.map((note, index) => (
                  <p
                    key={index}
                    className="text-xs leading-5 text-[#77736c]"
                  >
                    • {note}
                  </p>
                ))}
              </div>
            )}

            <button
              type="button"
              disabled={activityEditor !== null}
              onClick={() => startAddActivity(dayIndex, day)}
              className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-[#c94d1c]"
            >
              <Plus size={14} /> Add activity
            </button>
          </article>
        ))}
      </div>

      {/* Assumptions */}
      {(itinerary.assumptions ?? []).length > 0 && (
        <section className="mt-5 rounded-2xl border border-[#e4dbcf] bg-white p-5">
          <h3 className="font-['Manrope'] text-lg font-extrabold">
            Planning assumptions
          </h3>

          <ul className="mt-3 space-y-2">
            {itinerary.assumptions.map((assumption, index) => (
              <li
                key={index}
                className="text-sm leading-6 text-[#77736c]"
              >
                • {assumption}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Feasibility */}
      <section className="mt-5 rounded-2xl border border-[#e4dbcf] bg-white p-5">
        <h3 className="font-['Manrope'] text-lg font-extrabold">
          Budget feasibility
        </h3>

        <p className="mt-2 text-sm leading-6 text-[#77736c]">
          {itinerary.feasibility?.explanation ||
            "Budget feasibility has not been determined."}
        </p>

        {itinerary.feasibility?.withinBudget != null && (
          <p className="mt-2 text-sm font-semibold">
            {itinerary.feasibility?.withinBudget
              ? "Within your stated budget"
              : "May exceed your stated budget"}
          </p>
        )}
      </section>

      {/* Keep your existing version-comparison section here unchanged. */}
    </>
  )}
</section>


  {/* SAVED TRIPS — full-width section at the bottom */}
  <section className="rounded-2xl border border-[#e4dbcf] bg-white p-5 sm:p-6">
    <h2 className="font-['Manrope'] text-xl font-extrabold">
      Your saved trips
    </h2>
    <p className="mt-1 text-sm text-[#77736c]">
      Open a previous plan or delete a saved trip.
    </p>

    <button
      type="button"
      onClick={loadPlans}
      className="mt-3 text-xs font-bold text-[#c94d1c]"
    >
      Refresh saved trips
    </button>

    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {plans.map((plan) => (
        <div
          key={plan.id}
          className="flex min-w-0 items-center gap-3 rounded-xl border border-[#eee9e1] p-3"
        >
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-sm font-bold"
            onClick={() =>
              loadPlanVersions(plan.id).catch((e) => setError(e.message))
            }
          >
            {plan.title}
            <span className="mt-1 block text-[10px] font-normal text-[#77736c]">
              Version {plan.current_version}
            </span>
          </button>

          <button
            type="button"
            title="Delete saved trip"
            aria-label={`Delete ${plan.title}`}
            onClick={() => deletePlan(plan.id)}
            className="rounded-lg p-2 text-[#77736c] hover:bg-red-50 hover:text-red-700"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  </section>
</div>

        </div>

        
{enquiryOpen && itinerary && (
  <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trip-enquiry-title"
      className="my-4 max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 sm:p-6"
    >
      <h2
        id="trip-enquiry-title"
        className="font-['Manrope'] text-2xl font-extrabold text-[#25231f]"
      >
        Review your custom-trip enquiry
      </h2>

      <p className="mt-3 text-sm leading-6 text-[#77736c]">
        Review the complete proposed itinerary and your contact details.
        AeroFly staff will review your request and issue a booking proposal
        separately. This does not create a booking or payment.
      </p>

      {/* Trip overview */}
      <section className="mt-5 rounded-xl bg-[#f7f5f1] p-4">
        <h3 className="mb-3 font-bold text-[#25231f]">Trip overview</h3>

        <div className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <p><strong>Plan:</strong> {planTitle}</p>
          <p>
            <strong>Route:</strong>{" "}
            {preferences.origin || "Not specified"} →{" "}
            {preferences.destination}
          </p>
          <p>
            <strong>Duration:</strong>{" "}
            {preferences.durationDays} days
            {Math.max(0, preferences.durationDays - 1)} nights
          </p>
          <p>
  <strong>Travellers:</strong>{" "}
  {preferences.adults + (preferences.children ?? 0)}
</p>
          <p>
            <strong>Travel dates:</strong>{" "}
            {preferences.startDate || "Not selected"} –{" "}
            {preferences.endDate || "Not selected"}
          </p>
          <p>
            <strong>Budget preference:</strong>{" "}
            {money(preferences.budget, preferences.currency)}
          </p>
          <p className="sm:col-span-2">
            <strong>Estimated trip cost:</strong>{" "}
            {money(itinerary.budgetEstimate.total, itinerary.currency)}
          </p>
          <p className="sm:col-span-2">
            <strong>Activities:</strong>{" "}
            {itinerary.days.reduce(
              (count, day) =>
                count +
                (Array.isArray(day.activities) ? day.activities.length : 0),
              0,
            )}
          </p>
        </div>
      </section>

      {/* Complete generated itinerary */}
      

{/* Complete generated itinerary */}
<section className="mt-5">
  <h3 className="text-lg font-extrabold text-[#25231f]">
    Complete plan (Day by Day)
  </h3>

  <div className="mt-3 space-y-4">
    {itinerary.days.map((day, index) => (
      <article
        key={day.dayNumber ?? index}
        className="rounded-xl border border-[#e4dbcf] bg-white p-4 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f7f0e7] text-sm font-bold text-[#b85b25]">
            {day.dayNumber ?? index + 1}
          </div>

          <div className="min-w-0 flex-1">
            <h4 className="font-bold text-[#25231f]">
              {day.title || `Day ${index + 1}`}
            </h4>

            {Array.isArray(day.activities) &&
              day.activities.length > 0 && (
                <ul className="mt-3 space-y-2">
                  
{day.activities.map((activity, activityIndex) => {
  const isEditing =
    editingActivity?.dayIndex === index &&
    editingActivity?.activityIndex === activityIndex;

  return (
    <div
      key={`${index}-${activityIndex}`}
      className="rounded-xl border border-[#e4dbcf] p-4"
    >
      {isEditing && activityDraft ? (
        <div className="space-y-3">
          <label className="block text-xs font-semibold">
            Activity title
            <input
              value={activityDraft.title}
              onChange={(event) =>
                setActivityDraft({
                  ...activityDraft,
                  title: event.target.value,
                })
              }
              className="mt-1 w-full rounded-lg border p-2"
            />
          </label>

          <label className="block text-xs font-semibold">
            Location
            <input
              value={activityDraft.location}
              onChange={(event) =>
                setActivityDraft({
                  ...activityDraft,
                  location: event.target.value,
                })
              }
              className="mt-1 w-full rounded-lg border p-2"
            />
          </label>

          <label className="block text-xs font-semibold">
            Description
            <textarea
              value={activityDraft.description}
              onChange={(event) =>
                setActivityDraft({
                  ...activityDraft,
                  description: event.target.value,
                })
              }
              rows={3}
              className="mt-1 w-full rounded-lg border p-2"
            />
          </label>

          <label className="block text-xs font-semibold">
            Duration (minutes)
            <input
              type="number"
              min={0}
              value={activityDraft.durationMinutes}
              onChange={(event) =>
                setActivityDraft({
                  ...activityDraft,
                  durationMinutes: Math.max(
                    0,
                    Number(event.target.value) || 0,
                  ),
                })
              }
              className="mt-1 w-full rounded-lg border p-2"
            />
          </label>

          <label className="block text-xs font-semibold">
            Estimated cost ({activityDraft.costCurrency})
            <input
              type="number"
              min={0}
              value={activityDraft.estimatedCost}
              onChange={(event) =>
                setActivityDraft({
                  ...activityDraft,
                  estimatedCost: Math.max(
                    0,
                    Number(event.target.value) || 0,
                  ),
                })
              }
              className="mt-1 w-full rounded-lg border p-2"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveEditingActivity}
              className="btn"
            >
              Save
            </button>

            <button
              type="button"
              onClick={cancelEditingActivity}
              className="btn border"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="font-semibold">{activity.title}</h4>
              <p className="mt-1 text-sm text-gray-600">
                {activity.location}
              </p>
              <p className="mt-2 text-sm">{activity.description}</p>
              <p className="mt-2 text-xs text-gray-500">
                {activity.durationMinutes} minutes ·{" "}
                {activity.costCurrency} {activity.estimatedCost}
              </p>
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() =>
                  startEditingActivity(index, activityIndex)
                }
                className="text-sm font-semibold text-[#c94d1c]"
              >
                Edit
              </button>

              <button
                type="button"
                onClick={() => removeActivity(index, activityIndex)}
                className="text-sm font-semibold text-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
})}

                </ul>
              )}
          </div>
        </div>
      </article>
    ))}
  </div>
</section>



      {/* Budget breakdown */}
     <div className="mt-3 space-y-2 text-sm text-[#5f5c56]">
  {(
    [
      ["Transport", itinerary.budgetEstimate.breakdown.transport],
      ["Accommodation", itinerary.budgetEstimate.breakdown.accommodation],
      ["Activities", itinerary.budgetEstimate.breakdown.activities],
      ["Meals", itinerary.budgetEstimate.breakdown.meals],
      ["Other", itinerary.budgetEstimate.breakdown.other],
    ] as const
  ).map(([label, amount]) =>
    amount != null ? (
      <p key={label} className="flex justify-between gap-3">
        <span>{label}</span>
        <span>
          {money(amount, itinerary.budgetEstimate.currency)}
        </span>
      </p>
    ) : null
  )}

  <div className="border-t border-[#e4dbcf] pt-2 font-bold">
    <p className="flex justify-between gap-3">
      <span>Estimated total</span>
      <span>
        {money(
          itinerary.budgetEstimate.total,
          itinerary.budgetEstimate.currency
        )}
      </span>
    </p>
  </div>

{(itinerary.budgetEstimate.notes ?? []).length > 0 && (    <ul className="list-disc space-y-1 pl-5 text-xs">
      {itinerary.budgetEstimate.notes.map((note, index) => (
        <li key={index}>{note}</li>
      ))}
    </ul>
  )}
</div>

      {/* Contact details */}
      <section className="mt-5">
        <h3 className="mb-3 font-bold text-[#25231f]">
          Your contact details
        </h3>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <input
              className="field"
              value={contact.name}
              onChange={(e) =>
                setContact({ ...contact, name: e.target.value })
              }
            />
          </Field>

          <Field label="Phone">
            <input
              className="field"
              type="tel"
              value={contact.phone}
              onChange={(e) =>
                setContact({ ...contact, phone: e.target.value })
              }
            />
          </Field>

          <div className="sm:col-span-2">
            <Field label="Email">
              <input
                className="field"
                type="email"
                value={contact.email}
                onChange={(e) =>
                  setContact({ ...contact, email: e.target.value })
                }
              />
            </Field>
          </div>
        </div>
      </section>

      {/* Explicit consent */}
      <label className="mt-5 flex items-start gap-2 text-xs leading-5 text-[#5f5c56]">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-1"
        />
        <span>
          I confirm that AeroFly may receive my contact details and this
          complete itinerary to review my custom-trip enquiry. I understand
          this is not a booking confirmation or a payment request.
        </span>
      </label>

      {/* Actions */}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => setEnquiryOpen(false)}
          disabled={busy}
          className="btn btn-ghost"
        >
          Cancel
        </button>

        <button
          type="button"
          disabled={
            !confirmed ||
            busy ||
            !contact.name.trim() ||
            (!contact.email.trim() && !contact.phone.trim())
          }
          onClick={submitEnquiry}
          className="btn btn-primary"
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Check size={14} />
          )}
          {busy ? "Submitting..." : "Confirm and submit enquiry"}
        </button>
      </div>
    </div>
  </div>
)}

    </section>
     </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.12em] text-[#77736c]">
        {label}
      </span>
      {children}
    </label>
  );
}
