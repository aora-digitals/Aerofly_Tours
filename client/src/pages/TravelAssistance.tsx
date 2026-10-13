import { useCallback, useEffect, useState, type FormEvent } from "react";
import { FileCheck2, FileText, Loader2, MessageCircle, RefreshCw, UploadCloud } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import CustomerLayout from "@/components/customer/CustomerLayout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

type TravelApplication = {
  id: number; reference: string; type: "visa" | "passport"; status: string;
  applicantName: string; destinationCountry: string | null; visa_type: string | null;
  createdAt: string; customerNotes: string | null;
};
type ChecklistItem = { id: number; applicationId: number; label: string; required: boolean; status: string; notes: string | null; requested_from_customer: boolean };
type AppDocument = { id: number; applicationId: number; documentType: string; fileName: string; status: string; expires_on?: string | null; checklistItemId?: number | null; version_number?: number; rejection_reason?: string | null };
type ApplicationEvent = { id: number; applicationId: number; fromStatus: string | null; toStatus: string | null; note: string | null; createdAt: string; customer_visible: boolean; metadata?: Record<string, unknown> };

const invoke = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("travel-support", { body });
  if (error) throw new Error(error.message || "Request failed");
  if (data?.error) throw new Error(data.error);
  return data;
};

export default function TravelAssistance() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [applications, setApplications] = useState<TravelApplication[]>([]);
  const [checklists, setChecklists] = useState<ChecklistItem[]>([]);
  const [documents, setDocuments] = useState<AppDocument[]>([]);
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [type, setType] = useState<"visa" | "passport">("visa");
  const [applicantName, setApplicantName] = useState(user?.name ?? "");
  const [destinationCountry, setDestinationCountry] = useState("");
  const [visaType, setVisaType] = useState("tourist");
  const [nationality, setNationality] = useState("Indian");
  const [travelDate, setTravelDate] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [documentType, setDocumentType] = useState("identity_document");
  const [expiryDate, setExpiryDate] = useState("");
  const [checklistForUpload, setChecklistForUpload] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError("");
    try {
      const { data: apps, error: appsError } = await supabase.from("travel_applications")
        .select('id,reference,type,status,"applicantName","destinationCountry",visa_type,"createdAt","customerNotes"')
        .eq("customer_auth_id", user.id).order("createdAt", { ascending: false });
      if (appsError) throw appsError;
      const ids = (apps ?? []).map((a: any) => a.id);
      let items: any[] = []; let docs: any[] = []; let timeline: any[] = [];
      if (ids.length) {
        const [checklistResult, documentResult, eventResult] = await Promise.all([
          supabase.from("application_checklist_items").select('id,"applicationId",label,required,status,notes,requested_from_customer').in("applicationId", ids).order("sort_order"),
          supabase.from("application_documents").select('id,"applicationId","documentType","fileName",status,expires_on,"checklistItemId",version_number,rejection_reason').in("applicationId", ids).order("uploadedAt", { ascending: false }),
          supabase.from("application_events").select('id,"applicationId","fromStatus","toStatus",note,"createdAt",customer_visible').in("applicationId", ids).eq("customer_visible", true).order("createdAt", { ascending: false }),
        ]);
        if (checklistResult.error) throw checklistResult.error;
        if (documentResult.error) throw documentResult.error;
        if (eventResult.error) throw eventResult.error;
        items = checklistResult.data ?? []; docs = documentResult.data ?? []; timeline = eventResult.data ?? [];
      }
      setApplications((apps ?? []) as TravelApplication[]); setChecklists(items as ChecklistItem[]); setDocuments(docs as AppDocument[]); setEvents(timeline as ApplicationEvent[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load travel assistance"); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  async function createApplication(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await invoke({ action: "create_application", type, applicantName, destinationCountry: type === "visa" ? destinationCountry : "", visaType: type === "visa" ? visaType : "", nationality, travelDate: travelDate || null, customerNotes });
      setNotice(`Request created: ${result.application.reference}. You can now upload requested documents.`);
      setApplicantName(""); setDestinationCountry(""); setTravelDate(""); setCustomerNotes(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create request"); }
    finally { setBusy(false); }
  }

  async function submitApplication(id: number) {
    setBusy(true); setError(""); setNotice("");
    try { await invoke({ action: "set_application_status", applicationId: id, status: "submitted" }); setNotice("Application submitted to the AeroFly team."); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not submit application"); }
    finally { setBusy(false); }
  }

  async function uploadDocument(applicationId: number, file: File, replacesDocumentId?: number) {
    setBusy(true); setError(""); setNotice("");
    try {
      const created = await invoke({ action: "create_document_upload", applicationId, fileName: file.name, mimeType: file.type, sizeBytes: file.size, documentType, expiresOn: expiryDate || null, checklistItemId: checklistForUpload[applicationId] ? Number(checklistForUpload[applicationId]) : null, replacesDocumentId: replacesDocumentId ?? null });
      const { error: uploadError } = await supabase.storage.from("travel-documents").uploadToSignedUrl(created.path, created.token, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      await invoke({ action: "complete_document_upload", documentId: created.documentId });
      setNotice("Document uploaded securely."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Document upload failed"); }
    finally { setBusy(false); }
  }

  async function downloadDocument(documentId: number) {
    setError("");
    try {
      const result = await invoke({ action: "create_document_download", documentId });
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to authorize download"); }
  }

  if (authLoading) return <div className="grid min-h-screen place-items-center"><Loader2 className="animate-spin" /></div>;
  if (!isAuthenticated || !user) return <div className="p-8">Please sign in to manage your travel assistance requests.</div>;

  return <CustomerLayout><div className="mx-auto max-w-5xl space-y-6">
    <header className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6 sm:p-8">
      <div className="eyebrow">Travel documents & assistance</div><h1 className="display mt-2 text-4xl font-extrabold">Visa & passport help</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-[#6f6c66]">Track your request, review checklists and securely share requested documents. AeroFly provides application assistance only; government authorities decide outcomes and timelines. Visa or passport approval is not guaranteed.</p>
      <Button variant="outline" className="mt-4 gap-2 rounded-full" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""}/> Refresh</Button>
    </header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{notice}</div>}
    <section className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6">
      <h2 className="text-xl font-extrabold">Start a request</h2>
      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={createApplication}>
        <label className="text-sm font-semibold">Assistance type<select className="field mt-1" value={type} onChange={e => setType(e.target.value as "visa"|"passport")}><option value="visa">Visa assistance</option><option value="passport">Passport assistance</option></select></label>
        <label className="text-sm font-semibold">Applicant full name<input className="field mt-1" value={applicantName} onChange={e => setApplicantName(e.target.value)} minLength={2} maxLength={160} required /></label>
        {type === "visa" && <><label className="text-sm font-semibold">Destination country<input className="field mt-1" value={destinationCountry} onChange={e => setDestinationCountry(e.target.value)} maxLength={160} required /></label><label className="text-sm font-semibold">Visa type<select className="field mt-1" value={visaType} onChange={e => setVisaType(e.target.value)}><option value="tourist">Tourist</option><option value="business">Business</option><option value="transit">Transit</option><option value="student">Student</option><option value="other">Other / not sure</option></select></label></>}
        <label className="text-sm font-semibold">Nationality<input className="field mt-1" value={nationality} onChange={e => setNationality(e.target.value)} maxLength={120} /></label>
        <label className="text-sm font-semibold">Expected travel date<input type="date" className="field mt-1" value={travelDate} onChange={e => setTravelDate(e.target.value)} /></label>
        <label className="sm:col-span-2 text-sm font-semibold">Additional information<textarea className="field mt-1 min-h-24" value={customerNotes} onChange={e => setCustomerNotes(e.target.value)} maxLength={4000} /></label>
        <Button disabled={busy} className="sm:col-span-2 rounded-full bg-[#f26b35] hover:bg-[#d95725]">{busy ? <Loader2 className="animate-spin" size={16}/> : "Create assistance request"}</Button>
      </form>
    </section>
    <section className="space-y-4"><div className="flex items-center gap-2"><FileCheck2 className="text-[#f26b35]"/><h2 className="text-2xl font-extrabold">Your applications</h2></div>
      {loading ? <div className="rounded-xl bg-white p-8 text-sm">Loading applications…</div> : applications.length === 0 ? <div className="rounded-xl border border-dashed border-[#ddd5ca] p-8 text-sm text-[#6f6c66]">No visa or passport requests yet.</div> : applications.map(app => {
        const items = checklists.filter(x => x.applicationId === app.id); const docs = documents.filter(x => x.applicationId === app.id);
        return <article key={app.id} className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">{app.type === "visa" ? "Visa assistance" : "Passport assistance"}</div><h3 className="mt-1 text-lg font-extrabold">{app.applicantName}</h3><p className="mt-1 text-xs text-[#77736c]">{app.reference}{app.destinationCountry ? ` · ${app.destinationCountry}` : ""} · {new Date(app.createdAt).toLocaleDateString()}</p></div><span className="rounded-full bg-[#fff0e8] px-3 py-1 text-xs font-bold capitalize text-[#a83d16]">{app.status.replaceAll("_", " ")}</span></div>
          {app.customerNotes && <p className="mt-3 text-sm text-[#6f6c66]">{app.customerNotes}</p>}
          <div className="mt-5 grid gap-4 md:grid-cols-2"><div className="rounded-xl bg-[#f8f4ee] p-4"><h4 className="flex items-center gap-2 font-bold"><ListIcon/> Required documents</h4>{items.length === 0 ? <p className="mt-2 text-xs text-[#77736c]">The travel team has not added a checklist yet.</p> : <ul className="mt-3 space-y-2">{items.map(item => <li key={item.id} className="text-sm"><span className="font-semibold">{item.label}</span> {item.required && <span className="text-xs text-red-600">Required</span>}<div className="text-xs capitalize text-[#77736c]">{item.status.replaceAll("_", " ")}{item.requested_from_customer ? " · requested by AeroFly" : ""}{item.notes ? ` · ${item.notes}` : ""}</div></li>)}</ul>}</div>
          <div className="rounded-xl bg-[#f8f4ee] p-4"><h4 className="flex items-center gap-2 font-bold"><FileText size={16}/> Uploaded documents</h4>{docs.length === 0 ? <p className="mt-2 text-xs text-[#77736c]">No documents uploaded yet.</p> : <ul className="mt-3 space-y-2">{docs.map(doc => <li key={doc.id} className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 truncate">{doc.fileName}<span className="block text-xs capitalize text-[#77736c]">{doc.status.replaceAll("_", " ")}{doc.version_number ? ` · version ${doc.version_number}` : ""}{doc.expires_on ? ` · expires ${new Date(`${doc.expires_on}T00:00:00`).toLocaleDateString()}` : ""}</span>{doc.rejection_reason && <span className="mt-1 block whitespace-normal text-xs text-red-700">Staff note: {doc.rejection_reason}</span>}</span><div className="flex shrink-0 flex-col items-end gap-2"><button className="text-xs font-bold text-[#c94d1c]" onClick={() => void downloadDocument(doc.id)}>Download</button>{doc.status === "rejected" && !["approved","rejected","completed","cancelled"].includes(app.status) && <label className="cursor-pointer text-xs font-bold text-[#c94d1c]">Upload replacement<input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void uploadDocument(app.id, file, doc.id); e.currentTarget.value = ""; }}/></label>}</div></li>)}</ul>}
          <label className="mt-4 block text-xs font-semibold">Document category<select className="field mt-1" value={documentType} onChange={e => setDocumentType(e.target.value)}><option value="passport">Passport</option><option value="photo">Passport/visa photo</option><option value="identity_document">Identity document</option><option value="proof_of_funds">Proof of funds</option><option value="travel_itinerary">Travel itinerary</option><option value="invitation_letter">Invitation letter</option><option value="application_form">Application form</option><option value="supporting_document">Supporting document</option><option value="other">Other</option></select></label><label className="mt-3 block text-xs font-semibold">Link to checklist item (optional)<select className="field mt-1" value={checklistForUpload[app.id] ?? ""} onChange={e => setChecklistForUpload(old => ({ ...old, [app.id]: e.target.value }))}><option value="">General supporting document</option>{items.map(item => <option key={item.id} value={item.id}>{item.label}{item.required ? " · required" : ""}</option>)}</select></label><label className="mt-3 block text-xs font-semibold">Document expiry date (if applicable)<input type="date" className="field mt-1" value={expiryDate} onChange={e => setExpiryDate(e.target.value)}/></label><label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#d9cfc2] p-3 text-xs font-bold text-[#a83d16]"><UploadCloud size={15}/> Upload PDF/JPG/PNG/WebP<input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy || ["approved","rejected","completed","cancelled"].includes(app.status)} onChange={e => { const file = e.target.files?.[0]; if (file) void uploadDocument(app.id, file); e.currentTarget.value = ""; }}/></label></div></div>
          {app.status === "draft" && <Button className="mt-4 rounded-full bg-[#f26b35] hover:bg-[#d95725]" disabled={busy} onClick={() => void submitApplication(app.id)}>Submit application</Button>}
          <div className="mt-4 rounded-xl border border-[#e8e4dd] p-4"><h4 className="font-bold">Case timeline</h4>{events.filter(event => event.applicationId === app.id).length === 0 ? <p className="mt-2 text-xs text-[#77736c]">No customer-visible updates yet.</p> : <ol className="mt-3 space-y-3">{events.filter(event => event.applicationId === app.id).map(event => <li key={event.id} className="border-l-2 border-[#f26b35] pl-3"><p className="text-sm">{event.note || (event.toStatus ? `Status updated: ${event.toStatus.replaceAll("_", " ")}` : "Case updated")}</p><p className="mt-1 text-[10px] text-[#77736c]">{new Date(event.createdAt).toLocaleString()}</p></li>)}</ol>}</div>
          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-[#77736c]"><MessageCircle size={14} className="mt-0.5 shrink-0"/> Staff may request more information. Internal staff notes are not shown here.</p>
        </article>;
      })}
    </section>
  </div></CustomerLayout>;
}
function ListIcon() { return <FileCheck2 size={16} className="text-[#f26b35]"/>; }
