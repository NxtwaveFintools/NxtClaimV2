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
      ? "Your email domain is not authorized for this workspace."
      : queryErrorCode === "sso-failed" || queryErrorCode === "sso_failed"
        ? "Microsoft sign-in failed. Please try again."
        : queryErrorCode === "session_expired"
          ? "Your session expired. Please sign in again."
          : null;

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      const domainResult = await enforceSessionDomainAction();
      if (!isMounted) return;

      if (!domainResult.valid) {
        setError(domainResult.message ?? "Unauthorized domain.");
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
      setError(result.message ?? "Unable to sign in.");
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
      setError(result.message ?? "Unable to continue with Microsoft.");
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-6">
      {/* Subtle background wash */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-accent-muted opacity-[0.06] blur-3xl dark:opacity-[0.08]" />
        <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-accent-muted opacity-[0.06] blur-3xl dark:opacity-[0.08]" />
      </div>

      {/* Theme toggle */}
      <div className="absolute right-5 top-5 z-20 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:bg-background-secondary">
        <ThemeToggle />
      </div>

      {/* Centered content */}
      <div className="relative z-10 flex w-full max-w-[420px] flex-col items-center">
        {/* Brand area */}
        <div className="mb-8 text-center">
          <h1 className="dashboard-font-display text-[28px] font-bold tracking-tight text-foreground">
            NxtClaim V2
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Claims, approvals, and finance operations
          </p>
        </div>

        {/* Error Banner */}
        {error || queryError ? (
          <div className="mb-5 w-full rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
            {error ?? queryError}
          </div>
        ) : null}

        {/* Login Card */}
        <div className="w-full rounded-xl border border-border bg-card p-6 shadow-sm">
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
