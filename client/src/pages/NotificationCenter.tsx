import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Bell, CheckCheck, ChevronLeft, ChevronRight, ExternalLink, Loader2, Mail, MessageCircle, RefreshCw, Smartphone } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  action_path: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
};
type Preferences = {
  email_enabled: boolean;
  sms_enabled: boolean;
  whatsapp_enabled: boolean;
  marketing_email_enabled: boolean;
  marketing_sms_enabled: boolean;
  marketing_whatsapp_enabled: boolean;
  marketing_in_app_enabled: boolean;
};
const PAGE_SIZE = 20;
const DEFAULT_PREFS: Preferences = {
  email_enabled: true, sms_enabled: false, whatsapp_enabled: false,
  marketing_email_enabled: false, marketing_sms_enabled: false, marketing_whatsapp_enabled: false, marketing_in_app_enabled: false,
};

export default function NotificationCenter() {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFS);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preferenceExists, setPreferenceExists] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      let listQuery = supabase.from("notifications").select("id,title,body,event_type,entity_type,entity_id,action_path,is_read,read_at,created_at", { count: "exact" })
        .eq("recipient_user_id", user.id).eq("in_app_visible", true).order("created_at", { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (unreadOnly) listQuery = listQuery.eq("is_read", false);
      const [listResult, countResult, prefResult] = await Promise.all([
        listQuery,
        supabase.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_user_id", user.id).eq("in_app_visible", true).eq("is_read", false),
        supabase.from("notification_preferences").select("email_enabled,sms_enabled,whatsapp_enabled,marketing_email_enabled,marketing_sms_enabled,marketing_whatsapp_enabled,marketing_in_app_enabled").eq("user_id", user.id).maybeSingle(),
      ]);
      if (listResult.error) throw listResult.error;
      if (countResult.error) throw countResult.error;
      if (prefResult.error) throw prefResult.error;
      setItems((listResult.data ?? []) as NotificationItem[]);
      setHasNext((listResult.count ?? 0) > (page + 1) * PAGE_SIZE);
      setUnreadCount(countResult.count ?? 0);
      setPreferenceExists(Boolean(prefResult.data));
      setPreferences(prefResult.data ? { ...DEFAULT_PREFS, ...prefResult.data } : DEFAULT_PREFS);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to load notifications.";
      setError(message);
    } finally { setLoading(false); }
  }, [user, page, unreadOnly]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel(`phase9-notifications-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${user.id}` }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user, load]);

  const savePreferences = async () => {
    if (!user) return;
    setSavingPreferences(true);
    try {
      const optedOut = {
        email_opted_out_at: preferences.email_enabled ? null : new Date().toISOString(),
        sms_opted_out_at: preferences.sms_enabled ? null : new Date().toISOString(),
        whatsapp_opted_out_at: preferences.whatsapp_enabled ? null : new Date().toISOString(),
      };
      const values = { ...preferences, ...optedOut };
      const result = preferenceExists
        ? await supabase.from("notification_preferences").update(values).eq("user_id", user.id)
        : await supabase.from("notification_preferences").insert({ user_id: user.id, ...values });
      if (result.error) throw result.error;
      setPreferenceExists(true);
      toast.success("Notification preferences saved.");
      setPreferencesOpen(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Unable to save preferences."); }
    finally { setSavingPreferences(false); }
  };

  const setRead = async (item: NotificationItem, read: boolean) => {
    const result = await supabase.from("notifications").update({ is_read: read, read_at: read ? new Date().toISOString() : null }).eq("id", item.id).eq("recipient_user_id", user?.id);
    if (result.error) { toast.error("Unable to update notification."); return; }
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, is_read: read, read_at: read ? new Date().toISOString() : null } : entry));
    setUnreadCount((count) => Math.max(0, count + (read ? -1 : 1)));
  };
  const markAllRead = async () => {
    const { error: rpcError } = await supabase.rpc("phase9_mark_all_notifications_read");
    if (rpcError) { toast.error("Unable to mark all notifications as read."); return; }
    setItems((current) => current.map((item) => ({ ...item, is_read: true, read_at: new Date().toISOString() })));
    setUnreadCount(0); toast.success("All notifications marked as read.");
  };
  const heading = useMemo(() => unreadOnly ? "Unread notifications" : "All notifications", [unreadOnly]);

  if (authLoading) return <PageShell><div className="flex items-center gap-2 p-10 text-sm text-[#77736c]"><Loader2 className="animate-spin" size={16} /> Loading your account…</div></PageShell>;
  if (!isAuthenticated || !user) return <PageShell><div className="p-10 text-center"><h1 className="text-2xl font-extrabold">Sign in to view notifications</h1><Link className="btn btn-primary mt-4 inline-flex" href="/login?next=%2Fdashboard%2Fnotifications">Sign in</Link></div></PageShell>;

  return <PageShell>
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-col justify-between gap-4 rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6 sm:flex-row sm:items-end sm:p-8">
        <div><div className="eyebrow">AeroFly travel desk</div><h1 className="display mt-2 text-3xl font-extrabold sm:text-4xl">Notifications</h1><p className="mt-2 text-sm text-[#6f6c66]">Important updates about your enquiries, bookings, payments and support, plus promotions you choose to receive.</p><p className="mt-3 text-xs font-semibold text-[#c94d1c]">{unreadCount} unread</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" className="gap-2 rounded-full" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh</Button><Button variant="outline" className="gap-2 rounded-full" onClick={() => setPreferencesOpen((v) => !v)}><Mail size={14} /> Preferences</Button><Button className="gap-2 rounded-full bg-[#f26b35] text-white hover:bg-[#d95624]" onClick={() => void markAllRead()} disabled={!unreadCount}><CheckCheck size={14} /> Mark all read</Button></div>
      </header>

      {preferencesOpen && <section className="rounded-2xl border border-[#e8e4dd] bg-white p-5 sm:p-7"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-extrabold">Delivery preferences</h2><p className="mt-1 text-sm text-[#77736c]">In-app notifications always remain enabled. Essential security/service messages may still be sent even if optional email delivery is disabled. SMS and WhatsApp require opt-in.</p></div><Bell className="text-[#f26b35]" size={20} /></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([['email_enabled','Email',Mail],['sms_enabled','SMS',Smartphone],['whatsapp_enabled','WhatsApp',MessageCircle]] as const).map(([key,label,Icon]) => <label key={key} className="flex items-center gap-3 rounded-xl border border-[#ecece8] p-4"><Icon size={18} className="text-[#f26b35]" /><span className="flex-1 text-sm font-bold">{label} transactional updates</span><input type="checkbox" checked={preferences[key]} onChange={(event) => setPreferences((old) => ({ ...old, [key]: event.target.checked }))} /></label>)}</div>
        <div className="mt-5 rounded-xl bg-[#f8f4ee] p-4"><div className="text-sm font-bold">Marketing communications</div><p className="mt-1 text-xs leading-5 text-[#77736c]">Promotional campaigns are sent only through channels you enable here. You can withdraw consent at any time. Essential booking, payment, security and service updates are separate.</p><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{([['marketing_in_app_enabled','In-app'],['marketing_email_enabled','Email'],['marketing_sms_enabled','SMS'],['marketing_whatsapp_enabled','WhatsApp']] as const).map(([key,label]) => <label key={key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={preferences[key]} onChange={(event) => setPreferences((old) => ({ ...old, [key]: event.target.checked }))} /> {label} marketing consent</label>)}</div></div>
        <div className="mt-5 flex gap-2"><Button onClick={() => void savePreferences()} disabled={savingPreferences} className="gap-2 bg-[#f26b35] text-white hover:bg-[#d95624]">{savingPreferences && <Loader2 size={14} className="animate-spin" />} Save preferences</Button><Button variant="outline" onClick={() => setPreferencesOpen(false)}>Close</Button></div>
      </section>}

      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-extrabold">{heading}</h2><div className="flex items-center gap-2 rounded-full border border-[#e8e4dd] bg-white p-1 text-xs"><button onClick={() => { setUnreadOnly(false); setPage(0); }} className={`rounded-full px-3 py-2 ${!unreadOnly ? "bg-[#222321] text-white" : "text-[#6f6c66]"}`}>All</button><button onClick={() => { setUnreadOnly(true); setPage(0); }} className={`rounded-full px-3 py-2 ${unreadOnly ? "bg-[#222321] text-white" : "text-[#6f6c66]"}`}>Unread</button></div></div>
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"><div className="font-bold">Notifications could not be loaded.</div><p className="mt-1">{error}</p><Button variant="outline" onClick={() => void load()} className="mt-3">Try again</Button></div>}
      {loading ? <div className="flex items-center justify-center gap-2 rounded-2xl border border-[#e8e4dd] bg-white p-12 text-sm text-[#77736c]"><Loader2 size={17} className="animate-spin" /> Loading notifications…</div> : !items.length ? <div className="rounded-2xl border border-dashed border-[#dcd6cc] bg-white p-12 text-center"><Bell size={28} className="mx-auto text-[#f26b35]" /><h3 className="mt-4 font-extrabold">{unreadOnly ? "You're all caught up" : "No notifications yet"}</h3><p className="mt-2 text-sm text-[#77736c]">When something needs your attention, it will appear here.</p></div> : <div className="space-y-3">{items.map((item) => <article key={item.id} className={`rounded-2xl border bg-white p-4 sm:p-5 ${item.is_read ? "border-[#e8e4dd]" : "border-[#f3b28f] bg-[#fffaf6]"}`}><div className="flex items-start gap-3"><div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.is_read ? "bg-[#d8d4cc]" : "bg-[#f26b35]"}`} /><div className="min-w-0 flex-1"><button className="text-left font-extrabold hover:text-[#c94d1c]" onClick={() => setExpanded((old) => old === item.id ? null : item.id)}>{item.title}</button><p className="mt-1 text-sm leading-6 text-[#6f6c66]">{item.body}</p><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#92928b]"><span>{new Date(item.created_at).toLocaleString()}</span><span className="rounded-full bg-[#f3f0ea] px-2 py-1">{item.event_type.replaceAll("_", " ")}</span>{item.entity_type && <span>{item.entity_type.replaceAll("_", " ")} {item.entity_id ? `#${item.entity_id}` : ""}</span>}</div>
        {expanded === item.id && <div className="mt-4 rounded-xl bg-[#f8f4ee] p-4"><div className="text-xs font-bold uppercase tracking-wide text-[#77736c]">Notification details</div><p className="mt-2 text-sm leading-6">{item.body}</p>{item.action_path && <Link href={item.action_path} onClick={() => { if (!item.is_read) void setRead(item, true); }} className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-[#c94d1c]">Open related page <ExternalLink size={13} /></Link>}</div>}
        </div><div className="flex shrink-0 flex-col gap-2"><button aria-label={item.is_read ? "Mark unread" : "Mark read"} title={item.is_read ? "Mark unread" : "Mark read"} onClick={() => void setRead(item,!item.is_read)} className="rounded-lg border border-[#e8e4dd] px-2.5 py-2 text-[11px] font-bold text-[#6f6c66] hover:border-[#f26b35]">{item.is_read ? "Unread" : "Mark read"}</button>{item.action_path && <Link href={item.action_path} onClick={() => { if (!item.is_read) void setRead(item,true); }} className="rounded-lg bg-[#f26b35] px-2.5 py-2 text-center text-[11px] font-bold text-white">View</Link>}</div></div></article>)}</div>}
      {!loading && items.length > 0 && <div className="flex items-center justify-between rounded-xl border border-[#e8e4dd] bg-white p-3"><span className="text-xs text-[#77736c]">Page {page + 1} · {PAGE_SIZE} notifications per page</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((n) => Math.max(0,n-1))} className="gap-1"><ChevronLeft size={14} /> Previous</Button><Button variant="outline" size="sm" disabled={!hasNext} onClick={() => setPage((n) => n+1)} className="gap-1">Next <ChevronRight size={14} /></Button></div></div>}
    </div>
  </PageShell>;
}

function PageShell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#f8f6f2] px-4 py-6 sm:px-8 sm:py-10"><div className="mx-auto max-w-6xl">{children}</div></div>;
}
