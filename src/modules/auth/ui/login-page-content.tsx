"use client";

import { Plus_Jakarta_Sans } from "next/font/google";
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

const loginDisplayFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
});

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background transition-colors">
      {/* Background gradients */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -right-40 -top-40 h-[600px] w-[600px] rounded-full bg-[var(--accent-muted)] opacity-60 blur-[150px]" />
        <div className="absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-background-secondary opacity-40 blur-[120px]" />
      </div>

      {/* Theme toggle */}
      <div className="absolute right-5 top-5 z-20">
        <ThemeToggle />
      </div>

      {/* Centered content column */}
      <div className="relative z-10 flex w-full flex-col items-center px-5 py-16 sm:px-8">
        <div className="w-full max-w-[420px]">
          {/* Brand header */}
          <div className="mb-8 text-center">
            <h1
              className={`${loginDisplayFont.className} text-[32px] font-bold tracking-[-0.03em] text-foreground sm:text-[32px]`}
            >
              NxtClaim V2
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to manage claims, reimbursements, and settlements.
            </p>
          </div>

          {/* Error Banner */}
          {error || queryError ? (
            <div className="mb-5 rounded-[var(--radius-md)] border border-danger bg-danger-muted px-4 py-3 text-center text-sm text-danger">
              {error ?? queryError}
            </div>
          ) : null}

          {/* Login Card */}
          <div className="rounded-[var(--radius-xl)] border border-border bg-card p-8 shadow-lg transition-colors">
            <OAuthButtons loading={loading} onMicrosoftClick={handleMicrosoftLogin} />

            {/* Divider */}
            <div className="relative my-7">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <span className="bg-card px-4">OR CONTINUE WITH EMAIL</span>
              </div>
            </div>

            <EmailLoginForm loading={loading} onSubmit={handleEmailSubmit} />
          </div>
        </div>
      </div>

      {/* Bottom-left brand mark */}
      <div
        className="pointer-events-none fixed bottom-6 left-6 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-sm font-bold text-foreground shadow-sm select-none"
        aria-hidden="true"
      >
        N
      </div>
    </div>
  );
}
