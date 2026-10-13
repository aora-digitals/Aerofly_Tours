import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Activity, Building2, CalendarDays, CheckCircle2, CircleDollarSign, ClipboardList, RefreshCw, ShieldCheck, Users,BriefcaseBusiness, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { supabase } from "@/lib/supabase";

type DepartmentSummary = { id: string; name: string; is_active: boolean; employee_count: number };
type Overview = {
  range: { from: string; to: string };
  customers: number;
  active_employees: number;
  enquiries: number;
  new_enquiries: number;
  bookings: number;
  confirmed_bookings: number;
  accepted_proposals: number;
  departures_upcoming: number;
  verified_revenue: number | null;
  outstanding_balance: number | null;
  recent_activity: Array<{ id: number; action: string; entity_type: string; entity_id: string; actor_id: string | null; created_at: string; metadata: Record<string, unknown> }>;
  departments: DepartmentSummary[];
};
type Organization = { id: string; name: string; slug: string };
type Department = { id: string; organization_id: string; name: string; slug: string; is_active: boolean; manager_user_id: string | null };
type Membership = { user_id: string; organization_id: string; department_id: string | null; status: string; job_title: string | null; employee_code: string | null; employment_type: string; reports_to_user_id: string | null; joined_at: string | null };
type Profile = { id: string; full_name: string | null; phone: string | null };
type Role = { id: string; key: string; name: string; description: string | null };
type Permission = { id: string; key: string; description: string | null };

type Tab = "overview" | "organization" | "employees" | "access";

const today = new Date();
const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const defaultFrom = new Date(today.getTime() - 29 * 86400000);
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);

export default function AdminERP() {
  const [tab, setTab] = useState<Tab>("overview");
  const [from, setFrom] = useState(isoDate(defaultFrom));
  const [to, setTo] = useState(isoDate(today));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [roleAssignments, setRoleAssignments] = useState<Array<{ id: string; user_id: string; role_id: string; organization_id: string | null }>>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<Record<string, boolean>>({});
  const [departmentName, setDepartmentName] = useState("");
  const [departmentSlug, setDepartmentSlug] = useState("");
  const [roleUserId, setRoleUserId] = useState("");
  const [roleKey, setRoleKey] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const orgResult = await supabase.from("organizations").select("id,name,slug").order("name");
      if (orgResult.error) throw new Error(orgResult.error.message);
      const orgs = (orgResult.data ?? []) as Organization[];
      setOrganizations(orgs);
      const scopedOrgId = selectedOrg || orgs[0]?.id || "";
      if (!selectedOrg && scopedOrgId) setSelectedOrg(scopedOrgId);
      const permissionKeys = ["admin.dashboard.read", "organization.read", "organization.manage", "employees.read", "employees.manage", "roles.read", "roles.manage", "audit.read", "finance.read"];
      const permissionChecks = await Promise.all(permissionKeys.map(async (key) => {
        const { data, error: permissionError } = await supabase.rpc("has_permission", { requested_permission: key, requested_organization: scopedOrgId || null });
        if (permissionError) throw new Error(permissionError.message);
        return [key, data === true] as const;
      }));
      setAccess(Object.fromEntries(permissionChecks));
      const fromAt = new Date(`${from}T00:00:00.000Z`).toISOString();
      const toAt = new Date(`${to}T23:59:59.999Z`).toISOString();
      const [overviewResult, departmentResult, membershipResult, roleResult, permissionResult, assignmentResult] = await Promise.all([
        supabase.rpc("admin_erp_overview_scoped", { p_from: fromAt, p_to: toAt, p_organization_id: scopedOrgId || null }),
        supabase.from("departments").select("id,organization_id,name,slug,is_active,manager_user_id").order("name"),
        supabase.from("organization_memberships").select("user_id,organization_id,department_id,status,job_title,employee_code,employment_type,reports_to_user_id,joined_at").order("created_at", { ascending: false }).limit(500),
        supabase.from("roles").select("id,key,name,description").order("name"),
        supabase.from("permissions").select("id,key,description").order("key"),
        supabase.from("user_roles").select("id,user_id,role_id,organization_id").limit(1000),
      ]);
      const firstError = overviewResult.error || departmentResult.error || membershipResult.error || roleResult.error || permissionResult.error || assignmentResult.error;
      if (firstError) throw new Error(firstError.message);
      setOverview(overviewResult.data as Overview);
      setDepartments((departmentResult.data ?? []) as Department[]);
      const memberRows = (membershipResult.data ?? []) as Membership[];
      setMemberships(memberRows);
      setRoles((roleResult.data ?? []) as Role[]);
      setPermissions((permissionResult.data ?? []) as Permission[]);
      setRoleAssignments((assignmentResult.data ?? []) as typeof roleAssignments);
      const userIds = Array.from(
        new Set(memberRows.map((row) => row.user_id))
      );
      if (userIds.length) {
        const { data: profileRows, error: profileError } = await supabase.from("profiles").select("id,full_name,phone").in("id", userIds);
        if (profileError) throw new Error(profileError.message);
        setProfiles(Object.fromEntries(((profileRows ?? []) as Profile[]).map((profile) => [profile.id, profile])));
      } else setProfiles({});
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to load the ERP workspace.";
      setError(message);
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, selectedOrg]);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => {
    if (loading) return;
    const firstAllowed = tabsFallback(access);
    if (firstAllowed && !["overview", "organization", "employees", "access"].some((key) => key === tab && (key === "overview" ? access["admin.dashboard.read"] : key === "organization" ? access["organization.read"] || access["organization.manage"] : key === "employees" ? access["employees.read"] || access["employees.manage"] : access["roles.read"] || access["roles.manage"]))) setTab(firstAllowed);
  }, [access, loading, tab]);

  const callAdmin = async (payload: Record<string, unknown>) => {
    const { data, error: invokeError } = await supabase.functions.invoke("admin-organization", { body: payload });
    if (invokeError) throw invokeError;
    if (data?.error) throw new Error(String(data.error));
    return data?.data;
  };

  const createDepartment = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedOrg || !departmentName.trim() || !departmentSlug.trim()) return;
    setSaving(true);
    try {
      await callAdmin({ action: "upsert_department", organization_id: selectedOrg, name: departmentName.trim(), slug: departmentSlug.trim().toLowerCase() });
      toast.success("Department created.");
      setDepartmentName(""); setDepartmentSlug("");
      await loadAll();
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Department could not be created."); }
    finally { setSaving(false); }
  };

  const changeMembership = async (membership: Membership, status: string) => {
    setSaving(true);
    try {
      await callAdmin({ action: "set_membership", organization_id: membership.organization_id, user_id: membership.user_id, department_id: membership.department_id, status, job_title: membership.job_title });
      toast.success("Employee status updated.");
      await loadAll();
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Employee status could not be updated."); }
    finally { setSaving(false); }
  };

  const assignRole = async (event: FormEvent) => {
    event.preventDefault();
    if (!roleUserId || !roleKey) return;
    setSaving(true);
    try {
      await callAdmin({ action: "assign_role", user_id: roleUserId, role_key: roleKey, organization_id: selectedOrg || null });
      toast.success("Role assignment saved.");
      await loadAll();
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Role assignment failed."); }
    finally { setSaving(false); }
  };

  const visibleMemberships = useMemo(() => memberships.filter((membership) => {
    if (selectedOrg && membership.organization_id !== selectedOrg) return false;
    const profile = profiles[membership.user_id];
    const text = `${profile?.full_name ?? ""} ${profile?.phone ?? ""} ${membership.job_title ?? ""} ${membership.employee_code ?? ""}`.toLowerCase();
    return text.includes(search.toLowerCase());
  }), [memberships, profiles, search, selectedOrg]);

  const selectedOrgName = organizations.find((org) => org.id === selectedOrg)?.name ?? "Organization";
  const tabs: Array<{ id: Tab; label: string; icon: typeof Activity; allowed: boolean }> = [
    { id: "overview", label: "Overview", icon: Activity, allowed: Boolean(access["admin.dashboard.read"]) },
    { id: "organization", label: "Organization", icon: Building2, allowed: Boolean(access["organization.read"] || access["organization.manage"]) },
    { id: "employees", label: "Employees", icon: Users, allowed: Boolean(access["employees.read"] || access["employees.manage"]) },
    { id: "access", label: "Roles & permissions", icon: ShieldCheck, allowed: Boolean(access["roles.read"] || access["roles.manage"]) },
  ];

  return <main className="min-h-screen bg-[#f7f5f1] px-4 py-6 text-[#22231f] sm:px-7 lg:px-10">
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#f26b35]">AeroFly Tours · Phase 7</div><h1 className="mt-2 font-['Manrope'] text-3xl font-extrabold tracking-tight sm:text-4xl">Admin ERP</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[#77736c]">Live operational metrics, organization structure, employee assignments and database-backed access control.</p></div>
        <div className="flex flex-wrap gap-2">{["organization.manage", "employees.read", "employees.manage", "roles.read", "roles.manage", "reports.read", "settings.read", "settings.manage", "audit.read"].some((key) => access[key]) && <Link href="/admin/erp/administration" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#22231f] px-4 py-2.5 text-sm font-semibold text-white"><ShieldCheck size={15}/> Administration</Link>}<button type="button" onClick={() => void loadAll()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#deded9] bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60"><RefreshCw size={15} className={loading ? "animate-spin" : ""}/> Refresh data</button></div>
      </div>

      <div className="mt-7 flex flex-wrap gap-2 border-b border-[#deded9] pb-3">{tabs.filter((item) => item.allowed).map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition ${tab === id ? "bg-[#22231f] text-white" : "bg-white text-[#696960] hover:bg-[#eeece6]"}`}><Icon size={15}/>{label}</button>)}</div>

      {error && <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertCircle size={18} className="mt-0.5 shrink-0"/><div><strong>Could not load ERP data.</strong><p className="mt-1">{error}</p><p className="mt-1 text-xs">Check that the Phase 7 migration has been applied and your account has the required database permissions.</p></div></div>}
      {loading && <div className="mt-6 rounded-xl border border-[#deded9] bg-white p-8 text-sm text-[#77736c]">Loading verified Supabase records…</div>}

      {!loading && tab === "overview" && overview && <>
        <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border border-[#deded9] bg-white p-4"><label className="grid gap-1 text-xs font-semibold text-[#77736c]">From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-[#deded9] px-3 py-2 text-sm text-[#22231f]"/></label><label className="grid gap-1 text-xs font-semibold text-[#77736c]">To <input type="date" value={to} min={from} max={isoDate(today)} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-[#deded9] px-3 py-2 text-sm text-[#22231f]"/></label><span className="pb-2 text-xs text-[#92928b]">Metrics reflect the selected range except current outstanding balance and upcoming departures.</span></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Total customers" value={overview.customers.toLocaleString("en-IN")} note="Registered customer-role profiles" icon={Users}/>
          <Metric label="Active employees" value={overview.active_employees.toLocaleString("en-IN")} note="Active organization memberships" icon={BriefcaseBusiness}/>
          <Metric label="Enquiries" value={overview.enquiries.toLocaleString("en-IN")} note={`${overview.new_enquiries} new in range`} icon={ClipboardList}/>
          <Metric label="Bookings" value={overview.bookings.toLocaleString("en-IN")} note={`${overview.confirmed_bookings} confirmed in range`} icon={CheckCircle2}/>
          <Metric label="Accepted proposals" value={overview.accepted_proposals.toLocaleString("en-IN")} note="Phase 5 accepted proposals" icon={CalendarDays}/>
          <Metric label="Upcoming departures" value={overview.departures_upcoming.toLocaleString("en-IN")} note="Available or limited capacity" icon={CalendarDays}/>
          <Metric label="Verified revenue" value={overview.verified_revenue == null ? "Restricted" : money(overview.verified_revenue)} note="Successful payments with income ledger entries" icon={CircleDollarSign}/>
          <Metric label="Outstanding balance" value={overview.outstanding_balance == null ? "Restricted" : money(overview.outstanding_balance)} note="Pending/confirmed/in-progress bookings" icon={CircleDollarSign}/>
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
          <section className="rounded-xl border border-[#deded9] bg-white"><SectionHeading title="Department summary" subtitle="Active employee memberships by department"/>{overview.departments.length ? <div className="divide-y divide-[#eeece6]">{overview.departments.map((department) => <div key={department.id} className="flex items-center justify-between gap-3 px-5 py-4"><div><div className="text-sm font-bold">{department.name}</div><div className="mt-1 text-xs text-[#92928b]">{department.is_active ? "Active" : "Inactive"} department</div></div><div className="rounded-lg bg-[#f7f5f1] px-3 py-2 text-sm font-bold">{department.employee_count} employees</div></div>)}</div> : <Empty>No department records are available to this account.</Empty>}</section>
          <section className="rounded-xl border border-[#deded9] bg-white"><SectionHeading title="Recent administrative activity" subtitle="Organization and access changes"/>{overview.recent_activity.length ? <div className="divide-y divide-[#eeece6]">{overview.recent_activity.map((activity) => <div key={activity.id} className="px-5 py-3.5"><div className="flex items-center justify-between gap-3"><span className="text-sm font-bold">{activity.action.replaceAll("_", " ")}</span><time className="shrink-0 text-[11px] text-[#92928b]">{new Date(activity.created_at).toLocaleString()}</time></div><div className="mt-1 text-xs text-[#77736c]">{activity.entity_type} · {activity.entity_id}</div></div>)}</div> : <Empty>No administrative activity recorded in the audit log yet.</Empty>}</section>
        </div>
      </>}

      {!loading && tab === "organization" && <div className="mt-5 grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
        <section className="rounded-xl border border-[#deded9] bg-white"><SectionHeading title="Organization" subtitle="Existing organization records"/><div className="space-y-2 p-5">{organizations.length ? organizations.map((org) => <button type="button" key={org.id} onClick={() => setSelectedOrg(org.id)} className={`block w-full rounded-lg border p-3 text-left ${selectedOrg === org.id ? "border-[#f26b35] bg-[#fff7f2]" : "border-[#eeece6] hover:bg-[#faf9f6]"}`}><div className="text-sm font-bold">{org.name}</div><div className="mt-1 text-xs text-[#92928b]">{org.slug}</div></button>) : <Empty>No organizations are visible to this account.</Empty>}</div></section>
        <section className="rounded-xl border border-[#deded9] bg-white"><SectionHeading title={`Departments · ${selectedOrgName}`} subtitle="Create departments using the permission-checked Edge Function"/>{access["organization.manage"] && <form onSubmit={createDepartment} className="grid gap-3 border-b border-[#eeece6] p-5 sm:grid-cols-[1fr_1fr_auto]"><label className="grid gap-1 text-xs font-semibold text-[#77736c]">Department name<input required maxLength={120} value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} className="rounded-md border border-[#deded9] px-3 py-2.5 text-sm" placeholder="Customer Care"/></label><label className="grid gap-1 text-xs font-semibold text-[#77736c]">Slug<input required maxLength={120} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={departmentSlug} onChange={(e) => setDepartmentSlug(e.target.value)} className="rounded-md border border-[#deded9] px-3 py-2.5 text-sm" placeholder="customer-care"/></label><button disabled={saving || !selectedOrg} className="self-end rounded-lg bg-[#f26b35] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Add</button></form>}<div className="divide-y divide-[#eeece6]">{departments.filter((department) => !selectedOrg || department.organization_id === selectedOrg).map((department) => <div key={department.id} className="flex items-center justify-between gap-3 px-5 py-4"><div><div className="text-sm font-bold">{department.name}</div><div className="mt-1 text-xs text-[#92928b]">{department.slug}</div></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${department.is_active ? "bg-[#e8f3e8] text-[#456b45]" : "bg-[#f2eee8] text-[#77736c]"}`}>{department.is_active ? "Active" : "Inactive"}</span></div>)}{departments.filter((department) => !selectedOrg || department.organization_id === selectedOrg).length === 0 && <Empty>No departments exist for this organization yet.</Empty>}</div></section>
      </div>}

      {!loading && tab === "employees" && <section className="mt-5 rounded-xl border border-[#deded9] bg-white"><SectionHeading title="Employee directory" subtitle="Membership, department and activation status"/><div className="flex flex-col gap-3 border-b border-[#eeece6] p-5 sm:flex-row"><label className="flex-1"><span className="sr-only">Search employees</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, job title or employee code" className="w-full rounded-lg border border-[#deded9] px-3 py-2.5 text-sm"/></label><select value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)} className="rounded-lg border border-[#deded9] px-3 py-2.5 text-sm"><option value="">All organizations</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[#faf9f6] text-[11px] uppercase tracking-wide text-[#92928b]"><tr><th className="px-5 py-3">Employee</th><th className="px-5 py-3">Department</th><th className="px-5 py-3">Job title / code</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr></thead><tbody className="divide-y divide-[#eeece6]">{visibleMemberships.map((membership) => { const profile = profiles[membership.user_id]; const department = departments.find((d) => d.id === membership.department_id); return <tr key={`${membership.user_id}:${membership.organization_id}`}><td className="px-5 py-4"><div className="font-bold">{profile?.full_name || "Unnamed employee"}</div><div className="mt-1 max-w-[240px] truncate text-[11px] text-[#92928b]">{membership.user_id}</div></td><td className="px-5 py-4">{department?.name ?? "Unassigned"}</td><td className="px-5 py-4">{membership.job_title ?? "—"}<div className="mt-1 text-[11px] text-[#92928b]">{membership.employee_code ?? "No employee code"}</div></td><td className="px-5 py-4"><span className="rounded-full bg-[#f2eee8] px-2.5 py-1 text-xs">{membership.status}</span></td><td className="px-5 py-4">{access["employees.manage"] && <button type="button" disabled={saving} onClick={() => void changeMembership(membership, membership.status === "active" ? "inactive" : "active")} className="rounded-md border border-[#deded9] px-3 py-2 text-xs font-bold disabled:opacity-50">{membership.status === "active" ? "Deactivate" : "Activate"}</button>}</td></tr>; })}</tbody></table>{visibleMemberships.length === 0 && <Empty>No employee memberships match the current filters.</Empty>}</div></section>}

      {!loading && tab === "access" && <div className="mt-5 grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
        <section className="rounded-xl border border-[#deded9] bg-white"><SectionHeading title="Assign a role" subtitle="The Edge Function verifies roles.manage and protects owner assignments"/>{access["roles.manage"] && <form onSubmit={assignRole} className="grid gap-3 p-5"><label className="grid gap-1 text-xs font-semibold text-[#77736c]">Employee / user<select required value={roleUserId} onChange={(e) => setRoleUserId(e.target.value)} className="rounded-md border border-[#deded9] px-3 py-2.5 text-sm"><option value="">Choose a member</option>{visibleMemberships.map((member) => <option key={`${member.user_id}:${member.organization_id}`} value={member.user_id}>{profiles[member.user_id]?.full_name ?? member.user_id}</option>)}</select></label><label className="grid gap-1 text-xs font-semibold text-[#77736c]">Role<select required value={roleKey} onChange={(e) => setRoleKey(e.target.value)} className="rounded-md border border-[#deded9] px-3 py-2.5 text-sm"><option value="">Choose a role</option>{roles.map((role) => <option key={role.id} value={role.key}>{role.name} ({role.key})</option>)}</select></label><button disabled={saving || !roleUserId || !roleKey} className="rounded-lg bg-[#f26b35] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Assign role</button><p className="text-xs leading-5 text-[#92928b]">Role assignments are enforced by Supabase RBAC and RLS. UI visibility is not treated as authorization.</p></form>}<div className="border-t border-[#eeece6] px-5 py-4"><div className="text-sm font-bold">Current assignments</div><div className="mt-3 space-y-2">{roleAssignments.map((assignment) => { const role = roles.find((item) => item.id === assignment.role_id); return <div key={assignment.id} className="flex items-center justify-between gap-3 text-xs"><span>{profiles[assignment.user_id]?.full_name ?? assignment.user_id}</span><span className="rounded bg-[#f7f5f1] px-2 py-1 font-semibold">{role?.key ?? "Unknown role"}</span></div>; })}{roleAssignments.length === 0 && <p className="text-xs text-[#92928b]">No role assignments are visible.</p>}</div></div></section>
        <section className="rounded-xl border border-[#deded9] bg-white"><SectionHeading title="Permission catalogue" subtitle={`${permissions.length} database-defined permissions · read only here`}/><div className="max-h-[620px] overflow-auto divide-y divide-[#eeece6]">{permissions.map((permission) => <div key={permission.id} className="px-5 py-3"><div className="text-sm font-bold">{permission.key}</div><div className="mt-1 text-xs text-[#92928b]">{permission.description ?? "No description"}</div></div>)}{permissions.length === 0 && <Empty>No permissions returned. Check the RBAC migration and access policies.</Empty>}</div></section>
      </div>}
    </div>
  </main>;
}

function tabsFallback(access: Record<string, boolean>): Tab | null {
  if (access["admin.dashboard.read"]) return "overview";
  if (access["organization.read"] || access["organization.manage"]) return "organization";
  if (access["employees.read"] || access["employees.manage"]) return "employees";
  if (access["roles.read"] || access["roles.manage"]) return "access";
  return null;
}

function Metric({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Activity }) {
  return <div className="rounded-xl border border-[#deded9] bg-white p-5"><div className="flex items-center justify-between gap-3"><span className="text-[10px] font-bold uppercase tracking-[.13em] text-[#92928b]">{label}</span><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#fff0e8] text-[#f26b35]"><Icon size={17}/></span></div><div className="mt-4 font-['Manrope'] text-2xl font-extrabold tracking-tight">{value}</div><p className="mt-2 text-[11px] leading-5 text-[#77736c]">{note}</p></div>;
}
function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) { return <div className="border-b border-[#eeece6] px-5 py-4"><h2 className="font-['Manrope'] text-lg font-extrabold">{title}</h2><p className="mt-1 text-xs leading-5 text-[#92928b]">{subtitle}</p></div>; }
function Empty({ children }: { children: ReactNode }) { return <div className="p-8 text-center text-sm text-[#92928b]">{children}</div>; }
