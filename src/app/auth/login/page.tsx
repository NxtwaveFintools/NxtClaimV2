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
import { EmailLoginForm } from "@/modules/auth/ui/email-login-form";
import { OAuthButtons } from "@/modules/auth/ui/oauth-buttons";
import type { LoginFormValues } from "@/modules/auth/validators/login-schema";

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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,#dbeafe_0%,#f8fafc_45%,#e2e8f0_100%)] px-6 py-10">
      <div className="mx-auto grid max-w-md gap-6 rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-xl shadow-slate-900/5 backdrop-blur">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">
            NxtClaim V2
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">Sign in to continue</h1>
          <p className="text-sm text-slate-600">
            Use your official NxtWave account to access the reimbursement portal.
          </p>
        </div>

        {error || queryError ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error ?? queryError}
          </p>
        ) : null}

        <OAuthButtons
          loading={loading}
          onMicrosoftClick={handleMicrosoftLogin}
          onGoogleClick={handleGoogleLogin}
        />

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 text-slate-500">Or continue with email</span>
          </div>
        </div>

        <EmailLoginForm loading={loading} onSubmit={handleEmailSubmit} />
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
