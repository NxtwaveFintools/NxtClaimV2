const ISO_DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function formatDateOnlyUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeIsoDateOnly(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!ISO_DATE_ONLY_REGEX.test(trimmed)) {
    return undefined;
  }

  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return formatDateOnlyUtc(parsed) === trimmed ? trimmed : undefined;
}

export function toStartOfDayIso(dateOnly: string): string {
  return `${dateOnly}T00:00:00.000Z`;
}

export function toEndOfDayIso(dateOnly: string): string {
  return `${dateOnly}T23:59:59.999Z`;
}
