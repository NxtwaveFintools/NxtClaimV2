type SearchParamsValue = string | string[] | undefined;

const DASHBOARD_PATH_PREFIX = "/dashboard";

export function firstParamValue(value: SearchParamsValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export function toSearchParams(searchParams?: Record<string, SearchParamsValue>): URLSearchParams {
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

export function buildPathWithSearchParams(pathname: string, queryString?: string): string {
  if (!queryString) {
    return pathname;
  }

  const normalizedQuery = new URLSearchParams(queryString).toString();
  return normalizedQuery.length > 0 ? `${pathname}?${normalizedQuery}` : pathname;
}

export function appendReturnToParam(targetPath: string, returnTo: string): string {
  const [pathname, existingQuery = ""] = targetPath.split("?");
  const params = new URLSearchParams(existingQuery);
  params.set("returnTo", returnTo);

  const query = params.toString();
  return query.length > 0 ? `${pathname}?${query}` : pathname;
}

export function sanitizeDashboardReturnToPath(returnTo?: string | null): string | null {
  if (!returnTo) {
    return null;
  }

  let candidate = returnTo.trim();

  if (candidate.length === 0) {
    return null;
  }

  if (candidate.startsWith("%2F") || candidate.startsWith("%2f")) {
    try {
      candidate = decodeURIComponent(candidate);
    } catch {
      return null;
    }
  }

  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return null;
  }

  let parsed: URL;

  try {
    parsed = new URL(candidate, "http://localhost");
  } catch {
    return null;
  }

  const { pathname, search, hash } = parsed;
  const isDashboardPath =
    pathname === DASHBOARD_PATH_PREFIX || pathname.startsWith(`${DASHBOARD_PATH_PREFIX}/`);

  if (!isDashboardPath) {
    return null;
  }

  return `${pathname}${search}${hash}`;
}

export function buildCursorPageHref(
  searchParams: Record<string, SearchParamsValue> | undefined,
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

  params.delete("page");

  const query = params.toString();
  return query ? `?${query}` : "?";
}
