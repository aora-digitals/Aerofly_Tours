import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Activity, ArrowLeft, RefreshCw, Save, ShieldCheck, Users, UserPlus, FileBarChart2, Settings2, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type Organization = { id: string; name: string; slug: string };
type Department = { id: string; organization_id: string; name: string; slug: string; is_active: boolean; manager_user_id: string | null };
type Membership = { user_id: string; organization_id: string; department_id: string | null; status: string; job_title: string | null; employee_code: string | null; employment_type: string; reports_to_user_id: string | null; joined_at: string | null };
type Profile = { id: string; full_name: string | null; email: string | null; phone: string | null };
type Role = { id: string; key: string; name: string; description: string | null };
type Permission = { id: string; key: string; description: string | null };
type RolePermission = { role_id: string; permission_id: string };
type UserRole = { id: string; user_id: string; role_id: string; organization_id: string | null };
type AuditRow = { id: number; actor_id: string | null; action: string; entity_type: string; entity_id: string; organization_id: string | null; metadata: Record<string, unknown>; created_at: string };
type Report = { enquiry_count: number; new_enquiries: number; accepted_proposals: number; bookings_created: number; confirmed_bookings: number; departures_upcoming: number; verified_income: number | null; refunds_recorded: number | null; department_headcount: Array<{ department_id: string; department: string; active_employees: number }> };
type Tab = "employees" | "access" | "reports" | "settings" | "audit";
type AccessMap = Record<string, boolean>;
const dateValue = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const initialFrom = dateValue(new Date(Date.now() - 29 * 86400000));
const initialTo = dateValue(new Date());

export default function AdminERPAdministration() {
  const [tab, setTab] = useState<Tab>("employees");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessMap>({});
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [search, setSearch] = useState("");
  const [employeePage, setEmployeePage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [employeePhone, setEmployeePhone] = useState("");
  const [employeeTitle, setEmployeeTitle] = useState("");
  const [employeeRole, setEmployeeRole] = useState("staff");
  const [employeeDepartment, setEmployeeDepartment] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [report, setReport] = useState<Report | null>(null);
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [editOrgName, setEditOrgName] = useState("");
  const [editOrgSlug, setEditOrgSlug] = useState("");
  const [settingValues, setSettingValues] = useState<Record<string, string>>({
    "company.legal_name": "", "company.address": "", "company.phone": "",
    "company.email": "", "company.tax_registration_number": "",
  });

  const invoke = useCallback(async (payload: Record<string, unknown>) => {
    const { data, error: invokeError } = await supabase.functions.invoke("admin-organization", { body: payload });
    if (invokeError) throw invokeError;
    if (data?.error) throw new Error(String(data.error));
    return data?.data;
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [orgRes, deptRes, memberRes, roleRes, permRes, rolePermRes, userRoleRes, auditRes, settingsRes] = await Promise.all([
        supabase.from("organizations").select("id,name,slug").order("name"),
        supabase.from("departments").select("id,organization_id,name,slug,is_active,manager_user_id").order("name"),
        supabase.from("organization_memberships").select("user_id,organization_id,department_id,status,job_title,employee_code,employment_type,reports_to_user_id,joined_at").order("created_at", { ascending: false }).limit(1000),
        supabase.from("roles").select("id,key,name,description").order("name"),
        supabase.from("permissions").select("id,key,description").order("key"),
        supabase.from("role_permissions").select("role_id,permission_id").limit(3000),
        supabase.from("user_roles").select("id,user_id,role_id,organization_id").limit(3000),
        supabase.from("admin_audit_log").select("id,actor_id,action,entity_type,entity_id,organization_id,metadata,created_at").order("created_at", { ascending: false }).limit(100),
        organizationId ? supabase.from("organization_settings").select("setting_key,setting_value").eq("organization_id", organizationId) : Promise.resolve({ data: [] as Array<{ setting_key: string; setting_value: unknown }>, error: null }),
      ]);
      const firstError = orgRes.error || deptRes.error || memberRes.error || roleRes.error || permRes.error || rolePermRes.error || userRoleRes.error || auditRes.error || settingsRes.error;
      if (firstError) throw new Error(firstError.message);
      const orgs = (orgRes.data ?? []) as Organization[];
      setOrganizations(orgs);
      const chosenOrg = organizationId || orgs[0]?.id || "";
      if (chosenOrg !== organizationId) setOrganizationId(chosenOrg);
      const permissionKeys = ["admin.dashboard.read", "organization.read", "organization.manage", "employees.read", "employees.manage", "roles.read", "roles.manage", "reports.read", "settings.read", "settings.manage", "audit.read", "finance.read"];
      const permissionChecks = await Promise.all(permissionKeys.map(async (key) => {
        const { data, error: permissionError } = await supabase.rpc("has_permission", { requested_permission: key, requested_organization: chosenOrg || null });
        if (permissionError) throw new Error(permissionError.message);
        return [key, data === true] as const;
      }));
      setAccess(Object.fromEntries(permissionChecks));
      setDepartments((deptRes.data ?? []) as Department[]);
      const members = (memberRes.data ?? []) as Membership[];
      setMemberships(members);
      setRoles((roleRes.data ?? []) as Role[]);
      setPermissions((permRes.data ?? []) as Permission[]);
      setRolePermissions((rolePermRes.data ?? []) as RolePermission[]);
      setUserRoles((userRoleRes.data ?? []) as UserRole[]);
      setAudit((auditRes.data ?? []) as AuditRow[]);
      const ids = Array.from(
        new Set(members.map((m) => m.user_id))
      );
      if (ids.length) {
        const { data, error: profileError } = await supabase.from("profiles").select("id,full_name,email,phone").in("id", ids);
        if (profileError) throw new Error(profileError.message);
        setProfiles(Object.fromEntries(((data ?? []) as Profile[]).map((p) => [p.id, p])));
      } else setProfiles({});
      const settingRows = (settingsRes.data ?? []) as Array<{ setting_key: string; setting_value: unknown }>;
      setSettingValues((old) => {
        const next = { ...old };
        for (const row of settingRows) {
          const value = row.setting_value;
          next[row.setting_key] = typeof value === "string" ? value : JSON.stringify(value);
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load administration records.");
    } finally { setLoading(false); }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const current = organizations.find((o) => o.id === organizationId);
    setEditOrgName(current?.name ?? "");
    setEditOrgSlug(current?.slug ?? "");
  }, [organizations, organizationId]);

  useEffect(() => {
    if (tab !== "reports") return;
    const fetchReport = async () => {
      try {
        const fromAt = new Date(`${from}T00:00:00.000Z`).toISOString();
        const toAt = new Date(`${to}T23:59:59.999Z`).toISOString();
        const { data, error: rpcError } = await supabase.rpc("admin_erp_reports_scoped", { p_from: fromAt, p_to: toAt, p_organization_id: organizationId || null });
        if (rpcError) throw rpcError;
        setReport(data as Report);
      } catch (e) { toast.error(e instanceof Error ? e.message : "Report could not be loaded."); setReport(null); }
    };
    if (from && to && from <= to) void fetchReport();
  }, [tab, from, to, organizationId]);

  const call = async (payload: Record<string, unknown>, success: string) => {
    setSaving(true);
    try { const scopedPayload = Object.prototype.hasOwnProperty.call(payload, "organization_id") ? payload : { ...payload, organization_id: organizationId }; await invoke(scopedPayload); toast.success(success); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Operation failed."); }
    finally { setSaving(false); }
  };

  const inviteEmployee = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId || !employeeEmail.trim() || !employeeName.trim() || !employeeRole) return;
    await call({ action: "invite_employee", organization_id: organizationId, email: employeeEmail.trim(), full_name: employeeName.trim(), phone: employeePhone.trim() || null, job_title: employeeTitle.trim() || null, department_id: employeeDepartment || null, role_key: employeeRole }, "Employee invitation sent.");
    setEmployeeEmail(""); setEmployeeName(""); setEmployeePhone(""); setEmployeeTitle("");
  };

  const createOrganization = async (event: FormEvent) => {
    event.preventDefault();
    if (!orgName.trim() || !orgSlug.trim()) return;
    await call({ action: "create_organization", name: orgName.trim(), slug: orgSlug.trim().toLowerCase(), organization_id: null }, "Organization created.");
    setOrgName(""); setOrgSlug("");
  };
  const updateOrganization = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId || !editOrgName.trim() || !editOrgSlug.trim()) return;
    await call({ action: "update_organization", id: organizationId, organization_id: organizationId, name: editOrgName.trim(), slug: editOrgSlug.trim().toLowerCase() }, "Organization details updated.");
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!organizationId) return;
    setSaving(true);
    try {
      for (const [setting_key, value] of Object.entries(settingValues)) {
        await invoke({ action: "save_setting", organization_id: organizationId, setting_key, setting_value: value.trim() });
      }
      toast.success("Company settings saved."); await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Settings could not be saved."); }
    finally { setSaving(false); }
  };

  const visibleMembers = useMemo(() => memberships.filter((m) => {
    if (organizationId && m.organization_id !== organizationId) return false;
    if (statusFilter !== "all" && m.status !== statusFilter) return false;
    const p = profiles[m.user_id];
    return `${p?.full_name ?? ""} ${p?.email ?? ""} ${p?.phone ?? ""} ${m.job_title ?? ""} ${m.employee_code ?? ""}`.toLowerCase().includes(search.toLowerCase());
  }), [memberships, organizationId, profiles, search, statusFilter]);

  const pageSize = 50;
  const directoryPageRows = visibleMembers.slice(employeePage * pageSize, (employeePage + 1) * pageSize);
  useEffect(() => { setEmployeePage(0); }, [search, organizationId, statusFilter]);

  const tabs: Array<{ id: Tab; label: string; icon: typeof Users; allowed: boolean }> = [
    { id: "employees", label: "Employees", icon: Users, allowed: Boolean(access["employees.read"] || access["employees.manage"]) },
    { id: "access", label: "Roles & permissions", icon: ShieldCheck, allowed: Boolean(access["roles.read"] || access["roles.manage"]) },
    { id: "reports", label: "Reports", icon: FileBarChart2, allowed: Boolean(access["reports.read"]) },
    { id: "settings", label: "Company settings", icon: Settings2, allowed: Boolean(access["settings.read"] || access["settings.manage"] || access["organization.manage"]) },
    { id: "audit", label: "Audit log", icon: Activity, allowed: Boolean(access["audit.read"]) },
  ];
  const currentDepartments = departments.filter((d) => d.organization_id === organizationId);
  const activeDepartments = currentDepartments.filter((d) => d.is_active);
  const formatMoney = (n: number | null | undefined) => n == null ? "Restricted" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
  useEffect(() => {
    if (loading) return;
    const allowedTabs: Tab[] = [];
    if (access["employees.read"] || access["employees.manage"]) allowedTabs.push("employees");
    if (access["roles.read"] || access["roles.manage"]) allowedTabs.push("access");
    if (access["reports.read"]) allowedTabs.push("reports");
    if (access["settings.read"] || access["settings.manage"] || access["organization.manage"]) allowedTabs.push("settings");
    if (access["audit.read"]) allowedTabs.push("audit");
    if (allowedTabs.length && !allowedTabs.includes(tab)) setTab(allowedTabs[0]);
  }, [access, loading, tab]);

  return <main className="min-h-screen bg-[#f7f5f1] px-4 py-6 text-[#22231f] sm:px-7 lg:px-10">
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#f26b35]">AeroFly Tours · Phase 7</div><h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Administration & governance</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[#77736c]">Employee provisioning, permission assignments, operational reports, organization settings and append-only audit history.</p></div>
        <div className="flex gap-2"><Link href="/admin/erp" className="inline-flex items-center gap-2 rounded-lg border border-[#deded9] bg-white px-4 py-2.5 text-sm font-semibold"><ArrowLeft size={15}/> ERP overview</Link><button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[#deded9] bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><RefreshCw size={15} className={loading ? "animate-spin" : ""}/> Refresh</button></div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3"><label className="text-xs font-semibold text-[#77736c]">Organization<select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} className="ml-2 rounded-lg border border-[#deded9] bg-white px-3 py-2 text-sm">{organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label><span className="text-xs text-[#92928b]">All changes are re-authorized by the Edge Function/database.</span></div>
      <div className="mt-5 flex flex-wrap gap-2 border-b border-[#deded9] pb-3">{tabs.filter((item) => item.allowed).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold ${tab === id ? "bg-[#22231f] text-white" : "bg-white text-[#696960] hover:bg-[#eeece6]"}`}><Icon size={15}/>{label}</button>)}</div>
      {error && <div role="alert" className="mt-5 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertCircle size={18}/><div><strong>Could not load administration data.</strong><p className="mt-1">{error}</p></div></div>}
      {loading && <div className="mt-5 rounded-xl border border-[#deded9] bg-white p-8 text-sm text-[#77736c]">Loading organization and access records…</div>}
      {!loading && !tabs.some((item) => item.allowed) && <section className="mt-5 rounded-xl border border-[#deded9] bg-white p-8 text-sm text-[#77736c]">Your account does not have permission to access the administration modules for this organization.</section>}

      {!loading && tab === "employees" && <div className="mt-5 grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
        {access["employees.manage"] && <section className="rounded-xl border border-[#deded9] bg-white"><Heading title="Invite employee" subtitle="Supabase Auth sends the invitation; passwords are never handled by this page."/><form onSubmit={inviteEmployee} className="grid gap-3 p-5">
          <Field label="Full name"><input required maxLength={160} value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} className={inputClass}/></Field><Field label="Work email"><input required type="email" maxLength={320} value={employeeEmail} onChange={(e) => setEmployeeEmail(e.target.value)} className={inputClass}/></Field><Field label="Phone (optional)"><input maxLength={40} value={employeePhone} onChange={(e) => setEmployeePhone(e.target.value)} className={inputClass}/></Field><Field label="Job title (optional)"><input maxLength={120} value={employeeTitle} onChange={(e) => setEmployeeTitle(e.target.value)} className={inputClass}/></Field>
          <Field label="Department"><select value={employeeDepartment} onChange={(e) => setEmployeeDepartment(e.target.value)} className={inputClass}><option value="">Unassigned</option>{activeDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="Initial role"><select value={employeeRole} onChange={(e) => setEmployeeRole(e.target.value)} className={inputClass}>{roles.filter((r) => r.key !== "customer").map((r) => <option key={r.id} value={r.key}>{r.name} ({r.key})</option>)}</select></Field>
          <button disabled={saving || !organizationId} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#f26b35] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"><UserPlus size={16}/>{saving ? "Saving…" : "Invite employee"}</button>
        </form></section>}
        {(access["employees.read"] || access["employees.manage"]) && <section className="rounded-xl border border-[#deded9] bg-white"><Heading title="Employee directory" subtitle={`${visibleMembers.length} visible membership records`}/><div className="flex flex-col gap-2 border-b border-[#eeece6] p-4 sm:flex-row"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email, phone, job title or employee code" className={inputClass}/><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputClass} sm:max-w-[180px]`}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="invited">Invited</option></select></div><div className="max-h-[720px] divide-y divide-[#eeece6] overflow-auto">{directoryPageRows.map((m) => <div key={`${m.user_id}:${m.organization_id}`} className="p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-sm font-bold">{profiles[m.user_id]?.full_name ?? "Unnamed employee"}</div><div className="mt-1 text-xs text-[#92928b]">{profiles[m.user_id]?.email ?? m.user_id}</div></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${m.status === "active" ? "bg-green-50 text-green-700" : "bg-stone-100 text-stone-600"}`}>{m.status}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><Field label="Department"><select disabled={!access["employees.manage"] || saving} value={m.department_id ?? ""} onChange={(e) => void call({ action: "set_membership", user_id: m.user_id, department_id: e.target.value || null, status: m.status, job_title: m.job_title }, "Employee assignment updated.")} className={inputClass}><option value="">Unassigned</option>{activeDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="Reporting manager"><select disabled={!access["employees.manage"] || saving} value={m.reports_to_user_id ?? ""} onChange={(e) => void call({ action: "update_employee", user_id: m.user_id, reports_to_user_id: e.target.value || null }, "Reporting line updated.")} className={inputClass}><option value="">No manager</option>{visibleMembers.filter((candidate) => candidate.user_id !== m.user_id && candidate.status === "active").map((candidate) => <option key={candidate.user_id} value={candidate.user_id}>{profiles[candidate.user_id]?.full_name ?? candidate.user_id}</option>)}</select></Field></div><div className="mt-3 grid gap-2 sm:grid-cols-3"><Field label="Job title"><input disabled={!access["employees.manage"] || saving} defaultValue={m.job_title ?? ""} maxLength={120} onBlur={(e) => { const value = e.currentTarget.value.trim(); if (access["employees.manage"] && value !== (m.job_title ?? "")) void call({ action: "update_employee", user_id: m.user_id, job_title: value || null }, "Job title updated."); }} className={inputClass}/></Field><Field label="Employee code"><input disabled={!access["employees.manage"] || saving} defaultValue={m.employee_code ?? ""} maxLength={64} onBlur={(e) => { const value = e.currentTarget.value.trim(); if (access["employees.manage"] && value !== (m.employee_code ?? "")) void call({ action: "update_employee", user_id: m.user_id, employee_code: value || null }, "Employee code updated."); }} className={inputClass}/></Field><Field label="Employment type"><select disabled={!access["employees.manage"] || saving} value={m.employment_type} onChange={(e) => void call({ action: "update_employee", user_id: m.user_id, employment_type: e.target.value }, "Employment type updated.")} className={inputClass}><option value="employee">Employee</option><option value="contractor">Contractor</option><option value="intern">Intern</option><option value="director">Director</option></select></Field></div><div className="mt-3 flex justify-end">{access["employees.manage"] && <button disabled={saving} onClick={() => { if (confirm(`${m.status === "active" ? "Deactivate" : "Activate"} this employee?`)) void call({ action: "set_membership", user_id: m.user_id, department_id: m.department_id, status: m.status === "active" ? "inactive" : "active", job_title: m.job_title }, "Employee status updated."); }} className="rounded-md border border-[#deded9] px-3 py-1.5 text-xs font-bold">{m.status === "active" ? "Deactivate" : "Activate"}</button>}</div></div>)}{visibleMembers.length === 0 && <Empty>No employee memberships match this search.</Empty>}</div>{visibleMembers.length > pageSize && <div className="flex items-center justify-between border-t border-[#eeece6] px-5 py-3"><span className="text-xs text-[#92928b]">Showing {employeePage * pageSize + 1}–{Math.min((employeePage + 1) * pageSize, visibleMembers.length)} of {visibleMembers.length}</span><div className="flex gap-2"><button type="button" disabled={employeePage === 0} onClick={() => setEmployeePage((p) => Math.max(0, p - 1))} className="rounded-md border border-[#deded9] px-3 py-1.5 text-xs disabled:opacity-40">Previous</button><button type="button" disabled={(employeePage + 1) * pageSize >= visibleMembers.length} onClick={() => setEmployeePage((p) => p + 1)} className="rounded-md border border-[#deded9] px-3 py-1.5 text-xs disabled:opacity-40">Next</button></div></div>}</section>}
        {access["organization.manage"] && <section className="rounded-xl border border-[#deded9] bg-white xl:col-span-2"><Heading title="Department heads" subtitle="Department managers must be active members of the same organization."/><div className="divide-y divide-[#eeece6]">{currentDepartments.map((d) => <div key={d.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_1.5fr_auto] sm:items-center"><div><div className="text-sm font-bold">{d.name}</div><div className="mt-1 text-xs text-[#92928b]">{d.slug} · {d.is_active ? "Active" : "Inactive"}</div></div><select value={d.manager_user_id ?? ""} onChange={(e) => void call({ action: "set_department_manager", department_id: d.id, manager_user_id: e.target.value || null }, "Department manager updated.")} className={inputClass}><option value="">No department head</option>{visibleMembers.filter((m) => m.status === "active").map((m) => <option key={m.user_id} value={m.user_id}>{profiles[m.user_id]?.full_name ?? m.user_id}</option>)}</select>{access["organization.manage"] && <button disabled={saving} onClick={() => { if (confirm(`${d.is_active ? "Deactivate" : "Activate"} ${d.name}?`)) void call({ action: "set_department_active", department_id: d.id, is_active: !d.is_active }, "Department status updated."); }} className="rounded-md border border-[#deded9] px-3 py-2 text-xs font-bold">{d.is_active ? "Deactivate" : "Activate"}</button>}</div>)}{currentDepartments.length === 0 && <Empty>No departments in this organization.</Empty>}</div></section>}
      </div>}

      {!loading && tab === "access" && <div className="mt-5 grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
        <section className="rounded-xl border border-[#deded9] bg-white"><Heading title="User role assignments" subtitle="Role writes are performed by atomic database functions."/>{access["roles.manage"] && <form className="grid gap-3 p-5" onSubmit={(e) => { e.preventDefault(); if (selectedUser && selectedRole) void call({ action: "assign_role", user_id: selectedUser, role_key: selectedRole }, "Role assigned."); }}><Field label="Employee"><select required value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} className={inputClass}><option value="">Select employee</option>{visibleMembers.map((m) => <option key={m.user_id} value={m.user_id}>{profiles[m.user_id]?.full_name ?? m.user_id}</option>)}</select></Field><Field label="Role"><select required value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} className={inputClass}><option value="">Select role</option>{roles.filter((r) => r.key !== "customer").map((r) => <option key={r.id} value={r.key}>{r.name} ({r.key})</option>)}</select></Field><button disabled={saving || !selectedUser || !selectedRole} className="rounded-lg bg-[#f26b35] px-4 py-2.5 text-sm font-bold text-white">Assign role</button></form>}<div className="divide-y divide-[#eeece6]">{visibleMembers.map((m) => { const assigned = userRoles.filter((assignment) => assignment.user_id === m.user_id && (assignment.organization_id === organizationId || assignment.organization_id === null)).map((assignment) => ({ assignment, role: roles.find((r) => r.id === assignment.role_id) })).filter((item): item is { assignment: UserRole; role: Role } => Boolean(item.role)); return <div key={m.user_id} className="px-5 py-3"><div className="text-sm font-bold">{profiles[m.user_id]?.full_name ?? m.user_id}</div><div className="mt-2 flex flex-wrap gap-2">{assigned.length ? assigned.map(({ assignment, role }) => <span key={assignment.id} className="rounded-full bg-[#f7f5f1] px-2 py-1 text-[10px]">{role.key}{assignment.organization_id === null ? " · global" : ""}{access["roles.manage"] && <button aria-label={`Remove ${role.key}`} className="ml-2 font-bold text-red-600" onClick={() => { if (confirm(`Remove ${role.key} from this employee?`)) void call({ action: "remove_role", user_id: m.user_id, role_key: role.key, organization_id: assignment.organization_id }, "Role removed."); }}>×</button>}</span>) : <span className="text-xs text-[#92928b]">No visible roles</span>}</div></div>; })}</div></section>
        <section className="rounded-xl border border-[#deded9] bg-white"><Heading title="Role permission matrix" subtitle="Changes are checked in Postgres. Sensitive grants require owner privileges."/><div className="border-b border-[#eeece6] p-5"><Field label="Role to edit"><select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} className={inputClass}><option value="">Select role</option>{roles.filter((r) => r.key !== "customer").map((r) => <option key={r.id} value={r.key}>{r.name} ({r.key})</option>)}</select></Field></div><div className="max-h-[680px] divide-y divide-[#eeece6] overflow-auto">{permissions.map((p) => { const role = roles.find((r) => r.key === selectedRole); const granted = Boolean(role && rolePermissions.some((rp) => rp.role_id === role.id && rp.permission_id === p.id)); return <label key={p.id} className="flex cursor-pointer items-start gap-3 px-5 py-3 hover:bg-[#faf9f6]"><input type="checkbox" checked={granted} disabled={saving || !access["roles.manage"] || !role || selectedRole === "customer"} onChange={() => void call({ action: granted ? "remove_permission" : "assign_permission", role_key: selectedRole, permission_key: p.key }, `${p.key} ${granted ? "revoked" : "granted"}.`)} className="mt-1 accent-[#f26b35]"/><span><span className="block text-sm font-semibold">{p.key}</span><span className="mt-1 block text-xs text-[#92928b]">{p.description ?? "No description"}</span></span></label>; })}</div></section>
      </div>}

      {!loading && tab === "reports" && <section className="mt-5 rounded-xl border border-[#deded9] bg-white"><Heading title="Operational reports" subtitle="Metrics are calculated from the current Supabase records. Financial values require finance.read."/><div className="flex flex-wrap gap-3 border-b border-[#eeece6] p-5"><Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputClass}/></Field><Field label="To"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={inputClass}/></Field></div>{report ? <><div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">{[["Enquiries",report.enquiry_count],["New enquiries",report.new_enquiries],["Accepted proposals",report.accepted_proposals],["Bookings created",report.bookings_created],["Confirmed bookings",report.confirmed_bookings],["Upcoming departures",report.departures_upcoming],["Verified income",formatMoney(report.verified_income)],["Refunds recorded",formatMoney(report.refunds_recorded)]].map(([label,value]) => <div key={String(label)} className="rounded-lg border border-[#eeece6] p-4"><div className="text-[10px] font-bold uppercase tracking-wide text-[#92928b]">{label}</div><div className="mt-3 text-xl font-extrabold">{value}</div></div>)}</div><div className="border-t border-[#eeece6] p-5"><h3 className="font-bold">Department headcount</h3>{report.department_headcount.length ? report.department_headcount.map((d) => <div key={d.department_id} className="mt-3 flex items-center justify-between rounded-lg bg-[#faf9f6] px-4 py-3 text-sm"><span>{d.department}</span><strong>{d.active_employees}</strong></div>) : <Empty>No department records available.</Empty>}</div></> : <Empty>Choose a valid date range to load reports.</Empty>}</section>}

      {!loading && tab === "settings" && <div className="mt-5 grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
        <section className="rounded-xl border border-[#deded9] bg-white"><Heading title="Create organization" subtitle="Only owners can create a new organization."/>{access["organization.manage"] && <form onSubmit={createOrganization} className="grid gap-3 p-5"><Field label="Organization name"><input required maxLength={160} value={orgName} onChange={(e) => setOrgName(e.target.value)} className={inputClass}/></Field><Field label="URL slug"><input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={120} value={orgSlug} onChange={(e) => setOrgSlug(e.target.value)} className={inputClass}/></Field><button disabled={saving} className="rounded-lg bg-[#f26b35] px-4 py-2.5 text-sm font-bold text-white">Create organization</button></form>}<div className="border-t border-[#eeece6] p-5"><h3 className="mb-3 font-bold">Edit current organization</h3>{access["organization.manage"] && <form onSubmit={updateOrganization} className="grid gap-3"><Field label="Organization name"><input required maxLength={160} value={editOrgName} onChange={(e) => setEditOrgName(e.target.value)} className={inputClass}/></Field><Field label="URL slug"><input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={120} value={editOrgSlug} onChange={(e) => setEditOrgSlug(e.target.value)} className={inputClass}/></Field><button disabled={saving || !organizationId} className="rounded-lg border border-[#deded9] px-4 py-2.5 text-sm font-bold">Save organization</button></form>}</div></section>
        <section className="rounded-xl border border-[#deded9] bg-white"><Heading title="Company and invoice settings" subtitle="Tax identifiers and contact details are configurable. No tax rates are assumed."/>{access["settings.manage"] && <form onSubmit={saveSettings} className="grid gap-4 p-5">{Object.entries({"company.legal_name":"Legal company name","company.address":"Registered/business address","company.phone":"Business phone","company.email":"Business email","company.tax_registration_number":"Tax registration number (optional)"}).map(([key,label]) => <Field key={key} label={label}><input value={settingValues[key] ?? ""} onChange={(e) => setSettingValues((s) => ({ ...s, [key]: e.target.value }))} maxLength={2000} className={inputClass}/></Field>)}<button disabled={saving || !organizationId} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#f26b35] px-4 py-2.5 text-sm font-bold text-white"><Save size={15}/>{saving ? "Saving…" : "Save company settings"}</button></form>}{!access["settings.manage"] && <div className="space-y-3 p-5">{Object.entries({"company.legal_name":"Legal company name","company.address":"Registered/business address","company.phone":"Business phone","company.email":"Business email","company.tax_registration_number":"Tax registration number"}).map(([key,label]) => <div key={key}><div className="text-[10px] font-bold uppercase tracking-wide text-[#92928b]">{label}</div><div className="mt-1 text-sm">{settingValues[key] || "Not configured"}</div></div>)}</div>}</section>
      </div>}

      {!loading && tab === "audit" && <section className="mt-5 rounded-xl border border-[#deded9] bg-white"><Heading title="Administrative audit log" subtitle="Read-only event history for organization, department, membership and role changes."/><div className="divide-y divide-[#eeece6]">{audit.filter((a) => !organizationId || a.organization_id === organizationId || a.organization_id === null).map((a) => <div key={a.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_1.5fr_auto] sm:items-start"><div><div className="text-sm font-bold">{a.action.replaceAll("_", " ")}</div><div className="mt-1 text-xs text-[#92928b]">{a.entity_type} · {a.entity_id}</div></div><div className="text-xs text-[#77736c]">{JSON.stringify(a.metadata ?? {})}</div><time className="text-xs text-[#92928b]">{new Date(a.created_at).toLocaleString()}</time></div>)}{audit.length === 0 && <Empty>No administrative events are visible to this account.</Empty>}</div></section>}
    </div>
  </main>;
}

const inputClass = "w-full rounded-lg border border-[#deded9] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#f26b35]";
function Heading({ title, subtitle }: { title: string; subtitle: string }) { return <div className="border-b border-[#eeece6] px-5 py-4"><h2 className="font-extrabold">{title}</h2><p className="mt-1 text-xs leading-5 text-[#92928b]">{subtitle}</p></div>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-1.5 text-xs font-semibold text-[#77736c]"><span>{label}</span>{children}</label>; }
function Empty({ children }: { children: ReactNode }) { return <div className="p-8 text-center text-sm text-[#92928b]">{children}</div>; }
