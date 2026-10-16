import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { recordCustomerActivity } from "@/lib/customer";

type Props = { open: boolean; onClose: () => void; tour?: { id?: number; title?: string; destination?: string } };
export default function EnquiryModal({ open, onClose, tour }: Props) {
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const { user } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", phone: "", travelDates: "", travellers: "2", budget: "", message: "" });
  useEffect(() => { if (open && user?.id) void recordCustomerActivity(user.id, "enquiry_started", tour?.id ? "tour" : null, tour?.id ?? null).catch(() => undefined); }, [open, user?.id, tour?.id]);
  if (!open) return null;
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  
const submit = async (event: React.FormEvent<HTMLFormElement>) => {
  event.preventDefault();

  if (!confirmed) {
    toast.error("Please confirm your enquiry before submitting.");
    return;
  }

  setSubmitting(true);

  try {
    const { data, error } = await supabase.functions.invoke(
      "ai-travel-request",
      {
        body: {
          type: "enquiry",
          confirmed: true,
          name: form.name,
          email: form.email,
          phone: form.phone,
          destination: tour?.destination || "",
          travelDates: form.travelDates,
          budget: form.budget,
          tripType: "",
          message: form.message,
          tourId: tour?.id ?? null,
        },
      },
    );

    if (error) {
      throw new Error(
        "Your enquiry could not be submitted. Please try again.",
      );
    }

    if (!data?.success) {
      throw new Error(
        data?.error ?? "Your enquiry could not be submitted.",
      );
    }

    setSent(true);

    // if (user?.id) {
    //   void recordCustomerActivity(
    //     user.id,
    //     "enquiry_submitted",
    //     "enquiry",
    //   ).catch(() => undefined);
    // }

    toast.success(
      `Enquiry submitted successfully. Reference: ${data.reference}`,
    );
  } catch (error) {
    toast.error(
      error instanceof Error
        ? error.message
        : "Your enquiry could not be submitted.",
    );
    setSubmitting(false);
  }
};


  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#181817]/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Travel enquiry"><div className="relative max-h-[92vh] w-full max-w-[560px] overflow-y-auto rounded-2xl bg-[#fbfaf8] p-6 shadow-2xl sm:p-8"><button className="absolute right-5 top-5 grid h-9 w-9 place-items-center rounded-full border border-[#e8e4dd]" onClick={onClose} aria-label="Close"><X size={17} /></button>{sent ? <div className="py-12 text-center"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#e2f4e9] text-[#287444]"><Check size={27} /></div><h2 className="mt-6 font-['Manrope'] text-2xl font-extrabold tracking-[-.04em]">Thank you. We have your note.</h2><p className="mx-auto mt-3 max-w-[340px] text-[14px] leading-6 text-[#6f6c66]">An AeroFly travel expert will contact you shortly to shape the right next step.</p><button className="btn btn-dark mt-7" onClick={onClose}>Close</button></div> : <><div className="eyebrow">Start a conversation</div><h2 className="mt-2 pr-8 font-['Manrope'] text-3xl font-extrabold tracking-[-.055em]">Plan this journey with us.</h2><p className="mt-3 text-[13px] leading-6 text-[#6f6c66]">{tour?.title ? `Tell us a little about your plans for ${tour.title}.` : "Share a few details and we’ll come back with a considered starting point."}</p><form onSubmit={submit} className="mt-7 grid gap-4 sm:grid-cols-2"><Field label="Your name" value={form.name} onChange={(v) => update("name", v)} required /><Field label="Email address" type="email" value={form.email} onChange={(v) => update("email", v)} required /><Field label="Mobile number" value={form.phone} onChange={(v) => update("phone", v)} required /><Field label="Preferred dates" value={form.travelDates} onChange={(v) => update("travelDates", v)} placeholder="e.g. Dec 12–18" /><Field label="Travellers" value={form.travellers} onChange={(v) => update("travellers", v)} type="number" /><Field label="Budget per person" value={form.budget} onChange={(v) => update("budget", v)} placeholder="e.g. ₹50,000" /><label className="sm:col-span-2"><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-[#77736c]">Anything we should know?</span><textarea className="field" value={form.message} onChange={(e) => update("message", e.target.value)} placeholder="Interests, hotel preferences, special occasions…" />
<label className="sm:col-span-2">
  <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-[#77736c]">
    Anything we should know?
  </span>
  <textarea
    className="field"
    value={form.message}
    onChange={(e) => update("message", e.target.value)}
    placeholder="Interests, hotel preferences, special occasions…"
  />
</label>

{/* Customer confirmation checkbox */}
<label className="sm:col-span-2 flex items-start gap-3 text-xs leading-5 text-[#6f6c66]">
  <input
    type="checkbox"
    checked={confirmed}
    onChange={(event) => setConfirmed(event.target.checked)}
    required
    className="mt-1"
  />
  <span>
    I confirm that the contact details and travel preferences I've
    provided are correct, and I want AeroFly Tours to receive this
    enquiry and contact me about my travel request.
  </span>
</label>

{/* Submit enquiry */}
<button
  type="submit"
  disabled={submitting || !confirmed}
  className="btn btn-primary sm:col-span-2"
>
  {submitting ? (
    <Loader2 size={16} className="animate-spin" />
  ) : (
    "Send enquiry"
  )}
</button>
</label>
</form></>
}
</div>
</div>;
}
function Field({ label, value, onChange, type = "text", placeholder, required }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; required?: boolean }) { return <label><span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[.13em] text-[#77736c]">{label}</span><input className="field" type={type} value={value} placeholder={placeholder} required={required} onChange={(e) => onChange(e.target.value)} /></label>; }
