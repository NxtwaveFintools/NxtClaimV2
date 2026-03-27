"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

type MyClaimsPaginationControlsProps = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  currentCursor: string | null;
  nextCursor: string | null;
  previousCursor: string | null;
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
  cursor: string | null,
  prevCursor: string | null,
): string {
  const params = toSearchParams(searchParams);

  if (cursor) {
    params.set("cursor", cursor);
  } else {
    params.delete("cursor");
  }

  if (prevCursor) {
    params.set("prevCursor", prevCursor);
  } else {
    params.delete("prevCursor");
  }

  const query = params.toString();
  return query ? `?${query}` : "?";
}

export function MyClaimsPaginationControls({
  hasNextPage,
  hasPreviousPage,
  currentCursor,
  nextCursor,
  previousCursor,
  searchParams,
}: MyClaimsPaginationControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const nextHref =
    hasNextPage && nextCursor
      ? buildPageHref(searchParams, nextCursor, currentCursor ?? "__first__")
      : null;

  const previousHref =
    hasPreviousPage && previousCursor
      ? buildPageHref(searchParams, previousCursor === "__first__" ? null : previousCursor, null)
      : null;

  const navigateTo = (href: string | null): void => {
    if (!href) {
      return;
    }

    const nextHref = href === "?" ? pathname : `${pathname}${href}`;
    startTransition(() => {
      router.replace(nextHref, { scroll: false });
    });
  };

  return (
    <div
      className={`flex items-center justify-end gap-2 border-t border-zinc-200 px-4 py-3 transition-opacity dark:border-zinc-800 ${
        isPending ? "opacity-80" : "opacity-100"
      }`}
    >
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
          className="inline-flex rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 transition-all duration-200 hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Previous
        </button>
      ) : (
        <span className="inline-flex cursor-not-allowed rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-400 opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500">
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
          className="inline-flex rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-zinc-700 active:scale-[0.98] dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Next
        </button>
      ) : (
        <span className="inline-flex cursor-not-allowed rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          Next
        </span>
      )}
    </div>
  );
}
