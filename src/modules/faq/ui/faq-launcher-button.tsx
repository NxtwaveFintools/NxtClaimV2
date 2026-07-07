"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HelpCircle } from "lucide-react";
import { ROUTES } from "@/core/config/route-registry";

const HIDDEN_PATHS = new Set(["/", ROUTES.login, ROUTES.auth.callback, ROUTES.faq]);

const CLAIM_DETAIL_PATH_PATTERN = /^\/dashboard\/claims\/(?!hod-pending$)[^/]+$/;

export function FaqLauncherButton() {
  const pathname = usePathname();

  if (!pathname || HIDDEN_PATHS.has(pathname)) {
    return null;
  }

  const isOverStickyActionBar = CLAIM_DETAIL_PATH_PATTERN.test(pathname);

  return (
    <Link
      href={ROUTES.faq}
      aria-label="Open Frequently Asked Questions"
      className={`group fixed right-6 ${isOverStickyActionBar ? "bottom-24" : "bottom-6"} z-50 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/30 transition-all duration-200 hover:scale-105 hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-400`}
    >
      <span
        className="absolute inset-0 -z-10 rounded-full bg-indigo-400/40 animate-ping"
        aria-hidden="true"
      />
      <HelpCircle className="h-4.5 w-4.5" aria-hidden="true" />
      <span>FAQ</span>
    </Link>
  );
}
