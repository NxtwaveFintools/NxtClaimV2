const POSTGREST_SUBMISSION_TYPE_SELF = '"Self"';
const POSTGREST_SUBMISSION_TYPE_ON_BEHALF = '"On Behalf"';

function escapeForPostgrestQuotedValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function toContainsIlikePattern(searchQuery: string): string {
  return `%${searchQuery}%`;
}

export function toQuotedContainsIlikePattern(searchQuery: string): string {
  return `"${escapeForPostgrestQuotedValue(toContainsIlikePattern(searchQuery))}"`;
}

export function buildBeneficiaryScopedIlikeOrFilter(input: {
  searchQuery: string;
  selfField: string;
  onBehalfField: string;
}): string {
  const pattern = toQuotedContainsIlikePattern(input.searchQuery);

  return `and(submission_type.eq.${POSTGREST_SUBMISSION_TYPE_SELF},${input.selfField}.ilike.${pattern}),and(submission_type.eq.${POSTGREST_SUBMISSION_TYPE_ON_BEHALF},${input.onBehalfField}.ilike.${pattern})`;
}
