"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ROUTES } from "@/core/config/route-registry";
import {
  enforceSessionDomainAction,
  loginWithEmailAction,
  loginWithMicrosoftAction,
} from "@/modules/auth/actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { EmailLoginForm } from "@/modules/auth/ui/email-login-form";
import { OAuthButtons } from "@/modules/auth/ui/oauth-buttons";
import type { LoginFormValues } from "@/modules/auth/validators/login-schema";

export function LoginPageContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryErrorCode = params.get("error");
  const queryError =
    queryErrorCode === "unauthorized_domain"
      ? "Please sign in using an approved company email address."
      : queryErrorCode === "sso-failed" || queryErrorCode === "sso_failed"
        ? "We couldn't complete sign-in with this provider. Please try again."
        : queryErrorCode === "session_expired"
          ? "Your session has expired. Please sign in again."
          : null;

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      const domainResult = await enforceSessionDomainAction();
      if (!isMounted) return;

      if (!domainResult.valid) {
        setError(domainResult.message ?? "Please sign in using an approved company email address.");
        return;
      }

      if (domainResult.hasUser) {
        router.replace(ROUTES.dashboard);
      }
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, [router]);

  const handleEmailSubmit = async (values: LoginFormValues) => {
    setLoading(true);
    setError(null);

    const result = await loginWithEmailAction(values);
    if (!result.ok) {
      setError(result.message ?? "We couldn't sign you in. Please try again.");
      setLoading(false);
      return;
    }

    router.replace(ROUTES.dashboard);
  };

  const handleMicrosoftLogin = async () => {
    setLoading(true);
    setError(null);
    const result = await loginWithMicrosoftAction();
    if (!result.ok) {
      setError(
        result.message ?? "We couldn't complete sign-in with this provider. Please try again.",
      );
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-8">
      {/* Subtle background wash */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-accent-muted opacity-[0.06] blur-3xl dark:opacity-[0.08] sm:h-96 sm:w-96" />
        <div className="absolute bottom-0 left-0 h-56 w-56 rounded-full bg-accent-muted opacity-[0.06] blur-3xl dark:opacity-[0.08] sm:h-96 sm:w-96" />
      </div>

      {/* Theme toggle */}
      <div className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-background-secondary sm:right-5 sm:top-5">
        <ThemeToggle />
      </div>

      {/* Centered content */}
      <div className="relative z-10 flex w-full max-w-[420px] flex-col items-center">
        {/* Brand area */}
        <div className="mb-6 text-center sm:mb-8">
          <h1 className="dashboard-font-display text-[25px] font-bold tracking-tight text-foreground sm:text-[28px]">
            NxtClaim V2
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Claims, approvals, and finance operations
          </p>
        </div>

        {/* Error Banner */}
        {error || queryError ? (
          <div className="mb-5 w-full rounded-lg border border-danger/30 bg-danger-muted px-4 py-3 text-center text-sm text-danger">
            {error ?? queryError}
          </div>
        ) : null}

        {/* Login Card */}
        <div className="w-full rounded-xl border border-border bg-card p-5 sm:p-6">
          <OAuthButtons loading={loading} onMicrosoftClick={handleMicrosoftLogin} />

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-[11px] font-semibold uppercase tracking-[0.06em]">
              <span className="bg-card px-3 text-muted-foreground">OR CONTINUE WITH EMAIL</span>
            </div>
          </div>

          <EmailLoginForm loading={loading} onSubmit={handleEmailSubmit} />
        </div>

        {/* Helper text */}
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Use your approved company email to continue.
        </p>
      </div>
    </div>
  );
}
