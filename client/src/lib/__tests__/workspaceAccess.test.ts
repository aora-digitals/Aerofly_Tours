import { describe, expect, it } from "vitest";
import { canAccessWorkspace, defaultLandingPath, isSafeInternalPath, visibleWorkspaceNavigation } from "../workspaceAccess";

const user = (role: "customer" | "owner" | "admin" | "finance" | "sales" | "operations" | "support" | "marketing" | "department_manager" | "manager" | "staff" | "counsellor" | "customer_care", roles?: typeof role) => ({
  role,
  roles: roles ? [roles, role].filter((value, index, all) => all.indexOf(value) === index) : [role],
});

describe("AeroFly role landing", () => {
  it("sends owner and admin to distinct administration workspaces", () => {
    expect(defaultLandingPath(user("owner"))).toBe("/admin");
    expect(defaultLandingPath(user("admin"))).toBe("/admin/erp");
  });

  it.each([
    ["sales", "/admin/sales"],
    ["finance", "/admin/finance"],
    ["marketing", "/admin/marketing"],
    ["operations", "/admin/operations"],
    ["support", "/admin/support"],
    ["department_manager", "/admin/department"],
    ["staff", "/admin/work"],
    ["customer", "/dashboard"],
  ] as const)("routes %s to %s", (role, expected) => {
    expect(defaultLandingPath(user(role))).toBe(expected);
  });

  it("uses the highest-priority assigned role for multiple-role users", () => {
    expect(defaultLandingPath(user("finance", "sales"))).toBe("/admin/finance");
    expect(defaultLandingPath(user("finance", "owner"))).toBe("/admin");
  });
});

describe("AeroFly permission-aware navigation", () => {
  it("shows only modules matching the database-loaded permission keys", () => {
    const visible = visibleWorkspaceNavigation(["finance.read", "reports.read"]);
    expect(visible.map((item) => item.key)).toEqual(["finance"]);
    expect(canAccessWorkspace(["finance.read"], "finance")).toBe(true);
    expect(canAccessWorkspace(["finance.read"], "sales")).toBe(false);
  });

  it("rejects external, protocol-relative and login-loop redirect targets", () => {
    expect(isSafeInternalPath("/admin/finance")).toBe(true);
    expect(isSafeInternalPath("//evil.example/path")).toBe(false);
    expect(isSafeInternalPath("https://evil.example")).toBe(false);
    expect(isSafeInternalPath("/login?next=/admin")).toBe(false);
    expect(isSafeInternalPath("/\\evil.example")).toBe(false);
  });
});
