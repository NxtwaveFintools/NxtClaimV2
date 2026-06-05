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

  const approvedInput = page.locator('input[name="basicAmount"]');
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
      .eq("total_amount", requestedAmount)
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
            .eq("total_amount", requestedAmount)
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
      .select("total_amount")
      .eq("claim_id", originalClaim.claimId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    expect(originalExpenseError).toBeNull();
    expect(Number(originalExpense?.total_amount)).toBe(requestedAmount);

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

test.describe("Soft Flag - Suspected Duplicate Detection", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180000);

  const SOFT_FLAG_BILL = `BILL-SOFT-${RUN_TAG}`;
  const SOFT_FLAG_BILL_2 = `BILL-SOFTVAR-${RUN_TAG}`;
  const SOFT_FLAG_DATE = "2026-05-15";
  let claimAId: string;
  let claimBId: string;

  test("hard-block regression: exact duplicate (same amount) is blocked", async ({ browser }) => {
    const runtime = await resolveRuntimeClaimData();

    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await submitExpenseClaim(page, {
        submitterEmail: runtime.submitterEmail,
        departmentName: runtime.submitterDepartmentName,
        paymentModeName: runtime.reimbursementPaymentModeName,
        expenseCategoryName: runtime.expenseCategoryName,
        billNo: SOFT_FLAG_BILL,
        amount: 1000,
        employeeId: `EMP-SOFT-A-${Date.now()}`,
        purpose: "Soft flag test: claim A baseline",
        transactionDate: SOFT_FLAG_DATE,
      });
    });

    const claimA = await resolveLatestActiveExpenseClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo: SOFT_FLAG_BILL,
    });
    claimAId = claimA.claimId;

    const client = getAdminSupabaseClient();
    const { count: countBefore, error: countError } = await client
      .from("expense_details")
      .select("id", { count: "exact", head: true })
      .eq("bill_no", SOFT_FLAG_BILL)
      .eq("transaction_date", SOFT_FLAG_DATE)
      .eq("total_amount", 1000)
      .eq("is_active", true);

    if (countError) throw new Error(countError.message);

    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await openClaimForm(page, runtime.submitterEmail);
      await selectOptionByLabel(page, /Department/i, runtime.submitterDepartmentName);
      await selectOptionByLabel(page, /Payment Mode/i, runtime.reimbursementPaymentModeName);
      await selectOptionByLabel(page, /Expense Category/i, runtime.expenseCategoryName);
      await page
        .getByRole("textbox", { name: /^Employee ID \*/i })
        .fill(`EMP-SOFT-DUP-${Date.now()}`);
      await page.getByRole("textbox", { name: /^Bill No \*/i }).fill(SOFT_FLAG_BILL);
      await page
        .getByRole("textbox", { name: /^Purpose/i })
        .fill("Soft flag test: exact duplicate attempt");
      await page.getByRole("textbox", { name: /^Transaction Date \*/i }).fill(SOFT_FLAG_DATE);
      await page.locator("#basicAmount").fill("1000");
      await page.locator("#receiptFile").setInputFiles("tests/fixtures/dummy-receipt.pdf");
      await page.getByRole("button", { name: /submit claim/i }).click();
      await expect(page).toHaveURL(/\/claims\/new(?:\?|$)/, { timeout: 10000 });
    });

    await expect
      .poll(
        async () => {
          const { count, error } = await client
            .from("expense_details")
            .select("id", { count: "exact", head: true })
            .eq("bill_no", SOFT_FLAG_BILL)
            .eq("transaction_date", SOFT_FLAG_DATE)
            .eq("total_amount", 1000)
            .eq("is_active", true);
          if (error) throw new Error(error.message);
          return count ?? 0;
        },
        {
          timeout: 15000,
          message: `DB count for ${SOFT_FLAG_BILL} amount=1000 must stay at ${countBefore}`,
        },
      )
      .toBe(countBefore);
  });

  test("soft-flag: amount-variant claim succeeds and both arrays reference each other", async ({
    browser,
  }) => {
    const runtime = await resolveRuntimeClaimData();

    // Use a distinct bill number to avoid triggering the hard-block from the first test
    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await submitExpenseClaim(page, {
        submitterEmail: runtime.submitterEmail,
        departmentName: runtime.submitterDepartmentName,
        paymentModeName: runtime.reimbursementPaymentModeName,
        expenseCategoryName: runtime.expenseCategoryName,
        billNo: SOFT_FLAG_BILL_2,
        amount: 1000,
        employeeId: `EMP-SFA-${Date.now()}`,
        purpose: "Soft flag test: claim A (isolated)",
        transactionDate: SOFT_FLAG_DATE,
      });
    });

    const claimA = await resolveLatestActiveExpenseClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo: SOFT_FLAG_BILL_2,
    });
    claimAId = claimA.claimId;

    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await submitExpenseClaim(page, {
        submitterEmail: runtime.submitterEmail,
        departmentName: runtime.submitterDepartmentName,
        paymentModeName: runtime.reimbursementPaymentModeName,
        expenseCategoryName: runtime.expenseCategoryName,
        billNo: SOFT_FLAG_BILL_2,
        amount: 999,
        employeeId: `EMP-SFB-${Date.now()}`,
        purpose: "Soft flag test: claim B (amount variant)",
        transactionDate: SOFT_FLAG_DATE,
      });
    });

    const claimB = await resolveLatestActiveExpenseClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo: SOFT_FLAG_BILL_2,
      excludeClaimId: claimAId,
    });
    claimBId = claimB.claimId;

    const client = getAdminSupabaseClient();

    await expect
      .poll(
        async () => {
          const { data, error } = await client
            .from("expense_details")
            .select("suspected_duplicate_ids")
            .eq("claim_id", claimAId)
            .eq("is_active", true)
            .maybeSingle();
          if (error) throw new Error(error.message);
          return (data?.suspected_duplicate_ids ?? []).includes(claimBId);
        },
        { timeout: 30000, message: "claimA.suspected_duplicate_ids must include claimBId" },
      )
      .toBe(true);

    await expect
      .poll(
        async () => {
          const { data, error } = await client
            .from("expense_details")
            .select("suspected_duplicate_ids")
            .eq("claim_id", claimBId)
            .eq("is_active", true)
            .maybeSingle();
          if (error) throw new Error(error.message);
          return (data?.suspected_duplicate_ids ?? []).includes(claimAId);
        },
        { timeout: 30000, message: "claimB.suspected_duplicate_ids must include claimAId" },
      )
      .toBe(true);
  });

  test("banner is NOT visible to claim submitter", async ({ browser }) => {
    const runtime = await resolveRuntimeClaimData();

    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await page.goto(`/dashboard/claims/${claimBId}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText(claimBId, { exact: true })).toBeVisible({ timeout: 20000 });
      await expect(page.getByText(/Suspected Duplicate/i)).not.toBeVisible({ timeout: 5000 });
    });
  });

  test("banner IS visible to Finance with correct count and target=_blank links", async ({
    browser,
  }) => {
    const runtime = await resolveRuntimeClaimData();
    await setClaimToFinancePending(claimBId, runtime.financeApproverId);

    await withActorPage(browser, runtime.financeEmail, async (page) => {
      await page.goto(`/dashboard/claims/${claimBId}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText(claimBId, { exact: true })).toBeVisible({ timeout: 20000 });
      await expect(page.getByText(/Suspected Duplicate/i)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText(/match 1 other claim/i)).toBeVisible({ timeout: 10000 });

      const link = page.getByRole("link", { name: new RegExp(escapeRegExp(claimAId)) });
      await expect(link).toBeVisible({ timeout: 10000 });
      await expect(link).toHaveAttribute("target", "_blank");
    });
  });
});
