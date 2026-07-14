/**
 * AN-YYYYMMDD-<pr_id suffix>-<5-digit sequence>. Server-generated, never by the model.
 *
 * The suffix is the FULL pr_id (sanitized to alphanumerics), not just its trailing
 * hyphen segment -- pr_id is NOT NULL UNIQUE on purchase_requests, so this can't
 * collide across different PRs. Taking only the last segment (e.g. "01" from
 * "PR-MULTI-VERIFY-01") previously let unrelated PRs collide on the same
 * analysis_id string and fail the unique constraint on insert.
 */
export function buildAnalysisId(prId: string, sequenceNumber: number): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prSuffix = prId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() || "PR";
  return `AN-${datePart}-${prSuffix}-${String(sequenceNumber).padStart(5, "0")}`;
}
