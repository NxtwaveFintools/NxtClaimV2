import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

const receiptPath = path.resolve(process.cwd(), "tests/fixtures/dummy-receipt.pdf");
const defaultPassword = "password123";

async function loginWithEmail(page: Page, email: string): Promise<void> {
  await page.goto("/auth/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Auth session missing!/i)).toBeVisible();

  await page.locator("#email").fill(email);
  await page.locator("#password").fill(defaultPassword);
  await page.getByRole("button", { name: /sign in with email/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 30000 });
}

async function openClaimForm(page: Page): Promise<void> {
  await page.goto("/claims/new", { waitUntil: "domcontentloaded" });

  const submitButton = page.getByRole("button", { name: /submit claim/i });
  const failedHydrationBanner = page.getByText(/Unable to load claim form data/i);
  await expect(failedHydrationBanner).toHaveCount(0);
  await expect(submitButton).toBeVisible();
}

async function fillMandatoryExpenseFields(page: Page): Promise<void> {
  await page.locator("#employeeId").fill("EMP-E2E-1001");
  await expect(page.locator("#employeeId")).toHaveValue("EMP-E2E-1001");
  await page.locator("#billNo").fill("BILL-E2E-001");
  await expect(page.locator("#billNo")).toHaveValue("BILL-E2E-001");
  await page.locator("#transactionId").fill("TXN-E2E-001");
  await expect(page.locator("#transactionId")).toHaveValue("TXN-E2E-001");
  await page.locator("#expensePurpose").fill("Client visit and documentation");
  await expect(page.locator("#expensePurpose")).toHaveValue("Client visit and documentation");
  await page.locator("#transactionDate").fill("2026-03-14");
  await expect(page.locator("#transactionDate")).toHaveValue("2026-03-14");

  await page.locator("#isGstApplicable").check();
  await page.locator("#gstNumber").fill("GSTIN-E2E-123");
  await page.locator("#basicAmount").fill("100");
  await page.locator("#cgstAmount").fill("9");
  await page.locator("#sgstAmount").fill("9");
  await page.locator("#igstAmount").fill("0");

  await expect(page.locator("#basicAmount")).toHaveValue("100");
  await expect(page.locator("#totalAmount")).toHaveValue("118.00");
  await page.locator("#receiptFile").setInputFiles(receiptPath);
}

test.describe("Submit Claim Golden Paths", () => {
  test.describe.configure({ mode: "serial" });

  test("Test A: Standard employee submits reimbursement claim with GST", async ({ page }) => {
    await loginWithEmail(page, "user@nxtwave.co.in");
    await openClaimForm(page);

    const paymentMode = page.getByLabel(/Payment Mode/i);
    const reimbursementValue = await paymentMode.evaluate((el) => {
      const select = el as HTMLSelectElement;
      return (
        Array.from(select.options).find((option) => option.label === "Reimbursement")?.value ?? ""
      );
    });
    await paymentMode.evaluate((el, value) => {
      const select = el as HTMLSelectElement;
      select.value = value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, reimbursementValue);

    await fillMandatoryExpenseFields(page);
    await page.locator("#employeeId").fill("EMP-E2E-1001");
    await expect(page.locator("#employeeId")).toHaveValue("EMP-E2E-1001");
    await page.getByRole("button", { name: /submit claim/i }).click();

    await expect(page.getByText(/Claim submitted successfully:/i)).toBeVisible({ timeout: 30000 });
  });

  test("Test B: HOD submission resolves L1 approver to founder", async ({ page }) => {
    await loginWithEmail(page, "hod@nxtwave.co.in");
    await openClaimForm(page);

    const departmentSelect = page.getByLabel(/Department/i);
    const optionCount = await departmentSelect.locator("option").count();
    if (optionCount > 1) {
      await departmentSelect.selectOption({ index: 1 });
    }

    const l1ApproverInput = page
      .locator("label:text('Head of Department')")
      .locator("xpath=following-sibling::input");
    await expect(l1ApproverInput).not.toHaveValue("Not available");

    const founderIdentifier = process.env.E2E_FOUNDER_IDENTIFIER;
    if (founderIdentifier) {
      await expect(l1ApproverInput).toHaveValue(new RegExp(founderIdentifier, "i"));
    }

    const paymentMode = page.getByLabel(/Payment Mode/i);
    const reimbursementValue = await paymentMode.evaluate((el) => {
      const select = el as HTMLSelectElement;
      return (
        Array.from(select.options).find((option) => option.label === "Reimbursement")?.value ?? ""
      );
    });
    await paymentMode.evaluate((el, value) => {
      const select = el as HTMLSelectElement;
      select.value = value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, reimbursementValue);

    await fillMandatoryExpenseFields(page);
    await page.locator("#employeeId").fill("EMP-E2E-1001");
    await expect(page.locator("#employeeId")).toHaveValue("EMP-E2E-1001");
    await page.getByRole("button", { name: /submit claim/i }).click();

    await expect(page.getByText(/Claim submitted successfully:/i)).toBeVisible({ timeout: 30000 });
  });
});
