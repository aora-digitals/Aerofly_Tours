import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity, ArrowRight, BriefcaseBusiness, CalendarDays,
  CircleDollarSign, ClipboardList, Headset, LayoutDashboard, Loader2,
  Megaphone, ShieldAlert, UsersRound,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { visibleWorkspaceNavigation, type WorkspaceKey } from "@/lib/workspaceAccess";
import AdminSupportWorkspace from "@/components/admin/AdminSupportWorkspace";

type Report = Record<string, unknown>;
type Departure = { id: number; departure_date: string; status: string; label: string | null; tourId: number };
type TourSummary = { id: number; title: string; status: string; featured: boolean };
type DepartmentSummary = { user_id: string; department_id: string | null; status: string; job_title: string | null };
type EnquirySummary = { id: number; reference: string; name: string; email: string | null; destination: string | null; status: string; createdAt: string };
type QuotationSummary = { id: number; reference: string; destination: string | null; status: string; proposal_status: string | null; total: number; currency: string; createdAt: string; bookingId: number | null };
type FinanceTransaction = { id: number; amount: number; type: string; description: string | null; occurredAt: string; paymentId: number | null };
type WorkspaceData = {
  report: Report | null;
  departures: Departure[];
  tours: TourSummary[];
  tourCount: number;
  members: DepartmentSummary[];
  memberCount: number;
  enquiries: EnquirySummary[];
  quotations: QuotationSummary[];
  transactions: FinanceTransaction[];
  assignedWorkCount: number;
  error: string | null;
};

const EMPTY_DATA: WorkspaceData = { report: null, departures: [], tours: [], tourCount: 0, members: [], memberCount: 0, enquiries: [], quotations: [], transactions: [], assignedWorkCount: 0, error: null };
const PAGE_CONFIG: Record<WorkspaceKey, { title: string; eyebrow: string; description: string; icon: typeof LayoutDashboard }> = {
  erp: { title: "ERP overview", eyebrow: "Company operations", description: "Organization-scoped operating signals available to your assigned permissions.", icon: LayoutDashboard },
  sales: { title: "Sales & CRM", eyebrow: "Customer pipeline", description: "Work on enquiries, customer conversations and staff-issued booking proposals.", icon: BriefcaseBusiness },
  finance: { title: "Finance control room", eyebrow: "Financial operations", description: "Review payments, receipts and financial actions permitted for your role.", icon: CircleDollarSign },
  marketing: { title: "Marketing workspace", eyebrow: "Catalogue & campaigns", description: "Review the live tour catalogue and destination activity using database-backed records.", icon: Megaphone },
  operations: { title: "Tour operations", eyebrow: "Departures & delivery", description: "Monitor upcoming departures and operational readiness within your organization.", icon: CalendarDays },
  support: { title: "Customer support", eyebrow: "Customer care", description: "Handle customer follow-ups, callbacks and service requests assigned to your team.", icon: Headset },
  department: { title: "Department workspace", eyebrow: "Team operations", description: "Review active membership and scoped department performance.", icon: UsersRound },
  work: { title: "My work", eyebrow: "Assigned work", description: "Open the operational module available to your assigned permissions.", icon: ClipboardList },
};

function formatNumber(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-IN") : "—";
}
function formatMoney(value: unknown): string {
  if (value === null || value === undefined) return "Restricted";
  const number = Number(value);
  return Number.isFinite(number) ? `₹${number.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";
}

export default function RoleWorkspaceDashboard({ workspace }: { workspace: WorkspaceKey }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<WorkspaceData>(EMPTY_DATA);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const config = PAGE_CONFIG[workspace];
  const Icon = config.icon;
  const nav = useMemo(() => visibleWorkspaceNavigation(user?.permissions), [user?.permissions]);
  useEffect(() => {
    const available = user?.organizationIds ?? [];
    if (available.length && (!selectedOrganizationId || !available.includes(selectedOrganizationId))) {
      setSelectedOrganizationId(available[0]);
    }
    if (!available.length) setSelectedOrganizationId(null);
  }, [user?.organizationIds, selectedOrganizationId]);
  const organizationId = selectedOrganizationId ?? user?.organizationIds?.[0] ?? null;
  const canReadReports = user?.permissions.includes("reports.read") ?? false;
  const canReadTours = user?.permissions.includes("tours.read") ?? false;
  const canReadDepartures = user?.permissions.includes("departures.read") ?? false;
  const canReadEmployees = user?.permissions.includes("employees.read") ?? false;
  const canReadEnquiries = user?.permissions.includes("enquiries.read") ?? false;
  const canReadBookings = user?.permissions.includes("bookings.read") ?? false;
  const canReadFinance = user?.permissions.includes("finance.read") ?? false;

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      const next: WorkspaceData = { ...EMPTY_DATA };
      try {
        if (canReadReports) {
          const to = new Date();
          const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
          const { data: report, error } = await supabase.rpc("admin_erp_reports_scoped", {
            p_from: from.toISOString(), p_to: to.toISOString(), p_organization_id: organizationId,
          });
          if (error) next.error = error.message;
          else next.report = (report ?? null) as Report | null;
        }
        if (workspace === "work" && canReadEnquiries && user?.id) {
          const { count, error } = await supabase.from("enquiries").select("id", { count: "exact", head: true })
            .eq("assigned_employee_id", user.id);
          if (error) next.error = next.error ?? error.message;
          else next.assignedWorkCount = count ?? 0;
        }
        if (workspace === "sales" && canReadEnquiries) {
          const { data: enquiries, error: enquiriesError } = await supabase.from("enquiries")
            .select('id,reference,name,email,destination,status,"createdAt"')
            .order("createdAt", { ascending: false }).limit(8);
          if (enquiriesError) next.error = next.error ?? enquiriesError.message;
          else next.enquiries = (enquiries ?? []) as EnquirySummary[];
        }
        if (workspace === "sales" && canReadBookings) {
          const { data: quotations, error: quotationsError } = await supabase.from("quotations")
            .select('id,reference,destination,status,proposal_status,total,currency,"createdAt","bookingId"')
            .order("createdAt", { ascending: false }).limit(8);
          if (quotationsError) next.error = next.error ?? quotationsError.message;
          else next.quotations = (quotations ?? []) as QuotationSummary[];
        }
        if (workspace === "finance" && canReadFinance) {
          const { data: transactions, error: transactionsError } = await supabase.from("finance_transactions")
            .select('id,amount,type,description,"occurredAt","paymentId"')
            .order("occurredAt", { ascending: false }).limit(12);
          if (transactionsError) next.error = next.error ?? transactionsError.message;
          else next.transactions = (transactions ?? []) as FinanceTransaction[];
        }
        if (workspace === "marketing" && canReadTours) {
          const { data: tours, count, error } = await supabase.from("tours")
            .select("id,title,status,featured", { count: "exact" })
            .order("updatedAt", { ascending: false }).limit(8);
          if (error) next.error = next.error ?? error.message;
          else {
            next.tours = (tours ?? []) as TourSummary[];
            next.tourCount = count ?? next.tours.length;
          }
        }
        if (workspace === "operations" && canReadDepartures) {
          let query = supabase.from("tour_departures")
            .select('id,departure_date,status,label,"tourId",organization_id', { count: "exact" })
            .gte("departure_date", new Date().toISOString().slice(0, 10))
            .order("departure_date", { ascending: true }).limit(10);
          if (organizationId) query = query.eq("organization_id", organizationId);
          const { data: departures, error } = await query;
          if (error) next.error = next.error ?? error.message;
          else next.departures = (departures ?? []) as Departure[];
        }
        if (workspace === "department" && canReadEmployees && organizationId) {
          const { data: members, count, error } = await supabase.from("organization_memberships")
            .select("user_id,department_id,status,job_title", { count: "exact" })
            .eq("organization_id", organizationId).eq("status", "active").limit(100);
          if (error) next.error = next.error ?? error.message;
          else {
            next.members = (members ?? []) as DepartmentSummary[];
            next.memberCount = count ?? next.members.length;
          }
        }
      } catch (error) {
        next.error = error instanceof Error ? error.message : "Unable to load this workspace.";
      } finally {
        if (active) {
          setData(next);
          setLoading(false);
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [workspace, organizationId, canReadReports, canReadTours, canReadDepartures, canReadEmployees, canReadEnquiries, canReadBookings, canReadFinance, user?.id, refreshIndex]);

  const report = data.report ?? {};
  const metrics = workspace === "work" ? [
    ["Assigned enquiries", formatNumber(data.assignedWorkCount), "Assigned to your account"],
    ["Active organizations", formatNumber(user?.organizationIds.length ?? 0), "Current memberships"],
    ["Available modules", formatNumber(nav.length), "Permission-controlled navigation"],
  ] : workspace === "finance" ? [
    ["Verified income", formatMoney(report.verified_income), "finance.read controls this value"],
    ["Refunds recorded", formatMoney(report.refunds_recorded), "Verified ledger records"],
    ["Bookings created", formatNumber(report.bookings_created), "Last 30 days"],
  ] : workspace === "marketing" ? [
    ["Tours in catalogue", formatNumber(data.tourCount), "Live database count"],
    ["Enquiries", formatNumber(report.enquiry_count), "Last 30 days"],
    ["Accepted proposals", formatNumber(report.accepted_proposals), "Last 30 days"],
  ] : workspace === "operations" ? [
    ["Upcoming departures", formatNumber(report.departures_upcoming), "Organization-scoped report"],
    ["Bookings created", formatNumber(report.bookings_created), "Last 30 days"],
    ["Confirmed bookings", formatNumber(report.confirmed_bookings), "Last 30 days"],
  ] : workspace === "department" ? [
    ["Active memberships", formatNumber(data.memberCount), "Current organization"],
    ["Enquiries", formatNumber(report.enquiry_count), "Last 30 days"],
    ["Confirmed bookings", formatNumber(report.confirmed_bookings), "Last 30 days"],
  ] : [
    ["Enquiries", formatNumber(report.enquiry_count), "Last 30 days"],
    ["New enquiries", formatNumber(report.new_enquiries), "Awaiting first action"],
    ["Accepted proposals", formatNumber(report.accepted_proposals), "Last 30 days"],
  ];

  return (
    <div className="min-h-screen bg-[#f4f4f1] text-[#222321]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col bg-[#191a18] text-white lg:flex">
        <div className="flex h-[78px] items-center gap-3 border-b border-white/10 px-6">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f26b35] font-black italic">A</span>
          <div><div className="font-['Manrope'] text-[15px] font-extrabold">AeroFly Workspace</div><div className="text-[9px] font-bold uppercase tracking-[.15em] text-white/35">Role-based workspace</div></div>
        </div>
        <div className="px-4 py-6"><div className="px-3 text-[10px] font-bold uppercase tracking-[.15em] text-white/35">Your modules</div>
          <nav className="mt-3 space-y-1">{nav.map((item) => <Link key={item.key} href={item.href} className={`flex items-center gap-3 rounded-lg px-3 py-3 text-[12px] font-semibold transition ${location === item.href ? "bg-white/10 text-white" : "text-white/55 hover:bg-white/5 hover:text-white"}`}><ArrowRight size={15} />{item.label}</Link>)}</nav>
        </div>
        <div className="mt-auto border-t border-white/10 p-4"><div className="rounded-lg bg-white/5 p-3"><div className="text-[10px] uppercase tracking-[.14em] text-white/35">Signed in as</div><div className="mt-2 truncate text-[12px] font-semibold">{user?.name ?? "AeroFly team member"}</div><div className="mt-1 truncate text-[10px] text-white/40">{user?.email}</div><div className="mt-3 flex gap-2">{nav.some((item) => item.key === "erp") && <button onClick={() => setLocation("/admin/erp")} className="rounded-md bg-white/10 px-3 py-2 text-[10px] font-bold">ERP overview</button>}<button onClick={() => void logout()} className="rounded-md bg-white/10 px-3 py-2 text-[10px] font-bold">Sign out</button></div></div></div>
      </aside>
      <main className="min-h-screen px-4 py-5 sm:px-7 lg:ml-[264px] lg:px-9 lg:py-8">
        <header className="flex flex-col justify-between gap-4 rounded-2xl bg-[#20201e] p-6 text-white sm:flex-row sm:items-center sm:p-8">
          <div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-[#ffac88]"><Icon size={14}/>{config.eyebrow}</div><h1 className="mt-3 font-['Manrope'] text-2xl font-extrabold sm:text-3xl">{config.title}</h1><p className="mt-2 max-w-2xl text-[13px] leading-6 text-white/55">{config.description}</p><div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-white/45">{organizationId ? <><span>Organization scope</span>{(user?.organizationIds?.length ?? 0) > 1 ? <select aria-label="Active organization" value={organizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)} className="rounded-md border border-white/15 bg-white/10 px-2 py-1 text-[10px] text-white">{user?.organizationIds.map((id) => <option key={id} value={id} className="text-black">{id}</option>)}</select> : <span>{organizationId}</span>}</> : "No active organization membership"}</div></div>
          <button onClick={() => setRefreshIndex((n) => n + 1)} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#f26b35] px-4 py-3 text-[11px] font-bold text-white disabled:opacity-60">{loading ? <Loader2 size={14} className="animate-spin"/> : <Activity size={14}/>} Refresh data</button>
        </header>
        {data.error && <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-[12px] text-red-800"><ShieldAlert size={18} className="shrink-0"/><div><div className="font-bold">Some workspace data could not be loaded.</div><div className="mt-1">{data.error}</div></div></div>}
        <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {metrics.map(([label, value, detail]) => <div key={label} className="rounded-xl border border-[#deded9] bg-white p-5"><div className="text-[10px] font-bold uppercase tracking-[.14em] text-[#92928b]">{label}</div><div className="mt-4 font-['Manrope'] text-2xl font-extrabold tracking-[-.04em]">{loading ? "…" : value}</div><div className="mt-2 text-[10px] text-[#92928b]">{detail}</div></div>)}
        </section>
        {loading && <div className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-[#deded9] bg-white p-10 text-[12px] text-[#77736c]"><Loader2 size={16} className="animate-spin"/>Loading organization data…</div>}
        {!loading && workspace === "sales" && <section className="mt-6 grid gap-6 xl:grid-cols-2">
          <section className="overflow-hidden rounded-xl border border-[#deded9] bg-white"><div className="border-b border-[#ecece8] px-5 py-4"><h2 className="font-['Manrope'] text-base font-extrabold">Recent enquiries</h2><p className="mt-1 text-[11px] text-[#92928b]">Records returned by Supabase RLS for your assigned scope.</p></div>{data.enquiries.length ? <div className="divide-y divide-[#ecece8]">{data.enquiries.map((enquiry) => <div key={enquiry.id} className="px-5 py-4"><div className="flex items-center justify-between gap-3"><div className="text-[12px] font-bold">{enquiry.name}</div><span className="rounded-full bg-[#f4f4f1] px-2 py-1 text-[9px] font-bold capitalize">{String(enquiry.status)}</span></div><div className="mt-1 text-[10px] text-[#92928b]">{enquiry.reference} · {enquiry.destination || "Custom trip"} · {new Date(enquiry.createdAt).toLocaleDateString()}</div></div>)}</div> : <div className="p-8 text-center text-[12px] text-[#92928b]">No enquiries are visible in your scope.</div>}</section>
          <section className="overflow-hidden rounded-xl border border-[#deded9] bg-white"><div className="flex items-center justify-between border-b border-[#ecece8] px-5 py-4"><div><h2 className="font-['Manrope'] text-base font-extrabold">Booking proposals</h2><p className="mt-1 text-[11px] text-[#92928b]">Staff-issued proposals; customer acceptance remains the source of truth.</p></div><Link href="/admin/booking-offers/new" className="rounded-lg bg-[#f26b35] px-3 py-2 text-[10px] font-bold text-white">Issue proposal</Link></div>{data.quotations.length ? <div className="divide-y divide-[#ecece8]">{data.quotations.map((quote) => <div key={quote.id} className="flex items-center justify-between gap-3 px-5 py-4"><div><div className="text-[12px] font-bold">{quote.reference} · {quote.destination || "Travel proposal"}</div><div className="mt-1 text-[10px] capitalize text-[#92928b]">{quote.proposal_status || quote.status} · {new Date(quote.createdAt).toLocaleDateString()}</div></div><div className="text-right"><div className="text-[12px] font-extrabold">{quote.currency} {Number(quote.total).toLocaleString("en-IN")}</div>{quote.bookingId && <div className="mt-1 text-[9px] text-[#477d50]">Booking #{quote.bookingId}</div>}</div></div>)}</div> : <div className="p-8 text-center text-[12px] text-[#92928b]">No proposals are visible in your scope.</div>}</section>
        </section>}
        {!loading && workspace === "finance" && <section className="mt-6 overflow-hidden rounded-xl border border-[#deded9] bg-white"><div className="border-b border-[#ecece8] px-5 py-4"><h2 className="font-['Manrope'] text-base font-extrabold">Financial transaction ledger</h2><p className="mt-1 text-[11px] text-[#92928b]">Rows are filtered by Supabase RLS; the verified-income total comes from the server-side scoped report RPC.</p></div>{data.transactions.length ? <div className="divide-y divide-[#ecece8]">{data.transactions.map((transaction) => <div key={transaction.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><div className="text-[12px] font-bold">{transaction.description || `Transaction #${transaction.id}`}</div><div className="mt-1 text-[10px] capitalize text-[#92928b]">{transaction.type.replaceAll("_", " ")} · {new Date(transaction.occurredAt).toLocaleString()} · Payment {transaction.paymentId ?? "not linked"}</div></div><div className={`text-[13px] font-extrabold ${transaction.type === "refund" ? "text-[#b14a34]" : "text-[#3f7b4b]"}`}>{transaction.type === "refund" ? "−" : ""}₹{Number(transaction.amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div></div>)}</div> : <div className="p-8 text-center text-[12px] text-[#92928b]">No financial transactions are visible in your scope.</div>}</section>}
        {!loading && workspace === "support" && <AdminSupportWorkspace />}
        {!loading && workspace === "marketing" && <section className="mt-6 rounded-xl border border-[#deded9] bg-white"><div className="border-b border-[#ecece8] px-5 py-4"><h2 className="font-['Manrope'] text-base font-extrabold">Recently updated tours</h2><p className="mt-1 text-[11px] text-[#92928b]">Read from the live tour catalogue; edits still require tours.manage.</p></div>{data.tours.length ? <div className="divide-y divide-[#ecece8]">{data.tours.map((tour) => <div key={tour.id} className="flex items-center justify-between gap-4 px-5 py-4"><div><div className="text-[12px] font-bold">{tour.title}</div><div className="mt-1 text-[10px] capitalize text-[#92928b]">{tour.status}{tour.featured ? " · Featured" : ""}</div></div><span className="rounded-full bg-[#f4f4f1] px-2 py-1 text-[9px] font-bold">#{tour.id}</span></div>)}</div> : <div className="p-8 text-center text-[12px] text-[#92928b]">No tour records are visible to this account.</div>}</section>}
        {!loading && workspace === "operations" && <section className="mt-6 rounded-xl border border-[#deded9] bg-white"><div className="border-b border-[#ecece8] px-5 py-4"><h2 className="font-['Manrope'] text-base font-extrabold">Upcoming departures</h2><p className="mt-1 text-[11px] text-[#92928b]">Only departures visible through the current RLS policies are shown.</p></div>{data.departures.length ? <div className="divide-y divide-[#ecece8]">{data.departures.map((departure) => <div key={departure.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><div className="text-[12px] font-bold">{departure.label || `Departure #${departure.id}`}</div><div className="mt-1 text-[10px] text-[#92928b]">Tour #{departure.tourId} · {departure.departure_date}</div></div><span className="rounded-full bg-[#f4f4f1] px-2.5 py-1 text-[10px] font-bold capitalize">{departure.status.replaceAll("_", " ")}</span></div>)}</div> : <div className="p-8 text-center text-[12px] text-[#92928b]">No upcoming departures are available in this organization.</div>}</section>}
        {!loading && workspace === "department" && <section className="mt-6 rounded-xl border border-[#deded9] bg-white"><div className="border-b border-[#ecece8] px-5 py-4"><h2 className="font-['Manrope'] text-base font-extrabold">Active organization memberships</h2><p className="mt-1 text-[11px] text-[#92928b]">Employee identities are not exposed in this summary; use the authorized administration screen for directory details.</p></div>{data.members.length ? <div className="divide-y divide-[#ecece8]">{data.members.map((member) => <div key={`${member.user_id}:${member.department_id}`} className="flex items-center justify-between gap-3 px-5 py-4"><div><div className="text-[12px] font-bold">{member.job_title || "Team member"}</div><div className="mt-1 text-[10px] text-[#92928b]">Department {member.department_id ?? "not assigned"}</div></div><span className="text-[10px] font-bold capitalize text-[#477d50]">{member.status}</span></div>)}</div> : <div className="p-8 text-center text-[12px] text-[#92928b]">No memberships are visible for this organization.</div>}</section>}
        {!loading && workspace === "work" && <section className="mt-6 grid gap-4 sm:grid-cols-2">{user?.permissions.includes("enquiries.read") && <QuickLink title="Open CRM" description="Review customer enquiries and assigned follow-ups." href="/admin/crm" icon={ClipboardList}/>}{user?.permissions.includes("bookings.manage") && <QuickLink title="Issue booking proposal" description="Prepare a staff-issued proposal for an eligible enquiry." href="/admin/booking-offers/new" icon={BriefcaseBusiness}/>}</section>}
        <footer className="mt-8 flex items-center gap-2 text-[10px] text-[#92928b]"><Activity size={13}/>Values come from Supabase; restricted metrics are never replaced with fabricated values.</footer>
      </main>
    </div>
  );
}
function QuickLink({ title, description, href, icon: Icon }: { title: string; description: string; href: string; icon: typeof Activity }) {
  return <Link href={href} className="flex items-start gap-3 rounded-xl border border-[#deded9] bg-white p-5 transition hover:border-[#f2b59a]"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#fff0e8] text-[#c94d1c]"><Icon size={17}/></span><span><span className="block text-[13px] font-bold">{title}</span><span className="mt-1 block text-[11px] leading-5 text-[#77736c]">{description}</span></span></Link>;
}
