/** Shared AeroFly role and workspace definitions. UI permissions are hints only;
 * every operation is independently authorized by Supabase RLS/RPC or server code.
 */
export * from "./_core/errors";

export const STAFF_ROLES = [
  "owner", "admin", "manager", "department_manager", "finance", "sales",
  "operations", "support", "marketing", "customer_care", "staff", "counsellor",
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const ASSIGNABLE_ROLES = ["user", ...STAFF_ROLES] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
export type WorkspacePermission =
  | "overview" | "team" | "finance" | "catalogue" | "enquiries" | "customers"
  | "bookings" | "marketing" | "reports" | "settings" | "my_work" | "leads"
  | "quotes" | "crm";

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner", admin: "Super Admin", manager: "Manager",
  department_manager: "Department Manager", finance: "Finance", sales: "Sales / CRM",
  operations: "Tour Operations", support: "Customer Support", marketing: "Marketing",
  customer_care: "Customer care", staff: "Regular staff", counsellor: "Travel counsellor",
};
export const ASSIGNABLE_ROLE_LABELS: Record<AssignableRole, string> = {
  user: "Customer / unassigned", ...STAFF_ROLE_LABELS,
};
export const STAFF_ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  owner: "Company-wide operations and governance",
  admin: "System administration, organization and access control",
  manager: "Day-to-day operations and cross-team coordination",
  department_manager: "Department team, work allocation and scoped reporting",
  finance: "Payments, invoices, refunds and reconciliation",
  sales: "Enquiries, leads and staff-issued booking proposals",
  operations: "Departures, itineraries and traveller operations",
  support: "Customer enquiries, callbacks and service recovery",
  marketing: "Tour catalogue, content and campaign reporting",
  customer_care: "Customer conversations, follow-ups and service recovery",
  staff: "Assigned work queue and internal handoffs",
  counsellor: "Lead qualification, customer needs and quotation preparation",
};

// These mappings control navigation only. Database permissions are authoritative.
export const ROLE_PERMISSIONS: Record<StaffRole, readonly WorkspacePermission[]> = {
  owner: ["overview", "team", "finance", "catalogue", "enquiries", "customers", "bookings", "marketing", "reports", "settings", "my_work", "leads", "quotes", "crm"],
  admin: ["overview", "team", "finance", "catalogue", "enquiries", "customers", "bookings", "marketing", "reports", "settings", "my_work", "leads", "quotes", "crm"],
  manager: ["overview", "enquiries", "customers", "bookings", "catalogue", "finance", "reports", "my_work", "leads", "quotes", "crm"],
  department_manager: ["overview", "team", "enquiries", "customers", "bookings", "catalogue", "reports", "my_work", "crm"],
  finance: ["overview", "finance", "reports", "bookings", "my_work"],
  sales: ["overview", "enquiries", "customers", "bookings", "leads", "quotes", "my_work", "crm", "reports"],
  operations: ["overview", "bookings", "catalogue", "reports", "my_work"],
  support: ["overview", "enquiries", "customers", "bookings", "my_work", "crm"],
  marketing: ["overview", "catalogue", "marketing", "reports", "my_work"],
  customer_care: ["overview", "enquiries", "customers", "bookings", "my_work", "crm"],
  staff: ["overview", "my_work", "enquiries", "crm"],
  counsellor: ["overview", "leads", "customers", "quotes", "my_work", "crm", "reports"],
};

export function normalizeStaffRole(role: string | null | undefined): StaffRole | null {
  if (role === "user" || role === "customer") return null;
  if (role === "admin") return "admin";
  return STAFF_ROLES.includes(role as StaffRole) ? (role as StaffRole) : null;
}
export function hasWorkspacePermission(role: string | null | undefined, permission: WorkspacePermission) {
  const normalized = normalizeStaffRole(role);
  return normalized ? ROLE_PERMISSIONS[normalized].includes(permission) : false;
}
