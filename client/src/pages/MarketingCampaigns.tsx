import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CalendarClock, ChevronDown, CircleAlert, Loader2, Megaphone, Plus, RefreshCw, Save, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

type Channel = "in_app" | "email" | "sms" | "whatsapp";
type Audience = "consented_customers" | "domestic_interest" | "international_interest" | "wishlist_travelers" | "recently_active";
type Status = "draft" | "scheduled" | "processing" | "completed" | "cancelled" | "failed";
type Campaign = {
  id: string; name: string; title: string; subject: string; body: string; action_path: string | null;
  channels: Channel[]; audience_segment: Audience; status: Status; scheduled_at: string | null;
  started_at: string | null; completed_at: string | null; total_recipients: number; sent_count: number;
  delivered_count: number; failed_count: number; created_at: string;
};
type FormState = { id?: string; name: string; title: string; subject: string; body: string; action_path: string; channels: Channel[]; audience_segment: Audience; scheduled_at: string };
const EMPTY: FormState = { name: "", title: "", subject: "", body: "", action_path: "/tours", channels: ["email"], audience_segment: "consented_customers", scheduled_at: "" };
const CHANNEL_OPTIONS: Array<{ value: Channel; label: string; hint: string }> = [
  { value: "in_app", label: "In-app", hint: "Only customers who opted in to promotional in-app alerts" },
  { value: "email", label: "Email", hint: "Requires email marketing consent" },
  { value: "sms", label: "SMS", hint: "Requires SMS marketing consent and compliant sender setup" },
  { value: "whatsapp", label: "WhatsApp", hint: "Requires WhatsApp consent and an approved marketing template" },
];
const STATUS_CLASS: Record<Status, string> = {
  draft: "bg-stone-100 text-stone-700", scheduled: "bg-blue-50 text-blue-700", processing: "bg-amber-50 text-amber-800",
  completed: "bg-emerald-50 text-emerald-700", cancelled: "bg-stone-100 text-stone-500", failed: "bg-red-50 text-red-700",
};

export default function MarketingCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showComposer, setShowComposer] = useState(false);
  const [preview, setPreview] = useState(false);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: invokeError } = await supabase.functions.invoke("marketing-campaigns", { body });
    if (invokeError) throw new Error(invokeError.message || "Campaign service request failed.");
    if (data?.error) throw new Error(String(data.error));
    return data;
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const data = await invoke({ action: "list" }); setCampaigns((data.campaigns ?? []) as Campaign[]); }
    catch (e) { const message = e instanceof Error ? e.message : "Unable to load campaigns."; setError(message); }
    finally { setLoading(false); }
  }, [invoke]);
  useEffect(() => { void load(); }, [load]);

  const toggleChannel = (channel: Channel) => setForm((old) => ({ ...old, channels: old.channels.includes(channel) ? old.channels.filter((c) => c !== channel) : [...old.channels, channel] }));
  const openNew = () => { setForm({ ...EMPTY }); setPreview(false); setShowComposer(true); };
  const editDraft = (campaign: Campaign) => {
    if (campaign.status !== "draft") return;
    setForm({ id: campaign.id, name: campaign.name, title: campaign.title, subject: campaign.subject, body: campaign.body, action_path: campaign.action_path ?? "/tours", channels: campaign.channels, audience_segment: campaign.audience_segment, scheduled_at: "" });
    setPreview(false); setShowComposer(true);
  };
  const saveDraft = async () => {
    if (!form.channels.length) { toast.error("Choose at least one channel."); return; }
    setSaving(true);
    try {
      const data = await invoke({ action: form.id ? "update" : "create", campaign: { ...form, action_path: form.action_path || null } });
      toast.success(form.id ? "Draft updated." : "Campaign draft created.");
      setShowComposer(false); setForm({ ...EMPTY });
      if (data.campaign) setCampaigns((old) => [data.campaign as Campaign, ...old.filter((c) => c.id !== (data.campaign as Campaign).id)]);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Unable to save campaign."); }
    finally { setSaving(false); }
  };
  const scheduleCampaign = async (campaign: Campaign) => {
    const raw = campaign.id === form.id ? form.scheduled_at : "";
    const scheduledAt = raw || window.prompt("Schedule this campaign for (local date/time, e.g. 2026-10-20T10:00)?", "");
    if (!scheduledAt) return;
    const parsed = new Date(scheduledAt);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() < Date.now() - 60_000) { toast.error("Choose a valid future date and time."); return; }
    setSaving(true);
    try { await invoke({ action: "schedule", id: campaign.id, scheduled_at: parsed.toISOString() }); toast.success("Campaign scheduled."); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Unable to schedule campaign."); }
    finally { setSaving(false); }
  };
  const cancelCampaign = async (campaign: Campaign) => {
    if (!window.confirm(`Cancel “${campaign.name}”?`)) return;
    setSaving(true);
    try { await invoke({ action: "cancel", id: campaign.id }); toast.success("Campaign cancelled."); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Unable to cancel campaign."); }
    finally { setSaving(false); }
  };

  const total = campaigns.length;
  const scheduled = campaigns.filter((c) => c.status === "scheduled").length;
  const delivered = campaigns.reduce((sum, c) => sum + c.delivered_count, 0);
  const failed = campaigns.reduce((sum, c) => sum + c.failed_count, 0);

  return <div className="min-h-screen bg-[#f4f4f1] p-4 text-[#222321] sm:p-8">
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col justify-between gap-4 rounded-2xl border border-[#ead8cc] bg-[#fff8f3] p-6 sm:flex-row sm:items-end sm:p-8">
        <div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-[#c94d1c]"><Megaphone size={14} /> AeroFly marketing</div><h1 className="mt-2 font-['Manrope'] text-3xl font-extrabold tracking-[-.04em]">Promotions & Campaigns</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#77736c]">Create tour launches, seasonal offers and destination campaigns for customers who have explicitly opted in. Marketing campaigns are separate from essential booking and payment messages.</p></div>
        <div className="flex gap-2"><Button variant="outline" className="gap-2 rounded-full" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Refresh</Button><Button className="gap-2 rounded-full bg-[#f26b35] text-white hover:bg-[#d95624]" onClick={openNew}><Plus size={15} /> New campaign</Button></div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Campaigns" value={total} hint="All recent campaigns" />
        <Metric label="Scheduled" value={scheduled} hint="Waiting for launch time" />
        <Metric label="Delivered" value={delivered} hint="Provider-confirmed where supported" />
        <Metric label="Failed recipients" value={failed} hint="Review delivery errors" />
      </div>

      {showComposer && <section className="rounded-2xl border border-[#deded9] bg-white p-5 sm:p-7">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-extrabold">{form.id ? "Edit campaign draft" : "Create a campaign"}</h2><p className="mt-1 text-sm text-[#77736c]">Audience: customers with recorded marketing consent and at least one selected channel enabled.</p></div><button onClick={() => setShowComposer(false)} aria-label="Close campaign editor" className="rounded-full p-2 hover:bg-stone-100"><XCircle size={20} /></button></div>
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <Field label="Internal campaign name"><input value={form.name} onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))} maxLength={120} placeholder="Diwali international holidays" className={inputClass} /></Field>
          <Field label="Message title"><input value={form.title} onChange={(e) => setForm((v) => ({ ...v, title: e.target.value }))} maxLength={180} placeholder="Plan your next festive getaway" className={inputClass} /></Field>
          <Field label="Email subject"><input value={form.subject} onChange={(e) => setForm((v) => ({ ...v, subject: e.target.value }))} maxLength={180} placeholder="Festive escapes with AeroFly Tours" className={inputClass} /></Field>
          <Field label="Internal destination link"><input value={form.action_path} onChange={(e) => setForm((v) => ({ ...v, action_path: e.target.value }))} maxLength={300} placeholder="/tours" className={inputClass} /><span className="mt-1 block text-xs text-[#88857e]">Use an internal path such as /tours or /search, not an external URL.</span></Field>
          <div className="lg:col-span-2"><Field label="Campaign message"><textarea value={form.body} onChange={(e) => setForm((v) => ({ ...v, body: e.target.value }))} maxLength={1200} rows={5} placeholder="Discover our latest holiday packages and upcoming departures..." className={inputClass} /><span className="mt-1 block text-right text-xs text-[#88857e]">{form.body.length}/1200</span></Field></div>
          <Field label="Audience segment"><select value={form.audience_segment} onChange={(e) => setForm((v) => ({ ...v, audience_segment: e.target.value as Audience }))} className={inputClass}><option value="consented_customers">All consented customers</option><option value="domestic_interest">Domestic travel interest</option><option value="international_interest">International travel interest</option><option value="wishlist_travelers">Customers with a tour wishlist</option><option value="recently_active">Recently active customers (last 90 days)</option></select><span className="mt-1 block text-xs text-[#88857e]">Audience filters use existing Phase 3 customer preferences, wishlist and activity records. Channel consent is still required.</span></Field>
          <div className="lg:col-span-2"><div className="text-sm font-extrabold">Delivery channels</div><p className="mt-1 text-xs text-[#77736c]">Only customers with recorded consent for a selected channel are eligible. Email unsubscribe links are included; SMS opt-out relies on the configured provider's STOP handling.</p><div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{CHANNEL_OPTIONS.map((channel) => <label key={channel.value} className={`cursor-pointer rounded-xl border p-4 ${form.channels.includes(channel.value) ? "border-[#f26b35] bg-[#fff8f3]" : "border-[#ecece8]"}`}><span className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.channels.includes(channel.value)} onChange={() => toggleChannel(channel.value)} />{channel.label}</span><span className="mt-2 block text-xs leading-5 text-[#77736c]">{channel.hint}</span></label>)}</div></div>
        </div>
        {preview && <div className="mt-5 rounded-xl border border-[#ead8cc] bg-[#fffaf6] p-5"><div className="text-[10px] font-bold uppercase tracking-widest text-[#c94d1c]">Customer preview</div><h3 className="mt-2 text-xl font-extrabold">{form.title || "Campaign title"}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#5f5c56]">{form.body || "Your campaign message appears here."}</p><div className="mt-3 text-xs font-semibold text-[#c94d1c]">{form.action_path || "/tours"}</div></div>}
        <div className="mt-6 flex flex-wrap gap-2"><Button variant="outline" onClick={() => setPreview((v) => !v)} className="gap-2">{preview ? <ChevronDown size={14} /> : <Megaphone size={14} />}{preview ? "Hide preview" : "Preview"}</Button><Button onClick={() => void saveDraft()} disabled={saving} className="gap-2 bg-[#f26b35] text-white hover:bg-[#d95624]"><Save size={14} />{saving ? "Saving…" : "Save draft"}</Button><Button variant="outline" onClick={() => setShowComposer(false)}>Close</Button></div>
      </section>}

      <section className="overflow-hidden rounded-2xl border border-[#deded9] bg-white">
        <div className="flex items-center justify-between border-b border-[#ecece8] px-5 py-4"><div><h2 className="font-['Manrope'] text-lg font-extrabold">Campaign library</h2><p className="mt-1 text-xs text-[#92928b]">Drafts, scheduled sends and delivery results</p></div><span className="text-xs text-[#77736c]">{campaigns.length} campaigns</span></div>
        {error && <div role="alert" className="m-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><CircleAlert size={16} className="mr-2 inline" />{error}<Button variant="outline" onClick={() => void load()} className="ml-3">Retry</Button></div>}
        {loading ? <div className="flex items-center justify-center gap-2 p-14 text-sm text-[#77736c]"><Loader2 size={16} className="animate-spin" /> Loading campaigns…</div> : campaigns.length === 0 ? <div className="p-14 text-center"><Megaphone size={28} className="mx-auto text-[#f26b35]" /><h3 className="mt-4 font-extrabold">No campaigns yet</h3><p className="mt-2 text-sm text-[#77736c]">Create a draft for your next tour launch or seasonal offer.</p><Button onClick={openNew} className="mt-4 bg-[#f26b35] text-white hover:bg-[#d95624]"><Plus size={14} className="mr-2" />Create campaign</Button></div> : <div className="divide-y divide-[#ecece8]">{campaigns.map((campaign) => <article key={campaign.id} className="grid gap-4 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_minmax(220px,.7fr)_auto] xl:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-extrabold">{campaign.name}</h3><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${STATUS_CLASS[campaign.status]}`}>{campaign.status}</span></div><div className="mt-1 text-sm font-semibold text-[#5f5c56]">{campaign.title}</div><p className="mt-1 line-clamp-2 text-xs leading-5 text-[#88857e]">{campaign.body}</p><div className="mt-2 flex flex-wrap gap-1.5">{campaign.channels.map((channel) => <span key={channel} className="rounded-md bg-[#f3f0ea] px-2 py-1 text-[10px] font-semibold">{channel.replace("_", " ")}</span>)}</div></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2"><SmallStat label="Recipients" value={campaign.total_recipients} /><SmallStat label="Sent" value={campaign.sent_count} /><SmallStat label="Delivered" value={campaign.delivered_count} /><SmallStat label="Failed" value={campaign.failed_count} />{campaign.scheduled_at && <div className="col-span-2 flex items-center gap-1 text-xs text-[#77736c]"><CalendarClock size={13} />{new Date(campaign.scheduled_at).toLocaleString()}</div>}</div><div className="flex flex-wrap gap-2 xl:flex-col">{campaign.status === "draft" && <><Button size="sm" variant="outline" onClick={() => editDraft(campaign)}>Edit draft</Button><Button size="sm" onClick={() => void scheduleCampaign(campaign)} disabled={saving} className="gap-1 bg-[#f26b35] text-white hover:bg-[#d95624]"><Send size={12} />Schedule</Button><Button size="sm" variant="ghost" onClick={() => void cancelCampaign(campaign)} disabled={saving}>Discard</Button></>}{campaign.status === "scheduled" && <Button size="sm" variant="outline" onClick={() => void cancelCampaign(campaign)} disabled={saving}>Cancel schedule</Button>}{campaign.status === "processing" && <span className="flex items-center gap-1 text-xs font-semibold text-amber-700"><Loader2 size={13} className="animate-spin" />Processing queue</span>}</div></article>)}</div>}
      </section>
      <p className="text-xs leading-5 text-[#88857e]">Promotional messages are never sent to customers without recorded marketing consent for the selected channel. Campaign creation is authenticated and role-checked server-side. Delivery still depends on the configured providers, approved templates and scheduled worker.</p>
    </div>
  </div>;
}

const inputClass = "mt-2 w-full rounded-xl border border-[#deded9] bg-white px-3 py-3 text-sm outline-none transition focus:border-[#f26b35] focus:ring-2 focus:ring-[#f26b35]/10";
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block text-sm font-bold">{label}{children}</label>; }
function Metric({ label, value, hint }: { label: string; value: number; hint: string }) { return <div className="rounded-xl border border-[#deded9] bg-white p-5"><div className="text-[10px] font-bold uppercase tracking-[.14em] text-[#92928b]">{label}</div><div className="mt-4 font-['Manrope'] text-3xl font-extrabold">{value.toLocaleString("en-IN")}</div><div className="mt-2 text-[11px] text-[#77736c]">{hint}</div></div>; }
function SmallStat({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-[#f8f6f2] px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-wide text-[#92928b]">{label}</div><div className="mt-1 text-sm font-extrabold">{value.toLocaleString("en-IN")}</div></div>; }
