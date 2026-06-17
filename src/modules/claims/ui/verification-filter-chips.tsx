"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { VerificationBadgeState } from "@/modules/claims/repositories/SupabaseVerificationRepository";

type VerificationFilterChipsProps = {
  counts: Record<VerificationBadgeState, number>;
};

const CHIP_ORDER: { state: VerificationBadgeState; label: string; activeClass: string }[] = [
  { state: "mismatch", label: "Mismatch", activeClass: "bg-rose-600 text-white border-rose-600" },
  {
    state: "statement_mismatch",
    label: "Statement mismatch",
    activeClass: "bg-orange-600 text-white border-orange-600",
  },
  {
    state: "needs_review",
    label: "Needs review",
    activeClass: "bg-amber-600 text-white border-amber-600",
  },
  {
    state: "verified",
    label: "Verified",
    activeClass: "bg-emerald-600 text-white border-emerald-600",
  },
  { state: "pending", label: "Pending", activeClass: "bg-sky-600 text-white border-sky-600" },
  {
    state: "extraction_failed",
    label: "Extraction failed",
    activeClass: "bg-zinc-700 text-white border-zinc-700",
  },
  {
    state: "no_document",
    label: "No document",
    activeClass: "bg-zinc-500 text-white border-zinc-500",
  },
];

export function VerificationFilterChips({ counts }: VerificationFilterChipsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = searchParams.get("ai_verdict");

  const setVerdict = (state: VerificationBadgeState | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (state === null || state === active) {
      params.delete("ai_verdict");
    } else {
      params.set("ai_verdict", state);
    }
    // Reset pagination when the filter changes.
    params.delete("cursor");
    params.delete("prevCursor");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
        AI Check
      </span>
      {CHIP_ORDER.map(({ state, label, activeClass }) => {
        const isActive = active === state;
        const count = counts[state] ?? 0;
        return (
          <button
            key={state}
            type="button"
            onClick={() => setVerdict(state)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? activeClass
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
            aria-pressed={isActive}
          >
            {label}
            <span
              className={`rounded-full px-1.5 text-[10px] font-semibold ${
                isActive
                  ? "bg-white/25"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
      {active ? (
        <button
          type="button"
          onClick={() => setVerdict(null)}
          className="text-xs font-medium text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
