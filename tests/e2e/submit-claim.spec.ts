import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { getAuthStatePathByRole } from "./support/auth-state";

const receiptPath = path.resolve(process.cwd(), "tests/fixtures/dummy-receipt.pdf");
const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "password123";

async function ensureAuthenticated(page: Page, email: string): Promise<void> {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

  if (!/\/auth\/login/i.test(page.url())) {
    return;
  }

  const loginResponse = await page.request.post("/api/auth/email-login", {
    data: { email, password: DEFAULT_PASSWORD },
  });

  if (!loginResponse.ok()) {
    throw new Error(`Email login failed for ${email}: HTTP ${loginResponse.status()}`);
  }

  const loginPayload = (await loginResponse.json()) as {
    data?: { session?: { accessToken?: string; refreshToken?: string } };
  };

  const accessToken = loginPayload.data?.session?.accessToken;
  const refreshToken = loginPayload.data?.session?.refreshToken;
  if (!accessToken || !refreshToken) {
    throw new Error(`Missing auth session tokens for ${email}.`);
  }

  const sessionResponse = await page.request.post("/api/auth/session", {
    data: { accessToken, refreshToken },
  });

  if (!sessionResponse.ok()) {
    throw new Error(`Session bootstrap failed for ${email}: HTTP ${sessionResponse.status()}`);
  }
}

async function openClaimForm(page: Page, email: string): Promise<void> {
  await ensureAuthenticated(page, email);
  await page.goto("/claims/new", { waitUntil: "domcontentloaded" });

  const submitButton = page.getByRole("button", { name: /submit claim/i });
  const failedHydrationBanner = page.getByText(/Unable to load claim form data/i);
  await expect(failedHydrationBanner).toHaveCount(0);
  await expect(submitButton).toBeVisible();
}

async function fillMandatoryExpenseFields(page: Page): Promise<void> {
  const uniq = Date.now().toString();
  const billNo = `BILL-E2E-${uniq}`;
  const txnId = `TXN-E2E-${uniq}`;

  const fillStable = async (selector: string, value: string): Promise<void> => {
    const locator = page.locator(selector);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await locator.fill(value);
      const current = await locator.inputValue().catch(() => "");
      if (current === value) {
        return;
      }
      await page.waitForTimeout(150);
    }
    throw new Error(`Failed to set ${selector} to expected value.`);
  };

  await fillStable("#employeeId", "EMP-E2E-1001");
  await fillStable("#billNo", billNo);
  await fillStable("#transactionId", txnId);
  await fillStable("#expensePurpose", "Client visit and documentation");
  await page.locator("#basicAmount").fill("100");

  await page.locator("#transactionDate").fill("2026-03-14");
  await expect(page.locator("#transactionDate")).toHaveValue("2026-03-14");

  await expect(page.locator("#basicAmount")).toHaveValue("100");
  await expect(page.locator("#totalAmount")).toHaveValue("100.00");
  await page.locator("#receiptFile").setInputFiles(receiptPath);
}

test.describe("Submit Claim Golden Paths", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90000);

  async function expectSubmitOutcome(page: Page): Promise<void> {
    const successSignal = Promise.race([
      page.waitForURL("**/dashboard/my-claims**", { timeout: 45000 }),
      page.locator("[data-sonner-toast]", { hasText: /Claim submitted successfully/i }).waitFor({
        state: "visible",
        timeout: 45000,
      }),
    ]);

    const errorSignal = Promise.race([
      page.locator("[data-sonner-toast][data-type='error']").first().waitFor({
        state: "visible",
        timeout: 45000,
      }),
      page.locator(".text-destructive, [role='alert']").first().waitFor({
        state: "visible",
        timeout: 45000,
      }),
    ]).then(async () => {
      const toastText = await page
        .locator("[data-sonner-toast][data-type='error']")
        .first()
        .innerText()
        .catch(() => "");
      const alertText = await page
        .locator(".text-destructive, [role='alert']")
        .first()
        .innerText()
        .catch(() => "");
      throw new Error(`Submit failed: ${(toastText || alertText || "Unknown error").trim()}`);
    });

    await Promise.race([successSignal, errorSignal]);
  }

  test.describe("submitter path", () => {
    test.use({ storageState: getAuthStatePathByRole("submitter") });

    test("Test A: Standard employee submits reimbursement claim with GST", async ({ page }) => {
      await openClaimForm(page, process.env.E2E_SUBMITTER_EMAIL ?? "user@nxtwave.co.in");

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
      await page.getByRole("button", { name: /submit claim/i }).click();
      await expectSubmitOutcome(page);
    });
  });

  test.describe("hod path", () => {
    test.use({ storageState: getAuthStatePathByRole("hod") });

    test("Test B: HOD submission resolves a valid senior approver", async ({ page }) => {
      await openClaimForm(page, process.env.E2E_HOD_EMAIL ?? "hod@nxtwave.co.in");

      const departmentSelect = page.getByLabel(/Department/i);
      const optionCount = await departmentSelect.locator("option").count();
      if (optionCount > 1) {
        await departmentSelect.selectOption({ index: 1 });
      }

      const approverInput = page
        .locator("div", { hasText: /^Approver \(Finance\/Senior\)/i })
        .locator("input")
        .first();
      const approverEmailInput = page
        .locator("div", { hasText: /^Approver Email/i })
        .locator("input")
        .first();
      await expect(approverInput).not.toHaveValue("Not available");
      await expect(approverEmailInput).toHaveValue(/@/);

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
      await page.getByRole("button", { name: /submit claim/i }).click();
      await expectSubmitOutcome(page);
    });
  });
});
