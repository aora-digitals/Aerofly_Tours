import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Clock3, Eye, Loader2, Save, Trash2, Upload, UserRound } from "lucide-react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import CustomerLayout from "@/components/customer/CustomerLayout";
import TourCard from "@/components/site/TourCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/_core/hooks/useAuth";
import { cancelCustomerAppointment, cancelCustomerCallback, getAvatarUrl, getCustomerActivity, getCustomerPreferences, getRecentlyViewedTours, getWishlist, removeFromWishlist, saveCustomerPreferences, uploadCustomerAvatar, type CustomerActivity, type CustomerPreferences } from "@/lib/customer";
import { supabase } from "@/lib/supabase";

const TRAVEL_STYLES = ["honeymoon", "family", "adventure", "luxury", "budget", "weekend", "cultural", "relaxation"];
const LANGUAGES = [{ value: "en", label: "English" }, { value: "hi", label: "Hindi" }, { value: "mr", label: "Marathi" }];
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"];

export default function CustomerAccount() {
  const [location] = useLocation();
  const { user, loading: authLoading, isAuthenticated, refresh } = useAuth();
  const section = location.split("/").filter(Boolean)[1] || "dashboard";

  if (authLoading) return <AccountLoading />;
  if (!isAuthenticated || !user) {
    window.location.assign(`/login?next=${encodeURIComponent(location)}`);
    return null;
  }

  return <CustomerLayout><AccountSection section={section} user={user} refreshAuth={refresh} /></CustomerLayout>;
}

function AccountSection({ section, user, refreshAuth }: { section: string; user: any; refreshAuth: () => Promise<void> }) {
  switch (section) {
    case "profile": return <ProfileSection user={user} refreshAuth={refreshAuth} />;
    case "preferences": return <PreferencesSection userId={user.id} />;
    case "wishlist": return <WishlistSection userId={user.id} />;
    case "recently-viewed": return <RecentlyViewedSection userId={user.id} />;
    case "activity": return <ActivitySection userId={user.id} />;
    case "enquiries": return <EnquiriesSection userId={user.id} />;
    case "appointments": return <AppointmentsSection userId={user.id} />;
    case "callbacks": return <CallbacksSection userId={user.id} />;
    case "notifications": return <PlaceholderSection title="Notifications" copy="Customer notifications are reserved as a platform placeholder in Phase 3. The data model can be added when the notification delivery workflow is introduced." icon={BellIcon} />;
    case "bookings": return <PlaceholderSection title="Bookings" copy="Booking history and complete booking/payment workflows remain intentionally limited in Phase 3. Existing booking records are shown on the dashboard when available." icon={PlaneIcon} />;
    default: return <PlaceholderSection title="Customer account" copy="Choose a section from your AeroFly customer navigation." icon={UserRound} />;
  }
}

function ProfileSection({ user, refreshAuth }: { user: any; refreshAuth: () => Promise<void> }) {
  const profile = user.profile;
  const [name, setName] = useState(profile?.full_name ?? user.name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [dob, setDob] = useState(profile?.date_of_birth ?? "");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { void getAvatarUrl(profile?.avatar_url ?? null).then(setAvatar); }, [profile?.avatar_url]);

  const save = async () => {
    if (name.trim().length < 2) { toast.error("Name must contain at least 2 characters."); return; }
    if (phone && phone.trim().length < 7) { toast.error("Enter a valid phone number."); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("profiles").update({ full_name: name.trim(), phone: phone.trim() || null, date_of_birth: dob || null }).eq("id", user.id);
      if (error) throw new Error(error.message);
      await refreshAuth();
      toast.success("Profile updated successfully.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update profile."); }
    finally { setSaving(false); }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try { await uploadCustomerAvatar(user.id, file); await refreshAuth(); toast.success("Profile photo updated."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to upload profile photo."); }
    finally { setUploading(false); }
  };

  return <PageShell eyebrow="Profile" title="Your personal details" description="Keep the contact information AeroFly uses for your travel requests up to date.">
    <div className="grid gap-6 lg:grid-cols-[.7fr_1.3fr]">
      <section className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6">
        <div className="eyebrow">Profile photo</div>
        <div className="mt-5 flex items-center gap-4">
          <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-[#fff0e8] text-2xl font-extrabold text-[#c94d1c]">{avatar ? <img src={avatar} alt="Profile" className="h-full w-full object-cover" /> : (name || user.email || "A").slice(0,1).toUpperCase()}</div>
          <div><label className="btn btn-ghost inline-flex cursor-pointer"><Upload size={14} /> {uploading ? "Uploading…" : "Change photo"}<input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={(event) => void upload(event.target.files?.[0])} /></label><p className="mt-2 text-[11px] text-[#92928b]">JPG, PNG or WebP · maximum 5 MB.</p></div>
        </div>
      </section>
      <section className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} /></Field>
          <Field label="Email"><Input value={user.email ?? ""} disabled /><p className="mt-1 text-[10px] text-[#92928b]">Managed by Supabase Auth.</p></Field>
          <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} placeholder="+91 …" /></Field>
          <Field label="Date of birth"><Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></Field>
        </div>
        <div className="mt-6 flex justify-end"><Button onClick={() => void save()} disabled={saving} className="gap-2 bg-[#f26b35] hover:bg-[#d95727]"><Save size={14} /> {saving ? "Saving…" : "Save changes"}</Button></div>
      </section>
    </div>
    <div className="mt-6 rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6"><div className="eyebrow">Account security</div><p className="mt-2 text-[13px] leading-6 text-[#6f6c66]">Your identity, authentication credentials and AeroFly authorization role are controlled by Supabase Auth and database policies. They cannot be edited from this customer profile.</p><Link href="/login?mode=reset" className="btn btn-ghost mt-4 inline-flex">Change password</Link></div>
  </PageShell>;
}

function PreferencesSection({ userId }: { userId: string }) {
  const [prefs, setPrefs] = useState<Omit<CustomerPreferences, "user_id" | "created_at" | "updated_at">>({ travel_scope: "both", preferred_destinations: [], travel_styles: [], budget_min: null, budget_max: null, duration_min_days: null, duration_max_days: null, preferred_language: "en", preferred_currency: "INR" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [destinations, setDestinations] = useState<any[]>([]);

  useEffect(() => { void (async () => { try { const [saved, result] = await Promise.all([getCustomerPreferences(userId), supabase.from("destinations").select("name,country").eq("is_active", true).order("name").limit(100)]); if (saved) setPrefs({ travel_scope: saved.travel_scope, preferred_destinations: saved.preferred_destinations, travel_styles: saved.travel_styles, budget_min: saved.budget_min, budget_max: saved.budget_max, duration_min_days: saved.duration_min_days, duration_max_days: saved.duration_max_days, preferred_language: saved.preferred_language, preferred_currency: saved.preferred_currency }); if (!result.error) setDestinations(result.data ?? []); } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load preferences."); } finally { setLoading(false); } })(); }, [userId]);

  const toggleArray = (key: "preferred_destinations" | "travel_styles", value: string) => setPrefs((current) => ({ ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value] }));
  const save = async () => { if (prefs.budget_min != null && prefs.budget_min < 0 || prefs.budget_max != null && prefs.budget_max < 0) { toast.error("Budget cannot be negative."); return; } if (prefs.budget_min != null && prefs.budget_max != null && prefs.budget_min > prefs.budget_max) { toast.error("Minimum budget cannot exceed maximum budget."); return; } if (prefs.duration_min_days != null && prefs.duration_max_days != null && prefs.duration_min_days > prefs.duration_max_days) { toast.error("Minimum duration cannot exceed maximum duration."); return; } setSaving(true); try { await saveCustomerPreferences(userId, prefs); toast.success("Preferences saved."); } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save preferences."); } finally { setSaving(false); } };

  if (loading) return <AccountLoading />;
  return <PageShell eyebrow="Preferences" title="How you like to travel" description="These choices are the foundation for future AeroFly personalization. You can change them anytime.">
    <section className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6">
      <div className="grid gap-7">
        <div><Label>Travel scope</Label><div className="mt-3 flex flex-wrap gap-2">{(["domestic", "international", "both"] as const).map((value) => <button key={value} type="button" onClick={() => setPrefs((p) => ({ ...p, travel_scope: value }))} className={`rounded-full border px-4 py-2 text-xs font-bold capitalize ${prefs.travel_scope === value ? "border-[#f26b35] bg-[#fff0e8] text-[#c94d1c]" : "border-[#e1dbd2] text-[#77736c]"}`}>{value}</button>)}</div></div>
        <div><Label>Travel style</Label><div className="mt-3 flex flex-wrap gap-2">{TRAVEL_STYLES.map((value) => <button key={value} type="button" onClick={() => toggleArray("travel_styles", value)} className={`rounded-full border px-4 py-2 text-xs font-bold capitalize ${prefs.travel_styles.includes(value) ? "border-[#f26b35] bg-[#fff0e8] text-[#c94d1c]" : "border-[#e1dbd2] text-[#77736c]"}`}>{value}</button>)}</div></div>
        <div><Label>Preferred destinations</Label><div className="mt-3 grid max-h-64 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3">{destinations.map((item) => { const value = item.name; const selected = prefs.preferred_destinations.includes(value); return <button key={`${value}-${item.country}`} type="button" onClick={() => toggleArray("preferred_destinations", value)} className={`rounded-xl border p-3 text-left text-xs font-bold ${selected ? "border-[#f26b35] bg-[#fff0e8] text-[#c94d1c]" : "border-[#eee9e1] text-[#77736c]"}`}>{value}<span className="mt-1 block font-normal text-[10px]">{item.country}</span></button>; })}</div></div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4"><Field label="Minimum budget"><Input type="number" min="0" value={prefs.budget_min ?? ""} onChange={(e) => setPrefs((p) => ({ ...p, budget_min: e.target.value ? Number(e.target.value) : null }))} /></Field><Field label="Maximum budget"><Input type="number" min="0" value={prefs.budget_max ?? ""} onChange={(e) => setPrefs((p) => ({ ...p, budget_max: e.target.value ? Number(e.target.value) : null }))} /></Field><Field label="Minimum days"><Input type="number" min="1" value={prefs.duration_min_days ?? ""} onChange={(e) => setPrefs((p) => ({ ...p, duration_min_days: e.target.value ? Number(e.target.value) : null }))} /></Field><Field label="Maximum days"><Input type="number" min="1" value={prefs.duration_max_days ?? ""} onChange={(e) => setPrefs((p) => ({ ...p, duration_max_days: e.target.value ? Number(e.target.value) : null }))} /></Field></div>
        <div className="grid gap-5 sm:grid-cols-2"><Field label="Preferred language"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={prefs.preferred_language} onChange={(e) => setPrefs((p) => ({ ...p, preferred_language: e.target.value }))}>{LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field><Field label="Preferred currency"><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={prefs.preferred_currency} onChange={(e) => setPrefs((p) => ({ ...p, preferred_currency: e.target.value }))}>{CURRENCIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field></div>
        <div className="flex justify-end"><Button onClick={() => void save()} disabled={saving} className="gap-2 bg-[#f26b35] hover:bg-[#d95727]"><Save size={14} /> {saving ? "Saving…" : "Save preferences"}</Button></div>
      </div>
    </section>
  </PageShell>;
}

function WishlistSection({ userId }: { userId: string }) {
  const [items, setItems] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { setItems(await getWishlist(userId)); } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load wishlist."); } finally { setLoading(false); } }, [userId]);
  useEffect(() => { void load(); }, [load]);
  const remove = async (tourId: number) => { try { await removeFromWishlist(userId, tourId); await load(); toast.success("Removed from wishlist."); } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to remove tour."); } };
  return <PageShell eyebrow="Wishlist" title="Tours you want to remember" description="Saved tours stay private to your account and can be removed at any time.">{loading ? <AccountLoading /> : items.length === 0 ? <EmptyState title="Your wishlist is empty" copy="Save a tour from its card or detail page and it will appear here." href="/tours" action="Explore tours" /> : <div className="grid gap-5 md:grid-cols-2">{items.map((item) => item.tours && <div key={item.id} className="relative"><TourCard tour={mapTour(item.tours)} /><button type="button" onClick={() => void remove(item.tour_id)} className="absolute bottom-5 right-16 rounded-full border border-[#e8e4dd] bg-white px-3 py-2 text-[10px] font-bold text-[#b14a34] shadow-sm"><Trash2 size={13} className="mr-1 inline" /> Remove</button></div>)}</div>}</PageShell>;
}

function RecentlyViewedSection({ userId }: { userId: string }) { const [items, setItems] = useState<any[]>([]); const [loading, setLoading] = useState(true); useEffect(() => { void getRecentlyViewedTours(userId).then(setItems).catch((e) => toast.error(e.message)).finally(() => setLoading(false)); }, [userId]); return <PageShell eyebrow="Recently viewed" title="Journeys you explored" description="A lightweight history of tours you recently opened. It is private to your account and limited to useful recent activity.">{loading ? <AccountLoading /> : items.length === 0 ? <EmptyState title="Nothing here yet" copy="Open a tour to start building your recent-view history." href="/tours" action="Browse tours" /> : <div className="grid gap-5 md:grid-cols-2">{items.map((tour: any) => <TourCard key={tour.id} tour={mapTour(tour)} />)}</div>}</PageShell>; }

function ActivitySection({ userId }: { userId: string }) { const [items, setItems] = useState<CustomerActivity[]>([]); const [loading, setLoading] = useState(true); useEffect(() => { void getCustomerActivity(userId, 50).then(setItems).catch((e) => toast.error(e.message)).finally(() => setLoading(false)); }, [userId]); return <PageShell eyebrow="Activity" title="Your AeroFly activity" description="Only useful travel interactions are retained for future personalization and account context.">{loading ? <AccountLoading /> : items.length === 0 ? <EmptyState title="No activity yet" copy="Your activity will appear after you browse, save or contact AeroFly." /> : <div className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] divide-y divide-[#eee9e1]">{items.map((item) => <div key={item.id} className="flex gap-4 p-5"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fff0e8] text-[#f26b35]"><Eye size={16} /></div><div><div className="text-sm font-bold capitalize">{item.activity_type.replaceAll("_", " ")}</div><div className="mt-1 text-xs text-[#77736c]">{item.entity_type ? `${item.entity_type}${item.entity_id ? ` #${item.entity_id}` : ""}` : "Account"} · {new Date(item.created_at).toLocaleString()}</div></div></div>)}</div>}</PageShell>; }


function EnquiriesSection({ userId }: { userId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPlans, setExpandedPlans] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;

    void supabase
      .from("enquiries")
      .select("*")
      .eq("customer_auth_id", userId)
      .order("createdAt", { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;

        if (error) toast.error(error.message);
        setItems(data ?? []);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  function parseTripPlan(message: string): Record<string, any> | null {
    const marker = "COMPLETE SAVED TRIP PLAN";
    const markerIndex = message.indexOf(marker);

    if (markerIndex === -1) return null;

    const jsonText = message.slice(markerIndex + marker.length).trim();

    try {
      const parsed: unknown = JSON.parse(jsonText);

      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, any>;
      }
    } catch {
      return null;
    }

    return null;
  }

  function readableValue(value: unknown): string {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
    if (typeof value === "boolean") return value ? "Yes" : "No";

    if (Array.isArray(value)) {
      return value.map(readableValue).filter(Boolean).join(", ");
    }

    if (typeof value === "object") {
      const object = value as Record<string, unknown>;
      const preferredKeys = [
        "title",
        "name",
        "description",
        "activity",
        "label",
        "location",
      ];

      for (const key of preferredKeys) {
        if (typeof object[key] === "string" && object[key].trim()) {
          return object[key] as string;
        }
      }

      return Object.entries(object)
        .filter(([, entry]) => entry != null && entry !== "")
        .map(([key, entry]) => {
          const label = key
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/[_-]/g, " ")
            .replace(/^./, (char) => char.toUpperCase());

          return `${label}: ${readableValue(entry)}`;
        })
        .join(" · ");
    }

    return "";
  }

  function displayLabel(value: string): string {
    return value
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]/g, " ")
      .replace(/^./, (char) => char.toUpperCase());
  }

  return (
    <PageShell
      eyebrow="My enquiries"
      title="Your travel requests"
      description="Track the requests you have sent to AeroFly and their current status."
    >
      {loading ? (
        <AccountLoading />
      ) : items.length === 0 ? (
        <EmptyState
          title="No enquiries yet"
          copy="Start with a tour or contact AeroFly for a custom itinerary."
          href="/tours"
          action="Explore tours"
        />
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const plan = item.message
              ? parseTripPlan(item.message)
              : null;

            const itinerary =
              plan?.itinerary &&
              typeof plan.itinerary === "object"
                ? plan.itinerary
                : null;

            const days = Array.isArray(itinerary?.days)
              ? itinerary.days
              : [];

            const preferences =
              plan?.preferences &&
              typeof plan.preferences === "object"
                ? plan.preferences
                : {};

            const budgetEstimate =
              plan?.budgetEstimate ??
              itinerary?.budgetEstimate ??
              null;

            const isExpanded = !!expandedPlans[String(item.id)];

            return (
              <article
                key={item.id}
                className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-5"
              >
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <div className="font-extrabold">
                      {item.destination || itinerary?.destination || "Custom trip"}
                    </div>

                    <div className="mt-1 text-xs text-[#77736c]">
                      {item.reference} ·{" "}
                      {new Date(item.createdAt).toLocaleString()}
                    </div>
                  </div>

                  <Status value={item.status} />
                </div>

                <div className="mt-4 grid gap-3 text-xs text-[#6f6c66] sm:grid-cols-3">
                  <div>
                    <b>Travel dates:</b>{" "}
                    {item.travelDates || "Not specified"}
                  </div>
                  <div>
                    <b>Travellers:</b> {item.travellers}
                  </div>
                  <div>
                    <b>Trip type:</b>{" "}
                    {item.tripType || "Not specified"}
                  </div>
                </div>

                {itinerary ? (
                  <div className="mt-4 overflow-hidden rounded-xl border border-[#e8e4dd]">
                    <div className="bg-[#f8f4ee] p-4">
                      <div className="text-lg font-extrabold text-[#25231f]">
                        {itinerary.title || plan?.planTitle || "Custom trip plan"}
                      </div>

                      {itinerary.summary && (
                        <p className="mt-2 text-sm leading-6 text-[#6f6c66]">
                          {itinerary.summary}
                        </p>
                      )}

                      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <span className="text-[#77736c]">Route</span>
                          <p className="font-semibold">
                            {preferences.origin || "Not specified"} →{" "}
                            {preferences.destination ||
                              itinerary.destination ||
                              item.destination}
                          </p>
                        </div>

                        <div>
                          <span className="text-[#77736c]">Duration</span>
                          <p className="font-semibold">
                            {itinerary.durationDays ?? days.length} days
                            {preferences.durationNights != null
                              ? ` / ${preferences.durationNights} nights`
                              : ""}
                          </p>
                        </div>

                        <div>
                          <span className="text-[#77736c]">Budget preference</span>
                          <p className="font-semibold">
                            {preferences.currency || "INR"}{" "}
                            {preferences.budget ?? "Not specified"}
                          </p>
                        </div>

                        <div>
                          <span className="text-[#77736c]">Estimated total</span>
                          <p className="font-semibold">
                            {budgetEstimate?.currency ||
                              preferences.currency ||
                              "INR"}{" "}
                            {budgetEstimate?.total ?? "Not specified"}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="p-4">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPlans((current) => ({
                            ...current,
                            [String(item.id)]: !current[String(item.id)],
                          }))
                        }
                        className="flex w-full items-center justify-between gap-3 text-left font-bold text-[#25231f]"
                        aria-expanded={isExpanded}
                      >
                        <span>
                          Complete day-by-day itinerary ({days.length} days)
                        </span>
                        <span>{isExpanded ? "−" : "+"}</span>
                      </button>

                      {isExpanded && (
                        <div className="mt-4 space-y-3">
                          {days.map((day: Record<string, any>, index: number) => {
                            const activities = Array.isArray(day.activities)
                              ? day.activities
                              : [];

                            const meals = Array.isArray(day.meals)
                              ? day.meals
                              : [];

                            return (
                              <section
                                key={day.dayNumber ?? day.day ?? index}
                                className="rounded-xl border border-[#e8e4dd] p-4"
                              >
                                <h4 className="font-bold text-[#25231f]">
                                  Day {day.dayNumber ?? day.day ?? index + 1}
                                  {day.title ? ` — ${day.title}` : ""}
                                </h4>

                                {day.description && (
                                  <p className="mt-2 text-sm leading-6 text-[#6f6c66]">
                                    {day.description}
                                  </p>
                                )}

                                {activities.length > 0 && (
                                  <div className="mt-3">
                                    <h5 className="text-sm font-semibold">
                                      Activities and sightseeing
                                    </h5>
                                    <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-[#6f6c66]">
                                      {activities.map(
                                        (activity: unknown, activityIndex: number) => (
                                          <li key={activityIndex}>
                                            {readableValue(activity)}
                                          </li>
                                        ),
                                      )}
                                    </ul>
                                  </div>
                                )}

                                {meals.length > 0 && (
                                  <p className="mt-3 text-sm leading-6 text-[#6f6c66]">
                                    <b>Meals:</b>{" "}
                                    {meals.map(readableValue).join(", ")}
                                  </p>
                                )}

                                {day.accommodation && (
                                  <p className="mt-3 text-sm leading-6 text-[#6f6c66]">
                                    <b>Accommodation:</b>{" "}
                                    {readableValue(day.accommodation)}
                                  </p>
                                )}

                                {day.stay && (
                                  <p className="mt-3 text-sm leading-6 text-[#6f6c66]">
                                    <b>Stay:</b> {readableValue(day.stay)}
                                  </p>
                                )}

                                {day.estimatedCost != null && (
                                  <p className="mt-3 text-sm text-[#6f6c66]">
                                    <b>Estimated daily cost:</b>{" "}
                                    {preferences.currency || "INR"}{" "}
                                    {day.estimatedCost}
                                  </p>
                                )}

                                {Object.entries(day).filter(
                                  ([key, value]) =>
                                    ![
                                      "dayNumber",
                                      "day",
                                      "title",
                                      "description",
                                      "activities",
                                      "meals",
                                      "accommodation",
                                      "stay",
                                      "estimatedCost",
                                    ].includes(key) &&
                                    value != null &&
                                    value !== "",
                                ).map(([key, value]) => (
                                  <p
                                    key={key}
                                    className="mt-2 text-sm leading-6 text-[#6f6c66]"
                                  >
                                    <b>{displayLabel(key)}:</b>{" "}
                                    {readableValue(value)}
                                  </p>
                                ))}
                              </section>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : item.message ? (
                  <p className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-[#f8f4ee] p-4 text-sm leading-6 text-[#6f6c66]">
                    {item.message}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

function AppointmentsSection({ userId }: { userId: string }) { const [items, setItems] = useState<any[]>([]); const [loading, setLoading] = useState(true); const load = useCallback(async () => { setLoading(true); const { data, error } = await supabase.from("appointments").select("*").eq("customer_auth_id", userId).order("appointmentAt", { ascending: true }); if (error) toast.error(error.message); setItems(data ?? []); setLoading(false); }, [userId]); useEffect(() => { void load(); }, [load]); const cancel = async (id: number) => { try { await cancelCustomerAppointment(id); toast.success("Appointment cancelled."); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : "Unable to cancel appointment."); } }; return <PageShell eyebrow="Appointments" title="Your appointment requests" description="Review scheduled conversations with the AeroFly travel desk.">{loading ? <AccountLoading /> : items.length === 0 ? <EmptyState title="No appointments" copy="You can request an appointment through the existing AeroFly customer-care flow." href="/contact" action="Contact AeroFly" /> : <div className="space-y-3">{items.map((item) => <RequestCard key={item.id} icon={CalendarDays} title={item.purpose} reference={item.reference} status={item.status} details={`${new Date(item.appointmentAt).toLocaleString()} · ${item.mode} · ${item.durationMinutes} min`} cancelable={["requested", "confirmed"].includes(item.status)} onCancel={() => void cancel(item.id)} />)}</div>}</PageShell>; }

function CallbacksSection({ userId }: { userId: string }) { const [items, setItems] = useState<any[]>([]); const [loading, setLoading] = useState(true); const load = useCallback(async () => { setLoading(true); const { data, error } = await supabase.from("callback_requests").select("*").eq("customer_auth_id", userId).order("createdAt", { ascending: false }); if (error) toast.error(error.message); setItems(data ?? []); setLoading(false); }, [userId]); useEffect(() => { void load(); }, [load]); const cancel = async (id: number) => { try { await cancelCustomerCallback(id); toast.success("Callback request cancelled."); await load(); } catch (e) { toast.error(e instanceof Error ? e.message : "Unable to cancel callback."); } }; return <PageShell eyebrow="Callbacks" title="Your callback requests" description="Track and cancel callback requests while they are still eligible for cancellation.">{loading ? <AccountLoading /> : items.length === 0 ? <EmptyState title="No callback requests" copy="Use the existing customer-care flow whenever you want AeroFly to call you." href="/contact" action="Request help" /> : <div className="space-y-3">{items.map((item) => <RequestCard key={item.id} icon={Clock3} title={item.reason} reference={item.reference} status={item.status} details={item.preferredAt ? new Date(item.preferredAt).toLocaleString() : "Time to be confirmed"} cancelable={["requested", "scheduled"].includes(item.status)} onCancel={() => void cancel(item.id)} />)}</div>}</PageShell>; }

function RequestCard({ icon: Icon, title, reference, status, details, cancelable, onCancel }: any) { return <article className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-5"><div className="flex items-start gap-4"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#fff0e8] text-[#f26b35]"><Icon size={17} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-3"><div><div className="font-extrabold">{title}</div><div className="mt-1 text-xs text-[#77736c]">{reference}</div></div><Status value={status} /></div><div className="mt-4 text-xs text-[#6f6c66]">{details}</div>{cancelable && <button type="button" onClick={onCancel} className="mt-4 text-[11px] font-bold text-[#b14a34]">Cancel request</button>}</div></div></article>; }

function PlaceholderSection({ title, copy, icon: Icon }: any) { return <PageShell eyebrow="Customer platform" title={title} description={copy}><div className="rounded-2xl border border-dashed border-[#dcd4c9] bg-[#fffdf9] p-10 text-center"><Icon className="mx-auto text-[#f26b35]" size={24} /><h2 className="mt-4 text-xl font-extrabold">Coming together in the next workflow</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[#77736c]">This Phase 3 placeholder is intentional. It keeps the customer navigation ready without starting the Phase 4 operational workflow.</p></div></PageShell>; }

function PageShell({ eyebrow, title, description, children }: any) { return <div><header className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6 sm:p-8"><div className="eyebrow">{eyebrow}</div><h1 className="display mt-2 text-4xl font-extrabold sm:text-5xl">{title}</h1><p className="mt-3 max-w-2xl text-[14px] leading-6 text-[#6f6c66]">{description}</p></header><div className="mt-6">{children}</div></div>; }
function Field({ label, children }: any) { return <div><Label>{label}</Label><div className="mt-2">{children}</div></div>; }
function Status({ value }: { value: string | null }) { return <span className="rounded-full bg-[#f3ede5] px-2.5 py-1 text-[10px] font-bold capitalize text-[#6f6c66]">{String(value || "pending").replaceAll("_", " ")}</span>; }
function EmptyState({ title, copy, href, action }: any) { return <div className="rounded-2xl border border-dashed border-[#dcd4c9] bg-[#fffdf9] p-10 text-center"><div className="text-lg font-extrabold">{title}</div><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#77736c]">{copy}</p>{href && <Link href={href} className="btn btn-primary mt-5 inline-flex">{action}</Link>}</div>; }
function AccountLoading() { return <div className="grid min-h-[300px] place-items-center"><div className="text-center"><Loader2 className="mx-auto animate-spin text-[#f26b35]" /><p className="mt-3 text-sm text-[#77736c]">Loading your AeroFly account…</p></div></div>; }
function mapTour(tour: any) { return { slug: tour.slug, title: tour.title, destination: tour.destinations?.name ?? "", country: tour.destinations?.country ?? "", durationDays: tour.durationDays, durationNights: tour.durationNights, priceFrom: tour.priceFrom, originalPrice: tour.originalPrice, rating: tour.rating ?? 0, reviewCount: tour.reviewCount ?? 0, imageUrl: tour.imageUrl ?? "", tags: tour.tags, category: tour.tour_categories?.name, availability: tour.availability }; }
function BellIcon(props: any) { return <Clock3 {...props} />; }
function PlaneIcon(props: any) { return <CalendarDays {...props} />; }
