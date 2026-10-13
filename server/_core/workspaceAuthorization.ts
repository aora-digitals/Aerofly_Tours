import type { WorkspacePermission } from "@shared/types";
import { TRPCError } from "@trpc/server";
import { createServerSupabaseClient } from "./supabase";

const WORKSPACE_PERMISSION_KEYS: Record<WorkspacePermission, readonly string[]> = {
  overview: ["admin.dashboard.read"],
  team: ["employees.read"],
  finance: ["finance.read"],
  catalogue: ["tours.read"],
  enquiries: ["enquiries.read"],
  customers: ["customers.read"],
  bookings: ["bookings.read"],
  marketing: ["marketing.read", "tours.read"],
  reports: ["reports.read"],
  settings: ["settings.read", "settings.manage"],
  my_work: ["work.read", "enquiries.read", "bookings.read"],
  leads: ["enquiries.read"],
  quotes: ["bookings.read", "bookings.manage"],
  crm: ["enquiries.read"],
};

/**
 * Server-side authorization backed by the Supabase permission catalogue.
 * Fail closed on missing tokens, RLS errors, or RPC errors. This is used in
 * addition to (never instead of) RLS on the underlying data operations.
 */
export async function hasDatabasePermission(
  accessToken: string | null | undefined,
  permissionKeys: readonly string[],
): Promise<boolean> {
  if (!accessToken || permissionKeys.length === 0) return false;

  let client;
  try {
    client = createServerSupabaseClient(accessToken);
  } catch {
    return false;
  }

  const { data: memberships, error: membershipError } = await client
    .from("organization_memberships")
    .select("organization_id")
    .eq("status", "active");

  if (membershipError) return false;
  const organizationIds = Array.from(new Set((memberships ?? [])
    .map((row) => row.organization_id)
    .filter((id): id is string => typeof id === "string")));
  const scopes: (string | null)[] = [null, ...organizationIds];

  for (const permission of permissionKeys) {
    for (const organizationId of scopes) {
      const { data, error } = await client.rpc("has_permission", {
        requested_permission: permission,
        requested_organization: organizationId,
      });
      if (!error && data === true) return true;
    }
  }
  return false;
}

export function hasDatabaseWorkspacePermission(
  accessToken: string | null | undefined,
  permission: WorkspacePermission,
): Promise<boolean> {
  return hasDatabasePermission(accessToken, WORKSPACE_PERMISSION_KEYS[permission]);
}

export async function requireDatabasePermission(
  accessToken: string | null | undefined,
  permissionKeys: readonly string[],
  message = "You do not have permission to perform this action.",
): Promise<void> {
  if (!(await hasDatabasePermission(accessToken, permissionKeys))) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }
}

/**
 * For legacy server procedures that still use service-role database helpers,
 * require a global (organization_id IS NULL) permission. Organization-scoped
 * staff must use RLS-scoped Supabase queries or the audited Edge Functions.
 */
export async function hasGlobalDatabasePermission(
  accessToken: string | null | undefined,
  permissionKeys: readonly string[],
): Promise<boolean> {
  if (!accessToken || permissionKeys.length === 0) return false;
  let client;
  try { client = createServerSupabaseClient(accessToken); } catch { return false; }
  for (const permission of permissionKeys) {
    const { data, error } = await client.rpc("has_permission", {
      requested_permission: permission,
      requested_organization: null,
    });
    if (!error && data === true) return true;
  }
  return false;
}
