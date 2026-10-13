import { FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle, RefreshCw, Send } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import CustomerLayout from "@/components/customer/CustomerLayout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

type Ticket = { id: number; reference: string; subject: string; category: string; priority: string; status: string; created_at: string };
type Message = { id: number; ticket_id: number; author_id: string; body: string; is_internal: boolean; created_at: string };
type ApplicationOption = { id: number; reference: string; type: string; status: string };
type BookingOption = { id: number; reference: string; destination: string | null; bookingStatus: string };
async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("travel-support", { body });
  if (error) throw new Error(error.message || "Request failed");
  if (data?.error) throw new Error(data.error);
  return data;
}
export default function CustomerSupport() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [applications, setApplications] = useState<ApplicationOption[]>([]);
  const [bookings, setBookings] = useState<BookingOption[]>([]);
  const [linkedApplicationId, setLinkedApplicationId] = useState("");
  const [linkedBookingId, setLinkedBookingId] = useState("");
  const [messages, setMessages] = useState<Record<number, Message[]>>({});
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("normal");
  const [message, setMessage] = useState("");
  const [replies, setReplies] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError("");
    try {
      const [ticketResult, appResult, bookingResult] = await Promise.all([
        supabase.from("support_tickets").select("id,reference,subject,category,priority,status,created_at").eq("customer_auth_id", user.id).order("created_at", { ascending: false }),
        supabase.from("travel_applications").select('id,reference,type,status').eq("customer_auth_id", user.id).order("createdAt", { ascending: false }),
        supabase.from("bookings").select('id,reference,destination,"bookingStatus"').eq("customer_auth_id", user.id).order("createdAt", { ascending: false }),
      ]);
      if (ticketResult.error) throw ticketResult.error;
      if (appResult.error) throw appResult.error;
      if (bookingResult.error) throw bookingResult.error;
      const data = ticketResult.data;
      setApplications((appResult.data ?? []) as ApplicationOption[]);
      setBookings((bookingResult.data ?? []) as BookingOption[]);
      const list = (data ?? []) as Ticket[]; setTickets(list);
      const next: Record<number, Message[]> = {};
      for (const ticket of list) {
        const { data: rows, error: messageError } = await supabase.from("support_ticket_messages").select("id,ticket_id,author_id,body,is_internal,created_at").eq("ticket_id", ticket.id).eq("is_internal", false).order("created_at");
        if (messageError) throw messageError;
        next[ticket.id] = (rows ?? []) as Message[];
      }
      setMessages(next);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load support tickets"); }
    finally { setLoading(false); }
  }, [user]);
  useEffect(() => { void load(); }, [load]);
  async function createTicket(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try { const result = await invoke({ action: "create_support_ticket", subject, category, priority, message, applicationId: linkedApplicationId || null, bookingId: linkedBookingId || null }); setSubject(""); setMessage(""); setLinkedApplicationId(""); setLinkedBookingId(""); setNotice(`Ticket ${result.ticket.reference} was created.`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to create ticket"); }
    finally { setBusy(false); }
  }
  async function reply(ticket: Ticket) {
    const text = replies[ticket.id]?.trim(); if (!text) return;
    setBusy(true); setError(""); setNotice("");
    try { await invoke({ action: "reply_support_ticket", ticketId: ticket.id, message: text, internal: false }); setReplies(old => ({ ...old, [ticket.id]: "" })); setNotice("Your reply was sent."); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to send reply"); }
    finally { setBusy(false); }
  }
  if (authLoading) return <div className="grid min-h-screen place-items-center"><Loader2 className="animate-spin"/></div>;
  if (!isAuthenticated || !user) return <div className="p-8">Please sign in to contact customer support.</div>;
  return <CustomerLayout><div className="mx-auto max-w-4xl space-y-6">
    <header className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6"><div className="eyebrow">AeroFly customer care</div><h1 className="display mt-2 text-4xl font-extrabold">How can we help?</h1><p className="mt-3 text-sm leading-6 text-[#6f6c66]">Create a support ticket and continue the conversation here. Staff-only notes are never shown in your account.</p><Button variant="outline" className="mt-4 gap-2 rounded-full" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? "animate-spin" : ""}/> Refresh</Button></header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}{notice && <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{notice}</div>}
    <section className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-6"><h2 className="text-xl font-extrabold">Create a ticket</h2><form onSubmit={createTicket} className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold sm:col-span-2">Subject<input className="field mt-1" value={subject} onChange={e => setSubject(e.target.value)} minLength={3} maxLength={200} required /></label><label className="text-sm font-semibold">Category<select className="field mt-1" value={category} onChange={e => setCategory(e.target.value)}><option value="general">General</option><option value="booking">Booking</option><option value="payment">Payment</option><option value="visa">Visa assistance</option><option value="passport">Passport assistance</option><option value="documents">Documents</option><option value="cancellation">Cancellation</option><option value="complaint">Complaint</option></select></label><label className="text-sm font-semibold">Priority<select className="field mt-1" value={priority} onChange={e => setPriority(e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label><label className="text-sm font-semibold">Link travel application<select className="field mt-1" value={linkedApplicationId} onChange={e => setLinkedApplicationId(e.target.value)}><option value="">No linked application</option>{applications.map(app => <option key={app.id} value={app.id}>{app.reference} · {app.type} · {app.status.replaceAll("_", " ")}</option>)}</select></label><label className="text-sm font-semibold">Link booking<select className="field mt-1" value={linkedBookingId} onChange={e => setLinkedBookingId(e.target.value)}><option value="">No linked booking</option>{bookings.map(booking => <option key={booking.id} value={booking.id}>{booking.reference} · {booking.destination || "Tour booking"}</option>)}</select></label><label className="text-sm font-semibold sm:col-span-2">Message<textarea className="field mt-1 min-h-28" value={message} onChange={e => setMessage(e.target.value)} maxLength={10000} required /></label><Button disabled={busy} className="rounded-full bg-[#f26b35] hover:bg-[#d95725]">{busy ? <Loader2 className="animate-spin" size={16}/> : <><Send size={15}/> Submit ticket</>}</Button></form></section>
    <section className="space-y-4"><h2 className="flex items-center gap-2 text-2xl font-extrabold"><MessageCircle className="text-[#f26b35]"/> Your tickets</h2>{loading ? <div className="rounded-xl bg-white p-6">Loading tickets…</div> : tickets.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-sm text-[#6f6c66]">You have no support tickets yet.</div> : tickets.map(ticket => <article key={ticket.id} className="rounded-2xl border border-[#e8e4dd] bg-[#fffdf9] p-5"><div className="flex flex-wrap justify-between gap-3"><div><div className="eyebrow">{ticket.reference} · {ticket.category}</div><h3 className="mt-1 text-lg font-extrabold">{ticket.subject}</h3><p className="mt-1 text-xs text-[#77736c]">Created {new Date(ticket.created_at).toLocaleString()} · Priority {ticket.priority}</p></div><span className="rounded-full bg-[#fff0e8] px-3 py-1 text-xs font-bold capitalize">{ticket.status.replaceAll("_", " ")}</span></div><div className="mt-4 space-y-2">{(messages[ticket.id] ?? []).map(item => <div key={item.id} className={`rounded-xl p-3 text-sm ${item.author_id === user.id ? "bg-[#fff0e8]" : "bg-[#f8f4ee]"}`}><div className="mb-1 text-[10px] font-bold uppercase tracking-wider">{item.author_id === user.id ? "You" : "AeroFly support"}</div>{item.body}</div>)}</div>{!["resolved", "closed"].includes(ticket.status) && <div className="mt-4 flex flex-col gap-2 sm:flex-row"><textarea className="field min-h-16 flex-1" placeholder="Write a reply" value={replies[ticket.id] ?? ""} onChange={e => setReplies(old => ({ ...old, [ticket.id]: e.target.value }))}/><Button disabled={busy} onClick={() => void reply(ticket)} className="bg-[#f26b35] hover:bg-[#d95725]">Send reply</Button></div>}</article>)}</section>
  </div></CustomerLayout>;
}
