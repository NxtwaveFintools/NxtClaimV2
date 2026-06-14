import { expect, test } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import {
  claimRow,
  escapeRegExp,
  formatInr,
  getClaimRouting,
  gotoWithRetry,
  resolveLatestActiveExpenseClaimByBillNo,
  resolveRuntimeClaimData,
  resolveUserEmailById,
  submitExpenseClaim,
  withActorPage,
  type RuntimeClaimData,
} from "./support/claims-e2e-runtime";

loadEnvConfig(process.cwd());

/**
 * HOD "Review Selected Claims" modal journey.
 *
 * NOTE: This is a live-stack integration test in the same style as
 * `bulk-actions-lifecycle.spec.ts` — it requires a running dev server, a seeded
 * Supabase instance, and the Playwright auth states produced by `tests/global.setup.ts`.
 * It was authored to the established patterns but has not been executed in the
 * implementation environment (no live stack / browsers available there).
 *
 * On the Approve step we let the real `bulkApproveL1` server action run rather than
 * mocking a 200 response: Next.js server actions return a React Flight stream that
 * cannot be reliably hand-mocked across versions (see the design doc). The real action
 * gives us a genuine success toast + DB transition to assert against. Primary assertions
 * are the modal closing and the DB status advancing; the toast check is intentionally soft.
 *
 * The list is split into Expense and Advance sections; within each, claims are grouped by
 * submitter with summed amounts, sorted high to low. The grouping/split/advance-exclusion
 * math is exhaustively covered by the unit tests for `groupSubmittersByDetailType`,
 * `groupBySubmitterWithTotals`, and `groupByCategory`.
 */

const RUN_TAG = process.env.E2E_RUN_TAG ?? `HOD-REVIEW-${Date.now()}`;
const HOD_PENDING_STATUS = "Submitted - Awaiting HOD approval";
const FINANCE_PENDING_STATUS = "HOD approved - Awaiting finance approval";

const CLAIM_A_AMOUNT = 120.5;
const CLAIM_B_AMOUNT = 340.25;

let runtime: RuntimeClaimData;

test.describe("HOD Review Selected Claims", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300000);

  test.beforeAll(async () => {
    runtime = await resolveRuntimeClaimData();
  });

  test("HOD reviews selected claims in a modal, then bulk approves", async ({ browser }) => {
    const billA = `HODREV-A-${RUN_TAG}`;
    const billB = `HODREV-B-${RUN_TAG}`;

    // 1. Submit two expense claims as the same submitter (different amounts).
    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await submitExpenseClaim(page, {
        submitterEmail: runtime.submitterEmail,
        departmentName: runtime.submitterDepartmentName,
        paymentModeName: runtime.reimbursementPaymentModeName,
        expenseCategoryName: runtime.expenseCategoryName,
        billNo: billA,
        amount: CLAIM_A_AMOUNT,
        employeeId: `EMP-A-${RUN_TAG}`,
        purpose: `HOD review A ${RUN_TAG}`,
        transactionDate: "2026-03-24",
      });

      await submitExpenseClaim(page, {
        submitterEmail: runtime.submitterEmail,
        departmentName: runtime.submitterDepartmentName,
        paymentModeName: runtime.reimbursementPaymentModeName,
        expenseCategoryName: runtime.expenseCategoryName,
        billNo: billB,
        amount: CLAIM_B_AMOUNT,
        employeeId: `EMP-B-${RUN_TAG}`,
        purpose: `HOD review B ${RUN_TAG}`,
        transactionDate: "2026-03-24",
      });
    });

    const claimA = await resolveLatestActiveExpenseClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo: billA,
    });
    const claimB = await resolveLatestActiveExpenseClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo: billB,
    });

    // 2. Resolve the HOD assigned to these claims and act as them.
    const routing = await getClaimRouting(claimA.claimId);
    const hodEmail = await resolveUserEmailById(routing.assignedL1ApproverId);

    await withActorPage(browser, hodEmail, async (page) => {
      // Navigate to the HOD approvals view filtered to the pending-HOD status.
      // The status MUST be the real DB value, otherwise the bulk UI is hidden.
      const params = new URLSearchParams({ view: "approvals", status: HOD_PENDING_STATUS });
      await gotoWithRetry(page, `/dashboard/my-claims?${params.toString()}`);
      await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });
      await expect(page.getByRole("heading", { name: /approvals history/i })).toBeVisible({
        timeout: 20000,
      });

      // 3. Select both claims via their row checkboxes.
      for (const claimId of [claimA.claimId, claimB.claimId]) {
        await expect(claimRow(page, claimId)).toBeVisible({ timeout: 30000 });
        const checkbox = claimRow(page, claimId).getByRole("checkbox", {
          name: new RegExp(`^Select claim ${escapeRegExp(claimId)}$`, "i"),
        });
        await expect(checkbox).toBeVisible({ timeout: 10000 });
        await checkbox.check();
      }
      await expect(page.getByText(/\b2 selected\b/i)).toBeVisible({ timeout: 10000 });

      // 4. Open the review modal.
      await page.getByTestId("review-selected-claims-button").click();

      // 5. Modal is visible.
      const heading = page.getByRole("heading", { name: /review selected claims/i });
      await expect(heading).toBeVisible();

      // 6. Pie chart region present.
      await expect(page.getByTestId("review-pie-chart")).toBeVisible();

      // 7. Both expense claims are from the same submitter -> one summed expense row.
      const expenseRows = page.getByTestId("review-expense-row");
      await expect(expenseRows).toHaveCount(1);
      await expect(expenseRows.first()).toContainText(formatInr(CLAIM_A_AMOUNT + CLAIM_B_AMOUNT));
      // No advances were submitted, so the advance section is absent.
      await expect(page.getByTestId("review-advance-row")).toHaveCount(0);

      // 8. The cross-page scope toggle box has been removed from the modal.
      await expect(page.getByRole("button", { name: /this page \(\d+\)/i })).toHaveCount(0);

      // 9. Approve all (real server action).
      await page.getByRole("button", { name: /approve all/i }).click();

      // 10. Modal closes; a success toast appears (soft); DB advances.
      await expect(heading).toBeHidden({ timeout: 30000 });
      await page
        .locator("[data-sonner-toast], li[data-sonner-toast]")
        .first()
        .waitFor({ state: "visible", timeout: 5000 })
        .catch(() => undefined);
    });

    // Primary verification: both claims advanced past the HOD stage.
    for (const claimId of [claimA.claimId, claimB.claimId]) {
      await expect
        .poll(async () => (await getClaimRouting(claimId)).status, {
          timeout: 45000,
          message: `waiting for claim ${claimId} to advance to finance stage`,
        })
        .toBe(FINANCE_PENDING_STATUS);
    }
  });
});
