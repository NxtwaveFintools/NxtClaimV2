import { test, expect, type Page } from "@playwright/test";
import { getAuthStatePathByRole } from "../support/auth-state";

const BC_PAYMENT_URL = /supabase\.co\/functions\/v1\/bc-payment(\?|$)/;
const BC_VENDOR_SEARCH_URL = /supabase\.co\/functions\/v1\/bc-vendor-search(\?|$)/;

// Helper: pick the first Reimbursement claim awaiting Finance Approval and
// navigate to its detail page. Uses generic table-row selectors that match
// the project's current claims-list markup.
async function gotoFinanceApprovableReimbursementClaim(page: Page) {
  await page.goto("/dashboard/claims?status=HOD+approved+-+Awaiting+finance+approval");
  const firstClaim = page.locator("table tbody tr").first();
  await firstClaim.locator("a").first().click();
  await expect(page.getByRole("button", { name: /approve/i })).toBeVisible();
}

async function mockBcPayment(page: Page, response: unknown, status = 200) {
  await page.route(BC_PAYMENT_URL, async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
}

async function mockBcVendorSearch(page: Page, vendors: { no: string; name: string }[]) {
  await page.route(BC_VENDOR_SEARCH_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ vendors }),
    });
  });
}

test.describe("BC payment modal", () => {
  test.use({ storageState: getAuthStatePathByRole("finance1") });

  test("approves Reimbursement claim as non-vendor", async ({ page }) => {
    await gotoFinanceApprovableReimbursementClaim(page);
    await mockBcPayment(page, {
      ok: true,
      claimId: "TEST-CLAIM",
      bcResponses: [{}],
      auditLogId: "audit-1",
    });

    await page.getByRole("button", { name: /approve/i }).click();
    await expect(page.getByText("Send to Business Central")).toBeVisible();

    await page.getByText("Non-Vendor Payment").click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByText(/Sent to Business Central/i)).toBeVisible({ timeout: 4000 });
    await expect(page.getByText("Send to Business Central")).toBeHidden({ timeout: 4000 });
  });

  test("approves Reimbursement claim as vendor with vendor search", async ({ page }) => {
    await gotoFinanceApprovableReimbursementClaim(page);
    await mockBcVendorSearch(page, [
      { no: "VEN/0001", name: "Test Vendor One" },
      { no: "VEN/0002", name: "Test Vendor Two" },
    ]);
    await mockBcPayment(page, {
      ok: true,
      claimId: "TEST-CLAIM",
      bcResponses: [{}, {}],
      auditLogId: "audit-2",
    });

    await page.getByRole("button", { name: /approve/i }).click();
    await page.getByText("Vendor Payment").click();
    await page.getByPlaceholder("Search vendor by name or ID").fill("test");
    await page.getByRole("button", { name: /Test Vendor One \(VEN\/0001\)/i }).click();
    // After selection, the search input is replaced with a confirmation pill
    // that shows the vendor name + (No). The "Clear" X button identifies it.
    await expect(page.getByRole("button", { name: /clear selected vendor/i })).toBeVisible();

    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText(/Sent to Business Central/i)).toBeVisible({ timeout: 4000 });
  });

  test("shows inline error when BC rejects (BC_API_ERROR)", async ({ page }) => {
    await gotoFinanceApprovableReimbursementClaim(page);
    await mockBcPayment(
      page,
      { ok: false, error: { code: "BC_API_ERROR", status: 502, body: "BC down" } },
      502,
    );

    await page.getByRole("button", { name: /approve/i }).click();
    await page.getByText("Non-Vendor Payment").click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(
      page.getByText("Business Central rejected the request. Please contact admin."),
    ).toBeVisible({ timeout: 4000 });
    // Modal stays open so user can retry or cancel
    await expect(page.getByText("Send to Business Central")).toBeVisible();
  });

  test("blocks duplicate send (ALREADY_SENT)", async ({ page }) => {
    await gotoFinanceApprovableReimbursementClaim(page);
    await mockBcPayment(
      page,
      { ok: false, error: { code: "ALREADY_SENT", claimId: "TEST-CLAIM" } },
      409,
    );

    await page.getByRole("button", { name: /approve/i }).click();
    await page.getByText("Non-Vendor Payment").click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(
      page.getByText("This claim has already been sent to Business Central."),
    ).toBeVisible({ timeout: 4000 });
  });

  test("shows empty state when no vendors match", async ({ page }) => {
    await gotoFinanceApprovableReimbursementClaim(page);
    await mockBcVendorSearch(page, []);

    await page.getByRole("button", { name: /approve/i }).click();
    await page.getByText("Vendor Payment").click();
    await page.getByPlaceholder("Search vendor by name or ID").fill("nonexistent");

    await expect(page.getByText(/No vendors match/i)).toBeVisible({ timeout: 2000 });
  });

  test("disables Confirm during submission", async ({ page }) => {
    await gotoFinanceApprovableReimbursementClaim(page);
    // Delay the mock so we can observe the loading state.
    await page.route(BC_PAYMENT_URL, async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          claimId: "TEST-CLAIM",
          bcResponses: [{}],
          auditLogId: "audit-3",
        }),
      });
    });

    await page.getByRole("button", { name: /approve/i }).click();
    await page.getByText("Non-Vendor Payment").click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("button", { name: /Sending to BC/i })).toBeDisabled();
  });
});
