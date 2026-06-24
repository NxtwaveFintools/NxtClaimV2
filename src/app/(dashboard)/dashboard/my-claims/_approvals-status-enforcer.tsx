"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

export function ApprovalsStatusEnforcer({ defaultStatus }: { defaultStatus: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  useEffect(() => {
    const currentStatus = searchParams.get("status");

    const navEntries = window.performance.getEntriesByType("navigation");
    const isReload =
      navEntries.length > 0 && (navEntries[0] as PerformanceNavigationTiming).type === "reload";

    const shouldReset = !currentStatus || (isReload && currentStatus !== defaultStatus);

    if (shouldReset) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("status", defaultStatus);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }
    // Intentionally runs once on mount — stale closure is correct here.
    // navEntries[0].type is set by the browser at page load and never changes
    // during client-side navigation, so the reload check is safe with [] deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
