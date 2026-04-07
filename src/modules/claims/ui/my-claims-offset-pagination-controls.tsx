"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

type MyClaimsOffsetPaginationControlsProps = {
  totalCount: number;
  page: number;
  limit: number;
  position?: "top" | "bottom";
  searchParams?: Record<string, string | string[] | undefined>;
};

function firstParamValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function toSearchParams(
  searchParams?: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();

  if (!searchParams) {
    return params;
  }

  for (const [key, value] of Object.entries(searchParams)) {
    const normalized = firstParamValue(value);
    if (normalized) {
      params.set(key, normalized);
    }
  }

  return params;
}

function buildPageHref(
  searchParams: Record<string, string | string[] | undefined> | undefined,
  page: number,
): string {
  const params = toSearchParams(searchParams);

  params.delete("cursor");
  params.delete("prevCursor");
  params.delete("limit");

  if (page > 1) {
    params.set("page", String(page));
  } else {
    params.delete("page");
  }

  const query = params.toString();
  return query ? `?${query}` : "?";
}

export function MyClaimsOffsetPaginationControls({
  totalCount,
  page,
  limit,
  position = "bottom",
  searchParams,
}: MyClaimsOffsetPaginationControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const safePage = Math.max(1, Math.floor(page));
  const hasRowsOnPage = totalCount > (safePage - 1) * limit;
  const start = hasRowsOnPage ? (safePage - 1) * limit + 1 : 0;
  const end = hasRowsOnPage ? Math.min(safePage * limit, totalCount) : 0;
  const hasPreviousPage = safePage > 1;
  const hasNextPage = safePage * limit < totalCount;

  const previousHref = hasPreviousPage ? buildPageHref(searchParams, safePage - 1) : null;
  const nextHref = hasNextPage ? buildPageHref(searchParams, safePage + 1) : null;

  const navigateTo = (href: string | null): void => {
    if (!href) {
      return;
    }

    const nextHref = href === "?" ? pathname : `${pathname}${href}`;
    startTransition(() => {
      router.replace(nextHref, { scroll: false });
    });
  };

  const borderClass =
    position === "top"
      ? "border-b border-zinc-200/80 dark:border-zinc-800"
      : "border-t border-zinc-200/80 dark:border-zinc-800";

  return (
    <div
      className={`flex items-center justify-between gap-3 px-5 py-3.5 transition-opacity ${borderClass} ${
        isPending ? "opacity-80" : "opacity-100"
      }`}
    >
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {totalCount > 0
          ? `Showing ${start} to ${end} of ${totalCount} claims`
          : "Showing 0 to 0 of 0 claims"}
      </p>

      <div className="flex items-center justify-end gap-2.5">
        {isPending ? (
          <span className="mr-2 inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <svg
              className="h-3.5 w-3.5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Updating page...
          </span>
        ) : null}

        {previousHref ? (
          <button
            type="button"
            onClick={() => {
              navigateTo(previousHref);
            }}
            disabled={isPending}
            className="inline-flex rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition-all duration-200 hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Previous
          </button>
        ) : (
          <span className="inline-flex cursor-not-allowed rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-semibold text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600">
            Previous
          </span>
        )}

        {nextHref ? (
          <button
            type="button"
            onClick={() => {
              navigateTo(nextHref);
            }}
            disabled={isPending}
            className="inline-flex rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-indigo-500/20 transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98] dark:shadow-indigo-500/10"
          >
            Next
          </button>
        ) : (
          <span className="inline-flex cursor-not-allowed rounded-xl bg-indigo-600/50 px-4 py-2 text-sm font-semibold text-white/60 dark:bg-indigo-500/40">
            Next
          </span>
        )}
      </div>
    </div>
  );
}
