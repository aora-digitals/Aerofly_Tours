import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type AppRole =
  | "customer" | "owner" | "admin" | "manager" | "department_manager"
  | "finance" | "sales" | "operations" | "support" | "marketing"
  | "customer_care" | "staff" | "counsellor";

export type AppProfile = {
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

export type AppUser = {
  id: string;
  name: string | null;
  email: string | null;
  /** Highest-priority role retained for legacy components. */
  role: AppRole;
  /** All active database-assigned roles; never sourced from user metadata. */
  roles: AppRole[];
  /** Permission keys loaded from roles -> role_permissions -> permissions. */
  permissions: string[];
  /** Active organization memberships used to scope workspace reports. */
  organizationIds: string[];
  profile: AppProfile | null;
  authUser: User;
};

type AuthContextValue = {
  user: AppUser | null;
  session: Session | null;
  loading: boolean;
  error: Error | null;
  isAuthenticated: boolean;

  signIn: (
    email: string,
    password: string
  ) => Promise<{
    error: Error | null;
  }>;

  signUp: (
    email: string,
    password: string,
    fullName: string
  ) => Promise<{
    user: User | null;
    session: Session | null;
    error: Error | null;
    needsEmailConfirmation: boolean;
  }>;

  signOut: () => Promise<{
    error: Error | null;
  }>;

  resetPassword: (
    email: string
  ) => Promise<{
    error: Error | null;
  }>;

  updatePassword: (
    password: string
  ) => Promise<{
    error: Error | null;
  }>;

  refresh: () => Promise<void>;
};

const AuthContext =
  createContext<AuthContextValue | null>(null);

const ROLE_PRIORITY: AppRole[] = [
  "owner", "admin", "department_manager", "manager", "finance", "sales",
  "operations", "support", "marketing", "customer_care", "counsellor", "staff", "customer",
];

function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && ([
    "customer", "owner", "admin", "manager", "department_manager", "finance",
    "sales", "operations", "support", "marketing", "customer_care", "staff", "counsellor",
  ] as string[]).includes(value);
}

async function loadProfile(
  user: User
): Promise<AppProfile | null> {
  const { data, error } = await supabase
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
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load your AeroFly profile: ${error.message}`
    );
  }

  if (data) {
    return data as unknown as AppProfile;
  }

  /*
   * The database trigger normally creates this row.
   * This fallback makes profile creation resilient if a local
   * environment was initialized before the trigger existed.
   */
  const { data: createdProfile, error: createError } =
    await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          full_name:
            typeof user.user_metadata?.full_name === "string"
              ? user.user_metadata.full_name
              : null,
          phone:
            typeof user.user_metadata?.phone === "string"
              ? user.user_metadata.phone
              : null,
        },
        {
          onConflict: "id",
        }
      )
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
      .single();

  if (createError) {
    throw new Error(
      `Unable to create your AeroFly profile: ${createError.message}`
    );
  }

  return createdProfile as unknown as AppProfile;
}

type AuthorizationSnapshot = {
  roles: AppRole[];
  permissions: string[];
  organizationIds: string[];
};

async function loadAuthorization(userId: string): Promise<AuthorizationSnapshot> {
  const fallback: AuthorizationSnapshot = {
    roles: ["customer"], permissions: [], organizationIds: [],
  };

  const [assignmentResult, membershipResult] = await Promise.all([
    supabase.from("user_roles").select("role_id,organization_id").eq("user_id", userId),
    supabase.from("organization_memberships").select("organization_id")
      .eq("user_id", userId).eq("status", "active"),
  ]);

  if (assignmentResult.error) {
    console.error("[Auth] Role assignments could not be loaded; using least privilege.", assignmentResult.error.message);
    return fallback;
  }
  if (membershipResult.error) {
    console.error("[Auth] Organization membership could not be loaded; denying staff permissions.", membershipResult.error.message);
    return fallback;
  }

  const organizationIds = Array.from(new Set((membershipResult.data ?? [])
    .map((membership) => membership.organization_id)
    .filter((id): id is string => typeof id === "string")));
  const activeOrganizationSet = new Set(organizationIds);
  const assignments = (assignmentResult.data ?? []).filter((assignment) =>
    assignment.organization_id == null || activeOrganizationSet.has(assignment.organization_id),
  );
  const roleIds = Array.from(new Set(assignments.map((assignment) => assignment.role_id)
    .filter((id): id is string => typeof id === "string")));

  if (roleIds.length === 0) return { ...fallback, organizationIds };

  const { data: roleRows, error: rolesError } = await supabase
    .from("roles").select("id,key").in("id", roleIds);
  if (rolesError) {
    console.error("[Auth] Role definitions could not be loaded; using least privilege.", rolesError.message);
    return { ...fallback, organizationIds };
  }

  const roles = ROLE_PRIORITY.filter((candidate) =>
    (roleRows ?? []).some((row) => row.key === candidate),
  ).filter((candidate) => candidate === "customer" || organizationIds.length > 0);
  const validRoleIds = (roleRows ?? []).map((row) => row.id).filter((id): id is string => typeof id === "string");
  if (validRoleIds.length === 0) return { ...fallback, organizationIds };

  const { data: rolePermissionRows, error: rolePermissionsError } = await supabase
    .from("role_permissions").select("permission_id").in("role_id", validRoleIds);
  if (rolePermissionsError) {
    console.error("[Auth] Permission assignments could not be loaded; navigation is denied by default.", rolePermissionsError.message);
    return { roles: roles.length ? roles : ["customer"], permissions: [], organizationIds };
  }

  const permissionIds = Array.from(new Set((rolePermissionRows ?? []).map((row) => row.permission_id)
    .filter((id): id is string => typeof id === "string")));
  if (permissionIds.length === 0) return { roles: roles.length ? roles : ["customer"], permissions: [], organizationIds };

  const { data: permissionRows, error: permissionsError } = await supabase
    .from("permissions").select("key").in("id", permissionIds);
  if (permissionsError) {
    console.error("[Auth] Permission catalogue could not be loaded; navigation is denied by default.", permissionsError.message);
    return { roles: roles.length ? roles : ["customer"], permissions: [], organizationIds };
  }

  return {
    roles: roles.length ? roles : ["customer"],
    permissions: Array.from(new Set((permissionRows ?? []).map((row) => row.key).filter((key): key is string => typeof key === "string"))),
    organizationIds,
  };
}

async function buildAppUser(user: User): Promise<AppUser> {
  const [profile, authorization] = await Promise.all([
    loadProfile(user), loadAuthorization(user.id),
  ]);
  const role = ROLE_PRIORITY.find((candidate) => authorization.roles.includes(candidate)) ?? "customer";

  return {
    id: user.id,
    name: profile?.full_name ?? (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null),
    email: user.email ?? null,
    role: isAppRole(role) ? role : "customer",
    roles: authorization.roles,
    permissions: authorization.permissions,
    organizationIds: authorization.organizationIds,
    profile,
    authUser: user,
  };
}

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [session, setSession] =
    useState<Session | null>(null);

  const [user, setUser] =
    useState<AppUser | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] =
    useState<Error | null>(null);

  const hydrateSession = useCallback(
    async (nextSession: Session | null) => {
      setSession(nextSession);

      if (!nextSession?.user) {
        setUser(null);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const appUser = await buildAppUser(
          nextSession.user
        );

        setUser(appUser);
      } catch (loadError) {
        const normalized =
          loadError instanceof Error
            ? loadError
            : new Error("Unable to load your account.");

        setError(normalized);
        setUser(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    let mounted = true;

    void supabase.auth
      .getSession()
      .then(async ({ data, error: sessionError }) => {
        if (!mounted) return;

        if (sessionError) {
          setError(
            new Error(
              "Unable to restore your AeroFly session."
            )
          );
          setLoading(false);
          return;
        }

        await hydrateSession(data.session);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        /*
         * Supabase recommends keeping auth-state callbacks
         * synchronous. Defer profile queries outside the callback.
         */
        window.setTimeout(() => {
          if (!mounted) return;
          void hydrateSession(nextSession);
        }, 0);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [hydrateSession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { error: signInError } =
        await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });

      return {
        error: signInError
          ? new Error(signInError.message)
          : null,
      };
    },
    []
  );

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      fullName: string
    ) => {
      const redirectTo = `${window.location.origin}/login`;

      const { data, error: signUpError } =
        await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: {
              full_name: fullName.trim(),
            },
          },
        });

      return {
        user: data.user,
        session: data.session,
        error: signUpError
          ? new Error(signUpError.message)
          : null,
        needsEmailConfirmation:
          Boolean(data.user) && !data.session,
      };
    },
    []
  );

  const signOut = useCallback(async () => {
    const { error: signOutError } =
      await supabase.auth.signOut();

    return {
      error: signOutError
        ? new Error(signOutError.message)
        : null,
    };
  }, []);

  const resetPassword = useCallback(
    async (email: string) => {
      const redirectTo =
        `${window.location.origin}/login?mode=reset`;

      const { error: resetError } =
        await supabase.auth.resetPasswordForEmail(
          email.trim().toLowerCase(),
          {
            redirectTo,
          }
        );

      return {
        error: resetError
          ? new Error(resetError.message)
          : null,
      };
    },
    []
  );

  const updatePassword = useCallback(
    async (password: string) => {
      const { error: updateError } =
        await supabase.auth.updateUser({
          password,
        });

      return {
        error: updateError
          ? new Error(updateError.message)
          : null,
      };
    },
    []
  );

  const refresh = useCallback(async () => {
    const { data, error: refreshError } =
      await supabase.auth.getSession();

    if (refreshError) {
      setError(
        new Error(
          "Unable to refresh your AeroFly session."
        )
      );
      return;
    }

    await hydrateSession(data.session);
  }, [hydrateSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      loading,
      error,
      isAuthenticated: Boolean(session?.user && user),
      signIn,
      signUp,
      signOut,
      resetPassword,
      updatePassword,
      refresh,
    }),
    [
      user,
      session,
      loading,
      error,
      signIn,
      signUp,
      signOut,
      resetPassword,
      updatePassword,
      refresh,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuthContext must be used inside AuthProvider."
    );
  }

  return context;
}