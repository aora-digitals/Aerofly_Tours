import { useAuthContext } from "@/contexts/AuthContext";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

/**
 * Compatibility hook.
 *
 * Existing AeroFly pages already import useAuth().
 * Keep the same hook name so the UI does not need a broad rewrite.
 *
 * Phase 1 authentication is now powered by Supabase Auth.
 */
export function useAuth(options?: UseAuthOptions) {
  const auth = useAuthContext();

  /*
   * Existing callers currently do not pass authentication options.
   *
   * Keep these options for compatibility with future/legacy callers,
   * but do not automatically start the old Manus OAuth flow.
   */
  void options;

  return {
    user: auth.user,
    loading: auth.loading,
    error: auth.error,
    isAuthenticated: auth.isAuthenticated,
    refresh: auth.refresh,
    logout: auth.signOut,
    session: auth.session,
    signIn: auth.signIn,
    signUp: auth.signUp,
    resetPassword: auth.resetPassword,
    updatePassword: auth.updatePassword,
  };
}