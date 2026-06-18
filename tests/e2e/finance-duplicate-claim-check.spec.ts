import { expect, test } from "@playwright/test";
import {
  getAdminSupabaseClient,
  resolveLatestActiveExpenseClaimByBillNo,
  resolveRuntimeClaimData,
  setClaimToFinancePending,
  submitExpenseClaim,
  openClaimForm,
  withActorPage,
} from "./support/claims-e2e-runtime";

const RUN_TAG = process.env.E2E_RUN_TAG ?? `FDCE-${Date.now()}`;

// Shared fingerprint: amount + date must match between the pre-existing duplicate and
// what Finance submits in the edit form. Target claim is submitted with these same values
// so Finance only needs to swap the bill_no to trigger the interceptor.
const DUPE_AMOUNT = 750;
const DUPE_DATE = "2025-11-20";

const CLAIM_STATUS = {
  HOD_PENDING: "Submitted - Awaiting HOD approval",
  FINANCE_PENDING: "HOD approved - Awaiting finance approval",
  FINANCE_APPROVED: "Finance Approved - Payment under process",
  PAYMENT_DONE: "Payment Done - Closed",
} as const;

type RunScenario = {
  name: string;
  dbStatus: string;
  billNo: string;
  duplicateClaimId: string;
};

const TARGET_BILL_NO = `FDCE-TARGET-${RUN_TAG}`;

// Module-level mutable state — populated by the setup test, consumed by scenario tests.
let targetClaimId = "";
const scenarios: RunScenario[] = [
  {
    name: "Finance Pending → HOD Pending duplicate",
    dbStatus: CLAIM_STATUS.HOD_PENDING,
    billNo: `FDCE-HOD-${RUN_TAG}`,
    duplicateClaimId: "",
  },
  {
    name: "Finance Pending → Finance Pending duplicate",
    dbStatus: CLAIM_STATUS.FINANCE_PENDING,
    billNo: `FDCE-FIN-${RUN_TAG}`,
    duplicateClaimId: "",
  },
  {
    name: "Finance Pending → Finance Approved duplicate",
    dbStatus: CLAIM_STATUS.FINANCE_APPROVED,
    billNo: `FDCE-FINAP-${RUN_TAG}`,
    duplicateClaimId: "",
  },
  {
    name: "Finance Pending → Payment Done duplicate",
    dbStatus: CLAIM_STATUS.PAYMENT_DONE,
    billNo: `FDCE-PAY-${RUN_TAG}`,
    duplicateClaimId: "",
  },
];

test.describe("Finance Edit — Status-Agnostic Duplicate Interceptor", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    // Extend timeout for this hook: 5 UI submissions + DB ops can take ~3 min.
    test.setTimeout(360000);

    const runtime = await resolveRuntimeClaimData();
    const client = getAdminSupabaseClient();

    // 1. Create the shared target claim (Finance Pending). Reused across all scenarios
    //    because a blocked save never mutates the claim, so the form stays open each time.
    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      // 🔥 FIX: Use openClaimForm to handle auth and policy gate!
      await openClaimForm(page, runtime.submitterEmail);
      await submitExpenseClaim(page, {
        submitterEmail: runtime.submitterEmail,
        departmentName: runtime.submitterDepartmentName,
        paymentModeName: runtime.reimbursementPaymentModeName,
        expenseCategoryName: runtime.expenseCategoryName,
        billNo: TARGET_BILL_NO,
        amount: DUPE_AMOUNT,
        employeeId: `EMP-TGT-${Date.now()}`,
        purpose: "FDCE E2E: target claim (Finance edits this)",
        transactionDate: DUPE_DATE,
      });
    });

    const targetClaim = await resolveLatestActiveExpenseClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo: TARGET_BILL_NO,
    });
    targetClaimId = targetClaim.claimId;
    await setClaimToFinancePending(targetClaimId, runtime.financeApproverId);

    // 2. For each scenario, create one pre-existing duplicate claim and force it to the
    //    required DB status. The duplicate check in the server action is status-agnostic:
    //    it matches on (bill_no, total_amount, transaction_date) across ALL rows.
    for (const scenario of scenarios) {
      await withActorPage(browser, runtime.submitterEmail, async (page) => {
        // 🔥 FIX: Use openClaimForm to handle auth and policy gate!
        await openClaimForm(page, runtime.submitterEmail);

        await submitExpenseClaim(page, {
          submitterEmail: runtime.submitterEmail,
          departmentName: runtime.submitterDepartmentName,
          paymentModeName: runtime.reimbursementPaymentModeName,
          expenseCategoryName: runtime.expenseCategoryName,
          billNo: scenario.billNo,
          amount: DUPE_AMOUNT,
          employeeId: `EMP-DUP-${Date.now()}`,
          purpose: `FDCE E2E: pre-existing duplicate at ${scenario.name}`,
          transactionDate: DUPE_DATE,
        });
      });

      const dupeClaim = await resolveLatestActiveExpenseClaimByBillNo({
        submitterId: runtime.submitterId,
        billNo: scenario.billNo,
      });
      scenario.duplicateClaimId = dupeClaim.claimId;

      // Force the duplicate to its target lifecycle status.
      // HOD Pending is the initial submission status — no L2 approver needed.
      const updatePayload: Record<string, unknown> = { status: scenario.dbStatus };
      if (scenario.dbStatus !== CLAIM_STATUS.HOD_PENDING) {
        updatePayload.assigned_l2_approver_id = runtime.financeApproverId;
      }

      const { error } = await client
        .from("claims")
        .update(updatePayload)
        .eq("id", scenario.duplicateClaimId)
        .eq("is_active", true);

      if (error) {
        throw new Error(
          `Setup: failed to advance ${scenario.billNo} to "${scenario.dbStatus}": ${error.message}`,
        );
      }
    }
  });

  for (const scenario of scenarios) {
    test(scenario.name, async ({ browser }) => {
      test.setTimeout(120000);

      if (!targetClaimId || !scenario.duplicateClaimId) {
        test.skip(true, "Setup did not complete — skipping scenario.");
        return;
      }

      const runtime = await resolveRuntimeClaimData();

      await withActorPage(browser, runtime.financeEmail, async (page) => {
        // Navigate to the target claim as Finance user
        await page.goto(`/dashboard/claims/${targetClaimId}?view=approvals`, {
          waitUntil: "domcontentloaded",
        });
        await expect(page.getByText(targetClaimId, { exact: true })).toBeVisible({
          timeout: 20000,
        });

        // Open the inline Finance edit form
        await page
          .getByRole("button", { name: /edit claim/i })
          .first()
          .click();
        await expect(page.getByRole("heading", { name: /^edit claim$/i })).toBeVisible({
          timeout: 10000,
        });

        // Inject the pre-existing duplicate's bill number. Amount and date are already
        // pre-filled from the target claim (both set to DUPE_AMOUNT / DUPE_DATE), so
        // only the bill_no swap is needed to complete the duplicate fingerprint.
        const billNoInput = page.locator('input[name="billNo"]');
        await expect(billNoInput).toBeVisible({ timeout: 10000 });
        await billNoInput.fill(scenario.billNo);

        // Fill required audit reason field
        await page.locator('textarea[name="editReason"]').fill("FDCE duplicate interceptor E2E");

        // Submit — the anti-fraud check should block the save
        await page.getByRole("button", { name: /save claim edits/i }).click();

        // Assert the Sonner "Duplicate Intercepted" toast appears
        const toastEl = page.locator("[data-sonner-toast]");
        await expect(toastEl.getByText(/duplicate intercepted/i)).toBeVisible({ timeout: 15000 });

        // Assert the toast link points to the correct pre-existing duplicate claim
        const duplicateLink = toastEl.locator(`a[href*="${scenario.duplicateClaimId}"]`);
        await expect(duplicateLink).toBeVisible({ timeout: 10000 });
        await expect(duplicateLink).toHaveAttribute("target", "_blank");

        // Assert the link opens the duplicate claim in a new tab (preserving current form)
        const [newPage] = await Promise.all([
          page.context().waitForEvent("page"),
          duplicateLink.click(),
        ]);
        await newPage.waitForLoadState("domcontentloaded");
        expect(newPage.url()).toContain(`/dashboard/claims/${scenario.duplicateClaimId}`);

        // Assert the original edit form is still open — blocked save must not close the form
        await expect(page.getByRole("heading", { name: /^edit claim$/i })).toBeVisible({
          timeout: 5000,
        });

        await newPage.close();
      });
    });
  }
});
