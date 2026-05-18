import path from "node:path";
import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getAuthStatePathForEmail } from "./auth-state";

export const RECEIPT_PATH = path.resolve(process.cwd(), "tests/fixtures/dummy-receipt.pdf");

const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "password123";
const DEFAULT_SUBMITTER_EMAIL = (
  process.env.E2E_SUBMITTER_EMAIL ?? "user@nxtwave.co.in"
).toLowerCase();
const DEFAULT_FINANCE_EMAIL = (
  process.env.E2E_FINANCE_EMAIL ?? "finance@nxtwave.co.in"
).toLowerCase();

const indiaCurrencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export type RuntimeClaimData = {
  submitterId: string;
  submitterEmail: string;
  reimbursementPaymentModeName: string;
  pettyCashRequestPaymentModeName: string;
  expenseCategoryName: string;
  submitterDepartmentName: string;
  submitterDepartmentId: string;
  financeApproverId: string;
  financeEmail: string;
};

let runtimeClaimDataPromise: Promise<RuntimeClaimData> | null = null;

export function formatInr(amount: number): string {
  return indiaCurrencyFormatter.format(amount);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables for E2E runtime queries.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function resolveRuntimeClaimData(): Promise<RuntimeClaimData> {
  if (!runtimeClaimDataPromise) {
    runtimeClaimDataPromise = (async () => {
      const client = getAdminSupabaseClient();

      const [
        { data: submitter, error: submitterError },
        { data: reimbursementMode, error: reimbursementError },
        { data: pettyCashRequestMode, error: pettyCashRequestError },
        { data: expenseCategory, error: expenseCategoryError },
      ] = await Promise.all([
        client
          .from("users")
          .select("id, email")
          .eq("email", DEFAULT_SUBMITTER_EMAIL)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle(),
        client
          .from("master_payment_modes")
          .select("name")
          .eq("is_active", true)
          .ilike("name", "%reimbursement%")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        client
          .from("master_payment_modes")
          .select("name")
          .eq("is_active", true)
          .ilike("name", "%petty cash request%")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        client
          .from("master_expense_categories")
          .select("name")
          .eq("is_active", true)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);

      if (submitterError || !submitter?.id || !submitter?.email) {
        throw new Error(submitterError?.message ?? "Configured submitter user not found.");
      }

      if (reimbursementError || !reimbursementMode?.name) {
        throw new Error(
          reimbursementError?.message ?? "No active reimbursement payment mode found.",
        );
      }

      if (pettyCashRequestError || !pettyCashRequestMode?.name) {
        throw new Error(
          pettyCashRequestError?.message ?? "No active petty cash request payment mode found.",
        );
      }

      if (expenseCategoryError || !expenseCategory?.name) {
        throw new Error(expenseCategoryError?.message ?? "No active expense category found.");
      }

      const latestClaimDepartmentResult = await client
        .from("claims")
        .select("department_id")
        .eq("submitted_by", submitter.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestClaimDepartmentResult.error) {
        throw new Error(
          `Failed to infer submitter department: ${latestClaimDepartmentResult.error.message}`,
        );
      }

      const fallbackDepartmentResult = await client
        .from("master_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (fallbackDepartmentResult.error || !fallbackDepartmentResult.data) {
        throw new Error(
          fallbackDepartmentResult.error?.message ??
            "No active department found for claim creation.",
        );
      }

      let submitterDepartmentId = fallbackDepartmentResult.data.id as string;
      let submitterDepartmentName = fallbackDepartmentResult.data.name as string;

      const latestDepartmentId = latestClaimDepartmentResult.data?.department_id as
        | string
        | undefined;

      if (latestDepartmentId) {
        const latestDepartmentResult = await client
          .from("master_departments")
          .select("id, name")
          .eq("id", latestDepartmentId)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        if (!latestDepartmentResult.error && latestDepartmentResult.data) {
          submitterDepartmentId = latestDepartmentResult.data.id as string;
          submitterDepartmentName = latestDepartmentResult.data.name as string;
        }
      }

      let financeApproverId: string | null = null;
      let financeEmail: string | null = null;

      const configuredFinanceUserResult = await client
        .from("users")
        .select("id, email")
        .eq("email", DEFAULT_FINANCE_EMAIL)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (configuredFinanceUserResult.data?.id) {
        const configuredFinanceApproverResult = await client
          .from("master_finance_approvers")
          .select("id")
          .eq("is_active", true)
          .eq("user_id", configuredFinanceUserResult.data.id)
          .limit(1)
          .maybeSingle();

        if (!configuredFinanceApproverResult.error && configuredFinanceApproverResult.data?.id) {
          financeApproverId = configuredFinanceApproverResult.data.id as string;
          financeEmail = configuredFinanceUserResult.data.email as string;
        }
      }

      if (!financeApproverId) {
        const fallbackFinanceApproverResult = await client
          .from("master_finance_approvers")
          .select("id, user_id")
          .eq("is_active", true)
          .order("is_primary", { ascending: false })
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (fallbackFinanceApproverResult.error || !fallbackFinanceApproverResult.data?.id) {
          throw new Error(
            fallbackFinanceApproverResult.error?.message ??
              "No active finance approver found for runtime setup.",
          );
        }

        financeApproverId = fallbackFinanceApproverResult.data.id as string;

        if (fallbackFinanceApproverResult.data.user_id) {
          const financeUserResult = await client
            .from("users")
            .select("email")
            .eq("id", fallbackFinanceApproverResult.data.user_id)
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();

          if (!financeUserResult.error && financeUserResult.data?.email) {
            financeEmail = financeUserResult.data.email as string;
          }
        }
      }

      if (!financeApproverId || !financeEmail) {
        throw new Error("Unable to resolve active finance actor details for E2E runtime setup.");
      }

      return {
        submitterId: submitter.id as string,
        submitterEmail: submitter.email as string,
        reimbursementPaymentModeName: reimbursementMode.name,
        pettyCashRequestPaymentModeName: pettyCashRequestMode.name,
        expenseCategoryName: expenseCategory.name,
        submitterDepartmentName,
        submitterDepartmentId,
        financeApproverId,
        financeEmail,
      };
    })();
  }

  return runtimeClaimDataPromise;
}

export async function gotoWithRetry(page: Page, url: string, attempts = 2): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      const errorText = String(error);
      const isNavigationAbort =
        /ERR_ABORTED/i.test(errorText) || /interrupted by another navigation/i.test(errorText);

      if (!isNavigationAbort || attempt === attempts) {
        throw error;
      }
    }
  }
}

export async function acceptPolicyGateIfPresent(page: Page): Promise<void> {
  const policyGateHeading = page.getByRole("heading", { name: /company policy gate/i }).first();
  const isPolicyGateVisible = await policyGateHeading
    .isVisible({ timeout: 1200 })
    .catch(() => false);

  if (!isPolicyGateVisible) {
    return;
  }

  const confirmationCheckbox = page
    .getByRole("checkbox", { name: /i have read and agree to this company policy/i })
    .first();

  await expect(confirmationCheckbox).toBeVisible({ timeout: 10000 });
  if (!(await confirmationCheckbox.isChecked().catch(() => false))) {
    await confirmationCheckbox.check({ force: true });
  }

  const acceptButton = page.getByRole("button", { name: /^i accept$/i }).first();
  await expect(acceptButton).toBeEnabled({ timeout: 10000 });
  await acceptButton.click({ force: true });

  await expect(policyGateHeading).toBeHidden({ timeout: 30000 });
}

async function waitForAuthenticatedDashboard(page: Page, email: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await gotoWithRetry(page, "/dashboard");
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
        await acceptPolicyGateIfPresent(page);

        if (/\/auth\/login/i.test(page.url())) {
          return false;
        }

        const signOutVisible = await page
          .getByRole("button", { name: /sign out/i })
          .first()
          .isVisible({ timeout: 1000 })
          .catch(() => false);

        const emailHeadingVisible = await page
          .getByRole("heading", { name: new RegExp(escapeRegExp(email), "i") })
          .first()
          .isVisible({ timeout: 1000 })
          .catch(() => false);

        return signOutVisible || emailHeadingVisible;
      },
      {
        timeout: 45000,
        intervals: [1000, 2000, 3000],
        message: `waiting for authenticated dashboard for ${email}`,
      },
    )
    .toBe(true);
}

export async function ensureAuthenticated(page: Page, email: string): Promise<void> {
  await gotoWithRetry(page, "/dashboard");
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  await acceptPolicyGateIfPresent(page);

  const alreadyAuthenticated =
    !/\/auth\/login/i.test(page.url()) &&
    (await page
      .getByRole("button", { name: /sign out/i })
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false));

  if (alreadyAuthenticated) {
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

  await waitForAuthenticatedDashboard(page, email);
}

export async function withActorPage<T>(
  browser: Browser,
  email: string,
  work: (page: Page) => Promise<T>,
): Promise<T> {
  const storageStatePath = getAuthStatePathForEmail(email);
  const context = await browser.newContext(
    storageStatePath ? { storageState: storageStatePath } : undefined,
  );
  const page = await context.newPage();

  try {
    await ensureAuthenticated(page, email);
    return await work(page);
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function openClaimForm(page: Page, email: string): Promise<void> {
  await ensureAuthenticated(page, email);
  await gotoWithRetry(page, "/claims/new");
  await acceptPolicyGateIfPresent(page);

  const hydrationBanner = page.getByText(/unable to load claim form data/i);
  if ((await hydrationBanner.count()) > 0) {
    await ensureAuthenticated(page, email);
    await gotoWithRetry(page, "/claims/new");
  }

  await expect(page.getByRole("button", { name: /submit claim/i })).toBeVisible({ timeout: 15000 });
}

export async function selectOptionByLabel(
  page: Page,
  label: string | RegExp,
  optionLabel: string,
): Promise<void> {
  const select = page
    .getByRole("combobox", {
      name: typeof label === "string" ? new RegExp(label, "i") : label,
    })
    .first();

  await expect(select).toBeVisible({ timeout: 15000 });

  const isDisabled = await select.isDisabled().catch(() => false);
  const isReadOnly =
    (await select.getAttribute("readonly").catch(() => null)) !== null ||
    (await select.getAttribute("aria-readonly").catch(() => null)) === "true";

  if (isDisabled || isReadOnly) {
    return;
  }

  await expect
    .poll(
      async () =>
        select
          .locator("option")
          .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(optionLabel)}\\s*$`, "i") })
          .count(),
      {
        timeout: 15000,
        message: `waiting for option ${optionLabel}`,
      },
    )
    .toBeGreaterThan(0);

  await select.selectOption({ label: optionLabel });
}

export async function fillTextboxIfEditable(
  page: Page,
  label: string | RegExp,
  value: string,
): Promise<void> {
  const textbox = page
    .getByRole("textbox", {
      name: typeof label === "string" ? new RegExp(label, "i") : label,
    })
    .first();

  await expect(textbox).toBeVisible({ timeout: 15000 });

  const isDisabled = await textbox.isDisabled().catch(() => false);
  const isReadOnly = await textbox
    .evaluate((element) => {
      const input = element as HTMLInputElement;
      return input.readOnly || element.getAttribute("aria-readonly") === "true";
    })
    .catch(() => false);

  if (isDisabled || isReadOnly) {
    return;
  }

  await textbox.fill(value);
}

export async function submitExpenseClaim(
  page: Page,
  input: {
    submitterEmail: string;
    departmentName: string;
    paymentModeName: string;
    expenseCategoryName: string;
    billNo: string;
    amount: number;
    employeeId: string;
    purpose: string;
    transactionDate: string;
  },
): Promise<void> {
  await openClaimForm(page, input.submitterEmail);

  await selectOptionByLabel(page, /Department/i, input.departmentName);
  await selectOptionByLabel(page, /Payment Mode/i, input.paymentModeName);
  await selectOptionByLabel(page, /Expense Category/i, input.expenseCategoryName);

  await fillTextboxIfEditable(page, /^Employee ID \*/i, input.employeeId);
  await page.getByRole("textbox", { name: /^Bill No \*/i }).fill(input.billNo);
  await page.getByRole("textbox", { name: /^Purpose/i }).fill(input.purpose);
  await page.getByRole("spinbutton", { name: /^Basic Amount \*/i }).fill(String(input.amount));
  await page.getByRole("textbox", { name: /^Transaction Date \*/i }).fill(input.transactionDate);
  await page.locator("#receiptFile").setInputFiles(RECEIPT_PATH);

  await page.getByRole("button", { name: /submit claim/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/my-claims(?:\?|$)/, { timeout: 30000 });
}

export async function submitPettyCashRequestClaim(
  page: Page,
  input: {
    submitterEmail: string;
    departmentName: string;
    paymentModeName: string;
    employeeId: string;
    totalAmount: number;
    purpose: string;
    expectedUsageDate: string;
    budgetMonth: string;
    budgetYear: string;
  },
): Promise<void> {
  await openClaimForm(page, input.submitterEmail);

  await selectOptionByLabel(page, /Department/i, input.departmentName);
  await selectOptionByLabel(page, /Payment Mode/i, input.paymentModeName);

  await fillTextboxIfEditable(page, /^Employee ID \*/i, input.employeeId);
  await page.locator("#totalAmount").fill(String(input.totalAmount));
  await page.locator("#expectedUsageDate").fill(input.expectedUsageDate);
  await page.locator("#budgetMonth").selectOption(input.budgetMonth);
  await page.locator("#budgetYear").selectOption(input.budgetYear);
  await page.locator("#purpose").fill(input.purpose);

  await page.getByRole("button", { name: /submit claim/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/my-claims(?:\?|$)/, { timeout: 30000 });
}

export async function resolveLatestActiveExpenseClaimByBillNo(input: {
  submitterId: string;
  billNo: string;
  excludeClaimId?: string;
}): Promise<{ claimId: string; status: string }> {
  const client = getAdminSupabaseClient();

  await expect
    .poll(
      async () => {
        let query = client
          .from("claims")
          .select("id, status, expense_details!inner(bill_no, is_active)")
          .eq("submitted_by", input.submitterId)
          .eq("is_active", true)
          .eq("expense_details.bill_no", input.billNo)
          .eq("expense_details.is_active", true)
          .order("created_at", { ascending: false })
          .limit(1);

        if (input.excludeClaimId) {
          query = query.neq("id", input.excludeClaimId);
        }

        const { data, error } = await query.maybeSingle();
        if (error) {
          throw new Error(error.message);
        }

        return data ? { claimId: data.id as string, status: data.status as string } : null;
      },
      {
        timeout: 45000,
        message: `waiting for active expense claim on bill ${input.billNo}`,
      },
    )
    .not.toBeNull();

  let query = client
    .from("claims")
    .select("id, status, expense_details!inner(bill_no, is_active)")
    .eq("submitted_by", input.submitterId)
    .eq("is_active", true)
    .eq("expense_details.bill_no", input.billNo)
    .eq("expense_details.is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);

  if (input.excludeClaimId) {
    query = query.neq("id", input.excludeClaimId);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data?.id || !data?.status) {
    throw new Error(error?.message ?? `No active expense claim found for bill ${input.billNo}.`);
  }

  return {
    claimId: data.id as string,
    status: data.status as string,
  };
}

export async function resolveLatestActiveAdvanceClaimByPurpose(input: {
  submitterId: string;
  purpose: string;
  excludeClaimId?: string;
}): Promise<{ claimId: string; status: string }> {
  const client = getAdminSupabaseClient();

  await expect
    .poll(
      async () => {
        let query = client
          .from("claims")
          .select("id, status, advance_details!inner(purpose, is_active)")
          .eq("submitted_by", input.submitterId)
          .eq("is_active", true)
          .eq("advance_details.purpose", input.purpose)
          .eq("advance_details.is_active", true)
          .order("created_at", { ascending: false })
          .limit(1);

        if (input.excludeClaimId) {
          query = query.neq("id", input.excludeClaimId);
        }

        const { data, error } = await query.maybeSingle();
        if (error) {
          throw new Error(error.message);
        }

        return data ? { claimId: data.id as string, status: data.status as string } : null;
      },
      {
        timeout: 45000,
        message: `waiting for active advance claim on purpose ${input.purpose}`,
      },
    )
    .not.toBeNull();

  let query = client
    .from("claims")
    .select("id, status, advance_details!inner(purpose, is_active)")
    .eq("submitted_by", input.submitterId)
    .eq("is_active", true)
    .eq("advance_details.purpose", input.purpose)
    .eq("advance_details.is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);

  if (input.excludeClaimId) {
    query = query.neq("id", input.excludeClaimId);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data?.id || !data?.status) {
    throw new Error(
      error?.message ?? `No active advance claim found for purpose ${input.purpose}.`,
    );
  }

  return {
    claimId: data.id as string,
    status: data.status as string,
  };
}

export async function setClaimToFinancePending(
  claimId: string,
  financeApproverId: string,
): Promise<void> {
  const client = getAdminSupabaseClient();
  const { error } = await client
    .from("claims")
    .update({
      status: "HOD approved - Awaiting finance approval",
      assigned_l2_approver_id: financeApproverId,
    })
    .eq("id", claimId)
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to move claim ${claimId} to finance stage: ${error.message}`);
  }
}

export async function getClaimRouting(claimId: string): Promise<{
  status: string;
  assignedL1ApproverId: string;
  assignedL2ApproverId: string | null;
}> {
  const client = getAdminSupabaseClient();

  const { data, error } = await client
    .from("claims")
    .select("status, assigned_l1_approver_id, assigned_l2_approver_id")
    .eq("id", claimId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error || !data?.status || !data?.assigned_l1_approver_id) {
    throw new Error(error?.message ?? `Unable to resolve routing for claim ${claimId}.`);
  }

  return {
    status: data.status as string,
    assignedL1ApproverId: data.assigned_l1_approver_id as string,
    assignedL2ApproverId: (data.assigned_l2_approver_id as string | null) ?? null,
  };
}

export async function resolveUserEmailById(userId: string): Promise<string> {
  const client = getAdminSupabaseClient();

  const { data, error } = await client
    .from("users")
    .select("email")
    .eq("id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error || !data?.email) {
    throw new Error(error?.message ?? `Unable to resolve user email for id ${userId}.`);
  }

  return data.email as string;
}

export async function openApprovalsPage(page: Page, claimId?: string): Promise<void> {
  const params = new URLSearchParams({
    view: "approvals",
    status: "all",
  });

  if (claimId) {
    params.set("search_field", "claim_id");
    params.set("search_query", claimId);
  }

  await gotoWithRetry(page, `/dashboard/my-claims?${params.toString()}`);
  await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("heading", { name: /approvals history/i })).toBeVisible({
    timeout: 20000,
  });
}

export async function openSubmissionsPage(page: Page, claimId?: string): Promise<void> {
  const params = new URLSearchParams({
    view: "submissions",
    status: "all",
  });

  if (claimId) {
    params.set("search_field", "claim_id");
    params.set("search_query", claimId);
  }

  await gotoWithRetry(page, `/dashboard/my-claims?${params.toString()}`);
  await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("heading", { name: /^claims$/i })).toBeVisible({ timeout: 20000 });
}

export function claimRow(page: Page, claimId: string): Locator {
  return page
    .locator("tbody tr", {
      has: page.getByRole("link", { name: claimId }),
    })
    .first();
}

export async function waitForClaimRow(page: Page, claimId: string, timeout = 45000): Promise<void> {
  await expect(claimRow(page, claimId)).toBeVisible({ timeout });
}

export async function selectClaimForBulkAction(page: Page, claimId: string): Promise<void> {
  await waitForClaimRow(page, claimId);

  const row = claimRow(page, claimId);
  const rowCheckbox = row.getByRole("checkbox", {
    name: new RegExp(`^Select claim ${escapeRegExp(claimId)}$`, "i"),
  });

  await expect(rowCheckbox).toBeVisible({ timeout: 10000 });
  await rowCheckbox.check();
  await expect(page.getByText(/\b1 selected\b/i)).toBeVisible({ timeout: 10000 });
}

function nextApproveStatus(currentStatus: string): string {
  if (currentStatus === "Submitted - Awaiting HOD approval") {
    return "HOD approved - Awaiting finance approval";
  }

  if (currentStatus === "HOD approved - Awaiting finance approval") {
    return "Finance Approved - Payment under process";
  }

  throw new Error(`Approve action is invalid for current status: ${currentStatus}`);
}

export async function approveAtCurrentScope(page: Page, claimId: string): Promise<void> {
  const before = await getClaimRouting(claimId);
  await openApprovalsPage(page, claimId);
  await selectClaimForBulkAction(page, claimId);

  const bulkApproveButton = page.getByRole("button", { name: /^Bulk Approve$/i }).first();
  await expect(bulkApproveButton).toBeVisible({ timeout: 10000 });
  await expect(bulkApproveButton).toBeEnabled({ timeout: 10000 });
  await bulkApproveButton.click();

  const expectedStatus = nextApproveStatus(before.status);

  await expect
    .poll(async () => (await getClaimRouting(claimId)).status, {
      timeout: 45000,
      message: `waiting for approve transition on claim ${claimId}`,
    })
    .toBe(expectedStatus);
}
