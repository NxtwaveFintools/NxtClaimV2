"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ROUTES } from "@/core/config/route-registry";
import {
  enforceSessionDomainAction,
  loginWithEmailAction,
  loginWithGoogleAction,
  loginWithMicrosoftAction,
} from "@/modules/auth/actions";
import { ThemeToggle } from "@/components/theme-toggle";
import { EmailLoginForm } from "@/modules/auth/ui/email-login-form";
import { OAuthButtons } from "@/modules/auth/ui/oauth-buttons";
import type { LoginFormValues } from "@/modules/auth/validators/login-schema";
import { Banknote } from "lucide-react";

function LoginPageContent() {
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

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    const result = await loginWithGoogleAction();
    if (!result.ok) {
      setError(result.message ?? "Unable to continue with Google.");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 transition-colors dark:bg-[#0B0F1A]">
      <div className="flex w-full items-center justify-end p-6 absolute top-0 right-0">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-20">
        <div className="w-full max-w-[380px]">
          {/* Header */}
          <div className="mb-10 flex flex-col items-center text-center">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm dark:bg-indigo-500">
              <Banknote className="h-7 w-7 stroke-[2]" />
            </div>
            <h1 className="mb-2 text-lg font-bold tracking-wide text-zinc-900 dark:text-zinc-100">
              NxtClaim V2
            </h1>
            <h2 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Sign in to continue
            </h2>
          </div>

          <div className="w-full rounded-2xl border border-zinc-200 bg-white p-6 sm:p-8 shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
            {error || queryError ? (
              <p className="mb-6 rounded-xl bg-rose-50 px-4 py-3 text-sm text-center text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-100 dark:border-rose-900/50">
                {error ?? queryError}
              </p>
            ) : null}

            <OAuthButtons
              loading={loading}
              onMicrosoftClick={handleMicrosoftLogin}
              onGoogleClick={handleGoogleLogin}
            />

            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-zinc-200 dark:border-zinc-800" />
              </div>
              <div className="relative flex justify-center text-xs font-medium uppercase tracking-wider">
                <span className="bg-white px-4 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
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

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
