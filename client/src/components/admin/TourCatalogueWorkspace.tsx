
import { useCallback, useEffect, useState } from "react";
import {
  Archive, CalendarDays, ImagePlus, MapPin, Pencil, Plus,
  RefreshCw, Save, Search, Trash2, Upload, X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type Destination = {
  id: number;
  name: string;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type Category = { id: number; name: string };

type Tour = {
  id: number;
  slug: string;
  title: string;
  destinationId: number;
  categoryId: number;
  durationDays: number;
  durationNights: number;
  priceFrom: number;
  originalPrice: number | null;
  overview: string | null;
  highlights: string[] | null;
  inclusions: string[] | null;
  exclusions: string[] | null;
  imageUrl: string | null;
  galleryUrls: string[] | null;
  tags: string[] | null;
  availability: string;
  status: string;
  featured: boolean;
  is_archived?: boolean;
};

type Day = {
  id?: number;
  dayNumber: number;
  title: string;
  description: string;
  meals: string;
  stay: string;
  accommodation: string;
  location: string;
  image_url: string;
  latitude: string;
  longitude: string;
  activities: string;
  map_url: string;
street_view_url: string;
spots: ItinerarySpot[];
};

type Departure = {
  id?: number;
  departure_date: string;
  return_date: string;
  label: string;
  price_from: string;
  seats_available: string;
  status: string;
};

type TourForm = {
  title: string;
  slug: string;
  destinationId: string;
  categoryId: string;
  durationDays: string;
  durationNights: string;
  priceFrom: string;
  originalPrice: string;
  overview: string;
  highlights: string;
  inclusions: string;
  exclusions: string;
  tags: string;
  availability: string;
  featured: boolean;
  status: "draft" | "published";
  imageUrl: string;
  galleryUrls: string[];
  days: Day[];
  departures: Departure[];
};

type ItinerarySpot = {
  name: string;
  description: string;
  latitude: string;
  longitude: string;
  mapUrl: string;
  streetViewUrl: string;
};

const blankSpot = (): ItinerarySpot => ({
  name: "",
  description: "",
  latitude: "",
  longitude: "",
  mapUrl: "",
  streetViewUrl: "",
});

const blankDay = (dayNumber = 1): Day => ({
  id: undefined,
  dayNumber,
  title: "",
  description: "",
  meals: "",
  stay: "",
  accommodation: "",
  location: "",
  image_url: "",
  latitude: "",
  longitude: "",
  activities: "",
  map_url: "",
  street_view_url: "",
  spots: [blankSpot()],
});

const blankDeparture = (): Departure => ({
  departure_date: "", return_date: "", label: "",
  price_from: "", seats_available: "", status: "available",
});

const blankForm = (): TourForm => ({
  title: "", slug: "", destinationId: "", categoryId: "",
  durationDays: "3", durationNights: "2", priceFrom: "",
  originalPrice: "", overview: "", highlights: "", inclusions: "",
  exclusions: "", tags: "", availability: "On request",
  featured: false, status: "draft", imageUrl: "",
  galleryUrls: [], days: [blankDay()], departures: [],
});

const field =
  "w-full rounded-lg border border-[#deded9] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#f26b35]";
const label = "mb-1.5 block text-xs font-semibold text-[#4b4b46]";

function slugify(value: string) {
  return value.toLowerCase().trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function lines(value: string) {
  return value.split("\n").map((x) => x.trim()).filter(Boolean);
}

function asNumber(value: string, fallback: number | null = null) {
  if (!value.trim()) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}


function makeMapUrl(lat: string, lng: string, name = "") {
  if (lat.trim() && lng.trim()) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  }

  if (name.trim()) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
  }

  return "";
}

function makeStreetViewUrl(lat: string, lng: string) {
  if (!lat.trim() || !lng.trim()) return "";

  const latitude = Number(lat);
  const longitude = Number(lng);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180
  ) return "";

  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latitude},${longitude}`;
}


function ItinerarySpotEditor({
  spot,
  onChange,
  onRemove,
}: {
  spot: ItinerarySpot;
  onChange: (patch: Partial<ItinerarySpot>) => void;
  onRemove: () => void;
}) {
  const mapUrl = spot.mapUrl || makeMapUrl(
    spot.latitude,
    spot.longitude,
    spot.name
  );

  const streetUrl = spot.streetViewUrl || makeStreetViewUrl(
    spot.latitude,
    spot.longitude
  );

  return (
    <div className="rounded-xl border border-[#e6e2da] p-4">
      <div className="flex items-center justify-between">
        <h5 className="font-bold">Itinerary stop</h5>
        <button type="button" onClick={onRemove} className="text-sm text-red-600">
          Remove stop
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>
          <span className={label}>Spot / attraction name *</span>
          <input
            className={field}
            value={spot.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. Dal Lake"
          />
        </label>

        <label>
          <span className={label}>Description</span>
          <input
            className={field}
            value={spot.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="What will travellers experience?"
          />
        </label>

        <label>
          <span className={label}>Latitude</span>
          <input
            className={field}
            type="number"
            step="any"
            value={spot.latitude}
            onChange={(e) => onChange({
              latitude: e.target.value,
              mapUrl: "",
              streetViewUrl: "",
            })}
          />
        </label>

        <label>
          <span className={label}>Longitude</span>
          <input
            className={field}
            type="number"
            step="any"
            value={spot.longitude}
            onChange={(e) => onChange({
              longitude: e.target.value,
              mapUrl: "",
              streetViewUrl: "",
            })}
          />
        </label>

        <label className="sm:col-span-2">
          <span className={label}>Google Maps URL (optional)</span>
          <input
            className={field}
            type="url"
            value={spot.mapUrl}
            onChange={(e) => onChange({ mapUrl: e.target.value })}
            placeholder="Paste a Google Maps share link"
          />
        </label>

        <label className="sm:col-span-2">
          <span className={label}>Street View URL (optional)</span>
          <input
            className={field}
            type="url"
            value={spot.streetViewUrl}
            onChange={(e) => onChange({ streetViewUrl: e.target.value })}
            placeholder="Paste a Google Maps Street View link"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {mapUrl && (
          <a
            href={mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            <MapPin size={14} /> Open map
          </a>
        )}
        {streetUrl && (
          <a
            href={streetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Open Street View
          </a>
        )}
      </div>
    </div>
  );
}


export default function TourCatalogueWorkspace() {
  const [tours, setTours] = useState<Tour[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<TourForm>(blankForm());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showEditor, setShowEditor] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const [tourResult, destinationResult, categoryResult] =
      await Promise.all([
        supabase.from("tours").select("*").order("createdAt", { ascending: false }),
        supabase.from("destinations").select("*").order("name"),
        supabase.from("tour_categories").select("*").order("name"),
      ]);

    if (tourResult.error || destinationResult.error || categoryResult.error) {
      setError(
        tourResult.error?.message ||
        destinationResult.error?.message ||
        categoryResult.error?.message ||
        "Could not load catalogue data."
      );
    } else {
      setTours((tourResult.data ?? []) as Tour[]);
      setDestinations((destinationResult.data ?? []) as Destination[]);
      setCategories((categoryResult.data ?? []) as Category[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = <K extends keyof TourForm>(key: K, value: TourForm[K]) =>
    setForm((old) => ({ ...old, [key]: value }));

  const resetEditor = () => {
    setForm(blankForm());
    setEditingId(null);
    setShowEditor(false);
    setError("");
    setMessage("");
  };

  const uploadImage = async (file: File, folder: string) => {
    if (!file.type.startsWith("image/")) {
      throw new Error("Choose an image file.");
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("Each image must be 10 MB or smaller.");
    }

    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `tours/${folder}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("aerofly-public")
      .upload(path, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from("aerofly-public")
      .getPublicUrl(path);

    return data.publicUrl;
  };

  const handleImage = async (
    files: FileList | null,
    target: "cover" | "gallery" | "day",
    dayIndex?: number,
  ) => {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        urls.push(await uploadImage(file, editingId?.toString() || "new"));
      }

      if (target === "cover") {
        update("imageUrl", urls[0]);
      } else if (target === "gallery") {
        update("galleryUrls", [...form.galleryUrls, ...urls]);
      } else if (dayIndex !== undefined) {
        update("days", form.days.map((day, i) =>
          i === dayIndex ? { ...day, image_url: urls[0] } : day
        ));
      }
      setMessage("Image uploaded. Save the tour to persist its association.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const editTour = async (tour: Tour) => {
    setError("");
    setMessage("");
    const [dayResult, departureResult, mediaResult] = await Promise.all([
      supabase.from("tour_itineraries").select("*")
        .eq("tourId", tour.id).order("dayNumber"),
      supabase.from("tour_departures").select("*")
        .eq("tourId", tour.id).order("departure_date"),
      supabase.from("tour_media").select("*")
        .eq("tourId", tour.id).order("sort_order"),
    ]);

    
const days: Day[] = (dayResult.data ?? []).map((d: any) => ({
  id: d.id,
  dayNumber: d.dayNumber,
  title: d.title ?? "",
  description: d.description ?? "",
  meals: d.meals ?? "",
  stay: d.stay ?? "",
  accommodation: d.accommodation ?? "",
  location: d.location ?? "",
  image_url: d.image_url ?? "",
  latitude: d.latitude == null ? "" : String(d.latitude),
  longitude: d.longitude == null ? "" : String(d.longitude),
  activities: Array.isArray(d.activities)
    ? d.activities.join("\n")
    : "",

  // Map for the complete itinerary day
  map_url: d.map_url ?? "",
  street_view_url: d.street_view_url ?? "",

  // Individual attraction stops for this day
  spots: Array.isArray(d.spots)
    ? d.spots.map((spot: any) => ({
        name: spot.name ?? "",
        description: spot.description ?? "",
        latitude:
          spot.latitude == null ? "" : String(spot.latitude),
        longitude:
          spot.longitude == null ? "" : String(spot.longitude),
        mapUrl: spot.mapUrl ?? "",
        streetViewUrl: spot.streetViewUrl ?? "",
      }))
    : [
        {
          name: "",
          description: "",
          latitude: "",
          longitude: "",
          mapUrl: "",
          streetViewUrl: "",
        },
      ],
}));


    const departures: Departure[] = (departureResult.data ?? []).map((d: any) => ({
      id: d.id,
      departure_date: d.departure_date ?? "",
      return_date: d.return_date ?? "",
      label: d.label ?? "",
      price_from: d.price_from == null ? "" : String(d.price_from),
      seats_available: d.seats_available == null ? "" : String(d.seats_available),
      status: d.status ?? "available",
    }));

    const media = (mediaResult.data ?? []) as any[];
    const gallery = media
      .filter((m) => m.media_type === "gallery")
      .map((m) => m.public_url)
      .filter(Boolean);

    setForm({
      title: tour.title,
      slug: tour.slug,
      destinationId: String(tour.destinationId),
      categoryId: String(tour.categoryId),
      durationDays: String(tour.durationDays),
      durationNights: String(tour.durationNights),
      priceFrom: String(tour.priceFrom),
      originalPrice: tour.originalPrice == null ? "" : String(tour.originalPrice),
      overview: tour.overview ?? "",
      highlights: (tour.highlights ?? []).join("\n"),
      inclusions: (tour.inclusions ?? []).join("\n"),
      exclusions: (tour.exclusions ?? []).join("\n"),
      tags: (tour.tags ?? []).join(", "),
      availability: tour.availability ?? "On request",
      featured: tour.featured ?? false,
      status: tour.status === "published" ? "published" : "draft",
      imageUrl: tour.imageUrl ?? "",
      galleryUrls: gallery.length ? gallery : (tour.galleryUrls ?? []),
      days: days.length ? days : [blankDay()],
      departures,
    });
    setEditingId(tour.id);
    setShowEditor(true);
    if (dayResult.error || departureResult.error || mediaResult.error) {
      setError("Some supporting data could not be loaded. Check the relevant RLS policies.");
    }
  };

  const save = async () => {
    setError("");
    setMessage("");

    if (!form.title.trim()) return setError("Enter a tour title.");
    if (!form.destinationId || !form.categoryId) {
      return setError("Select a destination and category.");
    }
    const days = Number(form.durationDays);
    const nights = Number(form.durationNights);
    const price = Number(form.priceFrom);
    if (!Number.isInteger(days) || days < 1 ||
        !Number.isInteger(nights) || nights < 0 ||
        !Number.isFinite(price) || price < 0) {
      return setError("Enter a valid duration and non-negative price.");
    }

    for (const day of form.days) {
      const lat = day.latitude.trim() ? Number(day.latitude) : null;
      const lng = day.longitude.trim() ? Number(day.longitude) : null;
      if ((lat === null) !== (lng === null) ||
          (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) ||
          (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180))) {
        return setError(`Day ${day.dayNumber}: enter valid latitude and longitude together.`);
      }
    }

    setSaving(true);
    try {
      const slug = slugify(form.slug || form.title);
      const payload = {
        title: form.title.trim(),
        slug,
        "destinationId": Number(form.destinationId),
        "categoryId": Number(form.categoryId),
        "durationDays": days,
        "durationNights": nights,
        "priceFrom": price,
        "originalPrice": asNumber(form.originalPrice),
        overview: form.overview.trim() || null,
        highlights: lines(form.highlights),
        inclusions: lines(form.inclusions),
        exclusions: lines(form.exclusions),
        tags: form.tags.split(",").map((x) => x.trim()).filter(Boolean),
        "imageUrl": form.imageUrl || null,
        "galleryUrls": form.galleryUrls,
        availability: form.availability.trim() || "On request",
        featured: form.featured,
        status: form.status,
        is_archived: false,
        "updatedAt": new Date().toISOString(),
      };

      let tourId = editingId;
      if (editingId === null) {
        const { data, error: insertError } = await supabase
          .from("tours")
          .insert(payload)
          .select("id")
          .single();
        if (insertError) throw insertError;
        tourId = data.id;
      } else {
        const { error: updateError } = await supabase
          .from("tours").update(payload).eq("id", editingId);
        if (updateError) throw updateError;
      }

      if (tourId == null) throw new Error("Tour ID was not returned.");

      // Replace the itinerary atomically as far as the client API allows.
      // For strict all-or-nothing behavior, move this save into a Postgres RPC.
      const { error: deleteDaysError } = await supabase
        .from("tour_itineraries").delete().eq("tourId", tourId);
      if (deleteDaysError) throw deleteDaysError;

      if (form.days.length) {
        const itineraryRows = form.days.map((d, index) => ({
          "tourId": tourId,
          "dayNumber": index + 1,
          title: d.title.trim() || `Day ${index + 1}`,
          description: d.description.trim() || null,
          meals: d.meals.trim() || null,
          stay: d.stay.trim() || null,
          accommodation: d.accommodation.trim() || null,
          location: d.location.trim() || null,
          image_url: d.image_url || null,
          latitude: asNumber(d.latitude),
          longitude: asNumber(d.longitude),
          activities: lines(d.activities),
          map_url: d.map_url || null,
street_view_url: d.street_view_url || null,
spots: (d.spots ?? []).map((spot) => ({
  name: spot.name.trim(),
  description: spot.description.trim(),
  latitude: asNumber(spot.latitude),
  longitude: asNumber(spot.longitude),
  mapUrl:
    spot.mapUrl ||
    makeMapUrl(spot.latitude, spot.longitude, spot.name),
  streetViewUrl:
    spot.streetViewUrl ||
    makeStreetViewUrl(spot.latitude, spot.longitude),
})),
        }));
        const { error: insertDaysError } = await supabase
          .from("tour_itineraries").insert(itineraryRows);
        if (insertDaysError) throw insertDaysError;
      }

      // Save media metadata; public URLs point to the existing storage bucket.
      const { error: clearMediaError } = await supabase
        .from("tour_media").delete().eq("tourId", tourId);
      if (clearMediaError) throw clearMediaError;

      const mediaRows = [
        ...(form.imageUrl ? [{
          "tourId": tourId, media_type: "cover", public_url: form.imageUrl,
          alt_text: `${form.title} cover image`, sort_order: 0, is_public: true,
        }] : []),
        ...form.galleryUrls.map((url, index) => ({
          "tourId": tourId, media_type: "gallery", public_url: url,
          alt_text: `${form.title} gallery image ${index + 1}`,
          sort_order: index + 1, is_public: true,
        })),
        ...form.days.filter((d) => d.image_url).map((d, index) => ({
          "tourId": tourId, media_type: "itinerary", public_url: d.image_url,
          alt_text: `${form.title} day ${d.dayNumber} image`,
          sort_order: 1000 + index, is_public: true,
        })),
      ];

      if (mediaRows.length) {
        const { error: mediaInsertError } = await supabase
          .from("tour_media").insert(mediaRows);
        if (mediaInsertError) throw mediaInsertError;
      }

      // Update existing departures; insert new ones. Do not silently delete
      // departures because they may be referenced by real customer operations.
      for (const dep of form.departures) {
        if (!dep.departure_date) throw new Error("Each departure needs a departure date.");
        const depPayload = {
          "tourId": tourId,
          departure_date: dep.departure_date,
          return_date: dep.return_date || null,
          label: dep.label.trim() || null,
          price_from: asNumber(dep.price_from),
          seats_available: asNumber(dep.seats_available),
          status: dep.status,
        };
        const result = dep.id
          ? await supabase.from("tour_departures").update(depPayload).eq("id", dep.id)
          : await supabase.from("tour_departures").insert(depPayload);
        if (result.error) throw result.error;
      }

      setMessage("Tour saved successfully.");
      await load();
      setShowEditor(false);
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the tour.");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (tour: Tour, status: "draft" | "published") => {
    setError("");
    const { error } = await supabase.from("tours")
      .update({ status, "updatedAt": new Date().toISOString() })
      .eq("id", tour.id);
    if (error) setError(error.message);
    else {
      setMessage(`Tour ${status === "published" ? "published" : "moved to draft"}.`);
      await load();
    }
  };

  const archiveTour = async (tour: Tour) => {
    if (!window.confirm(`Archive "${tour.title}"? It will be hidden from catalogue listings.`)) return;
    const { error } = await supabase.from("tours")
      .update({ is_archived: true, status: "draft", "updatedAt": new Date().toISOString() })
      .eq("id", tour.id);
    if (error) setError(error.message);
    else {
      setMessage("Tour archived.");
      await load();
    }
  };

  const visibleTours = tours.filter((tour) => {
    const matchesSearch = `${tour.title} ${tour.slug}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "archived" ? tour.is_archived : !tour.is_archived && tour.status === statusFilter);
    return matchesSearch && matchesStatus;
  });

  const setDay = (index: number, patch: Partial<Day>) =>
    update("days", form.days.map((d, i) => i === index ? { ...d, ...patch } : d));

  const setDeparture = (index: number, patch: Partial<Departure>) =>
    update("departures", form.departures.map((d, i) => i === index ? { ...d, ...patch } : d));

  return (
    <section className="mt-7 rounded-xl border border-[#deded9] bg-white p-5 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#f26b35]">Catalogue management</p>
          <h2 className="mt-2 text-2xl font-extrabold">Tour catalogue</h2>
          <p className="mt-2 text-sm leading-6 text-[#77736c]">
            Create and maintain tour packages, itineraries, media and departures.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button className="btn btn-primary" onClick={() => {
            setForm(blankForm()); setEditingId(null); setShowEditor(true); setError(""); setMessage("");
          }}>
            <Plus size={16} /> Add tour
          </button>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}

      <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_180px]">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-3 text-[#92928b]" />
          <input className={field + " pl-9"} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tours..." />
        </div>
        <select className={field} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All tours</option>
          <option value="published">Published</option>
          <option value="draft">Drafts</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {loading ? <p className="py-10 text-sm text-[#77736c]">Loading catalogue…</p> :
        visibleTours.length === 0 ? (
          <div className="my-6 rounded-xl border border-dashed border-[#deded9] p-10 text-center">
            <MapPin className="mx-auto text-[#f26b35]" />
            <p className="mt-3 font-semibold">No tours found</p>
            <p className="mt-1 text-sm text-[#77736c]">Create your first package with Add tour.</p>
          </div>
        ) : (
          <div className="mt-5 divide-y divide-[#ecece8]">
            {visibleTours.map((tour) => (
              <article key={tour.id} className="flex flex-wrap items-center gap-4 py-4">
                {tour.imageUrl ? (
                  <img src={tour.imageUrl} alt={tour.title} className="h-20 w-28 rounded-lg object-cover" />
                ) : (
                  <div className="grid h-20 w-28 place-items-center rounded-lg bg-[#f7f5f1]"><ImagePlus /></div>
                )}
                <div className="min-w-[180px] flex-1">
                  <h3 className="font-bold">{tour.title}</h3>
                  <p className="mt-1 text-xs text-[#77736c]">
                    {tour.durationDays} days · ₹{Number(tour.priceFrom).toLocaleString("en-IN")} · {tour.status}
                  </p>
                  {tour.is_archived && <span className="text-xs text-amber-700">Archived</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-secondary" onClick={() => void editTour(tour)}><Pencil size={14}/> Edit</button>
                  {tour.status === "published" ? (
                    <button className="btn btn-secondary" onClick={() => void changeStatus(tour, "draft")}>Unpublish</button>
                  ) : !tour.is_archived && (
                    <button className="btn btn-primary" onClick={() => void changeStatus(tour, "published")}>Publish</button>
                  )}
                  {!tour.is_archived && (
                    <button className="btn btn-secondary" onClick={() => void archiveTour(tour)} title="Archive"><Archive size={14}/></button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )
      }

      {showEditor && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-3 sm:p-8">
          <div className="mx-auto max-w-5xl rounded-2xl bg-[#fbfaf8] p-5 shadow-xl sm:p-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#f26b35]">{editingId ? "Edit package" : "New package"}</p>
                <h2 className="mt-1 text-2xl font-extrabold">{editingId ? "Edit tour" : "Create a tour"}</h2>
              </div>
              <button onClick={resetEditor} className="rounded-lg p-2 hover:bg-white" aria-label="Close editor"><X /></button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label><span className={label}>Tour title *</span><input className={field} value={form.title} onChange={(e) => update("title", e.target.value)} /></label>
              <label><span className={label}>URL slug</span><input className={field} value={form.slug} onChange={(e) => update("slug", e.target.value)} placeholder={slugify(form.title)} /></label>
              <label><span className={label}>Destination *</span><select className={field} value={form.destinationId} onChange={(e) => update("destinationId", e.target.value)}><option value="">Choose destination</option>{destinations.map((d) => <option key={d.id} value={d.id}>{d.name}{d.country ? `, ${d.country}` : ""}</option>)}</select></label>
              <label><span className={label}>Category *</span><select className={field} value={form.categoryId} onChange={(e) => update("categoryId", e.target.value)}><option value="">Choose category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label><span className={label}>Duration (days) *</span><input className={field} type="number" min="1" value={form.durationDays} onChange={(e) => update("durationDays", e.target.value)} /></label>
              <label><span className={label}>Duration (nights) *</span><input className={field} type="number" min="0" value={form.durationNights} onChange={(e) => update("durationNights", e.target.value)} /></label>
              <label><span className={label}>Starting price (INR) *</span><input className={field} type="number" min="0" value={form.priceFrom} onChange={(e) => update("priceFrom", e.target.value)} /></label>
              <label><span className={label}>Original price (INR)</span><input className={field} type="number" min="0" value={form.originalPrice} onChange={(e) => update("originalPrice", e.target.value)} /></label>
              <label className="md:col-span-2"><span className={label}>Overview</span><textarea className={field} rows={4} value={form.overview} onChange={(e) => update("overview", e.target.value)} /></label>
              <label><span className={label}>Highlights (one per line)</span><textarea className={field} rows={3} value={form.highlights} onChange={(e) => update("highlights", e.target.value)} /></label>
              <label><span className={label}>Tags (comma separated)</span><textarea className={field} rows={3} value={form.tags} onChange={(e) => update("tags", e.target.value)} /></label>
              <label><span className={label}>Inclusions (one per line)</span><textarea className={field} rows={3} value={form.inclusions} onChange={(e) => update("inclusions", e.target.value)} /></label>
              <label><span className={label}>Exclusions (one per line)</span><textarea className={field} rows={3} value={form.exclusions} onChange={(e) => update("exclusions", e.target.value)} /></label>
              <label><span className={label}>Availability label</span><input className={field} value={form.availability} onChange={(e) => update("availability", e.target.value)} /></label>
              <label className="flex items-center gap-2 pt-5 text-sm"><input type="checkbox" checked={form.featured} onChange={(e) => update("featured", e.target.checked)} /> Featured tour</label>
              <label><span className={label}>Publication</span><select className={field} value={form.status} onChange={(e) => update("status", e.target.value as TourForm["status"])}><option value="draft">Draft</option><option value="published">Published</option></select></label>
            </div>

            <div className="mt-7 rounded-xl border border-[#e6e2da] bg-white p-4">
              <h3 className="font-bold">Images</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <p className={label}>Cover image</p>
                  {form.imageUrl && <img src={form.imageUrl} alt="Tour cover preview" className="mb-3 h-36 w-full rounded-lg object-cover" />}
                  <label className="btn btn-secondary cursor-pointer"><Upload size={14}/> Upload cover<input className="hidden" type="file" accept="image/*" onChange={(e) => void handleImage(e.target.files, "cover")} /></label>
                </div>
                <div>
                  <p className={label}>Gallery images</p>
                  <label className="btn btn-secondary cursor-pointer"><ImagePlus size={14}/> Add images<input className="hidden" type="file" accept="image/*" multiple onChange={(e) => void handleImage(e.target.files, "gallery")} /></label>
                  <div className="mt-3 grid grid-cols-3 gap-2">{form.galleryUrls.map((url, i) => <div key={`${url}-${i}`} className="relative"><img src={url} alt={`Gallery ${i + 1}`} className="h-20 w-full rounded object-cover"/><button type="button" className="absolute right-1 top-1 rounded bg-white p-1" onClick={() => update("galleryUrls", form.galleryUrls.filter((_, j) => j !== i))}><X size={12}/></button></div>)}</div>
                </div>
              </div>
            </div>

            <div className="mt-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-extrabold">Day-by-day itinerary</h3>
                <button className="btn btn-secondary" onClick={() => update("days", [...form.days, blankDay(form.days.length + 1)])}><Plus size={14}/> Add day</button>
              </div>
              <div className="mt-4 space-y-4">
                {form.days.map((day, i) => (
                  <article key={i} className="rounded-xl border border-[#e6e2da] bg-white p-4">
                    <div className="mb-4 flex justify-between"><h4 className="font-bold">Day {i + 1}</h4>{form.days.length > 1 && <button onClick={() => update("days", form.days.filter((_, j) => j !== i).map((d, j) => ({ ...d, dayNumber: j + 1 })))} className="text-sm text-red-600"><Trash2 size={14}/></button>}</div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label><span className={label}>Day title</span><input className={field} value={day.title} onChange={(e) => setDay(i, { title: e.target.value })}/></label>
                      <label><span className={label}>Location / stop</span><input className={field} value={day.location} onChange={(e) => setDay(i, { location: e.target.value })}/></label>
                      <label className="md:col-span-2"><span className={label}>Description</span><textarea className={field} rows={3} value={day.description} onChange={(e) => setDay(i, { description: e.target.value })}/></label>
                      <label><span className={label}>Activities (one per line)</span><textarea className={field} rows={2} value={day.activities} onChange={(e) => setDay(i, { activities: e.target.value })}/></label>
                      <label><span className={label}>Meals</span><input className={field} value={day.meals} onChange={(e) => setDay(i, { meals: e.target.value })}/></label>
                      <label><span className={label}>Accommodation / hotel</span><input className={field} value={day.accommodation} onChange={(e) => setDay(i, { accommodation: e.target.value })}/></label>
                      <label><span className={label}>Stay details</span><input className={field} value={day.stay} onChange={(e) => setDay(i, { stay: e.target.value })}/></label>
                      <label><span className={label}>Latitude (verified only)</span><input className={field} type="number" step="any" value={day.latitude} onChange={(e) => setDay(i, { latitude: e.target.value })}/></label>
                      <label><span className={label}>Longitude (verified only)</span><input className={field} type="number" step="any" value={day.longitude} onChange={(e) => setDay(i, { longitude: e.target.value })}/></label>
                      
<div className="md:col-span-2 mt-3 border-t border-[#ecece8] pt-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h4 className="font-bold">Stops, maps & Street View</h4>
      <p className="mt-1 text-xs text-[#77736c]">
        Add each attraction visited on this day.
      </p>
    </div>

    <button
      type="button"
      className="btn btn-secondary"
      onClick={() =>
        setDay(i, {
          spots: [...(day.spots ?? []), blankSpot()],
        })
      }
    >
      <Plus size={14} /> Add stop
    </button>
  </div>

  <div className="mt-4 space-y-3">
    {(day.spots ?? []).map((spot, spotIndex) => (
      <ItinerarySpotEditor
        key={spotIndex}
        spot={spot}
        onChange={(patch) =>
          setDay(i, {
            spots: (day.spots ?? []).map((current, j) =>
              j === spotIndex ? { ...current, ...patch } : current
            ),
          })
        }
        onRemove={() =>
          setDay(i, {
            spots: (day.spots ?? []).filter(
              (_, j) => j !== spotIndex
            ),
          })
        }
      />
    ))}
  </div>
</div>

                      <div className="md:col-span-2">
                        {day.image_url && <img src={day.image_url} alt={`Day ${i + 1}`} className="mb-3 h-32 rounded-lg object-cover"/>}
                        <label className="btn btn-secondary cursor-pointer"><ImagePlus size={14}/> Upload day image<input className="hidden" type="file" accept="image/*" onChange={(e) => void handleImage(e.target.files, "day", i)}/></label>
                      </div>
                    </div>
                  </article>
                ))}
                
              </div>
            </div>

            <div className="mt-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-extrabold">Departures and availability</h3>
                <button className="btn btn-secondary" onClick={() => update("departures", [...form.departures, blankDeparture()])}><CalendarDays size={14}/> Add departure</button>
              </div>
              <div className="mt-4 space-y-3">
                {form.departures.map((dep, i) => (
                  <div key={dep.id ?? `new-${i}`} className="grid gap-3 rounded-xl border border-[#e6e2da] bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
                    <label><span className={label}>Departure date *</span><input className={field} type="date" value={dep.departure_date} onChange={(e) => setDeparture(i, { departure_date: e.target.value })}/></label>
                    <label><span className={label}>Return date</span><input className={field} type="date" min={dep.departure_date || undefined} value={dep.return_date} onChange={(e) => setDeparture(i, { return_date: e.target.value })}/></label>
                    <label><span className={label}>Label</span><input className={field} value={dep.label} onChange={(e) => setDeparture(i, { label: e.target.value })} placeholder="Summer departure"/></label>
                    <label><span className={label}>Departure price (₹)</span><input className={field} type="number" min="0" value={dep.price_from} onChange={(e) => setDeparture(i, { price_from: e.target.value })}/></label>
                    <label><span className={label}>Seats available</span><input className={field} type="number" min="0" value={dep.seats_available} onChange={(e) => setDeparture(i, { seats_available: e.target.value })}/></label>
                    <label><span className={label}>Status</span><select className={field} value={dep.status} onChange={(e) => setDeparture(i, { status: e.target.value })}><option value="available">Available</option><option value="limited">Limited</option><option value="sold_out">Sold out</option><option value="cancelled">Cancelled</option></select></label>
                    <button className="text-left text-sm text-red-600" onClick={() => update("departures", form.departures.filter((_, j) => j !== i))}>Remove from editor (does not delete saved departure)</button>
                  </div>
                ))}
              </div>
            </div>

            {uploading && <p className="mt-4 text-sm text-[#77736c]">Uploading images…</p>}
            {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

            <div className="mt-7 flex flex-wrap justify-end gap-3 border-t border-[#e6e2da] pt-5">
              <button className="btn btn-secondary" onClick={resetEditor}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || uploading} onClick={() => void save()}>
                <Save size={15}/> {saving ? "Saving…" : "Save tour"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
