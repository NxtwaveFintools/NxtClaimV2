"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ROUTES } from "@/core/config/route-registry";

type BackButtonProps = {
  label?: string;
  className?: string;
  fallbackHref?: string;
};

function resolveTargetHref(fallbackHref: string): string {
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
}

export function BackButton({
  label = "Back",
  className = "",
  fallbackHref = ROUTES.dashboard,
}: BackButtonProps) {
  const [targetHref, setTargetHref] = useState(fallbackHref);
  const variant = "ghost";

  useEffect(() => {
    setTargetHref(resolveTargetHref(fallbackHref));
  }, [fallbackHref]);

  return (
    <Link
      href={targetHref}
      scroll={false}
      data-variant={variant}
      className={`group inline-flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-sm font-medium text-zinc-700 transition-all duration-200 hover:bg-zinc-100 active:scale-[0.98] dark:text-zinc-200 dark:hover:bg-zinc-900 ${className}`.trim()}
      aria-label="Go back"
    >
      <ArrowLeft
        className="h-4 w-4 transition-transform duration-200 group-hover:-tranzinc-x-1"
        aria-hidden="true"
      />
      <span>{label}</span>
    </Link>
  );
}
