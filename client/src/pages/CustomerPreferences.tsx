import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { supabase } from "@/lib/supabase";

const INTEREST_OPTIONS = [
  "nature",
  "adventure",
  "culture",
  "food",
  "beach",
  "wildlife",
  "history",
  "shopping",
  "family",
  "honeymoon",
  "luxury",
  "spiritual",
];

type Preferences = {
  travel_scope: string;
  preferred_destinations: string[];
  travel_styles: string[];
  interests: string[];
  budget_min: number | null;
  budget_max: number | null;
  personalization_enabled: boolean;
};

const DEFAULTS: Preferences = {
  travel_scope: "both",
  preferred_destinations: [],
  travel_styles: [],
  interests: [],
  budget_min: null,
  budget_max: null,
  personalization_enabled: false,
};

export default function CustomerPreferences() {
  const { user, loading: authLoading } = useAuth();

  const [preferences, setPreferences] =
    useState<Preferences>(DEFAULTS);

  const [destinationsText, setDestinationsText] =
    useState("");

  const [stylesText, setStylesText] = useState("");

  const [budgetMinText, setBudgetMinText] =
    useState("");

  const [budgetMaxText, setBudgetMaxText] =
    useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      type PreferenceRow = Partial<Preferences> & {
  user_id?: string;
  preferred_destinations?: string[] | null;
  travel_styles?: string[] | null;
  interests?: string[] | null;
  budget_min?: number | null;
  budget_max?: number | null;
  personalization_enabled?: boolean | null;
};

const { data: rawData, error: loadError } = await supabase
  .from("customer_preferences")
  .select(
    [
      "travel_scope",
      "preferred_destinations",
      "travel_styles",
      "interests",
      "budget_min",
      "budget_max",
      "personalization_enabled",
    ].join(","),
  )
  .eq("user_id", user.id)
  .maybeSingle();

const data = rawData as unknown as PreferenceRow | null;

      if (!active) return;

      if (loadError) {
        setError("Unable to load your preferences.");
      } else if (data) {
        const next: Preferences = {
          ...DEFAULTS,
          ...data,
          preferred_destinations:
            data.preferred_destinations ?? [],
          travel_styles: data.travel_styles ?? [],
          interests: data.interests ?? [],
          budget_min: data.budget_min ?? null,
          budget_max: data.budget_max ?? null,
          personalization_enabled:
            data.personalization_enabled ?? false,
        };

        setPreferences(next);
        setDestinationsText(
          next.preferred_destinations.join(", "),
        );
        setStylesText(next.travel_styles.join(", "));
        setBudgetMinText(
          next.budget_min == null
            ? ""
            : String(next.budget_min),
        );
        setBudgetMaxText(
          next.budget_max == null
            ? ""
            : String(next.budget_max),
        );
      }

      setLoading(false);
    }

    void load();

    return () => {
      active = false;
    };
  }, [user?.id]);

  function toggleInterest(interest: string) {
    setPreferences((current) => ({
      ...current,
      interests: current.interests.includes(interest)
        ? current.interests.filter(
            (value) => value !== interest,
          )
        : [...current.interests, interest].slice(0, 30),
    }));
  }

  async function savePreferences() {
    if (!user?.id) {
      setError("Sign in to save your preferences.");
      return;
    }

    const min =
      budgetMinText.trim() === ""
        ? null
        : Number(budgetMinText);

    const max =
      budgetMaxText.trim() === ""
        ? null
        : Number(budgetMaxText);

    if (
      (min !== null &&
        (!Number.isFinite(min) || min < 0)) ||
      (max !== null &&
        (!Number.isFinite(max) || max < 0)) ||
      (min !== null &&
        max !== null &&
        min > max)
    ) {
      setError(
        "Enter valid budget amounts. The minimum cannot exceed the maximum.",
      );
      return;
    }

    const destinations = destinationsText
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 30);

    const styles = stylesText
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 30);

    setSaving(true);
    setError("");

    const enabled =
      preferences.personalization_enabled;

    const payload = {
      user_id: user.id,
      travel_scope: preferences.travel_scope,
      preferred_destinations: destinations,
      travel_styles: styles,
      interests: preferences.interests,
      budget_min: min,
      budget_max: max,
      personalization_enabled: enabled,
      updated_consent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error: saveError } = await supabase
      .from("customer_preferences")
      .upsert(payload, { onConflict: "user_id" });

    if (saveError) {
      setError(
        "Could not save preferences. Please try again.",
      );
      setSaving(false);
      return;
    }

    if (!enabled) {
      await supabase
        .from("recommendation_events")
        .delete()
        .eq("user_id", user.id);
    }

    setPreferences((current) => ({
      ...current,
      preferred_destinations: destinations,
      travel_styles: styles,
      budget_min: min,
      budget_max: max,
    }));

    setSaving(false);
    toast.success("Your preferences have been saved.");
  }

  if (authLoading || loading) {
    return (
      <main className="container py-20">
        Loading your preferences…
      </main>
    );
  }

  if (!user) {
    return (
      <main className="container max-w-2xl py-20">
        <h1 className="display text-3xl font-extrabold">
          Sign in to personalize your trips
        </h1>
        <Link href="/login" className="btn btn-primary mt-5">
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f4f1]">
      <div className="container max-w-3xl py-8 sm:py-12">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#77736c]"
        >
          <ArrowLeft size={15} /> Dashboard
        </Link>

        <header className="mt-5">
          <div className="eyebrow">
            Your travel profile
          </div>
          <h1 className="display mt-2 text-4xl font-extrabold">
            Personalization preferences
          </h1>
          <p className="mt-3 text-sm text-[#77736c]">
            Choose what matters to you. Your preferences
            help us rank published tours; they do not
            confirm prices or availability.
          </p>
        </header>

        <section className="mt-6 space-y-6 rounded-2xl border border-[#e8e4dd] bg-white p-5 sm:p-8">
          <label className="block text-sm font-bold">
            Travel preference
            <select
              className="field mt-2"
              value={preferences.travel_scope}
              onChange={(event) =>
                setPreferences((current) => ({
                  ...current,
                  travel_scope: event.target.value,
                }))
              }
            >
              <option value="both">Domestic and international</option>
              <option value="domestic">Domestic India</option>
              <option value="international">
                International
              </option>
            </select>
          </label>

          <label className="block text-sm font-bold">
            Preferred destinations
            <input
              className="field mt-2"
              value={destinationsText}
              onChange={(event) =>
                setDestinationsText(event.target.value)
              }
              placeholder="Kerala, Japan, Dubai"
            />
            <span className="mt-1 block text-xs font-normal text-[#77736c]">
              Separate destinations with commas.
            </span>
          </label>

          <label className="block text-sm font-bold">
            Travel styles
            <input
              className="field mt-2"
              value={stylesText}
              onChange={(event) =>
                setStylesText(event.target.value)
              }
              placeholder="Family, adventure, relaxed"
            />
          </label>

          <fieldset>
            <legend className="text-sm font-bold">
              Interests
            </legend>

            <div className="mt-3 flex flex-wrap gap-2">
              {INTEREST_OPTIONS.map((interest) => {
                const selected =
                  preferences.interests.includes(interest);

                return (
                  <button
                    type="button"
                    key={interest}
                    aria-pressed={selected}
                    onClick={() => toggleInterest(interest)}
                    className={
                      selected
                        ? "rounded-full border border-[#f26b35] bg-[#fff0e8] px-4 py-2 text-sm font-semibold text-[#c94d1c]"
                        : "rounded-full border border-[#e8e4dd] px-4 py-2 text-sm font-semibold text-[#77736c]"
                    }
                  >
                    {interest}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold">
              Minimum budget (₹)
              <input
                type="number"
                min="0"
                className="field mt-2"
                value={budgetMinText}
                onChange={(event) =>
                  setBudgetMinText(event.target.value)
                }
                placeholder="No minimum"
              />
            </label>

            <label className="block text-sm font-bold">
              Maximum budget (₹)
              <input
                type="number"
                min="0"
                className="field mt-2"
                value={budgetMaxText}
                onChange={(event) =>
                  setBudgetMaxText(event.target.value)
                }
                placeholder="No maximum"
              />
            </label>
          </div>

          <div className="rounded-xl border border-[#e8e4dd] p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={
                  preferences.personalization_enabled
                }
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    personalization_enabled:
                      event.target.checked,
                  }))
                }
              />

              <span>
                <span className="block text-sm font-bold">
                  Enable personalized recommendations
                </span>
                <span className="mt-1 block text-xs leading-5 text-[#77736c]">
                  Allow AeroFly to use your selected
                  preferences, wishlist, recent tour views,
                  and recommendation interactions to rank
                  tours. You can turn this off at any time.
                </span>
              </span>
            </label>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void savePreferences()}
            disabled={saving}
          >
            <Save size={15} />
            {saving ? "Saving…" : "Save preferences"}
          </button>
        </section>
      </div>
    </main>
  );
}