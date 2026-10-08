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

type AuthMode =
  | "signin"
  | "signup"
  | "forgot"
  | "reset";

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
    user,
    loading,
    isAuthenticated,
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

  const [mode, setMode] =
    useState<AuthMode>(
      requestedReset ? "reset" : "signin"
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

  const [message, setMessage] =
    useState<string | null>(null);

  const nextPath =
    params.get("next") || "/dashboard";

  useEffect(() => {
    if (
      requestedReset &&
      isAuthenticated
    ) {
      setMode("reset");
    }
  }, [
    requestedReset,
    isAuthenticated,
  ]);

  useEffect(() => {
    if (
      loading ||
      !isAuthenticated ||
      mode === "reset"
    ) {
      return;
    }

    if (mode === "signin") {
      setLocation(nextPath);
    }
  }, [
    loading,
    isAuthenticated,
    mode,
    nextPath,
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

      setLocation(nextPath);
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
                AeroFly customer area
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

            {mode === "reset" && (
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
                    ? "Updating…"
                    : "Update password"}

                  {!submitting && (
                    <ArrowRight size={15} />
                  )}
                </button>
              </form>
            )}

            {mode !== "reset" && (
              <div className="mt-7 flex items-center gap-3 text-[11px] text-[#a29d95]">
                <span className="h-px flex-1 bg-[#e8e4dd]" />
                Secure sign-in
                <span className="h-px flex-1 bg-[#e8e4dd]" />
              </div>
            )}

            {mode !== "reset" && (
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