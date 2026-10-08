/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export * from "./_core/errors";

export const STAFF_ROLES = ["owner", "manager", "marketing", "customer_care", "staff", "counsellor"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const ASSIGNABLE_ROLES = ["user", ...STAFF_ROLES] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
export type WorkspacePermission = "overview" | "team" | "finance" | "catalogue" | "enquiries" | "customers" | "bookings" | "marketing" | "reports" | "settings" | "my_work" | "leads" | "quotes" | "crm";

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
  marketing: "Marketing",
  customer_care: "Customer care",
  staff: "Regular staff",
  counsellor: "Counsellor",
};

export const ASSIGNABLE_ROLE_LABELS: Record<AssignableRole, string> = {
  user: "Customer / unassigned",
  ...STAFF_ROLE_LABELS,
};

export const STAFF_ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  owner: "Company-wide control, team governance, finance and settings",
  manager: "Day-to-day operations, bookings, enquiries and catalogue oversight",
  marketing: "Campaigns, catalogue storytelling, content and performance reports",
  customer_care: "Customer conversations, follow-ups, bookings and service recovery",
  staff: "Assigned work queue, enquiry support and internal handoffs",
  counsellor: "Lead qualification, customer needs and quotation preparation",
};

export const ROLE_PERMISSIONS: Record<StaffRole, readonly WorkspacePermission[]> = {
  owner: ["overview", "team", "finance", "catalogue", "enquiries", "customers", "bookings", "marketing", "reports", "settings", "my_work", "leads", "quotes", "crm"],
  manager: ["overview", "enquiries", "customers", "bookings", "catalogue", "finance", "reports", "my_work", "leads", "quotes", "crm"],
  marketing: ["overview", "catalogue", "marketing", "reports", "my_work"],
  customer_care: ["overview", "enquiries", "customers", "bookings", "my_work", "crm"],
  staff: ["overview", "my_work", "enquiries", "crm"],
  counsellor: ["overview", "leads", "customers", "quotes", "my_work", "crm"],
};

export function normalizeStaffRole(role: string | null | undefined): StaffRole | null {
  if (role === "admin") return "owner";
  return STAFF_ROLES.includes(role as StaffRole) ? role as StaffRole : null;
}

export function hasWorkspacePermission(role: string | null | undefined, permission: WorkspacePermission) {
  const normalized = normalizeStaffRole(role);
  return normalized ? ROLE_PERMISSIONS[normalized].includes(permission) : false;
}
