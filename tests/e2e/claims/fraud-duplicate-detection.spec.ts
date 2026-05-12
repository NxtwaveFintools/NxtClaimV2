import { expect, test, type Page } from "@playwright/test";
import {
  getAdminSupabaseClient,
  openClaimForm,
  resolveLatestActiveExpenseClaimByBillNo,
  resolveRuntimeClaimData,
  setClaimToFinancePending,
  selectOptionByLabel,
  submitExpenseClaim,
  withActorPage,
} from "../support/claims-e2e-runtime";

const RUN_TAG = process.env.E2E_RUN_TAG ?? `FRAUD-${Date.now()}`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function financeEditApprovedAmount(page: Page, claimId: string, approvedAmount: number) {
  await page.goto(`/dashboard/claims/${claimId}?view=approvals`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(claimId, { exact: true })).toBeVisible({ timeout: 20000 });

  await page
    .getByRole("button", { name: /edit claim/i })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: /^edit claim$/i })).toBeVisible({
    timeout: 10000,
  });

  const approvedInput = page.locator('input[name="approvedAmount"]');
  await expect(approvedInput).toBeVisible({ timeout: 10000 });
  await approvedInput.fill(String(approvedAmount));
  await page
    .locator('textarea[name="editReason"]')
    .fill("Fraud-control test: reduce approved amount only.");

  await page.getByRole("button", { name: /save claim edits/i }).click();
  await expect(page.getByRole("heading", { name: /^edit claim$/i })).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(page.getByRole("button", { name: /edit claim/i }).first()).toBeVisible({
    timeout: 15000,
  });
}

test.describe("Fraud Prevention - Duplicate Expense Detection Uses Requested Total", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180000);

  test("blocks duplicate bill submission even after finance lowers approved amount", async ({
    browser,
  }) => {
    const runtime = await resolveRuntimeClaimData();
    const billNo = `BILL-FRAUD-${RUN_TAG}`;
    const transactionDate = "2026-05-10";
    const requestedAmount = 1000;

    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await submitExpenseClaim(page, {
        submitterEmail: runtime.submitterEmail,
        departmentName: runtime.submitterDepartmentName,
        paymentModeName: runtime.reimbursementPaymentModeName,
        expenseCategoryName: runtime.expenseCategoryName,
        billNo,
        amount: requestedAmount,
        employeeId: `EMP-FRAUD-${Date.now()}`,
        purpose: "Fraud duplicate baseline claim",
        transactionDate,
      });
    });

    const originalClaim = await resolveLatestActiveExpenseClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo,
    });

    await setClaimToFinancePending(originalClaim.claimId, runtime.financeApproverId);

    await withActorPage(browser, runtime.financeEmail, async (page) => {
      await financeEditApprovedAmount(page, originalClaim.claimId, 800);
    });

    const client = getAdminSupabaseClient();
    const beforeDuplicateAttemptCountQuery = await client
      .from("expense_details")
      .select("id", { count: "exact", head: true })
      .eq("bill_no", billNo)
      .eq("transaction_date", transactionDate)
      .eq("requested_total_amount", requestedAmount)
      .eq("is_active", true);

    if (beforeDuplicateAttemptCountQuery.error) {
      throw new Error(beforeDuplicateAttemptCountQuery.error.message);
    }

    const countBeforeDuplicateAttempt = beforeDuplicateAttemptCountQuery.count ?? 0;

    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await openClaimForm(page, runtime.submitterEmail);

      await selectOptionByLabel(page, /Department/i, runtime.submitterDepartmentName);
      await selectOptionByLabel(page, /Payment Mode/i, runtime.reimbursementPaymentModeName);
      await selectOptionByLabel(page, /Expense Category/i, runtime.expenseCategoryName);

      await page
        .getByRole("textbox", { name: /^Employee ID \*/i })
        .fill(`EMP-FRAUD-RETRY-${Date.now()}`);
      await page.getByRole("textbox", { name: /^Bill No \*/i }).fill(billNo);
      await page.getByRole("textbox", { name: /^Purpose/i }).fill("Fraud duplicate second attempt");
      await page.getByRole("textbox", { name: /^Transaction Date \*/i }).fill(transactionDate);
      await page.locator("#basicAmount").fill(String(requestedAmount));
      await page.locator("#receiptFile").setInputFiles("tests/fixtures/dummy-receipt.pdf");

      await page.getByRole("button", { name: /submit claim/i }).click();
      await expect(page).toHaveURL(/\/claims\/new(?:\?|$)/, { timeout: 10000 });
    });

    await expect
      .poll(
        async () => {
          const result = await client
            .from("expense_details")
            .select("id", { count: "exact", head: true })
            .eq("bill_no", billNo)
            .eq("transaction_date", transactionDate)
            .eq("requested_total_amount", requestedAmount)
            .eq("is_active", true);

          if (result.error) {
            throw new Error(result.error.message);
          }

          return result.count ?? 0;
        },
        {
          timeout: 30000,
          message: `waiting for duplicate fingerprint count to remain stable for ${billNo}`,
        },
      )
      .toBe(countBeforeDuplicateAttempt);

    const { data: originalExpense, error: originalExpenseError } = await client
      .from("expense_details")
      .select("requested_total_amount, approved_amount")
      .eq("claim_id", originalClaim.claimId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    expect(originalExpenseError).toBeNull();
    expect(Number(originalExpense?.requested_total_amount)).toBe(requestedAmount);
    expect(Number(originalExpense?.approved_amount)).toBe(800);

    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await page.goto(
        `/dashboard/my-claims?view=submissions&status=all&search_field=claim_id&search_query=${encodeURIComponent(originalClaim.claimId)}`,
        {
          waitUntil: "domcontentloaded",
        },
      );

      await expect(page.getByRole("link", { name: originalClaim.claimId })).toBeVisible({
        timeout: 20000,
      });
      await expect(page.getByText(new RegExp(escapeRegExp(originalClaim.claimId)))).toBeVisible();
    });
  });
});
