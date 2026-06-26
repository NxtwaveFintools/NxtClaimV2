/**
 * Returns `historicalId` when it is present in `options`, otherwise falls back
 * to the first option's id. Returns `""` when `options` is empty.
 *
 * Priority: Last-claim history > First available option > empty string.
 */
export function resolveHistoricalDefault(
  historicalId: string | null | undefined,
  options: { id: string }[],
): string {
  if (historicalId && options.some((o) => o.id === historicalId)) {
    return historicalId;
  }
  return options[0]?.id ?? "";
}
