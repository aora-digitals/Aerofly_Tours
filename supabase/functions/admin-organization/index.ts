import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const clean = (value: unknown, max = 160): string | null => {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s && s.length <= max ? s : null;
};
const slugOk = (value: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const sensitivePermissions = new Set([
  "roles.manage", "organization.manage", "employees.manage", "settings.manage",
  "finance.manage", "refunds.manage", "audit.read", "finance.read", "settings.read",
]);

Deno.serve(async (req) => {
  // CORS is not authentication. The function still validates the bearer token
  // with Supabase Auth below and checks database-backed permissions per action.
  const configuredOrigins = (Deno.env.get("ADMIN_CORS_ORIGINS") ?? Deno.env.get("ADMIN_CORS_ORIGIN") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const isProduction = Deno.env.get("APP_ENV") === "production";
  const allowedOrigins = new Set([
    ...configuredOrigins,
    ...(isProduction ? [] : ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173"]),
  ]);
  const requestOrigin = req.headers.get("Origin");
  const originAllowed = !requestOrigin || allowedOrigins.has(requestOrigin);
  const corsHeaders: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
  if (requestOrigin && originAllowed) corsHeaders["Access-Control-Allow-Origin"] = requestOrigin;
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  const fail = (message: string, status: number) => response({ error: message }, status);

  // OPTIONS must be answered before authentication because browsers do not send
  // the bearer token on preflight requests.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: originAllowed ? 204 : 403, headers: corsHeaders });
  }
  if (!originAllowed) return fail("Origin not allowed", 403);
  if (req.method !== "POST") return fail("Method not allowed", 405);
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return fail("Authentication required", 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return fail("Server configuration is incomplete", 500);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  const actor = authData.user;
  if (authError || !actor) return fail("Invalid session", 401);

  let body: Json;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("Invalid request body", 400);
    body = parsed as Json;
  } catch { return fail("Request body must be valid JSON", 400); }

  const action = clean(body.action, 64);
  const orgId = body.organization_id == null ? null : body.organization_id;
  if (orgId !== null && !uuid(orgId)) return fail("Invalid organization_id", 400);
  const permissionByAction: Record<string, string> = {
    create_organization: "organization.manage", update_organization: "organization.manage",
    upsert_department: "organization.manage", set_department_manager: "organization.manage",
    set_department_active: "organization.manage", set_membership: "employees.manage",
    update_employee: "employees.manage", invite_employee: "employees.manage",
    assign_role: "roles.manage", remove_role: "roles.manage",
    assign_permission: "roles.manage", remove_permission: "roles.manage",
    save_setting: "settings.manage",
  };
  const required = action ? permissionByAction[action] : undefined;
  if (!action || !required) return fail("Unsupported administrative action", 400);
  const { data: allowed, error: permissionError } = await userClient.rpc("has_permission", {
    requested_permission: required,
    requested_organization: orgId,
  });
  if (permissionError) return fail("Unable to verify permission", 500);
  if (allowed !== true) return fail("Permission denied", 403);

  let result: unknown = null;
  const entityType = action;
  let entityId = "unknown";
  let auditOrgId: string | null = typeof orgId === "string" ? orgId : null;
  let metadata: Json = {};
  const writeAudit = async () => {
    const { error } = await adminClient.from("admin_audit_log").insert({
      actor_id: actor.id, action, entity_type: entityType, entity_id: entityId,
      organization_id: auditOrgId, metadata,
    });
    if (error) throw new Error("Change was applied but audit recording failed; contact an administrator immediately");
  };
  const rpcError = (error: { message: string; code?: string } | null) => {
    if (error) throw new Error(error.code === "42501" ? "Permission denied" : error.message);
  };

  try {
    if (action === "create_organization" || action === "update_organization") {
      const name = clean(body.name, 160);
      const slug = clean(body.slug, 120)?.toLowerCase();
      if (!name || !slug || !slugOk(slug)) return fail("Valid organization name and slug are required", 400);
      if (action === "create_organization") {
        const { data: isOwner, error } = await userClient.rpc("has_role", { requested_role: "owner" });
        if (error) return fail("Unable to verify organization creation access", 500);
        if (isOwner !== true) return fail("Only an owner may create an organization", 403);
        const { data, error: insertError } = await adminClient.from("organizations").insert({ name, slug }).select("id,name,slug").single();
        if (insertError) return fail(insertError.message, 400);
        const { error: membershipError } = await adminClient.from("organization_memberships").upsert({
          user_id: actor.id, organization_id: data.id, status: "active", job_title: "Organization owner", updated_by: actor.id,
        }, { onConflict: "user_id,organization_id" });
        if (membershipError) return fail("Organization was created but the creator membership could not be established; repair the membership before use", 500);
        result = data; entityId = data.id; auditOrgId = data.id; metadata = { name, slug, creator_membership_created: true };
      } else {
        if (!uuid(body.id)) return fail("Organization id is required", 400);
        const { data, error: updateError } = await adminClient.from("organizations").update({ name, slug }).eq("id", body.id).select("id,name,slug").single();
        if (updateError) return fail(updateError.message, 400);
        result = data; entityId = data.id; auditOrgId = data.id; metadata = { name, slug };
      }
    } else if (action === "upsert_department") {
      if (!uuid(orgId)) return fail("organization_id is required", 400);
      const name = clean(body.name, 120);
      const slug = clean(body.slug, 120)?.toLowerCase();
      if (!name || !slug || !slugOk(slug)) return fail("Valid department name and slug are required", 400);
      let query;
      if (body.id != null) {
        if (!uuid(body.id)) return fail("Invalid department id", 400);
        query = adminClient.from("departments").update({ name, slug }).eq("id", body.id).eq("organization_id", orgId);
      } else query = adminClient.from("departments").insert({ organization_id: orgId, name, slug });
      const { data, error } = await query.select("id,organization_id,name,slug,is_active,manager_user_id").single();
      if (error) return fail(error.message, 400);
      result = data; entityId = data.id; metadata = { name, slug };
    } else if (action === "set_department_manager" || action === "set_department_active") {
      if (!uuid(orgId) || !uuid(body.department_id)) return fail("Organization and department ids are required", 400);
      const patch: Json = {};
      if (action === "set_department_manager") {
        if (body.manager_user_id !== null && !uuid(body.manager_user_id)) return fail("Invalid manager user id", 400);
        if (body.manager_user_id) {
          const { data: membership, error } = await adminClient.from("organization_memberships").select("user_id")
            .eq("user_id", body.manager_user_id).eq("organization_id", orgId).eq("status", "active").maybeSingle();
          if (error) return fail("Unable to validate manager", 500);
          if (!membership) return fail("Manager must be an active employee in this organization", 400);
        }
        patch.manager_user_id = body.manager_user_id;
      } else {
        if (typeof body.is_active !== "boolean") return fail("is_active must be boolean", 400);
        patch.is_active = body.is_active;
      }
      const { data, error } = await adminClient.from("departments").update(patch)
        .eq("id", body.department_id).eq("organization_id", orgId)
        .select("id,organization_id,name,slug,is_active,manager_user_id").single();
      if (error) return fail(error.message, 400);
      result = data; entityId = data.id; metadata = patch;
    } else if (action === "set_membership") {
      if (!uuid(orgId) || !uuid(body.user_id)) return fail("Organization and user ids are required", 400);
      const status = body.status;
      if (!(["active", "inactive", "invited"] as unknown[]).includes(status)) return fail("Invalid membership status", 400);
      const departmentId = body.department_id == null ? null : body.department_id;
      if (departmentId !== null && !uuid(departmentId)) return fail("Invalid department id", 400);
      if (departmentId) {
        const { data: department, error } = await adminClient.from("departments").select("id")
          .eq("id", departmentId).eq("organization_id", orgId).maybeSingle();
        if (error) return fail("Unable to validate department", 500);
        if (!department) return fail("Department does not belong to the selected organization", 400);
      }
      const { data, error } = await userClient.rpc("admin_set_membership", {
        p_user_id: body.user_id, p_organization_id: orgId, p_department_id: departmentId,
        p_status: status, p_job_title: body.job_title == null ? null : clean(body.job_title, 120),
      });
      rpcError(error);
      result = data; entityId = String(body.user_id); metadata = { department_id: departmentId, status };
    } else if (action === "update_employee") {
      if (!uuid(orgId) || !uuid(body.user_id)) return fail("Organization and user ids are required", 400);
      const patch: Json = { updated_by: actor.id };
      if (body.reports_to_user_id !== undefined) {
        if (body.reports_to_user_id !== null && !uuid(body.reports_to_user_id)) return fail("Invalid reporting manager", 400);
        patch.reports_to_user_id = body.reports_to_user_id;
      }
      if (body.employee_code !== undefined) patch.employee_code = body.employee_code === null ? null : clean(body.employee_code, 64);
      if (body.employment_type !== undefined) {
        if (!(["employee", "contractor", "intern", "director"] as unknown[]).includes(body.employment_type)) return fail("Invalid employment type", 400);
        patch.employment_type = body.employment_type;
      }
      if (body.joined_at !== undefined) {
        if (body.joined_at !== null && (typeof body.joined_at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.joined_at))) return fail("joined_at must be YYYY-MM-DD or null", 400);
        patch.joined_at = body.joined_at;
      }
      if (body.job_title !== undefined) patch.job_title = body.job_title === null ? null : clean(body.job_title, 120);
      if (Object.keys(patch).length === 1) return fail("No supported employee fields supplied", 400);
      const { data, error } = await adminClient.from("organization_memberships").update(patch)
        .eq("user_id", body.user_id).eq("organization_id", orgId)
        .select("user_id,organization_id,department_id,status,job_title,employee_code,employment_type,reports_to_user_id,joined_at").maybeSingle();
      if (error) return fail(error.message, 400);
      if (!data) return fail("Employee membership not found", 404);
      result = data; entityId = data.user_id; metadata = { updated_fields: Object.keys(patch).filter((key) => key !== "updated_by") };
    } else if (action === "invite_employee") {
      if (!uuid(orgId)) return fail("organization_id is required", 400);
      const email = clean(body.email, 320)?.toLowerCase();
      const fullName = clean(body.full_name, 160);
      const roleKey = clean(body.role_key, 80);
      const departmentId = body.department_id == null ? null : body.department_id;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || !roleKey) return fail("Valid email, full name and role are required", 400);
      if (roleKey === "customer") return fail("Customer cannot be assigned as an employee role", 400);
      if (departmentId !== null && !uuid(departmentId)) return fail("Invalid department id", 400);
      if (["owner", "admin"].includes(roleKey)) {
        const { data: isOwner, error } = await userClient.rpc("has_role", { requested_role: "owner" });
        if (error) return fail("Unable to verify owner permission", 500);
        if (isOwner !== true) return fail("Only an owner may invite an owner or administrator", 403);
      }
      if (departmentId) {
        const { data: department, error } = await adminClient.from("departments").select("id")
          .eq("id", departmentId).eq("organization_id", orgId).maybeSingle();
        if (error) return fail("Unable to validate department", 500);
        if (!department) return fail("Department does not belong to the organization", 400);
      }
      // Invitations must return to the account-setup screen, not the public homepage.
      // Configure APP_SITE_URL to the canonical app origin in each environment.
      const appSiteUrl = (Deno.env.get("APP_SITE_URL") ?? requestOrigin ?? "").replace(/\/+$/, "");
      let parsedAppUrl: URL;
      try { parsedAppUrl = new URL(appSiteUrl); } catch { return fail("APP_SITE_URL must be configured to the application origin", 500); }
      if (parsedAppUrl.protocol !== "https:" && parsedAppUrl.hostname !== "localhost" && parsedAppUrl.hostname !== "127.0.0.1") {
        return fail("APP_SITE_URL must use HTTPS outside local development", 500);
      }
      const workspaceByRole: Record<string, string> = {
        owner: "/admin", admin: "/admin/erp", super_admin: "/admin/erp",
        sales: "/admin/sales", crm: "/admin/sales", finance: "/admin/finance",
        marketing: "/admin/marketing", operations: "/admin/operations",
        tour_operations: "/admin/operations", support: "/admin/support",
        customer_support: "/admin/support", department_manager: "/admin/department",
        staff: "/admin/work",
      };
      const nextPath = workspaceByRole[roleKey] ?? "/admin/work";
      const redirectTo = `${appSiteUrl}/login?mode=invite&next=${encodeURIComponent(nextPath)}`;
      const { data: invite, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { full_name: fullName, phone: clean(body.phone, 40) },
      });
      if (inviteError || !invite.user) return fail(inviteError?.message ?? "Invitation failed", 400);
      const targetId = invite.user.id;
      const { error: profileError } = await adminClient.from("profiles").update({ full_name: fullName, phone: clean(body.phone, 40) }).eq("id", targetId);
      if (profileError) return fail("Invite sent but profile update failed; review the employee record", 500);
      const { error: membershipError } = await adminClient.from("organization_memberships").upsert({
        user_id: targetId, organization_id: orgId, department_id: departmentId,
        job_title: clean(body.job_title, 120), status: "active", updated_by: actor.id,
        joined_at: new Date().toISOString().slice(0, 10),
      }, { onConflict: "user_id,organization_id" });
      if (membershipError) return fail("Invite sent but membership creation failed; repair the membership before access is granted", 500);
      // New Auth identities receive the default customer role via the Phase 1 trigger.
      // Remove it before granting staff access, so this account cannot simultaneously act as a customer.
      const { data: customerRole } = await adminClient.from("roles").select("id").eq("key", "customer").maybeSingle();
      if (customerRole) await adminClient.from("user_roles").delete().eq("user_id", targetId).eq("role_id", customerRole.id);
      const { error: assignError } = await userClient.rpc("admin_assign_user_role", {
        p_user_id: targetId, p_role_key: roleKey, p_organization_id: orgId,
      });
      if (assignError) return fail("Invite and membership were created, but role assignment failed. Review the employee before enabling access.", 500);
      result = { user_id: targetId, email, organization_id: orgId, department_id: departmentId, role_key: roleKey, invited: true };
      entityId = targetId; metadata = { email, department_id: departmentId, role_key: roleKey };
    } else if (action === "assign_role" || action === "remove_role") {
      if (!uuid(body.user_id)) return fail("Valid user_id is required", 400);
      const roleKey = clean(body.role_key, 80);
      if (!roleKey || roleKey === "customer") return fail("A valid non-customer employee role is required", 400);
      if (["owner", "admin"].includes(roleKey)) {
        const { data: isOwner, error } = await userClient.rpc("has_role", { requested_role: "owner" });
        if (error) return fail("Unable to verify owner access", 500);
        if (isOwner !== true) return fail("Only an owner may change owner or administrator assignments", 403);
      }
      const { data, error } = await userClient.rpc(action === "assign_role" ? "admin_assign_user_role" : "admin_remove_user_role", {
        p_user_id: body.user_id, p_role_key: roleKey, p_organization_id: orgId,
      });
      rpcError(error);
      result = data; entityId = body.user_id; metadata = { role_key: roleKey, operation: action };
    } else if (action === "assign_permission" || action === "remove_permission") {
      const roleKey = clean(body.role_key, 80);
      const permissionKey = clean(body.permission_key, 120);
      if (!roleKey || !permissionKey) return fail("role_key and permission_key are required", 400);
      if (roleKey === "customer") return fail("Customer role permissions cannot be edited", 403);
      if ((["owner", "admin"].includes(roleKey) || sensitivePermissions.has(permissionKey))) {
        const { data: isOwner, error } = await userClient.rpc("has_role", { requested_role: "owner" });
        if (error) return fail("Unable to verify owner access", 500);
        if (isOwner !== true) return fail("Only an owner may change sensitive permissions", 403);
      }
      const { data, error } = await userClient.rpc("admin_set_role_permission", {
        p_role_key: roleKey, p_permission_key: permissionKey,
        p_grant: action === "assign_permission", p_organization_id: orgId,
      });
      rpcError(error);
      result = data; entityId = roleKey; metadata = { permission_key: permissionKey, operation: action };
    } else if (action === "save_setting") {
      if (!uuid(orgId)) return fail("organization_id is required", 400);
      const key = clean(body.setting_key, 100);
      if (!key || !/^[a-z][a-z0-9_.-]{1,99}$/.test(key)) return fail("Invalid setting key", 400);
      if (body.setting_value === undefined) return fail("setting_value is required", 400);
      const encoded = JSON.stringify(body.setting_value);
      if (encoded.length > 12000) return fail("Setting value exceeds 12 KB", 400);
      const { data, error } = await adminClient.from("organization_settings").upsert({
        organization_id: orgId, setting_key: key, setting_value: body.setting_value, updated_by: actor.id, updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id,setting_key" }).select("id,organization_id,setting_key,setting_value,updated_at").single();
      if (error) return fail(error.message, 400);
      result = data; entityId = `${orgId}:${key}`; metadata = { setting_key: key };
    }
    // These actions are audited by database triggers while auth.uid() is still the actor.
    // Other service-role writes need an explicit actor-attributed audit event here.
    if (!["set_membership", "assign_role", "remove_role", "assign_permission", "remove_permission"].includes(action)) {
      await writeAudit();
    }
    return response({ ok: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Administrative operation failed";
    const status = message === "Permission denied" ? 403 : 400;
    return fail(message, status);
  }
});
