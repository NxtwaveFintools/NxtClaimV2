import { expect, test, type Page } from "@playwright/test";
import {
  formatInr,
  getAdminSupabaseClient,
  openClaimForm,
  resolveLatestActiveExpenseClaimByBillNo,
  resolveRuntimeClaimData,
  setClaimToFinancePending,
  submitExpenseClaim,
  withActorPage,
  selectOptionByLabel,
} from "../support/claims-e2e-runtime";

const RUN_TAG = process.env.E2E_RUN_TAG ?? `AUDIT-${Date.now()}`;
const EMPLOYEE_EMAIL = (process.env.E2E_SUBMITTER_EMAIL ?? "user@nxtwave.co.in").toLowerCase();

async function financeEditApprovedAmount(page: Page, claimId: string, approvedAmount: number) {
  await page.goto(`/dashboard/claims/${claimId}?view=approvals`, { waitUntil: "domcontentloaded" });

  await expect(page.getByText(claimId, { exact: true })).toBeVisible({ timeout: 20000 });

  const editButton = page.getByRole("button", { name: /edit claim/i }).first();
  await expect(editButton).toBeVisible({ timeout: 15000 });
  await editButton.click();

  await expect(page.getByRole("heading", { name: /^edit claim$/i })).toBeVisible({
    timeout: 10000,
  });

  await expect(page.locator('input[name="approvedAmount"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('input[name="approvedAmount"]')).toBeEditable();

  // Finance lock-down: amount component fields must not be editable in finance mode.
  await expect(page.locator('input[name="basicAmount"]')).toHaveCount(0);
  await expect(page.locator('input[name="cgstAmount"]')).toHaveCount(0);
  await expect(page.locator('input[name="sgstAmount"]')).toHaveCount(0);
  await expect(page.locator('input[name="igstAmount"]')).toHaveCount(0);

  await page.locator('input[name="approvedAmount"]').fill(String(approvedAmount));
  await page
    .locator('textarea[name="editReason"]')
    .fill("Finance adjusted approved amount for audit review.");
  await page.getByRole("button", { name: /save claim edits/i }).click();

  await expect(page.getByRole("heading", { name: /^edit claim$/i })).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(page.getByRole("button", { name: /edit claim/i }).first()).toBeVisible({
    timeout: 15000,
  });
}

test.describe("Claim Audit Trail Submission + Finance Edit", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180000);

  test("Employee total math is auto-calculated, finance can edit only approved amount, and UI shows both requested + approved", async ({
    browser,
  }) => {
    const runtime = await resolveRuntimeClaimData();
    const billNo = `BILL-AUDIT-${RUN_TAG}`;
    const transactionDate = "2026-05-11";

    const basicAmount = 1000;
    const cgstAmount = 90;
    const sgstAmount = 90;
    const igstAmount = 0;
    const expectedRequestedTotal = basicAmount + cgstAmount + sgstAmount + igstAmount;

    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await openClaimForm(page, runtime.submitterEmail);

      await selectOptionByLabel(page, /Department/i, runtime.submitterDepartmentName);
      await selectOptionByLabel(page, /Payment Mode/i, runtime.reimbursementPaymentModeName);
      await selectOptionByLabel(page, /Expense Category/i, runtime.expenseCategoryName);

      await page.getByRole("textbox", { name: /^Employee ID \*/i }).fill(`EMP-AUDIT-${Date.now()}`);
      await page.getByRole("textbox", { name: /^Bill No \*/i }).fill(billNo);
      await page
        .getByRole("textbox", { name: /^Purpose/i })
        .fill("Audit trail total amount verification");
      await page.getByRole("textbox", { name: /^Transaction Date \*/i }).fill(transactionDate);

      await page.locator("#basicAmount").fill(String(basicAmount));
      await page.locator("#cgstAmount").fill(String(cgstAmount));
      await page.locator("#sgstAmount").fill(String(sgstAmount));
      await page.locator("#igstAmount").fill(String(igstAmount));

      await expect(page.locator("#totalAmount")).toHaveValue(expectedRequestedTotal.toFixed(2));

      await page.locator("#receiptFile").setInputFiles("tests/fixtures/dummy-receipt.pdf");
      await page.getByRole("button", { name: /submit claim/i }).click();

      await expect(page).toHaveURL(/\/dashboard\/my-claims(?:\?|$)/, { timeout: 30000 });
    });

    const submittedClaim = await resolveLatestActiveExpenseClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo,
    });

    const client = getAdminSupabaseClient();
    const { data: amountRow, error: amountError } = await client
      .from("expense_details")
      .select("total_amount")
      .eq("claim_id", submittedClaim.claimId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    expect(amountError).toBeNull();
    expect(Number(amountRow?.total_amount)).toBe(expectedRequestedTotal);

    await setClaimToFinancePending(submittedClaim.claimId, runtime.financeApproverId);

    const approvedAmount = 800;

    await withActorPage(browser, runtime.financeEmail, async (page) => {
      await financeEditApprovedAmount(page, submittedClaim.claimId, approvedAmount);
    });

    await withActorPage(browser, EMPLOYEE_EMAIL, async (page) => {
      await page.goto(`/dashboard/claims/${submittedClaim.claimId}`, {
        waitUntil: "domcontentloaded",
      });

      const requestedLabel = page.getByText(/requested amount/i).first();
      const approvedLabel = page.getByText(/approved amount/i).first();
      await expect(requestedLabel).toBeVisible({ timeout: 15000 });
      await expect(approvedLabel).toBeVisible({ timeout: 15000 });

      const requestedAmountText = formatInr(expectedRequestedTotal);
      const approvedAmountText = formatInr(approvedAmount);

      const requestedAmountNode = page
        .locator(".line-through")
        .filter({ hasText: new RegExp(requestedAmountText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
        .first();

      await expect(requestedAmountNode).toBeVisible({ timeout: 15000 });
      await expect(requestedAmountNode).toHaveClass(/line-through/);
      await expect(page.getByText(approvedAmountText, { exact: false }).first()).toBeVisible({
        timeout: 15000,
      });
    });
  });
});
