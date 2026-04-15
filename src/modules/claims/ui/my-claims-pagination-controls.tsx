"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { buildCursorPageHref } from "@/lib/pagination-helpers";

type MyClaimsPaginationControlsProps = {
  hasNextPage: boolean;
  currentCursor: string | null;
  nextCursor: string | null;
  prevCursor: string | null;
  summaryText?: string;
  position?: "top" | "bottom";
  searchParams?: Record<string, string | string[] | undefined>;
};

export function MyClaimsPaginationControls({
  hasNextPage,
  currentCursor,
  nextCursor,
  prevCursor,
  summaryText,
  position = "bottom",
  searchParams,
}: MyClaimsPaginationControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const hasPreviousPage = Boolean(prevCursor);

  const nextHref =
    hasNextPage && nextCursor
      ? buildCursorPageHref(searchParams, nextCursor, currentCursor ?? "__first__")
      : null;

  const previousHref =
    hasPreviousPage && prevCursor
      ? buildCursorPageHref(searchParams, prevCursor === "__first__" ? null : prevCursor, null)
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

  const borderClass =
    position === "top"
      ? "border-b border-zinc-200/80 dark:border-zinc-800"
      : "border-t border-zinc-200/80 dark:border-zinc-800";

  return (
    <div
      className={`flex items-center ${summaryText ? "justify-between" : "justify-end"} gap-2.5 px-5 py-3.5 transition-opacity ${borderClass} ${
        isPending ? "opacity-80" : "opacity-100"
      }`}
    >
      {summaryText ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{summaryText}</p>
      ) : null}

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
          <Button
            onClick={() => {
              navigateTo(previousHref);
            }}
            disabled={isPending}
            variant="secondary"
            size="md"
          >
            Previous
          </Button>
        ) : (
          <Button variant="secondary" size="md" disabled>
            Previous
          </Button>
        )}
        {nextHref ? (
          <Button
            onClick={() => {
              navigateTo(nextHref);
            }}
            disabled={isPending}
            variant="primary"
            size="md"
          >
            Next
          </Button>
        ) : (
          <Button variant="primary" size="md" disabled>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
