import { useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";

import { useAuthContext, type AppRole } from "@/contexts/AuthContext";
import { defaultLandingPath } from "@/lib/workspaceAccess";

type ProtectedRouteProps = {
  children: ReactNode;
  /** Require any authenticated staff role rather than a customer account. */
  requiredStaff?: boolean;
  /** Allow access only when the user has at least one of these database roles. */
  allowedRoles?: readonly AppRole[];
  /** Require this permission key from the database-backed RBAC catalogue. */
  requiredPermission?: string;
};

function LoadingScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#f3ede5]">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#f26b35] border-t-transparent" />
        <p className="mt-4 text-[13px] text-[#77736c]">Restoring your AeroFly session…</p>
      </div>
    </div>
  );
}

function AccessDenied({ onBack }: { onBack: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[#191a18] p-6 text-white">
      <div className="max-w-md text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#f26b35] font-black">A</div>
        <h1 className="mt-6 font-['Manrope'] text-3xl font-extrabold">Workspace access is restricted.</h1>
        <p className="mt-4 text-[13px] leading-6 text-white/65">
          Your account does not have the role and permission required for this page. If you believe this is incorrect, contact your AeroFly administrator.
        </p>
        <button type="button" onClick={onBack} className="btn btn-primary mt-7">Go to my workspace</button>
      </div>
    </div>
  );
}

export default function ProtectedRoute({
  children,
  requiredStaff = false,
  allowedRoles,
  requiredPermission,
}: ProtectedRouteProps) {
  const { user, loading, isAuthenticated } = useAuthContext();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      const next = encodeURIComponent(location || "/dashboard");
      setLocation(`/login?next=${next}`);
    }
  }, [loading, isAuthenticated, location, setLocation]);

  if (loading || !isAuthenticated || !user) return <LoadingScreen />;

  const roles = user.roles?.length ? user.roles : [user.role];
  const hasStaffRole = roles.some((role) => role !== "customer");
  const roleAllowed = !allowedRoles || allowedRoles.some((role) => roles.includes(role));
  const permissionAllowed = !requiredPermission || user.permissions.includes(requiredPermission);
  const staffAllowed = !requiredStaff || hasStaffRole;

  if (!staffAllowed || !roleAllowed || !permissionAllowed) {
    return <AccessDenied onBack={() => setLocation(defaultLandingPath(user))} />;
  }

  return <>{children}</>;
}
