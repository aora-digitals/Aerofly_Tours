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
  | "customer"
  | "owner"
  | "admin"
  | "manager"
  | "marketing"
  | "customer_care"
  | "staff"
  | "counsellor";

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
  role: AppRole;
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
  "owner",
  "admin",
  "manager",
  "marketing",
  "customer_care",
  "counsellor",
  "staff",
  "customer",
];

function isAppRole(value: unknown): value is AppRole {
  return (
    value === "customer" ||
    value === "owner" ||
    value === "admin" ||
    value === "manager" ||
    value === "marketing" ||
    value === "customer_care" ||
    value === "staff" ||
    value === "counsellor"
  );
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

async function loadRole(
  userId: string
): Promise<AppRole> {
  const { data: assignments, error } =
    await supabase
      .from("user_roles")
      .select("role_id")
      .eq("user_id", userId);

  if (error) {
    /*
     * A missing role should never make a normal customer unable
     * to sign in. The database trigger gives every new user
     * the customer role.
     */
    console.warn(
      "[Auth] Unable to load role:",
      error.message
    );

    return "customer";
  }

  const roleIds = (assignments ?? [])
    .map((assignment) => assignment.role_id)
    .filter(
      (roleId): roleId is string =>
        typeof roleId === "string"
    );

  if (roleIds.length === 0) {
    return "customer";
  }

  const { data: roles, error: roleError } =
    await supabase
      .from("roles")
      .select("id,key")
      .in("id", roleIds);

  if (roleError) {
    console.warn(
      "[Auth] Unable to load role definitions:",
      roleError.message
    );

    return "customer";
  }

  for (const role of ROLE_PRIORITY) {
    if (
      (roles ?? []).some(
        (candidate) => candidate.key === role
      )
    ) {
      return role;
    }
  }

  return "customer";
}

async function buildAppUser(
  user: User
): Promise<AppUser> {
  const [profile, role] = await Promise.all([
    loadProfile(user),
    loadRole(user.id),
  ]);

  return {
    id: user.id,
    name:
      profile?.full_name ??
      (typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : null),
    email: user.email ?? null,
    role: isAppRole(role) ? role : "customer",
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