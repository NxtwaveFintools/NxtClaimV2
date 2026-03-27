"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ROUTES } from "@/core/config/route-registry";

type BackButtonProps = {
  label?: string;
  className?: string;
  fallbackHref?: string;
};

export function BackButton({
  label = "Back",
  className = "",
  fallbackHref = ROUTES.dashboard,
}: BackButtonProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const variant = "ghost";

  const resolveTargetHref = (): string => {
    const referrer = document.referrer;
    const sameOriginReferrer = referrer.startsWith(window.location.origin);

    if (!sameOriginReferrer) {
      return fallbackHref;
    }

    try {
      const referrerUrl = new URL(referrer);
      const referrerView = referrerUrl.searchParams.get("view");

      if (
        fallbackHref.startsWith(ROUTES.claims.myClaims) &&
        referrerUrl.pathname === ROUTES.claims.myClaims &&
        referrerView === "approvals"
      ) {
        return `${ROUTES.claims.myClaims}?view=approvals`;
      }
    } catch {
      return fallbackHref;
    }

    return fallbackHref;
  };

  const handleGoBack = () => {
    startTransition(() => {
      router.push(resolveTargetHref(), { scroll: false });
    });
  };

  return (
    <button
      type="button"
      data-variant={variant}
      onClick={handleGoBack}
      className={`group inline-flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-sm font-medium text-slate-700 transition-all duration-200 hover:bg-slate-100 active:scale-[0.98] dark:text-slate-200 dark:hover:bg-slate-900 ${className}`.trim()}
      aria-label="Go back"
    >
      <ArrowLeft
        className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-1"
        aria-hidden="true"
      />
      <span>{label}</span>
    </button>
  );
}
