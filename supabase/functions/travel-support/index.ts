import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "http://localhost:3000",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const BUCKET = "travel-documents";
const MAX_BYTES = 10 * 1024 * 1024;
const MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const DOCUMENT_TYPES = new Set(["passport", "photo", "identity_document", "proof_of_funds", "travel_itinerary", "invitation_letter", "application_form", "supporting_document", "other"]);
const STAFF_ROLES = ["owner", "admin", "manager", "customer_care", "counsellor", "staff"];
const MANAGER_ROLES = ["owner", "admin", "manager"];

type Json = Record<string, unknown>;
const json = (status: number, body: Json) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const fail = (message: string, status = 400) => json(status, { error: message });
const str = (v: unknown, max = 2000) => typeof v === "string" ? v.trim().slice(0, max) : "";
const num = (v: unknown) => Number.isSafeInteger(Number(v)) ? Number(v) : null;
const safeName = (v: string) => v.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "document";

function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

function clients(req: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) throw new Error("Supabase function secrets are not configured");
  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Authentication required");
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const adminClient = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  return { userClient, adminClient };
}

async function requireUser(userClient: SupabaseClient): Promise<User> {
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new Error("Invalid or expired session");
  return data.user;
}

async function hasRole(admin: SupabaseClient, userId: string, roles: string[]) {
  const { data, error } = await admin.rpc("has_any_role", { requested_roles: roles, requested_user: userId });
  if (error) throw new Error("Unable to verify permissions");
  return data === true;
}

async function ownsApplication(admin: SupabaseClient, applicationId: number, userId: string) {
  const { data, error } = await admin.from("travel_applications").select("id,customer_auth_id,assigned_auth_id,organization_id,status,type,reference").eq("id", applicationId).maybeSingle();
  if (error || !data) return null;
  if (data.customer_auth_id === userId) return { application: data, mode: "customer" as const };
  const { data: staffCanAccess, error: accessError } = await admin.rpc("phase8_staff_can_access_application", { p_application_id: applicationId, p_user: userId });
  if (accessError) throw new Error("Unable to verify application access");
  return staffCanAccess ? { application: data, mode: "staff" as const } : null;
}

async function ownsTicket(admin: SupabaseClient, ticketId: number, userId: string) {
  const { data, error } = await admin.from("support_tickets").select("*").eq("id", ticketId).maybeSingle();
  if (error || !data) return null;
  if (data.customer_auth_id === userId) return { ticket: data, mode: "customer" as const };
  if (await hasRole(admin, userId, ["owner", "admin"])) return { ticket: data, mode: "staff" as const };
  if (data.assigned_to === userId && await hasRole(admin, userId, STAFF_ROLES)) return { ticket: data, mode: "staff" as const };
  if (!data.organization_id && await hasRole(admin, userId, MANAGER_ROLES)) {
    const { data: membership, error: membershipError } = await admin.from("organization_memberships").select("user_id").eq("user_id", userId).eq("status", "active").limit(1).maybeSingle();
    if (membershipError) throw new Error("Unable to verify manager organization scope");
    if (membership) return { ticket: data, mode: "staff" as const };
  }
  if (data.organization_id) {
    const { data: member, error: memberError } = await admin.rpc("is_organization_member", { requested_organization: data.organization_id, requested_user: userId });
    if (memberError) throw new Error("Unable to verify organization access");
    if (member && await hasRole(admin, userId, STAFF_ROLES)) return { ticket: data, mode: "staff" as const };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);
  try {
    const { userClient, adminClient } = clients(req);
    const user = await requireUser(userClient);
    const body = await req.json() as Json;
    const action = str(body.action, 80);

    if (action === "create_application") {
      const type = str(body.type, 20);
      const applicantName = str(body.applicantName, 160);
      const destinationCountry = str(body.destinationCountry, 160);
      const visaType = str(body.visaType, 120);
      if (!(["visa", "passport"] as string[]).includes(type)) return fail("Application type must be visa or passport");
      if (applicantName.length < 2) return fail("Applicant name is required");
      if (type === "visa" && !destinationCountry) return fail("Destination country is required for visa assistance");
      const { data, error } = await userClient.rpc("phase8_create_travel_application_safe", {
        p_type: type,
        p_applicant_name: applicantName,
        p_destination_country: destinationCountry || null,
        p_visa_type: visaType || null,
        p_phone: str(body.phone, 40) || null,
        p_nationality: str(body.nationality, 120) || null,
        p_travel_date: str(body.travelDate, 120) || null,
        p_customer_notes: str(body.customerNotes, 4000) || null,
        p_application_data: body.applicationData && typeof body.applicationData === "object" && !Array.isArray(body.applicationData) ? body.applicationData : {},
        p_urgency: body.urgency === "urgent" ? "urgent" : "standard",
      });
      if (error || !data) return fail(error?.message ?? "Unable to create application", error?.code === "42501" ? 403 : 400);
      const application = data as Record<string, unknown>;
      return json(201, { application: {
        id: application.id, reference: application.reference, type: application.type, status: application.status,
        applicantName: application.applicantName, destinationCountry: application.destinationCountry,
        visa_type: application.visa_type, createdAt: application.createdAt, submitted_at: application.submitted_at,
      }, disclaimer: "AeroFly provides application assistance only. Visa or passport decisions and processing timelines are determined by the relevant government authority; approval is not guaranteed." });
    }

    if (action === "set_application_status") {
      const applicationId = num(body.applicationId);
      const status = str(body.status, 40);
      if (!applicationId || !["draft", "submitted", "under_review", "action_required", "approved", "rejected", "completed", "cancelled"].includes(status)) return fail("Invalid application or status");
      const access = await ownsApplication(adminClient, applicationId, user.id);
      if (!access) return fail("Application not found or access denied", 404);
      const { data, error } = await userClient.rpc("phase8_set_application_status_safe", { p_application_id: applicationId, p_status: status, p_customer_message: str(body.customerMessage, 2000) || null });
      if (error) return fail(error.message, error.code === "42501" ? 403 : 400);
      const application = data as Record<string, unknown>;
      return json(200, { application: {
        id: application.id, reference: application.reference, type: application.type, status: application.status,
        applicantName: application.applicantName, destinationCountry: application.destinationCountry,
        submitted_at: application.submitted_at, completed_at: application.completed_at,
      } });
    }

    if (action === "staff_list_organizations") {
      const isGlobalAdmin = await hasRole(adminClient, user.id, ["owner", "admin"]);
      if (!isGlobalAdmin && !(await hasRole(adminClient, user.id, ["manager"]))) return fail("Manager permission required", 403);
      if (isGlobalAdmin) {
        const { data, error } = await adminClient.from("organizations").select("id,name,slug").order("name").limit(100);
        if (error) return fail("Unable to load organizations", 500);
        return json(200, { organizations: data ?? [] });
      }
      const { data: memberships, error: membershipError } = await adminClient.from("organization_memberships")
        .select("organization_id").eq("user_id", user.id).eq("status", "active");
      if (membershipError) return fail("Unable to load manager organization scope", 500);
      const ids = [...new Set((memberships ?? []).map((m: { organization_id: string }) => m.organization_id))];
      if (!ids.length) return json(200, { organizations: [] });
      const { data, error } = await adminClient.from("organizations").select("id,name,slug").in("id", ids).order("name");
      if (error) return fail("Unable to load organizations", 500);
      return json(200, { organizations: data ?? [] });
    }

    if (action === "staff_list_assignees") {
      if (!(await hasRole(adminClient, user.id, STAFF_ROLES))) return fail("Staff permission required", 403);
      const organizationId = str(body.organizationId, 64);
      if (!organizationId) return fail("Organization is required");
      const isGlobalAdmin = await hasRole(adminClient, user.id, ["owner", "admin"]);
      if (!isGlobalAdmin) {
        const { data: member, error: memberError } = await adminClient.rpc("is_organization_member", { requested_organization: organizationId, requested_user: user.id });
        if (memberError || member !== true) return fail("Organization access denied", 403);
      }
      const { data: memberships, error: membershipError } = await adminClient.from("organization_memberships")
        .select("user_id,job_title,department_id")
        .eq("organization_id", organizationId).eq("status", "active").limit(250);
      if (membershipError) return fail("Unable to load organization staff", 500);
      const ids = (memberships ?? []).map((m: { user_id: string }) => m.user_id);
      if (!ids.length) return json(200, { members: [] });
      const { data: profiles, error: profileError } = await adminClient.from("profiles")
        .select("id,full_name").in("id", ids).order("full_name");
      if (profileError) return fail("Unable to load staff profiles", 500);
      const profileById = new Map<string, { id: string; full_name: string | null }>(
        (profiles ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p] as const),
      );
      return json(200, { members: (memberships ?? []).map((m: { user_id: string; job_title: string | null; department_id: string | null }) => ({
        id: m.user_id, fullName: profileById.get(m.user_id)?.full_name || "Team member", jobTitle: m.job_title, departmentId: m.department_id,
      })).filter((m: { id: string }) => m.id) });
    }

    if (action === "staff_assign_application") {
      if (!(await hasRole(adminClient, user.id, STAFF_ROLES))) return fail("Staff permission required", 403);
      const applicationId = num(body.applicationId);
      const assignedTo = str(body.assignedTo, 64);
      const organizationId = str(body.organizationId, 64);
      if (!applicationId || !assignedTo) return fail("Application and assignee are required");
      if (!(await hasRole(adminClient, assignedTo, STAFF_ROLES))) return fail("Assignee must have an authorized staff role", 400);
      const access = await ownsApplication(adminClient, applicationId, user.id);
      if (!access || access.mode !== "staff") return fail("Application not found or access denied", 404);
      if (!(await hasRole(adminClient, user.id, MANAGER_ROLES))) {
        const { data: current } = await adminClient.from("travel_applications").select("assigned_auth_id,organization_id").eq("id", applicationId).single();
        if (current?.assigned_auth_id !== user.id) return fail("Only managers or the assigned staff member can reassign this case", 403);
      }
      const isGlobalAdmin = await hasRole(adminClient, user.id, ["owner", "admin"]);
      if (!isGlobalAdmin) {
        const { data: actorMembership, error: actorMembershipError } = await adminClient.rpc("is_organization_member", { requested_organization: organizationId, requested_user: user.id });
        if (actorMembershipError || actorMembership !== true) return fail("You may only assign cases within your own organization", 403);
      }
      const { data, error } = await userClient.rpc("phase8_staff_assign_application", {
        p_application_id: applicationId, p_assigned_to: assignedTo, p_organization_id: organizationId,
      });
      if (error || !data) return fail(error?.message ?? "Unable to assign case", error?.code === "42501" ? 403 : 400);
      return json(200, { application: data });
    }

    if (action === "staff_add_checklist_item" || action === "staff_request_information") {
      if (!(await hasRole(adminClient, user.id, STAFF_ROLES))) return fail("Staff permission required", 403);
      const applicationId = num(body.applicationId);
      const label = str(body.label, 255);
      const itemKey = str(body.itemKey, 120) || crypto.randomUUID();
      if (!applicationId || label.length < 2) return fail("Application and checklist label are required");
      const access = await ownsApplication(adminClient, applicationId, user.id);
      if (!access || access.mode !== "staff") return fail("Application not found or access denied", 404);
      const { data, error } = await userClient.rpc("phase8_staff_add_checklist_item", {
        p_application_id: applicationId, p_label: label, p_item_key: itemKey,
        p_required: body.required !== false, p_notes: str(body.notes, 2000) || null,
        p_request_customer: action === "staff_request_information",
      });
      if (error || !data) return fail(error?.message ?? "Unable to update checklist", error?.code === "42501" ? 403 : 400);
      return json(201, { checklistItem: data });
    }

    if (action === "staff_update_checklist_item") {
      if (!(await hasRole(adminClient, user.id, STAFF_ROLES))) return fail("Staff permission required", 403);
      const checklistItemId = num(body.checklistItemId);
      const status = str(body.status, 30);
      if (!checklistItemId || !["pending", "received", "approved", "rejected", "not_applicable"].includes(status)) return fail("Invalid checklist item or status");
      const { data: item, error: itemError } = await adminClient.from("application_checklist_items")
        .select("id,applicationId,label").eq("id", checklistItemId).maybeSingle();
      if (itemError || !item) return fail("Checklist item not found", 404);
      const access = await ownsApplication(adminClient, item.applicationId, user.id);
      if (!access || access.mode !== "staff") return fail("Application not found or access denied", 404);
      const { data, error } = await userClient.rpc("phase8_staff_update_checklist_item", {
        p_checklist_item_id: checklistItemId, p_status: status,
        p_notes: body.notes == null ? null : str(body.notes, 2000),
      });
      if (error) return fail(error.message, error.code === "42501" ? 403 : 400);
      return json(200, { checklistItem: data });
    }

    if (action === "staff_review_document") {
      if (!(await hasRole(adminClient, user.id, STAFF_ROLES))) return fail("Staff permission required", 403);
      const documentId = num(body.documentId);
      const status = str(body.status, 30);
      const reason = str(body.reason, 2000);
      if (!documentId || !["under_review", "approved", "rejected"].includes(status)) return fail("Invalid document review request");
      const { data: doc, error: docError } = await adminClient.from("application_documents")
        .select("id,applicationId,storage_path,fileKey").eq("id", documentId).maybeSingle();
      if (docError || !doc) return fail("Document not found", 404);
      const access = await ownsApplication(adminClient, doc.applicationId, user.id);
      if (!access || access.mode !== "staff") return fail("Application not found or access denied", 404);
      const { data, error } = await userClient.rpc("phase8_staff_review_document_safe", {
        p_document_id: documentId, p_status: status, p_rejection_reason: reason || null,
      });
      if (error) return fail(error.message, error.code === "42501" ? 403 : 400);
      return json(200, { document: data });
    }

    if (action === "staff_add_internal_note") {
      const applicationId = num(body.applicationId);
      const note = str(body.note, 10000);
      if (!applicationId || note.length < 1) return fail("Application and note are required");
      const access = await ownsApplication(adminClient, applicationId, user.id);
      if (!access || access.mode !== "staff" || !(await hasRole(adminClient, user.id, STAFF_ROLES))) return fail("Staff access required", 403);
      const { data, error } = await adminClient.from("travel_application_notes").insert({ application_id: applicationId, author_id: user.id, note, is_internal: true }).select("id,application_id,author_id,note,created_at").single();
      if (error) return fail(error.message, 400);
      return json(201, { note: data });
    }

    if (action === "create_document_upload") {
      const applicationId = num(body.applicationId);
      const fileName = str(body.fileName, 255);
      const mimeType = str(body.mimeType, 100).toLowerCase();
      const sizeBytes = num(body.sizeBytes);
      const documentType = str(body.documentType, 120);
      const expiresOnInput = str(body.expiresOn, 10);
      const expiryTimestamp = expiresOnInput ? Date.parse(`${expiresOnInput}T00:00:00Z`) : Number.NaN;
      const expiresOn = /^\d{4}-\d{2}-\d{2}$/.test(expiresOnInput)
        && Number.isFinite(expiryTimestamp)
        && new Date(expiryTimestamp).toISOString().slice(0, 10) === expiresOnInput
        ? expiresOnInput : null;
      const checklistItemId = body.checklistItemId == null ? null : num(body.checklistItemId);
      if (!applicationId || !fileName || !DOCUMENT_TYPES.has(documentType) || !sizeBytes || sizeBytes < 1 || sizeBytes > MAX_BYTES || !MIME_TYPES.has(mimeType)) return fail("Invalid document metadata. Choose a supported document category; allowed files are PDF, JPEG, PNG, WebP up to 10 MB.");
      if (expiresOnInput && !expiresOn) return fail("Expiry date must be a valid YYYY-MM-DD date");
      const access = await ownsApplication(adminClient, applicationId, user.id);
      if (!access || access.mode !== "customer") return fail("Only the application owner can upload requested documents", 403);
      if (access.mode === "customer" && !["draft", "submitted", "action_required", "under_review"].includes(access.application.status)) return fail("This application no longer accepts documents", 409);
      if (checklistItemId) {
        const { data: item } = await adminClient.from("application_checklist_items").select("id").eq("id", checklistItemId).eq("applicationId", applicationId).maybeSingle();
        if (!item) return fail("Checklist item does not belong to this application", 400);
      }
      let finalChecklistItemId = checklistItemId;
      let finalDocumentType = documentType;
      let finalExpiresOn = expiresOn || null;
      const replacesDocumentId = body.replacesDocumentId == null ? null : num(body.replacesDocumentId);
      if (replacesDocumentId) {
        const { data: prior, error: priorError } = await adminClient.from("application_documents")
          .select("id,applicationId,checklistItemId,documentType,uploaded_by,expires_on,status")
          .eq("id", replacesDocumentId).maybeSingle();
        if (priorError || !prior || prior.applicationId !== applicationId) return fail("Replacement target does not belong to this application", 400);
        if (prior.status !== "rejected") return fail("Only a rejected document can be replaced", 409);
        finalChecklistItemId = prior.checklistItemId;
        finalDocumentType = prior.documentType;
        finalExpiresOn = expiresOn || prior.expires_on || null;
      }
      if (finalChecklistItemId) {
        const { data: item, error: itemError } = await adminClient.from("application_checklist_items")
          .select("id").eq("id", finalChecklistItemId).eq("applicationId", applicationId).maybeSingle();
        if (itemError || !item) return fail("Checklist item does not belong to this application", 400);
      }
      const { data: legacyUser } = await adminClient.from("users").select("id").eq("openId", `supabase:${user.id}`).maybeSingle();
      let nextVersion = 1;
      let doc: { id: number } | null = null;
      let insertError: { code?: string; message: string } | null = null;
      // Unique indexes protect concurrent uploads; retry the version allocation on conflict.
      for (let attempt = 0; attempt < 3; attempt++) {
        let versionQuery = adminClient.from("application_documents")
          .select("version_number").eq("applicationId", applicationId).eq("documentType", finalDocumentType);
        versionQuery = finalChecklistItemId == null
          ? versionQuery.is("checklistItemId", null)
          : versionQuery.eq("checklistItemId", finalChecklistItemId);
        const { data: priorVersions, error: versionsError } = await versionQuery.order("version_number", { ascending: false }).limit(1);
        if (versionsError) return fail("Unable to determine document version", 500);
        nextVersion = Number(priorVersions?.[0]?.version_number ?? 0) + 1;
        const { data: inserted, error } = await adminClient.from("application_documents").insert({
          "applicationId": applicationId, "userId": legacyUser?.id ?? null, "checklistItemId": finalChecklistItemId,
          "documentType": finalDocumentType, "fileName": safeName(fileName), fileKey: "pending", fileUrl: null,
          mimeType, sizeBytes, status: "under_review", storage_path: "pending", uploaded_by: user.id, version_number: nextVersion,
          expires_on: finalExpiresOn,
        }).select("id").single();
        if (!error && inserted) { doc = inserted; insertError = null; break; }
        insertError = error;
        if (error?.code !== "23505") break;
      }
      if (insertError || !doc) return fail(insertError?.message ?? "Unable to reserve document version", insertError?.code === "23505" ? 409 : 400);
      const path = `${user.id}/${applicationId}/${doc.id}/${crypto.randomUUID()}-${safeName(fileName)}`;
      const { error: updateError } = await adminClient.from("application_documents").update({ fileKey: path, storage_path: path }).eq("id", doc.id);
      if (updateError) {
        await adminClient.from("application_documents").delete().eq("id", doc.id);
        return fail("Unable to initialize document upload", 500);
      }
      const { data: signed, error: signError } = await adminClient.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
      if (signError || !signed) {
        await adminClient.from("application_documents").delete().eq("id", doc.id);
        return fail("Unable to create secure upload URL", 500);
      }
      return json(201, { documentId: doc.id, versionNumber: nextVersion, path, token: signed.token, signedUrl: signed.signedUrl, expiresInSeconds: 300 });
    }

    if (action === "complete_document_upload") {
      const documentId = num(body.documentId);
      if (!documentId) return fail("Document ID is required");
      const { data: doc, error } = await adminClient.from("application_documents").select("id,applicationId,checklistItemId,storage_path,fileKey,fileName,mimeType,sizeBytes,uploaded_by,version_number,upload_completed_at").eq("id", documentId).maybeSingle();
      if (error || !doc) return fail("Document not found", 404);
      const access = await ownsApplication(adminClient, doc.applicationId, user.id);
      if (!access || access.mode !== "customer" || doc.uploaded_by !== user.id) return fail("Document not found or access denied", 404);
      const path = doc.storage_path || doc.fileKey;
      const parts = path.split("/");
      const folder = parts.slice(0, 3).join("/");
      const { data: objects, error: listError } = await adminClient.storage.from(BUCKET).list(folder, { search: parts[3], limit: 20 });
      if (listError || !objects?.some((object) => object.name === parts[3])) return fail("Uploaded object was not found; upload the file before completing", 409);
      if (doc.upload_completed_at) return json(200, { documentId, status: "uploaded", versionNumber: doc.version_number, alreadyCompleted: true });
      // Validate actual stored bytes; do not trust browser-supplied Content-Type or size.
      const { data: blob, error: downloadError } = await adminClient.storage.from(BUCKET).download(path);
      if (downloadError || !blob) return fail("Unable to inspect uploaded document", 400);
      if (blob.size < 1 || blob.size > MAX_BYTES) {
        await adminClient.storage.from(BUCKET).remove([path]);
        await adminClient.from("application_documents").delete().eq("id", documentId).eq("uploaded_by", user.id);
        return fail("Document exceeds the 10 MB limit", 413);
      }
      const actualMime = sniffMime(new Uint8Array(await blob.slice(0, 32).arrayBuffer()));
      if (!actualMime || !MIME_TYPES.has(actualMime) || actualMime !== doc.mimeType) {
        await adminClient.storage.from(BUCKET).remove([path]);
        await adminClient.from("application_documents").delete().eq("id", documentId).eq("uploaded_by", user.id);
        return fail("File content does not match an allowed file type or the declared type", 415);
      }
      const fullBytes = new Uint8Array(await blob.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", fullBytes);
      const checksum = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
      const { data: finalized, error: finalizeError } = await adminClient.rpc("phase8_finalize_document_upload", {
        p_document_id: documentId, p_actor_id: user.id, p_size_bytes: blob.size,
        p_mime_type: actualMime, p_checksum_sha256: checksum,
      });
      if (finalizeError || !finalized) return fail(finalizeError?.message ?? "Unable to finalize document metadata", finalizeError?.code === "42501" ? 403 : 500);
      return json(200, finalized as Json);
    }

    if (action === "create_document_download") {
      const documentId = num(body.documentId);
      if (!documentId) return fail("Document ID is required");
      const { data: doc, error } = await adminClient.from("application_documents").select("id,applicationId,storage_path,fileKey,fileName,upload_completed_at").eq("id", documentId).maybeSingle();
      if (error || !doc) return fail("Document not found", 404);
      const access = await ownsApplication(adminClient, doc.applicationId, user.id);
      if (!access) return fail("Document not found", 404);
      const path = doc.storage_path || doc.fileKey;
      if (!doc.upload_completed_at || !path || path === "pending" || path.startsWith("http://") || path.startsWith("https://")) return fail("Document upload has not been completed", 409);
      const { data: signed, error: signError } = await adminClient.storage.from(BUCKET).createSignedUrl(path, 60);
      if (signError || !signed) return fail("Unable to authorize document download", 500);
      return json(200, { signedUrl: signed.signedUrl, expiresInSeconds: 60, fileName: doc.fileName });
    }

    if (action === "create_support_ticket") {
      const subject = str(body.subject, 200);
      const message = str(body.message, 10000);
      const category = str(body.category, 40) || "general";
      const priority = str(body.priority, 20) || "normal";
      const applicationId = body.applicationId == null ? null : num(body.applicationId);
      const bookingId = body.bookingId == null ? null : num(body.bookingId);
      if (subject.length < 3 || message.length < 1) return fail("A subject and message are required");
      if (!["general", "booking", "payment", "visa", "passport", "documents", "cancellation", "complaint"].includes(category)) return fail("Invalid ticket category");
      if (!["low", "normal", "high"].includes(priority)) return fail("Invalid customer ticket priority");
      const { data: ticket, error: ticketError } = await userClient.rpc("phase8_create_support_ticket", {
        p_subject: subject, p_message: message, p_category: category, p_priority: priority,
        p_application_id: applicationId, p_booking_id: bookingId,
      });
      if (ticketError || !ticket) return fail(ticketError?.message ?? "Unable to create support ticket", ticketError?.code === "42501" ? 403 : 400);
      return json(201, { ticket });
    }

    if (action === "reply_support_ticket") {
      const ticketId = num(body.ticketId);
      const message = str(body.message, 10000);
      const internal = body.internal === true;
      if (!ticketId || !message) return fail("Ticket and message are required");
      const access = await ownsTicket(adminClient, ticketId, user.id);
      if (!access) return fail("Ticket not found or access denied", 404);
      if (access.mode === "staff" && !(await hasRole(adminClient, user.id, STAFF_ROLES))) return fail("Staff access required", 403);
      if (access.mode === "customer" && (internal || ["resolved", "closed"].includes(access.ticket.status))) return fail("This ticket cannot accept a customer reply", 403);
      if (internal && (access.mode !== "staff" || !(await hasRole(adminClient, user.id, STAFF_ROLES)))) return fail("Internal notes are staff-only", 403);
      const { data, error } = await userClient.rpc("phase8_add_support_ticket_message", {
        p_ticket_id: ticketId, p_body: message, p_internal: internal,
      });
      if (error || !data) return fail(error?.message ?? "Unable to save ticket message", error?.code === "42501" ? 403 : 400);
      return json(201, { message: data });
    }

    if (action === "update_support_ticket") {
      const ticketId = num(body.ticketId);
      if (!ticketId) return fail("Ticket ID is required");
      const access = await ownsTicket(adminClient, ticketId, user.id);
      if (!access || access.mode !== "staff" || !(await hasRole(adminClient, user.id, STAFF_ROLES))) return fail("Staff ticket access required", 403);
      const { data, error } = await userClient.rpc("phase8_update_support_ticket", {
        p_ticket_id: ticketId,
        p_status: body.status == null ? null : str(body.status, 30),
        p_priority: body.priority == null ? null : str(body.priority, 20),
        p_assigned_to: body.assignedTo == null ? null : str(body.assignedTo, 64),
        p_organization_id: body.organizationId == null ? null : str(body.organizationId, 64),
      });
      if (error) return fail(error.message, error.code === "42501" ? 403 : 400);
      return json(200, { ticket: data });
    }

    return fail("Unknown action", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    const status = message.includes("Authentication") || message.includes("session") ? 401 : 500;
    return fail(message, status);
  }
});
