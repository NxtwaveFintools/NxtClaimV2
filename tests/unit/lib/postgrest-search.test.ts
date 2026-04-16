import {
  buildBeneficiaryScopedIlikeOrFilter,
  toContainsIlikePattern,
  toQuotedContainsIlikePattern,
} from "@/lib/postgrest-search";

describe("postgrest-search helpers", () => {
  test("toContainsIlikePattern wraps search in SQL wildcards", () => {
    expect(toContainsIlikePattern("EMP-001")).toBe("%EMP-001%");
  });

  test("toQuotedContainsIlikePattern escapes reserved characters", () => {
    expect(toQuotedContainsIlikePattern('A,"B"\\C')).toBe('"%A,\\"B\\"\\\\C%"');
  });

  test("buildBeneficiaryScopedIlikeOrFilter composes scoped OR filter with quoted pattern", () => {
    expect(
      buildBeneficiaryScopedIlikeOrFilter({
        searchQuery: "EMP-001",
        selfField: "claim_employee_id_raw",
        onBehalfField: "on_behalf_employee_code_raw",
      }),
    ).toBe(
      'and(submission_type.eq."Self",claim_employee_id_raw.ilike."%EMP-001%"),and(submission_type.eq."On Behalf",on_behalf_employee_code_raw.ilike."%EMP-001%")',
    );
  });
});
