import { useEffect, useState } from "react";
import { ArrowLeft, Languages, Save } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { supabase } from "@/lib/supabase";

type ContentEntity = {
  id: string;
  title: string;
  detail?: string;
};

const CURRENCIES = [
  "INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD",
  "CAD", "JPY", "CHF", "NZD", "HKD", "SEK", "NOK",
  "DKK", "BRL", "ZAR", "THB", "MYR", "PHP", "IDR",
];

const FIELDS: Record<string, string[]> = {
  tour: [
    "title", "overview", "highlights", "inclusions",
    "exclusions", "itinerary", "faq", "visa", "safety",
    "legal", "financial_policy",
  ],
  destination: [
    "name", "tagline", "description", "country",
    "region", "attractions", "faq", "visa", "safety",
  ],
  itinerary: [
    "title", "description", "activities",
    "accommodation", "location",
  ],
  attraction: ["name", "description"],
  knowledge_document: ["title", "content"],
  faq: ["question", "answer"],
  policy: ["title", "body"],
  company: ["title", "body"],
};

export default function AdminLocalizationSettings() {
  const { user } = useAuth();

  const [entityType, setEntityType] = useState("tour");
  const [entities, setEntities] = useState<ContentEntity[]>([]);
  const [entityId, setEntityId] = useState("");
  const [language, setLanguage] = useState("mr");
  const [field, setField] = useState("title");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("missing");
  const [ratesText, setRatesText] = useState("INR=1");
  const [rateSource, setRateSource] = useState(
    "Manual admin configuration",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canManageTours = Boolean(
    user?.permissions?.includes("tours.manage"),
  );
  const canManageKnowledge = Boolean(
    user?.permissions?.includes("knowledge.manage"),
  );
  const canManageSettings = Boolean(
    user?.permissions?.includes("settings.manage"),
  );
  const canManage =
    canManageTours ||
    canManageKnowledge ||
    canManageSettings;

  const selectedEntity = entities.find(
    (item) => item.id === entityId,
  );

  useEffect(() => {
    if (!canManageTours && canManageKnowledge) {
      setEntityType("knowledge_document");
    }
  }, [canManageTours, canManageKnowledge]);

  useEffect(() => {
    if (
      (entityType === "knowledge_document" &&
        !canManageKnowledge) ||
      (entityType !== "knowledge_document" &&
        !canManageTours)
    ) {
      return;
    }

    let active = true;

    async function loadEntities() {
      setEntities([]);
      setEntityId("");
      setValue("");

      let result: ContentEntity[] = [];

      if (entityType === "tour") {
        const { data, error } = await supabase
          .from("tours")
          .select("id,title,slug,tour_kind")
          .order("title")
          .limit(300);

        if (error) throw error;

        result = (data ?? []).map((row) => ({
          id: String(row.id),
          title: row.title,
          detail: `${row.slug} · ${row.tour_kind}`,
        }));
      } else if (entityType === "destination") {
        const { data, error } = await supabase
          .from("destinations")
          .select("id,name,slug,country")
          .order("name")
          .limit(300);

        if (error) throw error;

        result = (data ?? []).map((row) => ({
          id: String(row.id),
          title: row.name,
          detail: `${row.country} · ${row.slug}`,
        }));
      } else if (entityType === "attraction") {
        const { data, error } = await supabase
          .from("destination_attractions")
          .select("id,name,description,destinationId")
          .eq("is_public", true)
          .order("name")
          .limit(500);

        if (error) throw error;

        result = (data ?? []).map((row) => ({
          id: String(row.id),
          title: row.name,
          detail: `Destination ${row.destinationId}`,
        }));
      } else if (entityType === "itinerary") {
        const { data, error } = await supabase
          .from("tour_itineraries")
          .select("id,title,dayNumber,tourId")
          .order("tourId")
          .order("dayNumber")
          .limit(500);

        if (error) throw error;

        result = (data ?? []).map((row) => ({
          id: String(row.id),
          title: row.title || `Day ${row.dayNumber}`,
          detail: `Tour ${row.tourId} · Day ${row.dayNumber}`,
        }));
      } else if (entityType === "knowledge_document") {
        if (!canManageKnowledge) {
          throw new Error(
            "knowledge.manage permission is required.",
          );
        }

        const { data, error } = await supabase
          .from("knowledge_documents")
          .select("id,title,category,visibility")
          .order("title")
          .limit(500);

        if (error) throw error;

        result = (data ?? []).map((row) => ({
          id: String(row.id),
          title: row.title,
          detail: `${row.category} · ${row.visibility}`,
        }));
      }

      if (active) setEntities(result);
    }

    void loadEntities().catch((reason: unknown) => {
      if (active) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to load content.",
        );
      }
    });

    return () => {
      active = false;
    };
  }, [
    canManageTours,
    canManageKnowledge,
    entityType,
  ]);

  useEffect(() => {
    let active = true;

    if (
      !entityId ||
      (!canManageTours &&
        !(entityType === "knowledge_document" &&
          canManageKnowledge))
    ) {
      return () => {
        active = false;
      };
    }

    void supabase
      .from("content_translations")
      .select("translated_value,review_status")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .eq("language_code", language)
      .eq("field_key", field)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setValue(data?.translated_value ?? "");
        setStatus(data?.review_status ?? "missing");
      });

    return () => {
      active = false;
    };
  }, [
    entityId,
    entityType,
    language,
    field,
    canManageTours,
    canManageKnowledge,
  ]);

  async function saveTranslation() {
    if (
      !(
        canManageTours ||
        (entityType === "knowledge_document" &&
          canManageKnowledge)
      )
    ) {
      setError(
        "The appropriate content-management permission is required.",
      );
      return;
    }

    if (!selectedEntity) {
      setError("Select a content item first.");
      return;
    }

    if (!value.trim()) {
      setError("Translation text cannot be empty.");
      return;
    }

    setLoading(true);
    setError("");

    const now = new Date().toISOString();
    const requiresApproval = [
      "visa",
      "safety",
      "legal",
      "financial_policy",
      "cancellation_policy",
    ].includes(field);

    const { error: saveError } = await supabase
      .from("content_translations")
      .upsert(
        {
          entity_type: entityType,
          entity_id: entityId,
          language_code: language,
          field_key: field,
          translated_value: value.trim(),
          review_status: status,
          requires_approval:
            requiresApproval ||
            Boolean(
              entityType === "knowledge_document" &&
              selectedEntity.detail &&
              /visa|policy|safety|legal/i.test(
                selectedEntity.detail,
              ),
            ),
          reviewed_by:
            status === "reviewed" ||
            status === "published"
              ? user?.id
              : null,
          reviewed_at:
            status === "reviewed" ||
            status === "published"
              ? now
              : null,
          published_at:
            status === "published" ? now : null,
          updated_by: user?.id,
          updated_at: now,
        },
        {
          onConflict:
            "entity_type,entity_id,language_code,field_key",
        },
      );

    setLoading(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    toast.success("Translation saved.");
  }

  async function saveRates() {
    if (!canManageSettings) {
      setError(
        "The settings.manage permission is required.",
      );
      return;
    }

    const rates: Record<string, number> = {};

    for (const part of ratesText.split(",")) {
      const [rawCode, rawValue] = part
        .split("=")
        .map((item) => item.trim());

      const code = rawCode?.toUpperCase();
      const rate = Number(rawValue);

      if (
        !code ||
        !CURRENCIES.includes(code) ||
        !Number.isFinite(rate) ||
        rate <= 0
      ) {
        setError(`Invalid currency rate: ${part}`);
        return;
      }

      rates[code] = rate;
    }

    if (rates.INR !== 1) {
      setError(
        "INR=1 is required. Enter foreign currency units per ₹1.",
      );
      return;
    }

    setLoading(true);
    setError("");

    const { error: rateError } = await supabase.rpc(
      "phase14_set_manual_currency_rates",
      {
        p_rates: rates,
        p_source: rateSource,
        p_fetched_at: new Date().toISOString(),
      },
    );

    setLoading(false);

    if (rateError) {
      setError(rateError.message);
      return;
    }

    toast.success(
      "Manual exchange rates saved. Refresh the site to reload them.",
    );
  }

  if (!canManage) {
    return (
      <main className="container py-16">
        <h1 className="display text-3xl font-extrabold">
          Access restricted
        </h1>
        <p className="mt-3 text-sm">
          An appropriate management permission is required.
        </p>
        <Link
          href="/admin"
          className="btn btn-primary mt-5"
        >
          Return to admin
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f4f1]">
      <div className="container max-w-5xl py-8 sm:py-12">
        <Link
          href="/admin"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#77736c]"
        >
          <ArrowLeft size={15} /> Admin workspace
        </Link>

        <header className="mt-5">
          <div className="eyebrow flex items-center gap-2">
            <Languages size={14} /> Phase 14
          </div>
          <h1 className="display mt-2 text-4xl font-extrabold">
            Languages, translations & currencies
          </h1>
          <p className="mt-3 text-sm text-[#77736c]">
            English is the fallback. Sensitive travel guidance
            requires reviewed content.
          </p>
        </header>

        {error && (
          <div
            role="alert"
            className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {(canManageTours || canManageKnowledge) && (
          <section className="mt-6 rounded-2xl border border-[#e8e4dd] bg-white p-6">
            <h2 className="font-['Manrope'] text-xl font-extrabold">
              Public content translations
            </h2>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold">
                Content type
                <select
                  className="field mt-2"
                  value={entityType}
                  onChange={(event) => {
                    setEntityType(event.target.value);
                    setField("title");
                  }}
                >
                  {canManageTours && (
                    <>
                      <option value="tour">Tour</option>
                      <option value="destination">Destination</option>
                      <option value="itinerary">Itinerary day</option>
                      <option value="attraction">Attraction</option>
                    </>
                  )}
                  {canManageKnowledge && (
                    <option value="knowledge_document">
                      Knowledge-base document
                    </option>
                  )}
                </select>
              </label>

              <label className="text-sm font-semibold">
                Content item
                <select
                  className="field mt-2"
                  value={entityId}
                  onChange={(event) =>
                    setEntityId(event.target.value)
                  }
                >
                  <option value="">Select content</option>
                  {entities.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                      {item.detail ? ` · ${item.detail}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-semibold">
                Language
                <select
                  className="field mt-2"
                  value={language}
                  onChange={(event) =>
                    setLanguage(event.target.value)
                  }
                >
                  <option value="mr">Marathi</option>
                  <option value="hi">Hindi (future language)</option>
                </select>
              </label>

              <label className="text-sm font-semibold">
                Content field
                <select
                  className="field mt-2"
                  value={field}
                  onChange={(event) =>
                    setField(event.target.value)
                  }
                >
                  {(FIELDS[entityType] ?? ["title", "body"]).map(
                    (name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <label className="text-sm font-semibold">
                Review status
                <select
                  className="field mt-2"
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value)
                  }
                >
                  <option value="missing">Missing translation</option>
                  <option value="draft">Draft</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="published">Published</option>
                </select>
              </label>
            </div>

            <label className="mt-4 block text-sm font-semibold">
              Translated text
              <textarea
                className="field mt-2 min-h-32"
                maxLength={12000}
                value={value}
                onChange={(event) =>
                  setValue(event.target.value)
                }
                placeholder="Enter reviewed translation…"
              />
            </label>

            <button
              className="btn btn-primary mt-4"
              disabled={loading || !selectedEntity}
              onClick={() => void saveTranslation()}
            >
              <Save size={15} />
              {loading ? "Saving…" : "Save translation"}
            </button>
          </section>
        )}

        {canManageTours && <TourClassificationManager />}

        {canManageSettings && (
          <section className="mt-6 rounded-2xl border border-[#e8e4dd] bg-white p-6">
            <h2 className="font-['Manrope'] text-xl font-extrabold">
              Manual exchange rates
            </h2>
            <p className="mt-2 text-sm text-[#77736c]">
              Enter foreign-currency units per ₹1. These rates
              are indicative only.
            </p>

            <label className="mt-4 block text-sm font-semibold">
              Rates
              <input
                className="field mt-2"
                value={ratesText}
                onChange={(event) =>
                  setRatesText(event.target.value)
                }
                placeholder="INR=1, USD=..., EUR=..."
              />
            </label>

            <label className="mt-4 block text-sm font-semibold">
              Rate source / note
              <input
                className="field mt-2"
                maxLength={160}
                value={rateSource}
                onChange={(event) =>
                  setRateSource(event.target.value)
                }
              />
            </label>

            <button
              className="btn btn-primary mt-4"
              disabled={loading}
              onClick={() => void saveRates()}
            >
              <Save size={15} />
              {loading ? "Saving…" : "Save manual rates"}
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

function TourClassificationManager() {
  const [rows, setRows] = useState<
    Array<{
      id: number;
      title: string;
      tour_kind: string;
    }>
  >([]);

  const [pending, setPending] = useState<
    Record<number, string>
  >({});

  const [savingId, setSavingId] = useState<number | null>(
    null,
  );

  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    void supabase
      .from("tours")
      .select("id,title,tour_kind")
      .order("title")
      .limit(300)
      .then(({ data, error }) => {
        if (!active) return;

        if (error) {
          setError("Unable to load tour classifications.");
          return;
        }

        setRows(
          (data ?? []) as Array<{
            id: number;
            title: string;
            tour_kind: string;
          }>,
        );
      });

    return () => {
      active = false;
    };
  }, []);

  async function save(row: {
    id: number;
    title: string;
    tour_kind: string;
  }) {
    const kind = pending[row.id] ?? row.tour_kind;

    setSavingId(row.id);
    setError("");

    const { error } = await supabase
      .from("tours")
      .update({ tour_kind: kind })
      .eq("id", row.id);

    setSavingId(null);

    if (error) {
      setError(error.message);
      return;
    }

    setRows((current) =>
      current.map((item) =>
        item.id === row.id
          ? { ...item, tour_kind: kind }
          : item,
      ),
    );

    toast.success(`${row.title}: classification saved.`);
  }

  return (
    <section className="mt-6 rounded-2xl border border-[#e8e4dd] bg-white p-6">
      <h2 className="font-['Manrope'] text-xl font-extrabold">
        India / International tour classification
      </h2>

      <p className="mt-2 text-sm text-[#77736c]">
        Classification is independent of language and currency.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 divide-y divide-[#eee9e1]">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div>
              <div className="text-sm font-bold">
                {row.title}
              </div>
              <div className="text-xs text-[#77736c]">
                Tour ID {row.id}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                aria-label={`Classify ${row.title}`}
                className="field min-w-40"
                value={pending[row.id] ?? row.tour_kind}
                onChange={(event) =>
                  setPending((current) => ({
                    ...current,
                    [row.id]: event.target.value,
                  }))
                }
              >
                <option value="domestic">India Tours</option>
                <option value="international">
                  International Tours
                </option>
              </select>

              <button
                className="btn btn-ghost"
                disabled={
                  savingId === row.id ||
                  (pending[row.id] ?? row.tour_kind) ===
                    row.tour_kind
                }
                onClick={() => void save(row)}
              >
                {savingId === row.id ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}