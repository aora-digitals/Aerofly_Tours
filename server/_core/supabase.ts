import {
  createClient,
  type User as SupabaseUser,
} from "@supabase/supabase-js";
import type { Request } from "express";
import { ENV } from "./env";

export type SupabaseAppRole =
  | "customer"
  | "owner"
  | "admin"
  | "manager"
  | "marketing"
  | "customer_care"
  | "staff"
  | "counsellor";

export type SupabaseProfile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  date_of_birth: string | null;
  preferred_language: string;
  preferred_currency: string;
  created_at: string;
  updated_at: string;
};

export type SupabaseAuthContext = {
  user: SupabaseUser;
  profile: SupabaseProfile | null;
  role: SupabaseAppRole;
  accessToken: string;
};

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;

  if (typeof header !== "string") {
    return null;
  }

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();

  return token.length > 0 ? token : null;
}

export function createServerSupabaseClient(accessToken?: string) {
  if (!ENV.supabaseUrl || !ENV.supabaseAnonKey) {
    throw new Error(
      "Supabase server configuration is missing. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
    );
  }

  return createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
}


async function loadProfile(
  accessToken: string,
  userId: string
): Promise<SupabaseProfile | null> {
  const client = createServerSupabaseClient(accessToken);

  const { data, error } = await client
    .from("profiles")
    .select(
      [
        "id",
        "full_name",
        "phone",
        "avatar_url",
        "date_of_birth",
        "preferred_language",
        "preferred_currency",
        "created_at",
        "updated_at",
      ].join(",")
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[Supabase] Failed to load profile:", error.message);
    return null;
  }

  return (data as SupabaseProfile | null) ?? null;
}

async function loadRole(
  accessToken: string,
  userId: string
): Promise<SupabaseAppRole> {
  const client = createServerSupabaseClient(accessToken);

  const { data: assignments, error: assignmentsError } = await client
    .from("user_roles")
    .select("role_id")
    .eq("user_id", userId);

  if (assignmentsError) {
    console.error(
      "[Supabase] Failed to load user roles:",
      assignmentsError.message
    );
    return "customer";
  }

  const roleIds = (assignments ?? [])
    .map((assignment) => assignment.role_id)
    .filter((roleId): roleId is string => typeof roleId === "string");

  if (roleIds.length === 0) {
    return "customer";
  }

  const { data: roles, error: rolesError } = await client
    .from("roles")
    .select("id,key")
    .in("id", roleIds);

  if (rolesError) {
    console.error(
      "[Supabase] Failed to load role definitions:",
      rolesError.message
    );
    return "customer";
  }

  const priority: SupabaseAppRole[] = [
    "owner",
    "admin",
    "manager",
    "marketing",
    "customer_care",
    "counsellor",
    "staff",
    "customer",
  ];

  for (const candidate of priority) {
    if (
      (roles ?? []).some(
        (role) => role.id && role.key === candidate
      )
    ) {
      return candidate;
    }
  }

  return "customer";
}

export async function authenticateSupabaseRequest(
  req: Request
): Promise<SupabaseAuthContext | null> {
  const accessToken = getBearerToken(req);

  if (!accessToken) {
    return null;
  }

  if (!ENV.supabaseUrl || !ENV.supabaseAnonKey) {
    return null;
  }

  try {
    const client = createServerSupabaseClient(accessToken);

    const {
      data: { user },
      error,
    } = await client.auth.getUser(accessToken);

    if (error || !user) {
      return null;
    }

    const [profile, role] = await Promise.all([
      loadProfile(accessToken, user.id),
      loadRole(accessToken, user.id),
    ]);

    return {
      user,
      profile,
      role,
      accessToken,
    };
  } catch (error) {
    console.error(
      "[Supabase] Authentication failed:",
      error instanceof Error ? error.message : String(error)
    );

    return null;
  }
}