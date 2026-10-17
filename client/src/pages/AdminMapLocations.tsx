import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Check,
  LoaderCircle,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { supabase } from "@/lib/supabase";

type LocationRow = {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
  map_visible: boolean;
  location_source: string | null;
  location_verified_at: string | null;
  location_notes: string | null;
  parent?: string;
};

type Draft = {
  lat: string;
  lng: string;
  source: string;
  notes: string;
  visible: boolean;
};

function validPair(lat: string, lng: string) {
  if (!lat.trim() && !lng.trim()) return true;

  const latitude = Number(lat);
  const longitude = Number(lng);

  return (
    lat.trim() !== "" &&
    lng.trim() !== "" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export default function AdminMapLocations() {
  const { user, loading: authLoading } = useAuth();
  const canManage = Boolean(
    user?.permissions?.includes("tours.manage"),
  );

  const [destinations, setDestinations] = useState<LocationRow[]>([]);
  const [attractions, setAttractions] = useState<LocationRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const [destinationResult, attractionResult] =
      await Promise.all([
        supabase
          .from("destinations")
          .select(
            "id,name,latitude,longitude,map_visible,location_source,location_verified_at,location_notes",
          )
          .order("name")
          .limit(500),

        supabase
          .from("destination_attractions")
          .select(
            'id,name,"destinationId",latitude,longitude,map_visible,location_source,location_verified_at,location_notes',
          )
          .order("name")
          .limit(1000),
      ]);

    if (destinationResult.error || attractionResult.error) {
      setError(
        "Could not load map locations. Verify tours.manage permission and that the Phase 15 migration has been applied.",
      );
      setLoading(false);
      return;
    }

    const dests = (destinationResult.data ?? []) as LocationRow[];

    const parentById = new Map(
      dests.map((item) => [item.id, item.name]),
    );

    const attrs = (attractionResult.data ?? []).map(
      (item: any) => ({
        ...item,
        parent:
          parentById.get(Number(item.destinationId)) ??
          "Unknown destination",
      }),
    ) as LocationRow[];

    setDestinations(dests);
    setAttractions(attrs);

    const next: Record<string, Draft> = {};

    [...dests, ...attrs].forEach((row) => {
      const kind = row.parent ? "attraction" : "destination";

      next[`${kind}:${row.id}`] = {
        lat: row.latitude == null ? "" : String(row.latitude),
        lng: row.longitude == null ? "" : String(row.longitude),
        source: row.location_source ?? "",
        notes: row.location_notes ?? "",
        visible: row.map_visible ?? true,
      };
    });

    setDrafts(next);
    setLoading(false);
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(
    row: LocationRow,
    kind: "destination" | "attraction",
  ) {
    const key = `${kind}:${row.id}`;
    const draft = drafts[key];

    if (!draft || !validPair(draft.lat, draft.lng)) {
      toast.error(
        "Enter valid latitude and longitude, or leave both empty.",
      );
      return;
    }

    const latitude = draft.lat.trim()
      ? Number(draft.lat)
      : null;

    const longitude = draft.lng.trim()
      ? Number(draft.lng)
      : null;

    if (latitude !== null && !draft.source.trim()) {
      toast.error(
        "Enter the source of these coordinates before saving them as verified.",
      );
      return;
    }

    setSaving(key);

    const table =
      kind === "destination"
        ? "destinations"
        : "destination_attractions";

    const payload = {
      latitude,
      longitude,
      map_visible: draft.visible,
      location_source: draft.source.trim() || null,
      location_notes: draft.notes.trim() || null,
      location_verified_at:
        latitude !== null && longitude !== null
          ? new Date().toISOString()
          : null,
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from(table)
      .update(payload)
      .eq("id", row.id);

    setSaving(null);

    if (updateError) {
      toast.error(
        "Location update rejected. Check tours.manage permission and database policies.",
      );
      return;
    }

    toast.success("Location metadata saved.");
    await load();
  }

  if (authLoading || loading) {
    return (
      <main className="container py-16">
        Loading location records…
      </main>
    );
  }

  if (!user || !canManage) {
    return (
      <main className="container max-w-2xl py-16">
        <h1 className="display text-3xl font-extrabold">
          Map management restricted
        </h1>
        <p className="mt-3 text-sm text-[#77736c]">
          An authorized staff account with tours.manage is required.
        </p>
        <Link href="/admin" className="btn btn-primary mt-5">
          Return to admin
        </Link>
      </main>
    );
  }

  function renderRows(
    rows: LocationRow[],
    kind: "destination" | "attraction",
  ) {
    return rows.map((row) => {
      const key = `${kind}:${row.id}`;

      const draft = drafts[key] ?? {
        lat: "",
        lng: "",
        source: "",
        notes: "",
        visible: true,
      };

      return (
        <article
          key={key}
          className="rounded-xl border border-[#e8e4dd] bg-white p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-extrabold">{row.name}</h3>

              {row.parent && (
                <p className="mt-1 text-xs text-[#77736c]">
                  {row.parent}
                </p>
              )}

              <p className="mt-1 text-xs text-[#8a4b1d]">
                {row.latitude == null || row.longitude == null
                  ? "Missing coordinates"
                  : row.location_verified_at
                    ? `Verified ${new Date(
                        row.location_verified_at,
                      ).toLocaleDateString()}`
                    : "Coordinates need verification"}
              </p>
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold">
              <input
                type="checkbox"
                checked={draft.visible}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [key]: {
                      ...draft,
                      visible: event.target.checked,
                    },
                  }))
                }
              />
              Show on map
            </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold">
              Latitude
              <input
                className="field mt-1"
                inputMode="decimal"
                value={draft.lat}
                placeholder="-90 to 90"
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [key]: {
                      ...draft,
                      lat: event.target.value,
                    },
                  }))
                }
              />
            </label>

            <label className="text-xs font-bold">
              Longitude
              <input
                className="field mt-1"
                inputMode="decimal"
                value={draft.lng}
                placeholder="-180 to 180"
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [key]: {
                      ...draft,
                      lng: event.target.value,
                    },
                  }))
                }
              />
            </label>

            <label className="text-xs font-bold sm:col-span-2">
              Coordinate source
              <input
                className="field mt-1"
                value={draft.source}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [key]: {
                      ...draft,
                      source: event.target.value,
                    },
                  }))
                }
                placeholder="Official destination data or verified survey"
              />
            </label>

            <label className="text-xs font-bold sm:col-span-2">
              Staff notes
              <textarea
                className="field mt-1 min-h-16"
                value={draft.notes}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [key]: {
                      ...draft,
                      notes: event.target.value,
                    },
                  }))
                }
              />
            </label>
          </div>

          <button
            className="btn btn-dark mt-3"
            disabled={
              saving === key ||
              !validPair(draft.lat, draft.lng)
            }
            onClick={() => void save(row, kind)}
          >
            {saving === key ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Check size={14} />
            )}
            Save location
          </button>
        </article>
      );
    });
  }

  return (
    <main className="min-h-screen bg-[#f4f4f1]">
      <div className="container max-w-6xl py-8 sm:py-12">
        <Link
          href="/admin"
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#77736c]"
        >
          <ArrowLeft size={15} />
          Admin workspace
        </Link>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow flex items-center gap-2">
              <MapPin size={14} />
              Verified map data
            </div>

            <h1 className="display mt-2 text-4xl font-extrabold">
              Location management
            </h1>

            <p className="mt-2 max-w-2xl text-sm text-[#77736c]">
              Enter coordinates only from a reliable source. Missing
              coordinates are intentionally excluded from map pins.
            </p>
          </div>

          <button className="btn btn-dark" onClick={() => void load()}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        <section className="mt-6">
          <h2 className="mb-3 font-['Manrope'] text-2xl font-extrabold">
            Destinations ({destinations.length})
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {renderRows(destinations, "destination")}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 font-['Manrope'] text-2xl font-extrabold">
            Attractions and points of interest ({attractions.length})
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {renderRows(attractions, "attraction")}
          </div>
        </section>
      </div>
    </main>
  );
}