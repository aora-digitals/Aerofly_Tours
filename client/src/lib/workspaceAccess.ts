import type { AppRole, AppUser } from "@/contexts/AuthContext";

export type WorkspaceKey = "erp" | "sales" | "finance" | "marketing" | "operations" | "support" | "department" | "work";
export type WorkspaceNavItem = {
  key: WorkspaceKey;
  label: string;
  href: string;
  description: string;
  anyPermission: readonly string[];
};

export const WORKSPACE_NAV: readonly WorkspaceNavItem[] = [
  { key: "erp", label: "ERP overview", href: "/admin/erp", description: "Organization and operational overview", anyPermission: ["roles.read", "organization.manage"] },
  { key: "sales", label: "Sales & CRM", href: "/admin/sales", description: "Enquiries, customers and proposals", anyPermission: ["sales.read"] },
  { key: "finance", label: "Finance", href: "/admin/finance", description: "Verified payments and financial records", anyPermission: ["finance.read"] },
  { key: "marketing", label: "Marketing", href: "/admin/marketing", description: "Tours, destinations and campaigns", anyPermission: ["marketing.read"] },
  { key: "operations", label: "Tour operations", href: "/admin/operations", description: "Departures and traveller operations", anyPermission: ["operations.read"] },
  { key: "support", label: "Customer support", href: "/admin/support", description: "Customer requests and follow-ups", anyPermission: ["support.read"] },
  { key: "department", label: "My department", href: "/admin/department", description: "Team and department operations", anyPermission: ["organization.read"] },
  { key: "work", label: "My work", href: "/admin/work", description: "Assigned work and handoffs", anyPermission: ["work.read"] },
];

const ROLE_LANDING_PRIORITY: readonly AppRole[] = [
  "owner", "admin", "department_manager", "manager", "finance", "sales",
  "counsellor", "operations", "support", "customer_care", "marketing", "staff", "customer",
];

const ROLE_DEFAULT_PATH: Record<AppRole, string> = {
  owner: "/admin",
  admin: "/admin/erp",
  manager: "/admin/department",
  department_manager: "/admin/department",
  finance: "/admin/finance",
  sales: "/admin/sales",
  counsellor: "/admin/sales",
  operations: "/admin/operations",
  support: "/admin/support",
  customer_care: "/admin/support",
  marketing: "/admin/marketing",
  staff: "/admin/work",
  customer: "/dashboard",
};

export function defaultLandingPath(user: Pick<AppUser, "role" | "roles"> | null | undefined): string {
  if (!user) return "/login";
  const roles = user.roles?.length ? user.roles : [user.role];
  const highest = ROLE_LANDING_PRIORITY.find((role) => roles.includes(role)) ?? "customer";
  return ROLE_DEFAULT_PATH[highest];
}

export function canAccessWorkspace(permissions: readonly string[] | null | undefined, key: WorkspaceKey): boolean {
  const item = WORKSPACE_NAV.find((entry) => entry.key === key);
  return Boolean(item && item.anyPermission.some((permission) => permissions?.includes(permission)));
}

export function visibleWorkspaceNavigation(permissions: readonly string[] | null | undefined): WorkspaceNavItem[] {
  return WORKSPACE_NAV.filter((item) => item.anyPermission.some((permission) => permissions?.includes(permission)));
}

export function isSafeInternalPath(path: string | null | undefined): path is string {
  return Boolean(path && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") && !/^\/login(?:\?|$)/.test(path));
}
