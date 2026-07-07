"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ROUTES } from "@/core/config/route-registry";

export function FaqBackButton() {
  const router = useRouter();

  const handleClick = useCallback(() => {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push(ROUTES.dashboard);
  }, [router]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="group inline-flex w-fit items-center gap-1.5 rounded-lg border border-indigo-200/60 bg-indigo-50/60 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition-all duration-200 hover:border-indigo-300 hover:bg-indigo-100/80 hover:text-indigo-800 active:scale-[0.98] dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:border-indigo-400/30 dark:hover:bg-indigo-500/20 dark:hover:text-indigo-200"
      aria-label="Go back"
    >
      <ArrowLeft
        className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-0.5"
        aria-hidden="true"
      />
      <span>Back</span>
    </button>
  );
}
