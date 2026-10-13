import { useCallback, useEffect, useMemo, useState } from "react";
import { FileCheck2, Loader2, MessageSquare, RefreshCw, ShieldAlert, UploadCloud, UserRoundCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/_core/hooks/useAuth";

type Application = {
  id: number; reference: string; type: string; status: string; applicantName: string;
  destinationCountry: string | null; assigned_auth_id: string | null;
  organization_id: string | null; createdAt: string;
};
type Ticket = {
  id: number; reference: string; subject: string; category: string; priority: string;
  status: string; assigned_to: string | null; organization_id: string | null;
  customer_auth_id: string; created_at: string; application_id: number | null; booking_id: number | null;
};
type ChecklistItem = { id: number; applicationId: number; label: string; status: string; required: boolean; notes: string | null; requested_from_customer: boolean };
type DocumentRecord = { id: number; applicationId: number; documentType: string; fileName: string; status: string; sizeBytes: number | null; version_number: number; uploadedAt: string; rejection_reason: string | null; checklistItemId: number | null };
type TicketMessage = { id: number; ticket_id: number; author_id: string; body: string; is_internal: boolean; created_at: string };
type StaffMember = { id: string; fullName: string; jobTitle: string | null; departmentId: string | null };
type Organization = { id: string; name: string; slug: string };
type AppNote = { id: number; application_id: number; author_id: string; note: string; created_at: string; is_internal: boolean };

const STAFF_ROLES = new Set(["owner", "admin", "manager", "staff", "customer_care", "counsellor"]);
const APP_STATUSES = ["submitted", "under_review", "action_required", "approved", "rejected", "completed", "cancelled"];
const APP_TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["under_review", "action_required", "rejected", "cancelled"],
  under_review: ["action_required", "approved", "rejected", "completed", "cancelled"],
  action_required: ["under_review", "rejected", "cancelled"],
  approved: ["completed", "cancelled"],
  rejected: [], completed: [], cancelled: [],
};
const CHECKLIST_STATUSES = ["pending", "received", "approved", "rejected", "not_applicable"];
const TICKET_STATUSES = ["open", "in_progress", "waiting_customer", "escalated", "resolved", "closed"];

async function invoke<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("travel-support", { body });
  if (error) throw new Error(error.message || "Request failed");
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export default function AdminTravelSupport() {
  const { user, loading: authLoading } = useAuth();
  const [applications, setApplications] = useState<Application[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [checklists, setChecklists] = useState<ChecklistItem[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [notes, setNotes] = useState<AppNote[]>([]);
  const [ticketMessages, setTicketMessages] = useState<Record<number, TicketMessage[]>>({});
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [assignees, setAssignees] = useState<Record<string, StaffMember[]>>({});
  const [applicationOrg, setApplicationOrg] = useState<Record<number, string>>({});
  const [applicationAssignee, setApplicationAssignee] = useState<Record<number, string>>({});
  const [ticketOrg, setTicketOrg] = useState<Record<number, string>>({});
  const [ticketAssignee, setTicketAssignee] = useState<Record<number, string>>({});
  const [notesDraft, setNotesDraft] = useState<Record<number, string>>({});
  const [checklistDraft, setChecklistDraft] = useState<Record<number, string>>({});
  const [replies, setReplies] = useState<Record<number, string>>({});
  const [reviewReasons, setReviewReasons] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [appResult, ticketResult] = await Promise.all([
        supabase.from("travel_applications").select('id,reference,type,status,"applicantName","destinationCountry",assigned_auth_id,organization_id,"createdAt"').order("createdAt", { ascending: false }).limit(150),
        supabase.from("support_tickets").select("id,reference,subject,category,priority,status,assigned_to,organization_id,customer_auth_id,created_at,application_id,booking_id").order("created_at", { ascending: false }).limit(150),
      ]);
      if (appResult.error) throw appResult.error;
      if (ticketResult.error) throw ticketResult.error;
      const appRows = (appResult.data ?? []) as Application[];
      const ticketRows = (ticketResult.data ?? []) as Ticket[];
      setApplications(appRows); setTickets(ticketRows);
      const appIds = appRows.map(a => a.id);
      if (appIds.length) {
        const [checklistResult, documentResult, noteResult] = await Promise.all([
          supabase.from("application_checklist_items").select('id,"applicationId",label,status,required,notes,requested_from_customer').in("applicationId", appIds).order("sort_order"),
          supabase.from("application_documents").select('id,"applicationId","documentType","fileName",status,"sizeBytes",version_number,"uploadedAt",rejection_reason,"checklistItemId"').in("applicationId", appIds).order("uploadedAt", { ascending: false }),
          supabase.from("travel_application_notes").select("id,application_id,author_id,note,created_at,is_internal").in("application_id", appIds).order("created_at", { ascending: false }),
        ]);
        if (checklistResult.error) throw checklistResult.error;
        if (documentResult.error) throw documentResult.error;
        if (noteResult.error) throw noteResult.error;
        setChecklists((checklistResult.data ?? []) as ChecklistItem[]);
        setDocuments((documentResult.data ?? []) as DocumentRecord[]);
        setNotes((noteResult.data ?? []) as AppNote[]);
      } else { setChecklists([]); setDocuments([]); setNotes([]); }
      const loadedMessages: Record<number, TicketMessage[]> = {};
      for (const ticket of ticketRows) {
        const { data, error: messageError } = await supabase.from("support_ticket_messages")
          .select("id,ticket_id,author_id,body,is_internal,created_at").eq("ticket_id", ticket.id).order("created_at");
        if (messageError) throw messageError;
        loadedMessages[ticket.id] = (data ?? []) as TicketMessage[];
      }
      setTicketMessages(loadedMessages);
      // A manager can enumerate organizations; non-managers only use the organization already on a case.
      try {
        const result = await invoke<{ organizations: Organization[] }>({ action: "staff_list_organizations" });
        setOrganizations(result.organizations ?? []);
      } catch { setOrganizations([]); }
      const orgIds = Array.from(new Set([...appRows.map(a => a.organization_id), ...ticketRows.map(t => t.organization_id)].filter((id): id is string => Boolean(id))));
      const memberResults = await Promise.all(orgIds.map(async orgId => {
        try { const result = await invoke<{ members: StaffMember[] }>({ action: "staff_list_assignees", organizationId: orgId }); return [orgId, result.members ?? []] as const; }
        catch { return [orgId, []] as const; }
      }));
      setAssignees(Object.fromEntries(memberResults));
      setApplicationOrg(old => Object.fromEntries(appRows.map(a => [a.id, old[a.id] || a.organization_id || ""])));
      setApplicationAssignee(old => Object.fromEntries(appRows.map(a => [a.id, old[a.id] || a.assigned_auth_id || ""])));
      setTicketOrg(old => Object.fromEntries(ticketRows.map(t => [t.id, old[t.id] || t.organization_id || ""])));
      setTicketAssignee(old => Object.fromEntries(ticketRows.map(t => [t.id, old[t.id] || t.assigned_to || ""])));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load travel cases"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (user) void load(); }, [user, load]);

  const visibleApplications = useMemo(() => applications.filter(a => filter === "all" || a.type === filter || a.status === filter), [applications, filter]);

  async function loadAssignees(organizationId: string) {
    if (!organizationId || assignees[organizationId]) return;
    try { const result = await invoke<{ members: StaffMember[] }>({ action: "staff_list_assignees", organizationId }); setAssignees(old => ({ ...old, [organizationId]: result.members ?? [] })); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load staff members"); }
  }
  async function run(key: string, operation: () => Promise<void>, success: string) {
    setBusyKey(key); setError(""); setNotice("");
    try { await operation(); setNotice(success); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Operation failed"); }
    finally { setBusyKey(null); }
  }
  async function updateApplicationStatus(app: Application, status: string) {
    await run(`app-${app.id}`, async () => { await invoke({ action: "set_application_status", applicationId: app.id, status, customerMessage: `Your ${app.type} assistance case ${app.reference} is now ${status.replaceAll("_", " ")}. Please sign in to view the updated checklist and case timeline.` }); }, `${app.reference} status updated.`);
  }
  async function assignApplication(app: Application) {
    const orgId = applicationOrg[app.id]; const assignee = applicationAssignee[app.id];
    if (!orgId || !assignee) { setError("Choose an organization and staff member before assigning this case."); return; }
    await run(`app-${app.id}`, async () => { await invoke({ action: "staff_assign_application", applicationId: app.id, assignedTo: assignee, organizationId: orgId }); }, `${app.reference} assigned.`);
  }
  async function addChecklist(app: Application, requestInfo: boolean) {
    const label = checklistDraft[app.id]?.trim(); if (!label) { setError("Enter a checklist label first."); return; }
    await run(`app-${app.id}`, async () => { await invoke({ action: requestInfo ? "staff_request_information" : "staff_add_checklist_item", applicationId: app.id, label, required: true }); setChecklistDraft(old => ({ ...old, [app.id]: "" })); }, requestInfo ? "Additional information requested." : "Checklist item added.");
  }
  async function updateChecklist(item: ChecklistItem, status: string) {
    await run(`check-${item.id}`, async () => { await invoke({ action: "staff_update_checklist_item", checklistItemId: item.id, status, notes: item.notes }); }, `Checklist item updated: ${item.label}`);
  }
  async function addInternalNote(app: Application) {
    const note = notesDraft[app.id]?.trim(); if (!note) return;
    await run(`note-${app.id}`, async () => { await invoke({ action: "staff_add_internal_note", applicationId: app.id, note }); setNotesDraft(old => ({ ...old, [app.id]: "" })); }, "Private internal note saved.");
  }
  async function reviewDocument(doc: DocumentRecord, status: "approved" | "rejected" | "under_review") {
    const reason = reviewReasons[doc.id]?.trim() ?? "";
    if (status === "rejected" && reason.length < 3) { setError("Enter a clear customer-visible reason before rejecting a document."); return; }
    await run(`doc-${doc.id}`, async () => { await invoke({ action: "staff_review_document", documentId: doc.id, status, reason }); setReviewReasons(old => ({ ...old, [doc.id]: "" })); }, `Document marked ${status.replaceAll("_", " ")}.`);
  }
  async function downloadDocument(documentId: number) {
    setError("");
    try { const result = await invoke<{ signedUrl: string }>({ action: "create_document_download", documentId }); window.open(result.signedUrl, "_blank", "noopener,noreferrer"); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to authorize document download"); }
  }
  async function updateTicket(ticket: Ticket, patch: Record<string, unknown>, success: string) {
    await run(`ticket-${ticket.id}`, async () => { await invoke({ action: "update_support_ticket", ticketId: ticket.id, ...patch }); }, success);
  }
  async function reply(ticket: Ticket, internal: boolean) {
    const message = replies[ticket.id]?.trim(); if (!message) return;
    await run(`ticket-${ticket.id}`, async () => { await invoke({ action: "reply_support_ticket", ticketId: ticket.id, message, internal }); setReplies(old => ({ ...old, [ticket.id]: "" })); }, internal ? "Private note saved." : "Customer-visible reply sent.");
  }

  if (authLoading) return <div className="grid min-h-64 place-items-center"><Loader2 className="animate-spin"/></div>;
  if (!user || !STAFF_ROLES.has(user.role)) return <div className="mx-auto max-w-2xl p-8"><ShieldAlert className="mb-3 text-red-600"/><h1 className="text-xl font-bold">Staff access required</h1><p className="mt-2 text-sm">Your account is not authorized for this workspace. Server-side authorization and RLS remain authoritative.</p></div>;

  return <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-8">
    <header className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6"><div><div className="eyebrow">AeroFly operations</div><h1 className="display mt-2 text-4xl font-extrabold">Travel documents & support</h1><p className="mt-2 text-sm text-[#6f6c66]">Review documents, manage checklists, assign cases and handle customer support.</p></div><Button variant="outline" className="gap-2 rounded-full" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""}/> Refresh</Button></header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}{notice && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{notice}</div>}
    <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-2xl font-extrabold"><FileCheck2 className="text-[#f26b35]"/> Visa & passport applications</h2><select className="field max-w-56" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All applications</option><option value="visa">Visa</option><option value="passport">Passport</option>{APP_STATUSES.map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></div>
      {loading ? <p className="rounded-xl bg-white p-6">Loading cases…</p> : visibleApplications.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-sm">No applications are visible in your current assignment/organization scope.</p> : visibleApplications.map(app => {
        const appChecklist = checklists.filter(x => x.applicationId === app.id);
        const appDocuments = documents.filter(x => x.applicationId === app.id);
        const appNotes = notes.filter(x => x.application_id === app.id && x.is_internal);
        const orgId = applicationOrg[app.id] || app.organization_id || "";
        return <article key={app.id} className="space-y-4 rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-5"><div className="flex flex-wrap justify-between gap-3"><div><div className="eyebrow">{app.type} · {app.reference}</div><h3 className="mt-1 text-lg font-extrabold">{app.applicantName}</h3><p className="mt-1 text-xs text-[#77736c]">{app.destinationCountry || "Passport assistance"} · {new Date(app.createdAt).toLocaleDateString()}</p></div><span className="h-fit rounded-full bg-[#fff0e8] px-3 py-1 text-xs font-bold capitalize">{app.status.replaceAll("_", " ")}</span></div>
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]"><label className="text-xs font-semibold">Organization<select className="field mt-1" value={orgId} onChange={e => { const value = e.target.value; setApplicationOrg(old => ({ ...old, [app.id]: value })); setApplicationAssignee(old => ({ ...old, [app.id]: "" })); void loadAssignees(value); }}><option value="">Select organization</option>{organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}{app.organization_id && !organizations.some(o => o.id === app.organization_id) && <option value={app.organization_id}>{app.organization_id}</option>}</select></label><label className="text-xs font-semibold">Assigned staff<select className="field mt-1" value={applicationAssignee[app.id] || ""} onChange={e => setApplicationAssignee(old => ({ ...old, [app.id]: e.target.value }))}><option value="">Select team member</option>{(assignees[orgId] ?? []).map(m => <option key={m.id} value={m.id}>{m.fullName}{m.jobTitle ? ` · ${m.jobTitle}` : ""}</option>)}</select></label><div className="flex items-end"><Button disabled={busyKey === `app-${app.id}`} onClick={() => void assignApplication(app)}><UserRoundCog size={15} className="mr-2"/>Assign case</Button></div></div>
        <label className="block max-w-xs text-xs font-semibold">Application status<select className="field mt-1" value={app.status} onChange={e => void updateApplicationStatus(app, e.target.value)} disabled={busyKey === `app-${app.id}`}><option value={app.status}>{app.status.replaceAll("_", " ")}</option>{(APP_TRANSITIONS[app.status] ?? []).map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></label>
        <div className="rounded-xl bg-[#f8f4ee] p-4"><h4 className="font-bold">Document checklist</h4>{appChecklist.length === 0 ? <p className="mt-2 text-xs text-[#77736c]">No checklist items yet.</p> : <div className="mt-3 space-y-3">{appChecklist.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4dbd0] pb-3 last:border-0"><div><p className="text-sm font-semibold">{item.label} {item.required && <span className="text-red-600">*</span>}</p><p className="text-xs text-[#77736c]">{item.requested_from_customer ? "Requested from customer · " : ""}{item.status.replaceAll("_", " ")}{item.notes ? ` · ${item.notes}` : ""}</p></div><select className="field max-w-48" value={item.status} onChange={e => void updateChecklist(item, e.target.value)} disabled={busyKey === `check-${item.id}`}>{CHECKLIST_STATUSES.map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select></div>)}</div>}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input className="field flex-1" placeholder="Add a checklist item" value={checklistDraft[app.id] ?? ""} onChange={e => setChecklistDraft(old => ({ ...old, [app.id]: e.target.value }))}/><Button variant="outline" disabled={busyKey === `app-${app.id}`} onClick={() => void addChecklist(app, false)}>Add checklist</Button><Button disabled={busyKey === `app-${app.id}`} onClick={() => void addChecklist(app, true)} className="bg-[#f26b35] hover:bg-[#d95725]">Request information</Button></div>
        </div>
        <div className="rounded-xl border border-[#e8e4dd] p-4"><h4 className="font-bold">Uploaded documents and review</h4>{appDocuments.length === 0 ? <p className="mt-2 text-xs text-[#77736c]">No documents uploaded.</p> : <div className="mt-3 space-y-3">{appDocuments.map(doc => <div key={doc.id} className="rounded-lg bg-[#f8f4ee] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold">{doc.fileName}</p><p className="text-xs text-[#77736c]">{doc.documentType} · v{doc.version_number} · {doc.sizeBytes ? `${Math.ceil(doc.sizeBytes / 1024)} KB · ` : ""}{doc.status.replaceAll("_", " ")}</p>{doc.rejection_reason && <p className="mt-1 text-xs text-red-700">Previous review: {doc.rejection_reason}</p>}</div><Button size="sm" variant="outline" onClick={() => void downloadDocument(doc.id)}><UploadCloud size={14} className="mr-1"/>Download securely</Button></div><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input className="field flex-1" placeholder="Required if rejecting: explain what customer must fix" value={reviewReasons[doc.id] ?? ""} onChange={e => setReviewReasons(old => ({ ...old, [doc.id]: e.target.value }))}/><Button size="sm" variant="outline" disabled={busyKey === `doc-${doc.id}`} onClick={() => void reviewDocument(doc, "under_review")}>Under review</Button><Button size="sm" disabled={busyKey === `doc-${doc.id}`} onClick={() => void reviewDocument(doc, "approved")} className="bg-[#28784c] hover:bg-[#20633e]">Approve</Button><Button size="sm" variant="destructive" disabled={busyKey === `doc-${doc.id}`} onClick={() => void reviewDocument(doc, "rejected")}>Reject</Button></div></div>)}</div>}</div>
        <div className="rounded-xl bg-[#f8f4ee] p-4"><h4 className="font-bold">Private internal notes</h4>{appNotes.length > 0 && <ul className="mt-2 space-y-2">{appNotes.map(n => <li key={n.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p>{n.note}</p><p className="mt-1 text-[10px] text-[#77736c]">{new Date(n.created_at).toLocaleString()}</p></li>)}</ul>}<div className="mt-3 flex flex-col gap-2 sm:flex-row"><textarea className="field min-h-16 flex-1" placeholder="Private note — never visible to customer" value={notesDraft[app.id] ?? ""} onChange={e => setNotesDraft(old => ({ ...old, [app.id]: e.target.value }))}/><Button variant="outline" disabled={busyKey === `note-${app.id}`} onClick={() => void addInternalNote(app)}>Save private note</Button></div></div>
        </article>;
      })}
    </section>
    <section className="space-y-4"><h2 className="flex items-center gap-2 text-2xl font-extrabold"><MessageSquare className="text-[#f26b35]"/> Support tickets</h2>
      {loading ? <p className="rounded-xl bg-white p-6">Loading tickets…</p> : tickets.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-sm">No support tickets are visible in your assignment/organization scope.</p> : tickets.map(ticket => {
        const orgId = ticketOrg[ticket.id] || ticket.organization_id || "";
        return <article key={ticket.id} className="space-y-4 rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">{ticket.reference} · {ticket.category}</div><h3 className="mt-1 text-lg font-extrabold">{ticket.subject}</h3><p className="mt-1 text-xs text-[#77736c]">Priority: {ticket.priority} · Created {new Date(ticket.created_at).toLocaleString()}{ticket.application_id ? ` · Application #${ticket.application_id}` : ""}{ticket.booking_id ? ` · Booking #${ticket.booking_id}` : ""}</p></div><div className="flex flex-wrap gap-2"><select className="field max-w-44" value={ticket.status} onChange={e => void updateTicket(ticket, { status: e.target.value }, `${ticket.reference} status updated.`)} disabled={busyKey === `ticket-${ticket.id}`}>{TICKET_STATUSES.map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</select><select className="field max-w-32" value={ticket.priority} onChange={e => void updateTicket(ticket, { priority: e.target.value }, `${ticket.reference} priority updated.`)} disabled={busyKey === `ticket-${ticket.id}`}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div></div>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]"><label className="text-xs font-semibold">Organization<select className="field mt-1" value={orgId} onChange={e => { const value = e.target.value; setTicketOrg(old => ({ ...old, [ticket.id]: value })); setTicketAssignee(old => ({ ...old, [ticket.id]: "" })); void loadAssignees(value); }}><option value="">Select organization</option>{organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}{ticket.organization_id && !organizations.some(o => o.id === ticket.organization_id) && <option value={ticket.organization_id}>{ticket.organization_id}</option>}</select></label><label className="text-xs font-semibold">Assigned staff<select className="field mt-1" value={ticketAssignee[ticket.id] || ""} onChange={e => setTicketAssignee(old => ({ ...old, [ticket.id]: e.target.value }))}><option value="">Select team member</option>{(assignees[orgId] ?? []).map(m => <option key={m.id} value={m.id}>{m.fullName}{m.jobTitle ? ` · ${m.jobTitle}` : ""}</option>)}</select></label><div className="flex items-end"><Button disabled={busyKey === `ticket-${ticket.id}` || !ticketAssignee[ticket.id] || !orgId} onClick={() => void updateTicket(ticket, { assignedTo: ticketAssignee[ticket.id], organizationId: orgId }, `${ticket.reference} assigned.`)}><UserRoundCog size={15} className="mr-2"/>Assign</Button></div></div>
          <div className="space-y-2">{(ticketMessages[ticket.id] ?? []).map(message => <div key={message.id} className={`rounded-xl p-3 text-sm ${message.is_internal ? "border border-amber-200 bg-amber-50" : "bg-[#f8f4ee]"}`}><div className="mb-1 text-[10px] font-bold uppercase tracking-wider">{message.is_internal ? "Internal note — staff only" : message.author_id === ticket.customer_auth_id ? "Customer" : "Customer-visible reply"}</div>{message.body}<p className="mt-1 text-[10px] text-[#77736c]">{new Date(message.created_at).toLocaleString()}</p></div>)}</div>
          <textarea className="field min-h-20 w-full" placeholder="Reply to customer or add a private internal note" value={replies[ticket.id] ?? ""} onChange={e => setReplies(old => ({ ...old, [ticket.id]: e.target.value }))}/><div className="flex flex-wrap gap-2"><Button disabled={busyKey === `ticket-${ticket.id}`} onClick={() => void reply(ticket, false)} className="bg-[#f26b35] hover:bg-[#d95725]">Reply to customer</Button><Button variant="outline" disabled={busyKey === `ticket-${ticket.id}`} onClick={() => void reply(ticket, true)}>Add internal note</Button></div>
        </article>;
      })}
    </section>
  </main>;
}
