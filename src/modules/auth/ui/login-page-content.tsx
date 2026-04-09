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
      : queryErrorCode === "sso-failed"
        ? "Microsoft sign-in failed. Please try again."
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-zinc-50 transition-colors dark:bg-[#0B0F1A]">
      <div
        className="pointer-events-none absolute inset-0 bg-linear-to-br from-white via-zinc-50 to-sky-50/55 dark:from-[#060917] dark:via-[#0B0F1A] dark:to-[#0E1729]"
        aria-hidden="true"
      />

      {/* Ambient background — large soft orbs */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -right-24 -top-28 h-150 w-150 rounded-full bg-linear-to-bl from-indigo-300/65 via-violet-200/45 to-transparent blur-[135px] dark:from-indigo-500/22 dark:via-violet-500/12 dark:to-transparent" />
        <div className="absolute right-10 top-8 h-96 w-96 rounded-full border border-indigo-200/70 bg-indigo-100/25 dark:border-indigo-400/10 dark:bg-indigo-500/5" />
        <div className="absolute -bottom-24 -left-24 h-125 w-125 rounded-full bg-linear-to-tr from-sky-300/70 via-cyan-200/50 to-transparent blur-[125px] dark:from-sky-500/18 dark:via-cyan-500/10 dark:to-transparent" />
        <div className="absolute bottom-8 left-6 h-72 w-72 rounded-full border border-sky-200/75 bg-sky-100/30 dark:border-sky-400/10 dark:bg-sky-500/5" />
        <div className="absolute left-1/2 top-1/2 h-90 w-90 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-300/10 blur-[115px] dark:bg-violet-500/6" />
      </div>

      {/* Subtle dot grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.018] dark:opacity-[0.032]"
        aria-hidden="true"
        style={{
          backgroundImage: "radial-gradient(circle, #6366f1 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Theme toggle */}
      <div className="absolute right-5 top-5 z-20">
        <ThemeToggle />
      </div>

      {/* Centered content column */}
      <div className="relative z-10 flex w-full flex-col items-center px-5 py-16 sm:px-8">
        <div className="w-full max-w-105">
          <div className="mb-6 text-center">
            <p
              className={`${loginDisplayFont.className} text-[30px] font-extrabold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50 sm:text-[34px]`}
            >
              NxtClaim V2
            </p>
          </div>

          {/* Error Banner */}
          {error || queryError ? (
            <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              {error ?? queryError}
            </div>
          ) : null}

          {/* Card */}
          <div className="rounded-[28px] border border-zinc-200/80 bg-white/95 px-7 py-8 shadow-[0_32px_100px_-28px_rgba(15,23,42,0.13),0_0_0_1px_rgba(99,102,241,0.04)] backdrop-blur-sm transition-colors dark:border-zinc-800/70 dark:bg-zinc-900/95 dark:shadow-[0_32px_100px_-28px_rgba(0,0,0,0.55)]">
            <OAuthButtons loading={loading} onMicrosoftClick={handleMicrosoftLogin} />

            <div className="relative my-7">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-zinc-100 dark:border-zinc-800" />
              </div>
              <div className="relative flex justify-center text-[11px] font-semibold uppercase tracking-[0.18em]">
                <span className="bg-white px-4 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
                  Or continue with email
                </span>
              </div>
            </div>

            <EmailLoginForm loading={loading} onSubmit={handleEmailSubmit} />
          </div>
        </div>
      </div>
    </div>
  );
}
