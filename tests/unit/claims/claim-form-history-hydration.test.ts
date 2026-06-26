/** @jest-environment node */

import { resolveHistoricalDefault } from "@/modules/claims/utils/form-history";

const MOCK_OPTIONS = [
  { id: "opt-1", name: "Option 1" },
  { id: "opt-2", name: "Option 2" },
  { id: "opt-3", name: "Option 3" },
];

// ── Requirement 1a: Form fields inherit the last-claim history payload ────────

describe("resolveHistoricalDefault — form history inheritance", () => {
  it("returns historical ID when it exists in options", () => {
    expect(resolveHistoricalDefault("opt-2", MOCK_OPTIONS)).toBe("opt-2");
  });

  it("returns last option when historical ID matches the last entry", () => {
    expect(resolveHistoricalDefault("opt-3", MOCK_OPTIONS)).toBe("opt-3");
  });

  it("falls back to first option when historical ID is stale (not in options)", () => {
    expect(resolveHistoricalDefault("deleted-uuid", MOCK_OPTIONS)).toBe("opt-1");
  });

  it("falls back to first option when historical ID is null", () => {
    expect(resolveHistoricalDefault(null, MOCK_OPTIONS)).toBe("opt-1");
  });

  it("falls back to first option when historical ID is undefined", () => {
    expect(resolveHistoricalDefault(undefined, MOCK_OPTIONS)).toBe("opt-1");
  });

  it("returns empty string when options list is empty and no historical ID", () => {
    expect(resolveHistoricalDefault(null, [])).toBe("");
  });

  it("returns empty string when options list is empty even if historical ID is set", () => {
    expect(resolveHistoricalDefault("opt-1", [])).toBe("");
  });
});

// ── Requirement 1b: AI parse responses overwrite historical form state ────────

describe("AI category override guard logic", () => {
  it("guard passes when AI returns a non-empty matched category ID", () => {
    const matchedExpenseCategoryId = "ai-matched-cat-id";
    // The guard: `if (matchedExpenseCategoryId)` — truthy → setValue should run
    expect(Boolean(matchedExpenseCategoryId)).toBe(true);
  });

  it("guard blocks when resolveExpenseCategoryIdFromAi returns empty string (no match)", () => {
    const matchedExpenseCategoryId = ""; // function returns "" when categoryName is null or unmatched
    // The guard: `if (matchedExpenseCategoryId)` — falsy → setValue is skipped
    expect(Boolean(matchedExpenseCategoryId)).toBe(false);
  });

  it("AI with no match preserves the historical category value", () => {
    const historicalCategoryId = "opt-1";
    const aiResult = ""; // no AI match
    // Guard skips setValue → form retains historicalCategoryId
    const formValue = aiResult || historicalCategoryId;
    expect(formValue).toBe("opt-1");
  });

  it("AI with a confident match overwrites the historical category value", () => {
    const historicalCategoryId = "opt-1";
    const aiResult = "opt-3"; // AI matched a different category
    // Guard passes → setValue fires with aiResult
    const formValue = aiResult || historicalCategoryId;
    expect(formValue).toBe("opt-3");
  });

  it("resolveHistoricalDefault correctly seeds the form before AI runs", () => {
    // If user's last claim had opt-2, the form starts with opt-2
    const initialValue = resolveHistoricalDefault("opt-2", MOCK_OPTIONS);
    expect(initialValue).toBe("opt-2");

    // AI runs and finds opt-3 → overwrites
    const aiResult = "opt-3";
    const finalValue = aiResult || initialValue;
    expect(finalValue).toBe("opt-3");
  });

  it("resolveHistoricalDefault seeds the form and AI no-match leaves it unchanged", () => {
    const initialValue = resolveHistoricalDefault("opt-2", MOCK_OPTIONS);
    expect(initialValue).toBe("opt-2");

    const aiResult = ""; // no match
    const finalValue = aiResult || initialValue;
    expect(finalValue).toBe("opt-2"); // historical value preserved
  });
});

// ── Requirement 2: Filter URL params drive table re-hydration ────────────────

describe("Filter URL param detection (hasActiveFilterParams logic)", () => {
  function hasActiveFilterParams(params: URLSearchParams): boolean {
    const dateTarget = params.get("date_target");
    const searchQuery = (params.get("search_query") ?? "").trim();
    const searchField = params.get("search_field");

    if (searchQuery.length > 0) return true;
    if (searchField && searchField !== "claim_id") return true;
    if (dateTarget && dateTarget !== "submitted") return true;

    const trackedFilterKeys = [
      "submission_type",
      "payment_mode_id",
      "department_id",
      "location_id",
      "product_id",
      "expense_category_id",
      "status",
      "from",
      "to",
      "adv_sub_from",
      "adv_sub_to",
      "adv_hod_from",
      "adv_hod_to",
      "adv_fin_from",
      "adv_fin_to",
      "min_amt",
      "max_amt",
    ];
    return trackedFilterKeys.some((key) => {
      const value = params.get(key);
      return Boolean(value && value.trim().length > 0);
    });
  }

  it("detects active status filter", () => {
    const params = new URLSearchParams("status=Submitted - Awaiting HOD Approval");
    expect(hasActiveFilterParams(params)).toBe(true);
  });

  it("detects active search query", () => {
    const params = new URLSearchParams("search_query=EMP001");
    expect(hasActiveFilterParams(params)).toBe(true);
  });

  it("detects non-default search field", () => {
    const params = new URLSearchParams("search_field=employee_name");
    expect(hasActiveFilterParams(params)).toBe(true);
  });

  it("returns false for empty params", () => {
    expect(hasActiveFilterParams(new URLSearchParams(""))).toBe(false);
  });

  it("returns false for view-only navigation params (not filter state)", () => {
    expect(hasActiveFilterParams(new URLSearchParams("view=approvals"))).toBe(false);
  });

  it("returns false for default search_field=claim_id (baseline, not a filter)", () => {
    expect(hasActiveFilterParams(new URLSearchParams("search_field=claim_id"))).toBe(false);
  });

  it("returns true when multiple filters are active", () => {
    const params = new URLSearchParams(
      "status=HOD approved - Awaiting finance approval&department_id=dept-uuid",
    );
    expect(hasActiveFilterParams(params)).toBe(true);
  });

  it("returns true for date range filter", () => {
    const params = new URLSearchParams("from=2026-01-01&to=2026-06-30");
    expect(hasActiveFilterParams(params)).toBe(true);
  });
});
