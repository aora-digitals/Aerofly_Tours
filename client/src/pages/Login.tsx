import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  LockKeyhole,
  Mail,
  UserRound,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";

import Footer from "@/components/site/Footer";
import Header from "@/components/site/Header";
import { useAuth } from "@/_core/hooks/useAuth";
import { initialAuthCallbackUrl, supabase } from "@/lib/supabase";
import { defaultLandingPath, isSafeInternalPath } from "@/lib/workspaceAccess";

type AuthMode =
  | "signin"
  | "signup"
  | "forgot"
  | "reset"
  | "invite";

function getSearchParams() {
  if (typeof window === "undefined") {
    return new URLSearchParams();
  }

  return new URLSearchParams(
    window.location.search
  );
}

export default function Login() {
  const [, setLocation] = useLocation();

  const {
    loading,
    isAuthenticated,
    session,
    user,
    signIn,
    signUp,
    resetPassword,
    updatePassword,
  } = useAuth();

  const params = useMemo(
    () => getSearchParams(),
    []
  );

  const requestedReset =
    params.get("mode") === "reset";
  const requestedInvite =
    params.get("mode") === "invite";

  const [mode, setMode] =
    useState<AuthMode>(
      requestedReset ? "reset" : requestedInvite ? "invite" : "signin"
    );

  const [fullName, setFullName] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [submitting, setSubmitting] =
    useState(false);

  const [inviteCallbackState, setInviteCallbackState] =
    useState<"checking" | "ready" | "failed">(
      requestedInvite ? "checking" : "ready"
    );

  const [message, setMessage] =
    useState<string | null>(null);

  const requestedNextPath = params.get("next");
  // Invitation links retain their assigned workspace destination. Ordinary
  // sign-ins default to the landing page for the authenticated database role.
  const nextPath = isSafeInternalPath(requestedNextPath)
    ? requestedNextPath
    : "/dashboard";

  useEffect(() => {
    if (requestedReset && isAuthenticated) setMode("reset");
    if (requestedInvite) setMode("invite");
  }, [requestedReset, requestedInvite, isAuthenticated]);

  // Supabase invitations may arrive as a token hash (implicit callback),
  // a token_hash query parameter, or a PKCE code. Process the callback before
  // deciding that the invitation is invalid. Keep flowType: "pkce" unchanged.
  useEffect(() => {
    if (!requestedInvite) return;

    let cancelled = false;

    const processInviteCallback = async () => {
      setInviteCallbackState("checking");

      try {
        const liveUrl = new URL(window.location.href);
        const originalUrl = initialAuthCallbackUrl
          ? new URL(initialAuthCallbackUrl)
          : liveUrl;
        const hasLiveCallback = Boolean(
          liveUrl.searchParams.get("token_hash") ||
          liveUrl.searchParams.get("code") ||
          liveUrl.hash.includes("access_token=") ||
          liveUrl.hash.includes("error=")
        );
        // Supabase may remove callback tokens from the address bar after it
        // consumes them. Use the URL captured before client initialization only
        // when it belongs to this same invitation page and the live URL is clean.
        const callbackUrl = !hasLiveCallback &&
          originalUrl.pathname === liveUrl.pathname &&
          originalUrl.searchParams.get("mode") === "invite"
            ? originalUrl
            : liveUrl;
        const hashParams = new URLSearchParams(
          callbackUrl.hash.startsWith("#")
            ? callbackUrl.hash.slice(1)
            : callbackUrl.hash
        );
        const tokenHash = callbackUrl.searchParams.get("token_hash");
        const callbackType = callbackUrl.searchParams.get("type") || hashParams.get("type");
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        const code = callbackUrl.searchParams.get("code");
        const callbackError =
          hashParams.get("error_description") ||
          callbackUrl.searchParams.get("error_description") ||
          hashParams.get("error_code") ||
          callbackUrl.searchParams.get("error_code");

        if (callbackError) {
          throw new Error(callbackError.replace(/\+/g, " "));
        }

        let callbackSucceeded = false;

        if (tokenHash && (!callbackType || callbackType === "invite")) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "invite",
          });
          if (error) throw error;
          callbackSucceeded = true;
        } else if (accessToken && refreshToken) {
          const { data: current } = await supabase.auth.getSession();
          let callbackUserId: string | null = null;
          try {
            const payload = accessToken.split(".")[1];
            const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
            const claims = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
            callbackUserId = typeof claims.sub === "string" ? claims.sub : null;
          } catch {
            // Supabase setSession below will report malformed credentials.
          }

          if (current.session?.user?.id && callbackUserId === current.session.user.id) {
            callbackSucceeded = true;
          } else {
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (error) throw error;
            callbackSucceeded = true;
          }
        } else if (code) {
          const { data: current } = await supabase.auth.getSession();
          if (current.session) {
            callbackSucceeded = true;
          } else {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) throw error;
            callbackSucceeded = true;
          }
        } else {
          // The Supabase client may already have consumed the callback during
          // initialization, so check its session before declaring failure.
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          callbackSucceeded = Boolean(data.session?.user);
        }

        const { data: finalSession, error: finalSessionError } =
          await supabase.auth.getSession();
        if (finalSessionError) throw finalSessionError;
        callbackSucceeded = callbackSucceeded && Boolean(finalSession.session?.user);

        // Remove bearer credentials / one-time codes from the address bar after
        // processing, while preserving mode and the internal destination.
        if (callbackUrl.hash || tokenHash || code) {
          callbackUrl.hash = "";
          callbackUrl.searchParams.delete("token_hash");
          callbackUrl.searchParams.delete("code");
          callbackUrl.searchParams.delete("type");
          callbackUrl.searchParams.delete("error");
          callbackUrl.searchParams.delete("error_code");
          callbackUrl.searchParams.delete("error_description");
          window.history.replaceState(
            window.history.state,
            "",
            `${callbackUrl.pathname}${callbackUrl.search}`
          );
        }

        if (!cancelled) {
          setInviteCallbackState(callbackSucceeded ? "ready" : "failed");
        }
      } catch (callbackError) {
        console.error("[Auth] Employee invitation callback failed:", callbackError);
        if (!cancelled) setInviteCallbackState("failed");
      }
    };

    void processInviteCallback();
    return () => {
      cancelled = true;
    };
  }, [requestedInvite]);

  useEffect(() => {
    if (
      loading ||
      !isAuthenticated ||
      mode === "reset" ||
      mode === "invite"
    ) {
      return;
    }

    if (mode === "signin") {
      const roles = user?.roles?.length
        ? user.roles
        : user?.role
          ? [user.role]
          : [];
      const isOrganizationMember = roles.some((role) => role !== "customer");
      const requestedCustomerPath = requestedNextPath === "/dashboard" ||
        Boolean(requestedNextPath?.startsWith("/dashboard/"));
      const destination = isSafeInternalPath(requestedNextPath) &&
        !(isOrganizationMember && requestedCustomerPath)
          ? requestedNextPath
          : defaultLandingPath(user);
      setLocation(destination);
    }
  }, [
    loading,
    isAuthenticated,
    session,
    mode,
    requestedNextPath,
    user,
    setLocation,
  ]);

  const clearFormMessage = () => {
    setMessage(null);
  };

  const handleSignIn = async (
    event: FormEvent
  ) => {
    event.preventDefault();

    clearFormMessage();

    if (!email.trim()) {
      toast.error("Enter your email address.");
      return;
    }

    if (!password) {
      toast.error("Enter your password.");
      return;
    }

    setSubmitting(true);

    try {
      const result = await signIn(
        email,
        password
      );

      if (result.error) {
        toast.error(
          getFriendlyAuthError(
            result.error
          )
        );
        return;
      }

      toast.success(
        "Welcome back to AeroFly."
      );
      // AuthContext hydrates the database-assigned role asynchronously.
      // The authenticated redirect effect navigates after that hydration,
      // avoiding a race to the customer dashboard.
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignUp = async (
    event: FormEvent
  ) => {
    event.preventDefault();

    clearFormMessage();

    if (fullName.trim().length < 2) {
      toast.error(
        "Enter your full name."
      );
      return;
    }

    if (!email.trim()) {
      toast.error(
        "Enter your email address."
      );
      return;
    }

    if (password.length < 8) {
      toast.error(
        "Your password must contain at least 8 characters."
      );
      return;
    }

    if (password !== confirmPassword) {
      toast.error(
        "Passwords do not match."
      );
      return;
    }

    setSubmitting(true);

    try {
      const result = await signUp(
        email,
        password,
        fullName
      );

      if (result.error) {
        toast.error(
          getFriendlyAuthError(
            result.error
          )
        );
        return;
      }

      if (result.needsEmailConfirmation) {
        setMessage(
          "Your account has been created. Check your email to verify your AeroFly account before signing in."
        );

        toast.success(
          "Account created. Check your email."
        );

        setMode("signin");
        setPassword("");
        setConfirmPassword("");

        return;
      }

      toast.success(
        "Your AeroFly account is ready."
      );

      setLocation(nextPath);
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async (
    event: FormEvent
  ) => {
    event.preventDefault();

    clearFormMessage();

    if (!email.trim()) {
      toast.error(
        "Enter the email address associated with your account."
      );
      return;
    }

    setSubmitting(true);

    try {
      const result =
        await resetPassword(email);

      if (result.error) {
        toast.error(
          getFriendlyAuthError(
            result.error
          )
        );
        return;
      }

      setMessage(
        "If an AeroFly account exists for that email, a password-reset link has been sent."
      );

      toast.success(
        "Check your email for the reset link."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdatePassword = async (
    event: FormEvent
  ) => {
    event.preventDefault();

    clearFormMessage();

    if (password.length < 8) {
      toast.error(
        "Your new password must contain at least 8 characters."
      );
      return;
    }

    if (password !== confirmPassword) {
      toast.error(
        "Passwords do not match."
      );
      return;
    }

    setSubmitting(true);

    try {
      const result =
        await updatePassword(password);

      if (result.error) {
        toast.error(
          getFriendlyAuthError(
            result.error
          )
        );
        return;
      }

      toast.success(
        "Your password has been updated."
      );

      setPassword("");
      setConfirmPassword("");

      setLocation(nextPath);
    } finally {
      setSubmitting(false);
    }
  };

  const title =
    mode === "signup"
      ? "Create your AeroFly account."
      : mode === "forgot"
        ? "Reset your password."
        : mode === "reset"
          ? "Choose a new password."
          : "Keep your journey in view.";

  const description =
    mode === "signup"
      ? "Create one secure account for your AeroFly enquiries, trips and travel documents."
      : mode === "forgot"
        ? "Enter your email and we’ll send you a secure password-reset link."
        : mode === "reset"
          ? "Choose a new password for your AeroFly account."
          : "Sign in to track enquiries, upcoming trips and the details your travel desk is coordinating.";

  return (
    <div className="min-h-screen">
      <Header />

      <main className="bg-[#f3ede5]">
        <div className="container grid min-h-[650px] place-items-center py-20">
          <div className="card w-full max-w-[470px] p-8 sm:p-10">
            <div className="text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#fff0e8] text-[#f26b35]">
                {mode === "signup" ? (
                  <UserRound size={22} />
                ) : mode === "forgot" ? (
                  <Mail size={22} />
                ) : (
                  <LockKeyhole size={22} />
                )}
              </div>

              <div className="eyebrow mt-7">
                {mode === "invite" ? "AeroFly employee onboarding" : "AeroFly customer area"}
              </div>

              <h1 className="mt-3 font-['Manrope'] text-3xl font-extrabold tracking-[-.05em]">
                {title}
              </h1>

              <p className="mt-4 text-[14px] leading-6 text-[#6f6c66]">
                {description}
              </p>
            </div>

            {message && (
              <div className="mt-6 flex gap-3 rounded-xl border border-[#d9eadc] bg-[#f1f8f2] p-4 text-[12px] leading-5 text-[#437044]">
                <CheckCircle2
                  size={16}
                  className="mt-0.5 shrink-0"
                />

                <span>{message}</span>
              </div>
            )}

            {mode === "signin" && (
              <form
                onSubmit={handleSignIn}
                className="mt-7 space-y-4"
              >
                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-[#77736c]">
                    Email
                  </span>

                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) =>
                      setEmail(event.target.value)
                    }
                    className="field w-full"
                    placeholder="you@example.com"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-[#77736c]">
                    Password
                  </span>

                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    className="field w-full"
                    placeholder="Your password"
                  />
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary mt-2 w-full"
                >
                  {submitting
                    ? "Signing in…"
                    : "Sign in to AeroFly"}

                  {!submitting && (
                    <ArrowRight size={15} />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    clearFormMessage();
                    setMode("forgot");
                  }}
                  className="mx-auto block text-[11px] font-bold text-[#77736c] hover:text-[#c94d1c]"
                >
                  Forgot your password?
                </button>
              </form>
            )}

            {mode === "signup" && (
              <form
                onSubmit={handleSignUp}
                className="mt-7 space-y-4"
              >
                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-[#77736c]">
                    Full name
                  </span>

                  <input
                    type="text"
                    autoComplete="name"
                    value={fullName}
                    onChange={(event) =>
                      setFullName(event.target.value)
                    }
                    className="field w-full"
                    placeholder="Your full name"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-[#77736c]">
                    Email
                  </span>

                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) =>
                      setEmail(event.target.value)
                    }
                    className="field w-full"
                    placeholder="you@example.com"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-[#77736c]">
                    Password
                  </span>

                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    className="field w-full"
                    placeholder="At least 8 characters"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-[#77736c]">
                    Confirm password
                  </span>

                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) =>
                      setConfirmPassword(event.target.value)
                    }
                    className="field w-full"
                    placeholder="Repeat your password"
                  />
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary mt-2 w-full"
                >
                  {submitting
                    ? "Creating account…"
                    : "Create AeroFly account"}

                  {!submitting && (
                    <ArrowRight size={15} />
                  )}
                </button>
              </form>
            )}

            {mode === "forgot" && (
              <form
                onSubmit={handleForgotPassword}
                className="mt-7 space-y-4"
              >
                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-[#77736c]">
                    Email
                  </span>

                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) =>
                      setEmail(event.target.value)
                    }
                    className="field w-full"
                    placeholder="you@example.com"
                  />
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary mt-2 w-full"
                >
                  {submitting
                    ? "Sending…"
                    : "Send reset link"}

                  {!submitting && (
                    <ArrowRight size={15} />
                  )}
                </button>
              </form>
            )}

            {mode === "invite" && (inviteCallbackState === "checking" || loading) && (
              <div className="mt-7 text-center text-sm text-[#6f6c66]">Verifying your invitation…</div>
            )}

            {mode === "invite" && inviteCallbackState === "failed" && !loading && (
              <div className="mt-7 rounded-xl border border-[#f0d2c2] bg-[#fff7f2] p-4 text-sm leading-6 text-[#8b3c1b]">
                We could not verify this invitation. It may have expired or already been used. Ask your AeroFly administrator to send a fresh invitation, then open the newest email link.
              </div>
            )}

            {(mode === "reset" && isAuthenticated || mode === "invite" && inviteCallbackState === "ready" && Boolean(session?.user)) && (
              <form
                onSubmit={handleUpdatePassword}
                className="mt-7 space-y-4"
              >
                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-[#77736c]">
                    New password
                  </span>

                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    className="field w-full"
                    placeholder="At least 8 characters"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-[11px] font-bold uppercase tracking-[.12em] text-[#77736c]">
                    Confirm password
                  </span>

                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) =>
                      setConfirmPassword(event.target.value)
                    }
                    className="field w-full"
                    placeholder="Repeat your password"
                  />
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary mt-2 w-full"
                >
                  {submitting
                    ? "Saving password…"
                    : mode === "invite" ? "Set password and continue" : "Update password"}

                  {!submitting && (
                    <ArrowRight size={15} />
                  )}
                </button>
              </form>
            )}

            {mode !== "reset" && mode !== "invite" && (
              <div className="mt-7 flex items-center gap-3 text-[11px] text-[#a29d95]">
                <span className="h-px flex-1 bg-[#e8e4dd]" />
                Secure sign-in
                <span className="h-px flex-1 bg-[#e8e4dd]" />
              </div>
            )}

            {mode !== "reset" && mode !== "invite" && (
              <div className="mt-6 text-center">
                {mode === "signin" ? (
                  <p className="text-[11px] text-[#908b83]">
                    New to AeroFly?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        clearFormMessage();
                        setMode("signup");
                      }}
                      className="font-bold text-[#c94d1c]"
                    >
                      Create an account
                    </button>
                  </p>
                ) : mode === "signup" ? (
                  <p className="text-[11px] text-[#908b83]">
                    Already have an account?{" "}
                    <button
                      type="button"
                      onClick={() => {
                        clearFormMessage();
                        setMode("signin");
                      }}
                      className="font-bold text-[#c94d1c]"
                    >
                      Sign in
                    </button>
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      clearFormMessage();
                      setMode("signin");
                    }}
                    className="text-[11px] font-bold text-[#c94d1c]"
                  >
                    Back to sign in
                  </button>
                )}
              </div>
            )}

            <p className="mt-6 text-center text-[11px] leading-5 text-[#908b83]">
              AeroFly uses Supabase Auth for account
              security. Never share your password with
              anyone claiming to represent AeroFly.
            </p>

            <Link
              href="/"
              className="mx-auto mt-8 inline-flex items-center gap-2 text-[12px] font-bold text-[#6f6c66] hover:text-[#c94d1c]"
            >
              <ArrowLeft size={14} />
              Back to public site
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function getFriendlyAuthError(
  error: Error
): string {
  const message =
    error.message.toLowerCase();

  if (
    message.includes("invalid login credentials")
  ) {
    return "The email or password is incorrect.";
  }

  if (
    message.includes("email not confirmed")
  ) {
    return "Please verify your email before signing in.";
  }

  if (
    message.includes("user already registered")
  ) {
    return "An account already exists with this email.";
  }

  if (
    message.includes("password should be")
  ) {
    return "Please choose a stronger password.";
  }

  if (
    message.includes("rate limit")
  ) {
    return "Too many attempts. Please wait a moment and try again.";
  }

  if (
    message.includes("network") ||
    message.includes("fetch")
  ) {
    return "We could not reach the authentication service. Check your connection and try again.";
  }

  return "We could not complete that authentication request. Please try again.";
}