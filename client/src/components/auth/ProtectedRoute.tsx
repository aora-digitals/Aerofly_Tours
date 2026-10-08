import { useEffect } from "react";
import { useLocation } from "wouter";

import { useAuth } from "@/_core/hooks/useAuth";
import {
  normalizeStaffRole,
} from "@shared/types";

type ProtectedRouteProps = {
  children: React.ReactNode;
  requiredStaff?: boolean;
};

export default function ProtectedRoute({
  children,
  requiredStaff = false,
}: ProtectedRouteProps) {
  const {
    user,
    loading,
    isAuthenticated,
  } = useAuth();

  const [location, setLocation] =
    useLocation();

  useEffect(() => {
    if (loading) return;

    if (!isAuthenticated) {
      const next = encodeURIComponent(
        location || "/dashboard"
      );

      setLocation(`/login?next=${next}`);
    }
  }, [
    loading,
    isAuthenticated,
    location,
    setLocation,
  ]);

  if (loading || !isAuthenticated) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f3ede5]">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#f26b35] border-t-transparent" />
          <p className="mt-4 text-[13px] text-[#77736c]">
            Restoring your AeroFly session…
          </p>
        </div>
      </div>
    );
  }

  if (requiredStaff) {
    const staffRole =
      normalizeStaffRole(user?.role);

    if (!staffRole) {
      return (
        <div className="grid min-h-screen place-items-center bg-[#191a18] p-6 text-white">
          <div className="max-w-md text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#f26b35] font-black">
              A
            </div>

            <h1 className="mt-6 font-['Manrope'] text-3xl font-extrabold">
              Workspace access is restricted.
            </h1>

            <p className="mt-4 text-[13px] leading-6 text-white/55">
              Your AeroFly account is authenticated, but it
              does not currently have a staff workspace role.
            </p>

            <button
              type="button"
              onClick={() => setLocation("/")}
              className="btn btn-primary mt-7"
            >
              Back to public site
            </button>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}