import { createServerSupabaseClient } from "./_core/supabase";
import { getDb } from "./db";

export type CrmEnquiryStatus =
  | "new"
  | "assigned"
  | "contacted"
  | "follow_up"
  | "qualified"
  | "quotation"
  | "converted"
  | "confirmed"
  | "completed"
  | "lost"
  | "closed"
  | "cancelled";

export type CrmPriority = "low" | "normal" | "high";

function client(accessToken: string) {
  return createServerSupabaseClient(accessToken);
}

function fail(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

export async function getCrmDashboard(accessToken: string) {
  const db = client(accessToken);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const tomorrow = new Date(startOfToday);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    newEnquiries,
    pendingEnquiries,
    assignedEnquiries,
    followUpsDue,
    todayAppointments,
    pendingCallbacks,
    convertedEnquiries,
    lostEnquiries,
  ] = await Promise.all([
    db.from("enquiries").select("id", { count: "exact", head: true }).eq("status", "new"),
    db.from("enquiries").select("id", { count: "exact", head: true }).in("status", ["assigned", "contacted", "follow_up", "qualified", "quotation"]),
    db.from("enquiries").select("id", { count: "exact", head: true }).not("assigned_employee_id", "is", null),
    db.from("enquiries").select("id", { count: "exact", head: true }).gte("followUpAt", startOfToday.toISOString()).lt("followUpAt", tomorrow.toISOString()).not("status", "in", "(closed,lost,converted,cancelled)"),
    db.from("appointments").select("id", { count: "exact", head: true }).gte("appointmentAt", startOfToday.toISOString()).lt("appointmentAt", tomorrow.toISOString()).in("status", ["requested", "confirmed", "rescheduled"]),
    db.from("callback_requests").select("id", { count: "exact", head: true }).in("status", ["requested", "pending", "assigned", "in_progress", "scheduled"]),
    db.from("enquiries").select("id", { count: "exact", head: true }).eq("status", "converted"),
    db.from("enquiries").select("id", { count: "exact", head: true }).eq("status", "lost"),
  ]);

  for (const result of [newEnquiries, pendingEnquiries, assignedEnquiries, followUpsDue, todayAppointments, pendingCallbacks, convertedEnquiries, lostEnquiries]) {
    if (result.error) fail(result.error, "Unable to load CRM dashboard.");
  }

  return {
    newEnquiries: newEnquiries.count ?? 0,
    pendingEnquiries: pendingEnquiries.count ?? 0,
    assignedEnquiries: assignedEnquiries.count ?? 0,
    followUpsDue: followUpsDue.count ?? 0,
    todayAppointments: todayAppointments.count ?? 0,
    pendingCallbacks: pendingCallbacks.count ?? 0,
    convertedEnquiries: convertedEnquiries.count ?? 0,
    lostEnquiries: lostEnquiries.count ?? 0,
  };
}

export async function listCrmEnquiries(
  accessToken: string,
  input: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: CrmEnquiryStatus;
    priority?: CrmPriority;
    assignedEmployeeId?: string;
    departmentId?: string;
  },
) {
  const db = client(accessToken);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = db
    .from("enquiries")
    .select(
      `
        id,reference,userId,tourId,name,email,phone,destination,travelDates,travellers,budget,tripType,message,status,priority,source,followUpAt,createdAt,updatedAt,customer_auth_id,assigned_employee_id,assigned_department_id,destination_id,
        customer:profiles!enquiries_customer_auth_id_fkey(id,full_name,phone),
        assignee:profiles!enquiries_assigned_employee_id_fkey(id,full_name),
        department:departments!enquiries_assigned_department_id_fkey(id,name,slug)
      `,
      { count: "exact" },
    )
    .order("createdAt", { ascending: false })
    .range(from, to);

  if (input.status) query = query.eq("status", input.status);
  if (input.priority) query = query.eq("priority", input.priority);
  if (input.assignedEmployeeId) query = query.eq("assigned_employee_id", input.assignedEmployeeId);
  if (input.departmentId) query = query.eq("assigned_department_id", input.departmentId);
  if (input.search?.trim()) {
    const term = input.search.trim().replace(/[%_]/g, "").slice(0, 80);
    query = query.or(`reference.ilike.%${term}%,name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,destination.ilike.%${term}%`);
  }

  const { data, error, count } = await query;
  if (error) fail(error, "Unable to load enquiries.");

  return {
    items: data ?? [],
    page,
    pageSize,
    total: count ?? 0,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
  };
}

export async function getCrmEnquiry(accessToken: string, id: number) {
  const db = client(accessToken);
  const [enquiry, notes, assignments, communications, audit] = await Promise.all([
    db.from("enquiries").select(`*,customer:profiles!enquiries_customer_auth_id_fkey(id,full_name,phone),assignee:profiles!enquiries_assigned_employee_id_fkey(id,full_name),department:departments!enquiries_assigned_department_id_fkey(id,name,slug)`).eq("id", id).maybeSingle(),
    db.from("enquiry_notes").select("id,enquiry_id,author_id,body,created_at,updated_at,author:profiles!enquiry_notes_author_id_fkey(full_name)").eq("enquiry_id", id).order("created_at", { ascending: false }),
    db.from("enquiry_assignments").select("id,enquiry_id,assigned_employee_id,assigned_department_id,assigned_by,assigned_at,unassigned_at,employee:profiles!enquiry_assignments_assigned_employee_id_fkey(full_name),department:departments!enquiry_assignments_assigned_department_id_fkey(name),assigner:profiles!enquiry_assignments_assigned_by_fkey(full_name)").eq("enquiry_id", id).order("assigned_at", { ascending: false }),
    db.from("communication_events").select("id,event_type,summary,created_at,actor_id,actor:profiles!communication_events_actor_id_fkey(full_name)").eq("enquiry_id", id).order("created_at", { ascending: false }),
    db.from("crm_audit_log").select("id,actor_id,action,entity_type,entity_id,changed_fields,created_at").eq("entity_type", "enquiry").eq("entity_id", String(id)).order("created_at", { ascending: false }),
  ]);

  for (const result of [enquiry, notes, assignments, communications, audit]) {
    if (result.error) fail(result.error, "Unable to load enquiry details.");
  }

  return {
    enquiry: enquiry.data,
    notes: notes.data ?? [],
    assignments: assignments.data ?? [],
    communications: communications.data ?? [],
    audit: audit.data ?? [],
  };
}

export async function updateCrmEnquiry(
  accessToken: string,
  input: {
    id: number;
    status?: CrmEnquiryStatus;
    priority?: CrmPriority;
    source?: string;
    followUpAt?: string | null;
    destination?: string | null;
    travelDates?: string | null;
    travellers?: number;
    budget?: string | null;
    tripType?: string | null;
  },
) {
  const db = client(accessToken);
  const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  for (const key of ["status", "priority", "source", "followUpAt", "destination", "travelDates", "travellers", "budget", "tripType"] as const) {
    if (input[key] !== undefined) payload[key] = input[key];
  }
  const { data, error } = await db.from("enquiries").update(payload).eq("id", input.id).select("id,status,priority,source,followUpAt,updatedAt").single();
  if (error) fail(error, "Unable to update enquiry.");
  return data;
}

export async function assignCrmEnquiry(accessToken: string, input: { enquiryId: number; employeeId: string; departmentId: string }) {
  const db = client(accessToken);
  const { data, error } = await db.rpc("assign_crm_enquiry", {
    p_enquiry_id: input.enquiryId,
    p_employee_id: input.employeeId,
    p_department_id: input.departmentId,
  });
  if (error) fail(error, "Unable to assign enquiry.");
  if (!data) throw new Error("The enquiry could not be assigned.");
  return { success: true } as const;
}

export async function addEnquiryNote(accessToken: string, enquiryId: number, body: string) {
  const db = client(accessToken);
  const { data, error } = await db.from("enquiry_notes").insert({ enquiry_id: enquiryId, author_id: (await db.auth.getUser()).data.user?.id, body: body.trim() }).select("id,enquiry_id,author_id,body,created_at").single();
  if (error) fail(error, "Unable to add internal note.");
  return data;
}

export async function listCrmCustomers(accessToken: string, input: { page?: number; pageSize?: number; search?: string }) {
  const db = client(accessToken);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = db.from("profiles").select("id,email,full_name,phone,avatar_url,date_of_birth,preferred_language,preferred_currency,created_at,updated_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  if (input.search?.trim()) {
    const term = input.search.trim().replace(/[%_]/g, "").slice(0, 80);
    query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  }
  const { data, error, count } = await query;
  if (error) fail(error, "Unable to load customers.");
  return { items: data ?? [], page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) };
}

export async function getCrmCustomer(accessToken: string, customerId: string) {
  const db = client(accessToken);
  const [profile, preferences, enquiries, appointments, callbacks, wishlist, activity] = await Promise.all([
    db.from("profiles").select("id,email,full_name,phone,avatar_url,date_of_birth,preferred_language,preferred_currency,created_at,updated_at").eq("id", customerId).maybeSingle(),
    db.from("customer_preferences").select("*").eq("user_id", customerId).maybeSingle(),
    db.from("enquiries").select("id,reference,destination,status,priority,createdAt,followUpAt").eq("customer_auth_id", customerId).order("createdAt", { ascending: false }).limit(20),
    db.from("appointments").select("id,reference,appointmentAt,status,purpose,assigned_employee_id").eq("customer_auth_id", customerId).order("appointmentAt", { ascending: false }).limit(20),
    db.from("callback_requests").select("id,reference,preferredAt,status,reason,assigned_employee_id").eq("customer_auth_id", customerId).order("createdAt", { ascending: false }).limit(20),
    db.from("wishlists").select("id,tour_id,created_at,tours(title,slug)").eq("user_id", customerId).order("created_at", { ascending: false }).limit(20),
    db.from("customer_activity").select("id,activity_type,entity_type,entity_id,created_at").eq("user_id", customerId).order("created_at", { ascending: false }).limit(30),
  ]);
  for (const result of [profile, preferences, enquiries, appointments, callbacks, wishlist, activity]) if (result.error) fail(result.error, "Unable to load customer details.");
  return { profile: profile.data, preferences: preferences.data, enquiries: enquiries.data ?? [], appointments: appointments.data ?? [], callbacks: callbacks.data ?? [], wishlist: wishlist.data ?? [], activity: activity.data ?? [] };
}

export async function updateCrmAppointment(accessToken: string, input: { id: number; status?: string; assignedEmployeeId?: string | null; assignedDepartmentId?: string | null; meetingLink?: string | null; followUpAt?: string | null; notes?: string | null }) {
  const db = client(accessToken);
  const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (input.status !== undefined) payload.status = input.status;
  if (input.assignedEmployeeId !== undefined) payload.assigned_employee_id = input.assignedEmployeeId;
  if (input.assignedDepartmentId !== undefined) payload.assigned_department_id = input.assignedDepartmentId;
  if (input.meetingLink !== undefined) payload.meetingLink = input.meetingLink;
  if (input.followUpAt !== undefined) payload.followUpAt = input.followUpAt;
  if (input.notes !== undefined) payload.notes = input.notes;
  const { data, error } = await db.from("appointments").update(payload).eq("id", input.id).select("id,status,assigned_employee_id,assigned_department_id,meetingLink,followUpAt,updatedAt").single();
  if (error) fail(error, "Unable to update appointment.");
  return data;
}

export async function updateCrmCallback(accessToken: string, input: { id: number; status?: string; priority?: CrmPriority; assignedEmployeeId?: string | null; assignedDepartmentId?: string | null; notes?: string | null }) {
  const db = client(accessToken);
  const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (input.status !== undefined) payload.status = input.status;
  if (input.priority !== undefined) payload.priority = input.priority;
  if (input.assignedEmployeeId !== undefined) payload.assigned_employee_id = input.assignedEmployeeId;
  if (input.assignedDepartmentId !== undefined) payload.assigned_department_id = input.assignedDepartmentId;
  if (input.notes !== undefined) payload.notes = input.notes;
  const { data, error } = await db.from("callback_requests").update(payload).eq("id", input.id).select("id,status,priority,assigned_employee_id,assigned_department_id,updatedAt").single();
  if (error) fail(error, "Unable to update callback request.");
  return data;
}


export async function addAppointmentNote(accessToken: string, appointmentId: number, body: string) {
  const db = client(accessToken);
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db.from("appointment_notes").insert({ appointment_id: appointmentId, author_id: auth.user?.id, body: body.trim() }).select("id,appointment_id,author_id,body,created_at").single();
  if (error) fail(error, "Unable to add appointment note.");
  return data;
}

export async function addCallbackNote(accessToken: string, callbackId: number, body: string) {
  const db = client(accessToken);
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db.from("callback_notes").insert({ callback_id: callbackId, author_id: auth.user?.id, body: body.trim() }).select("id,callback_id,author_id,body,created_at").single();
  if (error) fail(error, "Unable to add callback note.");
  return data;
}

export async function listCrmAppointments(accessToken: string, page = 1, pageSize = 20) {
  const db = client(accessToken);
  const from = (page - 1) * pageSize;
  const { data, error, count } = await db.from("appointments").select("id,reference,name,email,phone,appointmentAt,durationMinutes,mode,purpose,status,meetingLink,followUpAt,assigned_employee_id,assigned_department_id,customer_auth_id", { count: "exact" }).order("appointmentAt", { ascending: true }).range(from, from + pageSize - 1);
  if (error) fail(error, "Unable to load appointments.");
  return { items: data ?? [], page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) };
}

export async function listCrmCallbacks(accessToken: string, page = 1, pageSize = 20) {
  const db = client(accessToken);
  const from = (page - 1) * pageSize;
  const { data, error, count } = await db.from("callback_requests").select("id,reference,name,email,phone,preferredAt,reason,status,priority,assigned_employee_id,assigned_department_id,customer_auth_id,createdAt", { count: "exact" }).order("createdAt", { ascending: false }).range(from, from + pageSize - 1);
  if (error) fail(error, "Unable to load callback requests.");
  return { items: data ?? [], page, pageSize, total: count ?? 0, totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)) };
}

export async function listCrmStaff() {
  const db = getDb();
  const { data, error } = await db.from("profiles").select("id,full_name,phone,user_roles(role:roles(key,name)),organization_memberships(department_id,status,departments(id,name,slug))").order("full_name", { ascending: true });
  if (error) fail(error, "Unable to load staff directory.");
  return (data ?? []).filter((row: any) => (row.user_roles ?? []).some((assignment: any) => ["owner","admin","manager","customer_care","counsellor","staff"].includes(assignment.role?.key)));
}

export async function listCrmDepartments() {
  const db = getDb();
  const { data, error } = await db.from("departments").select("id,name,slug,organization_id").order("name", { ascending: true });
  if (error) fail(error, "Unable to load departments.");
  return data ?? [];
}
