import { expect, test } from "@playwright/test";
import {
  approveAtCurrentScope,
  claimRow,
  getClaimRouting,
  openSubmissionsPage,
  resolveLatestActiveAdvanceClaimByPurpose,
  resolveRuntimeClaimData,
  resolveUserEmailById,
  submitPettyCashRequestClaim,
  waitForClaimRow,
  withActorPage,
} from "./support/claims-e2e-runtime";

const RUN_TAG = process.env.E2E_RUN_TAG ?? `EA-PCR-${Date.now()}`;

test.describe("Petty Cash Request EA Flow", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240000);

  test("Petty Cash Request generates EA- claim and remains approvable at L1", async ({
    browser,
  }) => {
    const runtime = await resolveRuntimeClaimData();

    const expectedUsageDate = new Date().toISOString().slice(0, 10);
    const purpose = `EA-PCR-${RUN_TAG}`;

    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await submitPettyCashRequestClaim(page, {
        submitterEmail: runtime.submitterEmail,
        departmentName: runtime.submitterDepartmentName,
        paymentModeName: runtime.pettyCashRequestPaymentModeName,
        employeeId: `EA-EMP-${RUN_TAG}`,
        requestedTotalAmount: 720,
        purpose,
        expectedUsageDate,
        budgetMonth: "3",
        budgetYear: "2026",
      });

      await expect(page).toHaveURL(/\/dashboard\/my-claims(?:\?|$)/);
    });

    const createdClaim = await resolveLatestActiveAdvanceClaimByPurpose({
      submitterId: runtime.submitterId,
      purpose,
    });

    expect(createdClaim.claimId).toMatch(/^EA-/);

    await withActorPage(browser, runtime.submitterEmail, async (page) => {
      await openSubmissionsPage(page, createdClaim.claimId);
      await waitForClaimRow(page, createdClaim.claimId);
      await expect(claimRow(page, createdClaim.claimId)).toContainText(createdClaim.claimId);
    });

    const routing = await getClaimRouting(createdClaim.claimId);
    const l1ApproverEmail = await resolveUserEmailById(routing.assignedL1ApproverId);

    await withActorPage(browser, l1ApproverEmail, async (page) => {
      await approveAtCurrentScope(page, createdClaim.claimId);
    });

    await expect
      .poll(async () => (await getClaimRouting(createdClaim.claimId)).status, {
        timeout: 45000,
        message: `waiting for L1 approval to complete on ${createdClaim.claimId}`,
      })
      .toBe("HOD approved - Awaiting finance approval");
  });
});
