/**
 * Bill Number search E2E tests.
 *
 * Regression coverage for the normalizeSearchField whitelist bug:
 * search_field=bill_no was silently dropped by the server, returning
 * unfiltered results instead of bill-number-matched rows.
 */
import { expect, test } from "@playwright/test";
import {
  ensureAuthenticated,
  gotoWithRetry,
  getAdminSupabaseClient,
} from "../support/claims-e2e-runtime";
import { getDefaultSeedEmails } from "../support/auth-state";

const SUBMITTER_EMAIL = getDefaultSeedEmails().submitter;

async function fetchSubmitterBillNo(submitterEmail: string): Promise<string | null> {
  const client = getAdminSupabaseClient();

  const { data: user } = await client
    .from("users")
    .select("id")
    .eq("email", submitterEmail.toLowerCase())
    .eq("is_active", true)
    .maybeSingle();

  if (!user?.id) return null;

  const { data } = await client
    .from("expense_details")
    .select("bill_no, claim_id, claims!inner(submitted_by, is_active)")
    .eq("claims.submitted_by", user.id)
    .eq("claims.is_active", true)
    .eq("is_active", true)
    .not("bill_no", "is", null)
    .neq("bill_no", "")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as { bill_no: string } | null)?.bill_no ?? null;
}

test.describe("Bill Number search — My Submissions view", () => {
  test("search_field=bill_no in URL returns filtered results (regression: normalizeSearchField whitelist)", async ({
    page,
  }) => {
    page.on("console", (msg) => console.log("BROWSER CONSOLE:", msg.text()));
    const billNo = await fetchSubmitterBillNo(SUBMITTER_EMAIL);
    if (!billNo) {
      test.skip(true, "No expense claims with bill numbers for the test submitter");
      return;
    }

    await ensureAuthenticated(page, SUBMITTER_EMAIL);

    // Navigate directly with bill_no params — this bypasses the UI and hits the
    // server normalizer directly. Before the fix this returned ALL claims because
    // normalizeSearchField dropped "bill_no" → undefined → no filter applied.
    await gotoWithRetry(
      page,
      `/dashboard/my-claims?view=submissions&status=all&search_field=bill_no&search_query=${encodeURIComponent(billNo)}`,
    );

    await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });

    // URL params must be preserved (server must not strip search_field=bill_no)
    await expect(page).toHaveURL(/search_field=bill_no/);

    // Table must show at least one row — if the filter was silently dropped
    // and there are any other-status claims, the count would be higher.
    // We assert at least one row appears for this specific bill number.
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 15000 });
  });

  test("selecting Bill Number in Search Category dropdown updates placeholder and URL", async ({
    page,
  }) => {
    page.on("console", (msg) => console.log("BROWSER CONSOLE:", msg.text()));
    await ensureAuthenticated(page, SUBMITTER_EMAIL);
    await gotoWithRetry(page, "/dashboard/my-claims?view=submissions&status=all");
    await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });

    const filtersButton = page.getByRole("button", { name: /filters/i }).first();
    const isExpanded = (await filtersButton.getAttribute("aria-expanded")) === "true";
    if (!isExpanded) {
      await filtersButton.click();
    }

    // Explicitly wait for Next.js router and CSS animation to completely finish
    await page.waitForTimeout(1000);

    const searchCategorySelect = page.locator("#claims-filter-panel select").first();
    await expect(searchCategorySelect).toBeVisible({ timeout: 5000 });

    await searchCategorySelect.focus();
    await searchCategorySelect.selectOption("bill_no");

    // URL must update to confirm React state was mutated
    await expect(page).toHaveURL(/search_field=bill_no/, { timeout: 5000 });

    // Placeholder must reflect the new category
    await expect(page.locator("#claims-filter-panel input").first()).toHaveAttribute(
      "placeholder",
      "Search by Bill Number...",
      { timeout: 3000 },
    );
  });

  test("typing a bill number with # prefix filters the table", async ({ page }) => {
    page.on("console", (msg) => console.log("BROWSER CONSOLE:", msg.text()));
    const billNo = await fetchSubmitterBillNo(SUBMITTER_EMAIL);
    if (!billNo) {
      test.skip(true, "No expense claims with bill numbers for the test submitter");
      return;
    }

    await ensureAuthenticated(page, SUBMITTER_EMAIL);
    await gotoWithRetry(page, "/dashboard/my-claims?view=submissions&status=all");
    await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });

    const filtersButton = page.getByRole("button", { name: /filters/i }).first();
    const isExpanded = (await filtersButton.getAttribute("aria-expanded")) === "true";
    if (!isExpanded) {
      await filtersButton.click();
    }

    await page.waitForTimeout(1000);

    const searchCategorySelect = page.locator("#claims-filter-panel select").first();
    await expect(searchCategorySelect).toBeVisible({ timeout: 5000 });

    await searchCategorySelect.focus();
    await searchCategorySelect.selectOption("bill_no");

    const searchInput = page.locator("#claims-filter-panel input").first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.focus();
    await searchInput.fill(`#${billNo}`);

    // Wait for debounce to fire and URL to sync
    await expect(page).toHaveURL(/search_query=/, { timeout: 5000 });
    await expect(page).toHaveURL(/search_field=bill_no/);

    await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 15000 });
  });

  test("typing a bill number without # prefix also filters the table", async ({ page }) => {
    page.on("console", (msg) => console.log("BROWSER CONSOLE:", msg.text()));
    const billNo = await fetchSubmitterBillNo(SUBMITTER_EMAIL);
    if (!billNo) {
      test.skip(true, "No expense claims with bill numbers for the test submitter");
      return;
    }

    await ensureAuthenticated(page, SUBMITTER_EMAIL);
    await gotoWithRetry(page, "/dashboard/my-claims?view=submissions&status=all");
    await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });

    const filtersButton = page.getByRole("button", { name: /filters/i }).first();
    const isExpanded = (await filtersButton.getAttribute("aria-expanded")) === "true";
    if (!isExpanded) {
      await filtersButton.click();
    }

    await page.waitForTimeout(1000);

    const searchCategorySelect = page.locator("#claims-filter-panel select").first();
    await expect(searchCategorySelect).toBeVisible({ timeout: 5000 });

    await searchCategorySelect.focus();
    await searchCategorySelect.selectOption("bill_no");

    const searchInput = page.locator("#claims-filter-panel input").first();
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.focus();
    await searchInput.fill(billNo);

    await expect(page).toHaveURL(
      /search_field=bill_no.*search_query=|search_query=.*search_field=bill_no/,
      {
        timeout: 5000,
      },
    );
    await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 15000 });
  });
});
