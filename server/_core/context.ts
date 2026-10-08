import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { authenticateSupabaseRequest } from "./supabase";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

type LegacyRole =
  | "user"
  | "owner"
  | "manager"
  | "marketing"
  | "customer_care"
  | "staff"
  | "counsellor"
  | "admin";

function mapSupabaseRoleToLegacyRole(
  role: string
): LegacyRole {
  switch (role) {
    case "owner":
      return "owner";

    case "admin":
      return "admin";

    case "manager":
      return "manager";

    case "marketing":
      return "marketing";

    case "customer_care":
      return "customer_care";

    case "staff":
      return "staff";

    case "counsellor":
      return "counsellor";

    case "customer":
    default:
      return "user";
  }
}

async function resolveSupabaseLegacyUser(
  auth: Awaited<ReturnType<typeof authenticateSupabaseRequest>>
): Promise<User | null> {
  if (!auth) {
    return null;
  }

  const email = auth.user.email?.trim().toLowerCase() ?? null;

  const existingByEmail = email
    ? await db.getUserByEmail(email)
    : undefined;

  const supabaseOpenId = `supabase:${auth.user.id}`;

  const existingBySupabaseId = await db.getUserByOpenId(
    supabaseOpenId
  );

  const existingUser =
    existingByEmail ?? existingBySupabaseId;

  /*
   * Do not downgrade an existing legacy staff/admin account merely
   * because its Supabase profile has not yet been assigned a role.
   */
  const legacyRole =
    existingUser && existingUser.role !== "user"
      ? existingUser.role
      : mapSupabaseRoleToLegacyRole(auth.role);

  const openId =
    existingUser?.openId ??
    supabaseOpenId;

  await db.upsertUser({
    openId,
    name:
      auth.profile?.full_name ??
      auth.user.user_metadata?.full_name ??
      auth.user.email ??
      null,
    email,
    loginMethod: "supabase",
    role: legacyRole,
    lastSignedIn: new Date(),
  });

  return (await db.getUserByOpenId(openId)) ?? null;
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const supabaseAuth = await authenticateSupabaseRequest(
    opts.req
  );

  if (supabaseAuth) {
    try {
      const user =
        await resolveSupabaseLegacyUser(supabaseAuth);

      if (user) {
        return {
          req: opts.req,
          res: opts.res,
          user,
        };
      }
    } catch (error) {
      console.error(
        "[Auth] Supabase compatibility bridge failed:",
        error instanceof Error
          ? error.message
          : String(error)
      );
    }
  }

  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}