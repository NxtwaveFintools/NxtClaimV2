/**
 * Claim Form — Validation & Conditional Rendering E2E Tests
 *
 * Phase 1 — Basic Validation:
 *
 *  VAL-1  Submitting an expense claim without attaching a receipt must surface
 *         the "Invoice/Bill upload is required" error and keep the user on the
 *         form (no redirect).
 *
 *  VAL-2  Submitting a second claim whose (bill_no + transaction_date +
 *         basic_amount) fingerprint exactly matches an existing record must
 *         trigger the DUPLICATE_TRANSACTION error toast and keep the user on
 *         the form.
 *
 *  VAL-3  Selecting a "Petty Cash" payment mode must unmount the expense detail
 *         section and mount the advance detail section (and vice-versa).
 *
 * Phase 2 — Conditional Rendering & File-Type Edge Cases:
 *
 *  VAL-4  Uploading a .txt file for the receipt triggers the "must be an image
 *         or PDF" validation error on submit.
 *
 *  REND-1 Toggling Submission Type between "Self" and "On Behalf" reveals and
 *         hides the #onBehalfEmail and #onBehalfEmployeeCode fields.
 *
 *  REND-2 Checking/unchecking the GST Applicable checkbox shows/hides the
 *         CGST/SGST/IGST fields and the Total Amount auto-calculates correctly.
 */

import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { getAuthStatePathByRole } from "./support/auth-state";

loadEnvConfig(process.cwd());

const RECEIPT_PATH = path.resolve(process.cwd(), "tests/fixtures/dummy-receipt.pdf");
const INVALID_FILE_PATH = path.resolve(process.cwd(), "tests/fixtures/invalid-receipt.txt");
const RUN_TAG = process.env.E2E_RUN_TAG ?? `VAL-${Date.now()}`;
const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "password123";

// ---------------------------------------------------------------------------
// Runtime DB helpers
// ---------------------------------------------------------------------------

type FormOptions = {
  reimbursementPaymentModeName: string;
  pettyCashRequestPaymentModeName: string;
};

let formOptionsPromise: Promise<FormOptions> | null = null;

function getAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables for claim-form-validation E2E.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Queries the database at test-run time to resolve the exact labels used for
 * the two payment modes this suite relies on.  Results are memoised for the
 * duration of the process.
 */
async function resolveFormOptions(): Promise<FormOptions> {
  if (!formOptionsPromise) {
    formOptionsPromise = (async () => {
      const client = getAdminSupabaseClient();

      const [
        { data: reimbursement, error: reimburseError },
        { data: pettyCashRequest, error: pettyRequestError },
      ] = await Promise.all([
        client
          .from("master_payment_modes")
          .select("name")
          .eq("is_active", true)
          .ilike("name", "%reimbursement%")
          .limit(1)
          .maybeSingle(),
        client
          .from("master_payment_modes")
          .select("name")
          .eq("is_active", true)
          .ilike("name", "%petty cash request%")
          .limit(1)
          .maybeSingle(),
      ]);

      if (reimburseError || !reimbursement?.name) {
        throw new Error(
          reimburseError?.message ?? "No active reimbursement payment mode found in DB.",
        );
      }

      if (pettyRequestError || !pettyCashRequest?.name) {
        throw new Error(
          pettyRequestError?.message ?? "No active petty cash request payment mode found in DB.",
        );
      }

      return {
        reimbursementPaymentModeName: reimbursement.name,
        pettyCashRequestPaymentModeName: pettyCashRequest.name,
      };
    })();
  }

  return formOptionsPromise;
}

async function gotoWithRetry(page: Page, url: string, attempts = 2): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      const errorText = String(error);
      const redirectedToLogin =
        /interrupted by another navigation/i.test(errorText) && /\/auth\/login/i.test(page.url());

      if (redirectedToLogin) {
        return;
      }

      const isNavigationAbort =
        /ERR_ABORTED/i.test(errorText) || /interrupted by another navigation/i.test(errorText);
      const isLastAttempt = attempt === attempts;

      if (!isNavigationAbort || isLastAttempt) {
        throw error;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Page-object helpers
// ---------------------------------------------------------------------------

async function ensureAuthenticated(page: Page): Promise<void> {
  const submitterEmail = process.env.E2E_SUBMITTER_EMAIL ?? "user@nxtwave.co.in";
  await gotoWithRetry(page, "/dashboard");

  const signOutButton = page.getByRole("button", { name: /sign out/i });
  const hasSession = await signOutButton.isVisible({ timeout: 3000 }).catch(() => false);
  if (hasSession) {
    return;
  }

  const loginResponse = await page.request.post("/api/auth/email-login", {
    data: { email: submitterEmail, password: DEFAULT_PASSWORD },
  });

  if (!loginResponse.ok()) {
    throw new Error(`Email login failed for ${submitterEmail}: HTTP ${loginResponse.status()}`);
  }

  const loginPayload = (await loginResponse.json()) as {
    data?: { session?: { accessToken?: string; refreshToken?: string } };
  };

  const accessToken = loginPayload.data?.session?.accessToken;
  const refreshToken = loginPayload.data?.session?.refreshToken;
  if (!accessToken || !refreshToken) {
    throw new Error(`Missing auth session tokens for ${submitterEmail}.`);
  }

  const sessionResponse = await page.request.post("/api/auth/session", {
    data: { accessToken, refreshToken },
  });

  if (!sessionResponse.ok()) {
    throw new Error(
      `Session bootstrap failed for ${submitterEmail}: HTTP ${sessionResponse.status()}`,
    );
  }

  await gotoWithRetry(page, "/dashboard");
  await expect(page).not.toHaveURL(/\/auth\/login/i);
  await expect(signOutButton).toBeVisible({ timeout: 15000 });
}

async function openClaimForm(page: Page): Promise<void> {
  await ensureAuthenticated(page);
  await gotoWithRetry(page, "/claims/new");

  const hydrationBanner = page.getByText(/unable to load claim form data/i);
  if ((await hydrationBanner.count()) > 0) {
    await ensureAuthenticated(page);
    await gotoWithRetry(page, "/claims/new");
  }

  // Confirm the form hydrated successfully — no server-error banner present
  await expect(page.getByText(/unable to load claim form data/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /submit claim/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("combobox", { name: /payment mode/i })).toBeVisible({
    timeout: 15_000,
  });
}

async function selectOptionByLabelWithRetry(selectLocator: Locator, label: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await selectLocator.selectOption({ label });
        return selectLocator.evaluate((el) => {
          const select = el as HTMLSelectElement;
          const selected = select.selectedOptions?.[0];
          return selected?.label ?? selected?.textContent?.trim() ?? "";
        });
      },
      {
        timeout: 10_000,
        message: `waiting for select value to persist as ${label}`,
      },
    )
    .toBe(label);
}

/**
 * Fills every mandatory expense field EXCEPT the receipt file upload.
 * Used to set up the "no file" error scenario cleanly.
 */
async function fillExpenseFieldsWithoutFile(
  page: Page,
  opts: { billNo: string; transactionDate: string; amount: number; tag: string },
): Promise<void> {
  await page.locator("#employeeId").fill(`EMP-${opts.tag}`);
  await page.locator("#billNo").fill(opts.billNo);
  await page.locator("#expensePurpose").fill("E2E claim-form-validation test");
  await page.locator("#transactionDate").fill(opts.transactionDate);
  await page.locator("#basicAmount").fill(String(opts.amount));
}

async function countExpenseFingerprintRecords(input: {
  billNo: string;
  transactionDate: string;
  totalAmount: number;
}): Promise<number> {
  const client = getAdminSupabaseClient();
  const { count, error } = await client
    .from("expense_details")
    .select("id", { count: "exact", head: true })
    .eq("bill_no", input.billNo)
    .eq("transaction_date", input.transactionDate)
    .eq("total_amount", input.totalAmount)
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to count duplicate fingerprint records: ${error.message}`);
  }

  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("Claim Form — Validation & Conditional Rendering", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: getAuthStatePathByRole("submitter") });
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    // Warm up the DB query so individual tests do not time out waiting for it.
    await resolveFormOptions();
  });

  // ─── VAL-1 ────────────────────────────────────────────────────────────────
  test("VAL-1: Expense claim without receipt shows file-required error and does not redirect", async ({
    page,
  }) => {
    await openClaimForm(page);
    const options = await resolveFormOptions();

    // Ensure the expense detail section is active (reimbursement payment mode)
    const paymentModeSelect = page.getByRole("combobox", { name: /payment mode/i });
    await selectOptionByLabelWithRetry(paymentModeSelect, options.reimbursementPaymentModeName);

    // Fill all required text fields — deliberately skip setInputFiles
    const tag = `${RUN_TAG}-${Date.now()}`;
    await fillExpenseFieldsWithoutFile(page, {
      billNo: `BILL-NOFILE-${tag}`,
      transactionDate: "2026-03-01",
      amount: 75,
      tag,
    });

    await page.getByRole("button", { name: /submit claim/i }).click();

    // The form fires toast.error("Invoice/Bill upload is required.") and sets
    // the inline fileError paragraph with the same text.  Either renders as
    // acceptable proof that the guard triggered.
    const fileRequiredPattern = /invoice.*required|upload.*required/i;
    const errorLocator = page
      .locator("[data-sonner-toast], p")
      .filter({ hasText: fileRequiredPattern })
      .first();

    await expect(errorLocator).toBeVisible({ timeout: 10_000 });

    // The page must NOT have navigated away — the user should be able to
    // correct the missing file without losing their filled data.
    await expect(page).toHaveURL(/\/claims\/new/);
  });

  // ─── VAL-2 ────────────────────────────────────────────────────────────────
  test("VAL-2: Duplicate bill_no + date + amount triggers DUPLICATE_TRANSACTION toast", async ({
    page,
  }) => {
    const options = await resolveFormOptions();

    // These three values form the duplicate fingerprint checked by the server.
    const billNo = `BILL-DUP-${RUN_TAG}`;
    const txDate = "2026-03-15";
    const amount = 123;
    const expectedTotalAmount = amount;

    const baselineCount = await countExpenseFingerprintRecords({
      billNo,
      transactionDate: txDate,
      totalAmount: expectedTotalAmount,
    });

    const paymentModeSelect = page.getByRole("combobox", { name: /payment mode/i });

    // ── First submission: must succeed and redirect ───────────────────────
    await openClaimForm(page);
    await selectOptionByLabelWithRetry(paymentModeSelect, options.reimbursementPaymentModeName);

    await page.locator("#employeeId").fill(`EMP-DUP-${RUN_TAG}`);
    await page.locator("#billNo").fill(billNo);
    await page.locator("#expensePurpose").fill("E2E duplicate-detection first submission");
    await page.locator("#transactionDate").fill(txDate);
    await page.locator("#basicAmount").fill(String(amount));
    await page.locator("#receiptFile").setInputFiles(RECEIPT_PATH);

    await page.getByRole("button", { name: /submit claim/i }).click();

    // A successful submission always redirects to the My Claims dashboard.
    await expect(page).toHaveURL(/\/dashboard\/my-claims(?:\?|$)/, { timeout: 30_000 });

    // Ensure the first claim is fully persisted before duplicate attempt.
    await expect
      .poll(
        () =>
          countExpenseFingerprintRecords({
            billNo,
            transactionDate: txDate,
            totalAmount: expectedTotalAmount,
          }),
        {
          timeout: 30_000,
          message: `waiting for first duplicate fingerprint record for ${billNo}`,
        },
      )
      .toBe(baselineCount + 1);

    // ── Second submission: identical fingerprint — must be rejected ──────
    await openClaimForm(page);
    await selectOptionByLabelWithRetry(paymentModeSelect, options.reimbursementPaymentModeName);

    await page.locator("#employeeId").fill(`EMP-DUP-${RUN_TAG}`);
    await page.locator("#billNo").fill(billNo); // ← same bill number
    await page.locator("#expensePurpose").fill("E2E duplicate-detection second submission");
    await page.locator("#transactionDate").fill(txDate); // ← same date
    await page.locator("#basicAmount").fill(String(amount)); // ← same amount
    await page.locator("#receiptFile").setInputFiles(RECEIPT_PATH);

    await page.getByRole("button", { name: /submit claim/i }).click();

    // The server returns errorCode: "DUPLICATE_TRANSACTION".  The form maps
    // this to the message "A claim with this exact Bill No, Date, and Amount
    // already exists." which Sonner renders as an error toast.
    const dupToast = page
      .locator("[data-sonner-toast]")
      .filter({ hasText: /already exists|duplicate/i })
      .first();

    await expect(dupToast).toBeVisible({ timeout: 20_000 });

    // The form must not redirect — the user should stay to correct the data.
    await expect(page).toHaveURL(/\/claims\/new/, { timeout: 10_000 });

    await expect
      .poll(
        () =>
          countExpenseFingerprintRecords({
            billNo,
            transactionDate: txDate,
            totalAmount: expectedTotalAmount,
          }),
        {
          timeout: 15_000,
          message: `waiting to confirm duplicate fingerprint count is stable for ${billNo}`,
        },
      )
      .toBe(baselineCount + 1);
  });

  // ─── VAL-3 ────────────────────────────────────────────────────────────────
  test("VAL-3: Selecting Petty Cash payment mode unmounts expense section and mounts advance section", async ({
    page,
  }) => {
    await openClaimForm(page);
    const options = await resolveFormOptions();

    const paymentModeSelect = page.getByRole("combobox", { name: /payment mode/i });

    // ── Phase 1: Reimbursement → expense detail section active ───────────
    await selectOptionByLabelWithRetry(paymentModeSelect, options.reimbursementPaymentModeName);

    // Expense-section landmarks must be present (and visible) in the DOM.
    await expect(page.locator("#billNo")).toBeVisible();
    await expect(page.locator("#basicAmount")).toBeVisible();

    // Advance-section landmark must NOT yet exist in the DOM because React
    // unmounts the entire advance JSX branch when detailType === "expense".
    await expect(page.locator("#requestedAmount")).not.toBeAttached();

    // ── Phase 2: Petty Cash → advance detail section active ──────────────
    await selectOptionByLabelWithRetry(paymentModeSelect, options.pettyCashRequestPaymentModeName);

    // The useEffect that syncs paymentModeId→detailType must have fired and
    // React must have re-rendered before these assertions run.
    await expect(page.locator("#requestedAmount")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("#expectedUsageDate")).toBeVisible({ timeout: 5_000 });

    // Expense section must have been completely removed from the DOM.
    await expect(page.locator("#billNo")).not.toBeAttached({ timeout: 5_000 });

    // ── Phase 3: Switch back → expense section restored ──────────────────
    await selectOptionByLabelWithRetry(paymentModeSelect, options.reimbursementPaymentModeName);

    await expect(page.locator("#billNo")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("#requestedAmount")).not.toBeAttached({ timeout: 5_000 });
  });

  // ─── VAL-4 ────────────────────────────────────────────────────────────────
  test("VAL-4: Uploading an unsupported file type shows validation error on submit", async ({
    page,
  }) => {
    await openClaimForm(page);
    const options = await resolveFormOptions();

    const paymentModeSelect = page.getByRole("combobox", { name: /payment mode/i });
    await selectOptionByLabelWithRetry(paymentModeSelect, options.reimbursementPaymentModeName);

    // Fill all mandatory text fields so the only validation failure is the
    // invalid file type — this isolates the validateUploadFile guard.
    const tag = `${RUN_TAG}-BADFILE-${Date.now()}`;
    await fillExpenseFieldsWithoutFile(page, {
      billNo: `BILL-BADFILE-${tag}`,
      transactionDate: "2026-03-10",
      amount: 200,
      tag,
    });

    // Playwright's setInputFiles bypasses the browser accept attribute, so
    // the .txt file lands in React state as `invoiceFile`.  The validation
    // runs inside onValidSubmit when the user clicks Submit.
    await page.locator("#receiptFile").setInputFiles(INVALID_FILE_PATH);

    await page.getByRole("button", { name: /submit claim/i }).click();

    // validateUploadFile returns "Invoice/Bill file must be an image or PDF."
    // which is surfaced both via toast.error and the inline fileError <p>.
    const invalidTypePattern = /must be an image or pdf/i;
    const errorLocator = page
      .locator("[data-sonner-toast], p")
      .filter({ hasText: invalidTypePattern })
      .first();

    await expect(errorLocator).toBeVisible({ timeout: 10_000 });

    // The form must NOT redirect — the user stays to correct the file.
    await expect(page).toHaveURL(/\/claims\/new/);
  });

  // ─── REND-1 ───────────────────────────────────────────────────────────────
  test("REND-1: Toggling Submission Type reveals and hides On Behalf fields", async ({ page }) => {
    await openClaimForm(page);

    const submissionTypeSelect = page.locator("#submissionType");
    const onBehalfEmail = page.locator("#onBehalfEmail");
    const onBehalfEmployeeCode = page.locator("#onBehalfEmployeeCode");

    // ── Phase 1: Default is "Self" → On Behalf fields must not exist ─────
    await expect(submissionTypeSelect).toHaveValue("Self");
    await expect(onBehalfEmail).not.toBeAttached();
    await expect(onBehalfEmployeeCode).not.toBeAttached();

    // ── Phase 2: Switch to "On Behalf" → fields appear ──────────────────
    await expect
      .poll(
        async () => {
          await submissionTypeSelect.selectOption({ label: "On Behalf" });
          return submissionTypeSelect.inputValue();
        },
        {
          timeout: 10_000,
          message: "waiting for Submission Type to persist as On Behalf",
        },
      )
      .toBe("On Behalf");

    await expect(onBehalfEmail).toBeVisible({ timeout: 5_000 });
    await expect(onBehalfEmployeeCode).toBeVisible({ timeout: 5_000 });

    // Fill them to prove they are interactive
    await onBehalfEmail.fill("proxy@nxtwave.co.in");
    await onBehalfEmployeeCode.fill("EMP-PROXY-001");
    await expect(onBehalfEmail).toHaveValue("proxy@nxtwave.co.in");
    await expect(onBehalfEmployeeCode).toHaveValue("EMP-PROXY-001");

    // ── Phase 3: Switch back to "Self" → fields unmount ─────────────────
    await expect
      .poll(
        async () => {
          await submissionTypeSelect.selectOption({ label: "Self" });
          return submissionTypeSelect.inputValue();
        },
        {
          timeout: 10_000,
          message: "waiting for Submission Type to persist as Self",
        },
      )
      .toBe("Self");

    await expect(onBehalfEmail).not.toBeAttached({ timeout: 5_000 });
    await expect(onBehalfEmployeeCode).not.toBeAttached({ timeout: 5_000 });
  });

  // ─── REND-2 ───────────────────────────────────────────────────────────────
  test("REND-2: GST checkbox toggles tax fields and auto-calculates Total Amount", async ({
    page,
  }) => {
    await openClaimForm(page);
    const options = await resolveFormOptions();

    // Ensure expense section is active
    const paymentModeSelect = page.getByRole("combobox", { name: /payment mode/i });
    await selectOptionByLabelWithRetry(paymentModeSelect, options.reimbursementPaymentModeName);

    const basicAmountInput = page.locator("#basicAmount");
    const totalAmountInput = page.locator("#totalAmount");
    const gstCheckbox = page.locator("#isGstApplicable");
    const cgstInput = page.locator("#cgstAmount");
    const sgstInput = page.locator("#sgstAmount");
    const igstInput = page.locator("#igstAmount");

    // ── Phase 1: No GST — total mirrors basic amount ────────────────────
    await expect(gstCheckbox).not.toBeChecked();
    await expect(cgstInput).not.toBeAttached();
    await expect(sgstInput).not.toBeAttached();
    await expect(igstInput).not.toBeAttached();

    await basicAmountInput.fill("1000");
    // React's useEffect recalculates: total = basic (no GST) = 1000.00
    await expect(totalAmountInput).toHaveValue("1000.00");

    // ── Phase 2: Enable GST — tax fields appear, enter values ───────────
    await gstCheckbox.check();

    await expect(cgstInput).toBeVisible({ timeout: 5_000 });
    await expect(sgstInput).toBeVisible({ timeout: 5_000 });
    await expect(igstInput).toBeVisible({ timeout: 5_000 });

    await cgstInput.fill("50");
    await sgstInput.fill("50");
    // igstAmount defaults to 0 — leave it at 0
    // Expected total: 1000 + 50 + 50 + 0 = 1100.00
    await expect(totalAmountInput).toHaveValue("1100.00");

    // Add IGST → total updates to 1200.00
    await igstInput.fill("100");
    await expect(totalAmountInput).toHaveValue("1200.00");

    // ── Phase 3: Uncheck GST — tax fields unmount, total reverts ────────
    await gstCheckbox.uncheck();

    await expect(cgstInput).not.toBeAttached({ timeout: 5_000 });
    await expect(sgstInput).not.toBeAttached({ timeout: 5_000 });
    await expect(igstInput).not.toBeAttached({ timeout: 5_000 });

    // The useEffect clears GST amounts to 0 and recalculates total = basic
    await expect(totalAmountInput).toHaveValue("1000.00");
  });
});
