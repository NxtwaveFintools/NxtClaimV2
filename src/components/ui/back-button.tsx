"use client";

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ROUTES } from "@/core/config/route-registry";

type BackButtonProps = {
  label?: string;
  className?: string;
  fallbackHref?: string;
};

function hasBrowserHistory(): boolean {
  try {
    const referrer = document.referrer;
    return Boolean(referrer && referrer.startsWith(window.location.origin));
  } catch {
    return false;
  }
}

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

function subscribeToBrowserNavigation(): () => void {
  return () => {};
}

export function BackButton({
  label = "Back",
  className = "",
  fallbackHref = ROUTES.dashboard,
}: BackButtonProps) {
  const router = useRouter();
  const canGoBack = useSyncExternalStore(
    subscribeToBrowserNavigation,
    hasBrowserHistory,
    () => false,
  );
  const targetHref = useSyncExternalStore(
    subscribeToBrowserNavigation,
    () => resolveTargetHref(fallbackHref),
    () => fallbackHref,
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (canGoBack) {
        event.preventDefault();
        router.back();
      }
    },
    [canGoBack, router],
  );

  return (
    <Link
      href={targetHref}
      scroll={false}
      onClick={handleClick}
      className={`group inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-background-secondary hover:text-foreground active:scale-[0.98] ${className}`.trim()}
      aria-label="Go back"
    >
      <ArrowLeft
        className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-0.5"
        aria-hidden="true"
      />
      <span>{label}</span>
    </Link>
  );
}
