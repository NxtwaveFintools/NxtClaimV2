type SearchParamsValue = string | string[] | undefined;

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

export function buildCursorPageHref(
  searchParams: Record<string, SearchParamsValue> | undefined,
  cursor: string | null,
  prevCursor: string | null,
  page: number,
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

  if (page > 1) {
    params.set("page", String(page));
  } else {
    params.delete("page");
  }

  const query = params.toString();
  return query ? `?${query}` : "?";
}

export function buildOffsetPageHref(
  searchParams: Record<string, SearchParamsValue> | undefined,
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
