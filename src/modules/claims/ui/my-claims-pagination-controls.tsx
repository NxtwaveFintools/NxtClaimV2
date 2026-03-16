import Link from "next/link";

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
  const nextHref =
    hasNextPage && nextCursor
      ? buildPageHref(searchParams, nextCursor, currentCursor ?? "__first__")
      : null;

  const previousHref =
    hasPreviousPage && previousCursor
      ? buildPageHref(searchParams, previousCursor === "__first__" ? null : previousCursor, null)
      : null;

  return (
    <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
      {previousHref ? (
        <Link
          href={previousHref}
          className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-50 active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Previous
        </Link>
      ) : (
        <span className="inline-flex cursor-not-allowed rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-400 opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500">
          Previous
        </span>
      )}
      {nextHref ? (
        <Link
          href={nextHref}
          className="inline-flex rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-slate-700 active:scale-[0.98] dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
        >
          Next
        </Link>
      ) : (
        <span className="inline-flex cursor-not-allowed rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white opacity-50 dark:bg-slate-100 dark:text-slate-900">
          Next
        </span>
      )}
    </div>
  );
}
