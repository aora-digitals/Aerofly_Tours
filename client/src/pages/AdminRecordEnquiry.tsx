import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Source = "phone" | "office" | "website" | "callback" | "appointment" | "other";

export default function AdminRecordEnquiry() {
  const [, navigate] = useLocation();
  const [created, setCreated] = useState<{ id: number; reference: string; customer_linked: boolean } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", destination: "", travelDates: "", travellers: "2", budget: "", tripType: "", message: "", source: "office" as Source });
  const mutation = trpc.crm.recordEnquiry.useMutation({
    onSuccess: (result) => { setCreated(result); toast.success(`Enquiry ${result.reference} recorded.`); },
    onError: (error) => toast.error(error.message || "Unable to record enquiry."),
  });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const field = (label: string, key: keyof typeof form, type = "text", required = false) => <label className="block"><span className="mb-1.5 block text-xs font-bold text-neutral-600">{label}</span><input className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-orange-600 focus:ring-2 focus:ring-orange-100" type={type} required={required} value={form[key]} onChange={(e) => set(key, e.target.value)} /></label>;
  const submit = (event: React.FormEvent) => { event.preventDefault(); mutation.mutate({ ...form, travellers: Number(form.travellers), destination: form.destination || undefined, travelDates: form.travelDates || undefined, budget: form.budget || undefined, tripType: form.tripType || undefined, message: form.message || undefined }); };

  return <div className="min-h-screen bg-[#fbfaf8] px-4 py-8 text-[#242321] sm:px-6 lg:px-8"><div className="mx-auto max-w-3xl">
    <Link href="/admin/crm" className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-orange-700"><ArrowLeft size={16} /> Back to CRM</Link>
    <div className="mt-5"><p className="text-xs font-bold uppercase tracking-[.18em] text-orange-700">CRM / New lead</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight">Record a customer enquiry</h1><p className="mt-2 text-sm leading-6 text-neutral-600">Use this form for calls, office visits, walk-ins, and enquiries received by the team. The enquiry is assigned to you and enters the same CRM pipeline as website enquiries.</p></div>
    {created ? <div className="mt-7 rounded-2xl border border-emerald-200 bg-white p-6"><CheckCircle2 className="text-emerald-700" size={30}/><h2 className="mt-3 text-xl font-bold">Enquiry recorded: {created.reference}</h2><p className="mt-2 text-sm leading-6 text-neutral-600">{created.customer_linked ? "This enquiry is linked to the customer's existing account. Once you issue an offer, it will appear in their profile." : "No matching customer account was found yet. The enquiry is saved; ask the customer to register using this email before issuing an online offer."}</p><div className="mt-5 flex flex-wrap gap-3"><button onClick={() => navigate(`/admin/booking-offers/new?enquiryId=${created.id}`)} className="rounded-full bg-orange-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-orange-800">Prepare booking offer</button><button onClick={() => navigate("/admin/crm")} className="rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-semibold">Return to CRM</button></div></div> : <form onSubmit={submit} className="mt-7 space-y-6 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-7">
      <section><h2 className="mb-4 text-base font-bold">Customer contact</h2><div className="grid gap-4 sm:grid-cols-2">{field("Customer name", "name", "text", true)}{field("Email", "email", "email", true)}{field("Phone", "phone", "tel", true)}<label className="block"><span className="mb-1.5 block text-xs font-bold text-neutral-600">Enquiry source</span><select value={form.source} onChange={(e) => set("source", e.target.value)} className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm">{([["office","Office visit / walk-in"],["phone","Phone call"],["website","Website"],["callback","Callback"],["appointment","Appointment"],["other","Other"]] as const).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label></div></section>
      <section><h2 className="mb-4 text-base font-bold">Trip requirements</h2><div className="grid gap-4 sm:grid-cols-2">{field("Destination / region", "destination")}{field("Preferred dates", "travelDates")}{field("Number of travellers", "travellers", "number", true)}{field("Approximate budget", "budget")}{field("Trip type", "tripType")}</div><label className="mt-4 block"><span className="mb-1.5 block text-xs font-bold text-neutral-600">Requirements and discussion notes</span><textarea rows={4} maxLength={2000} value={form.message} onChange={(e) => set("message", e.target.value)} className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-orange-600" placeholder="Preferred hotels, mobility needs, interests, or follow-up items…" /></label></section>
      <div className="flex flex-col-reverse gap-3 border-t border-neutral-100 pt-5 sm:flex-row sm:justify-end"><Link href="/admin/crm" className="rounded-full border border-neutral-300 px-5 py-2.5 text-center text-sm font-semibold">Cancel</Link><button type="submit" disabled={mutation.isPending} className="rounded-full bg-orange-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-orange-800 disabled:opacity-50">{mutation.isPending ? "Saving enquiry…" : "Record enquiry"}</button></div>
    </form>}
  </div></div>;
}
