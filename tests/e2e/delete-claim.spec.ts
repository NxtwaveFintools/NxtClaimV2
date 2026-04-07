import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getAuthStatePathByRole } from "./support/auth-state";

const receiptPath = path.resolve(process.cwd(), "tests/fixtures/dummy-receipt.pdf");
const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "password123";
const RUN_TAG = process.env.E2E_RUN_TAG ?? `DELETE-${Date.now()}`;

type RuntimeFormData = {
  reimbursementPaymentModeName: string;
  submitterDepartmentName: string;
  submitterDepartmentId: string;
  expenseCategoryName: string;
  submitterId: string;
  submitterEmail: string;
};

let runtimeFormDataPromise: Promise<RuntimeFormData> | null = null;

function getAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables for delete-claim E2E.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function resolveRuntimeFormData(): Promise<RuntimeFormData> {
  if (!runtimeFormDataPromise) {
    runtimeFormDataPromise = (async () => {
      const client = getAdminSupabaseClient();
      const submitterEmail = (
        process.env.E2E_SUBMITTER_EMAIL ?? "user@nxtwave.co.in"
      ).toLowerCase();

      const [
        { data: submitter, error: submitterError },
        { data: paymentMode, error: paymentModeError },
        { data: expenseCategory, error: expenseCategoryError },
      ] = await Promise.all([
        client
          .from("users")
          .select("id, email")
          .eq("email", submitterEmail)
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

      if (paymentModeError || !paymentMode?.name) {
        throw new Error(paymentModeError?.message ?? "No active reimbursement payment mode found.");
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

      const latestDepartmentId = latestClaimDepartmentResult.data?.department_id as
        | string
        | undefined;

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

      let departmentId = fallbackDepartmentResult.data.id as string;
      let departmentName = fallbackDepartmentResult.data.name as string;

      if (latestDepartmentId) {
        const latestDepartmentResult = await client
          .from("master_departments")
          .select("id, name")
          .eq("id", latestDepartmentId)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        if (!latestDepartmentResult.error && latestDepartmentResult.data) {
          departmentId = latestDepartmentResult.data.id as string;
          departmentName = latestDepartmentResult.data.name as string;
        }
      }

      return {
        reimbursementPaymentModeName: paymentMode.name,
        submitterDepartmentName: departmentName,
        submitterDepartmentId: departmentId,
        expenseCategoryName: expenseCategory.name,
        submitterId: submitter.id as string,
        submitterEmail: submitter.email as string,
      };
    })();
  }

  return runtimeFormDataPromise;
}

async function gotoWithRetry(page: Page, url: string, attempts = 2): Promise<void> {
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

async function acceptPolicyGateIfPresent(page: Page): Promise<void> {
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

async function ensureAuthenticated(page: Page, email: string): Promise<void> {
  await gotoWithRetry(page, "/dashboard");
  await acceptPolicyGateIfPresent(page);

  const signOutButton = page.getByRole("button", { name: /sign out/i });
  const hasSession =
    !/\/auth\/login/i.test(page.url()) &&
    (await signOutButton.isVisible({ timeout: 3000 }).catch(() => false));

  if (hasSession) {
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

  await gotoWithRetry(page, "/dashboard");
  await acceptPolicyGateIfPresent(page);
  await expect(page).not.toHaveURL(/\/auth\/login/i);
}

async function openClaimForm(page: Page, email: string): Promise<void> {
  await ensureAuthenticated(page, email);
  await gotoWithRetry(page, "/claims/new");
  await acceptPolicyGateIfPresent(page);

  await expect(page.getByRole("button", { name: /submit claim/i })).toBeVisible({ timeout: 15000 });
}

async function selectOptionByLabel(page: Page, label: string | RegExp, optionLabel: string) {
  const select = page.getByRole("combobox", {
    name: typeof label === "string" ? new RegExp(label, "i") : label,
  });
  await expect(select).toBeVisible();
  await select.selectOption({ label: optionLabel });
}

async function submitExpenseClaim(
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

  await page.getByRole("textbox", { name: /^Employee ID \*/i }).fill(input.employeeId);
  await page.getByRole("textbox", { name: /^Bill No \*/i }).fill(input.billNo);
  await page.getByRole("textbox", { name: /^Purpose/i }).fill(input.purpose);
  await page.getByRole("spinbutton", { name: /^Basic Amount \*/i }).fill(String(input.amount));
  await page.getByRole("textbox", { name: /^Transaction Date \*/i }).fill(input.transactionDate);
  await page.locator("#receiptFile").setInputFiles(receiptPath);

  await page.getByRole("button", { name: /submit claim/i }).click();
}

async function resolveLatestActiveClaimByBillNo(input: {
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
        message: `waiting for active claim on bill ${input.billNo}`,
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
    throw new Error(error?.message ?? `No active claim found for bill ${input.billNo}.`);
  }

  return {
    claimId: data.id as string,
    status: data.status as string,
  };
}

async function waitForClaimAndDetailsInactive(claimId: string): Promise<void> {
  const client = getAdminSupabaseClient();

  await expect
    .poll(
      async () => {
        const [
          { data: claim, error: claimError },
          { count: expenseActiveCount, error: expenseError },
          { count: advanceActiveCount, error: advanceError },
        ] = await Promise.all([
          client.from("claims").select("is_active").eq("id", claimId).limit(1).maybeSingle(),
          client
            .from("expense_details")
            .select("id", { count: "exact", head: true })
            .eq("claim_id", claimId)
            .eq("is_active", true),
          client
            .from("advance_details")
            .select("id", { count: "exact", head: true })
            .eq("claim_id", claimId)
            .eq("is_active", true),
        ]);

        if (claimError || expenseError || advanceError) {
          throw new Error(claimError?.message ?? expenseError?.message ?? advanceError?.message);
        }

        return {
          claimActive: claim?.is_active === true,
          expenseActiveCount: expenseActiveCount ?? 0,
          advanceActiveCount: advanceActiveCount ?? 0,
        };
      },
      {
        timeout: 30000,
        message: `waiting for claim ${claimId} and detail rows to become inactive`,
      },
    )
    .toEqual({ claimActive: false, expenseActiveCount: 0, advanceActiveCount: 0 });
}

test.describe("Delete Claim", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: getAuthStatePathByRole("submitter") });

  test("submitter can delete and recreate same bill, and detail-page delete redirects", async ({
    page,
  }) => {
    const runtime = await resolveRuntimeFormData();

    const billNo = `BILL-DEL-${RUN_TAG}`;
    const amount = 125;
    const transactionDate = new Date().toISOString().slice(0, 10);

    await submitExpenseClaim(page, {
      submitterEmail: runtime.submitterEmail,
      departmentName: runtime.submitterDepartmentName,
      paymentModeName: runtime.reimbursementPaymentModeName,
      expenseCategoryName: runtime.expenseCategoryName,
      billNo,
      amount,
      employeeId: `EMP-DEL-A-${RUN_TAG}`,
      purpose: `Delete claim flow A ${RUN_TAG}`,
      transactionDate,
    });

    const firstClaim = await resolveLatestActiveClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo,
    });
    expect(firstClaim.status).toBe("Submitted - Awaiting HOD approval");

    await page.goto(
      `/dashboard/my-claims?view=submissions&search_field=claim_id&search_query=${encodeURIComponent(firstClaim.claimId)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("heading", { name: /my claims/i })).toBeVisible({ timeout: 20000 });

    const firstRow = page.locator("tbody tr", { hasText: firstClaim.claimId }).first();
    await expect(firstRow).toBeVisible({ timeout: 30000 });

    const firstDeleteButton = firstRow.getByRole("button", { name: /^Delete Claim$/i }).first();
    await expect(firstDeleteButton).toBeVisible({ timeout: 10000 });

    await firstDeleteButton.click();
    const firstDeleteDialog = page.getByRole("dialog", { name: /^Delete Claim$/i }).first();
    await expect(firstDeleteDialog).toBeVisible({ timeout: 10000 });
    await expect(firstDeleteDialog).toContainText(
      "Are you sure you want to delete this claim? This action will remove it from your queue.",
    );
    await firstDeleteDialog.getByRole("button", { name: /^Delete$/i }).click();

    await expect(firstRow).toHaveCount(0);
    await waitForClaimAndDetailsInactive(firstClaim.claimId);

    await submitExpenseClaim(page, {
      submitterEmail: runtime.submitterEmail,
      departmentName: runtime.submitterDepartmentName,
      paymentModeName: runtime.reimbursementPaymentModeName,
      expenseCategoryName: runtime.expenseCategoryName,
      billNo,
      amount,
      employeeId: `EMP-DEL-B-${RUN_TAG}`,
      purpose: `Delete claim flow B ${RUN_TAG}`,
      transactionDate,
    });

    await expect(page.getByText(/exact Bill No, Date, and Amount already exists/i)).toHaveCount(0);

    const secondClaim = await resolveLatestActiveClaimByBillNo({
      submitterId: runtime.submitterId,
      billNo,
      excludeClaimId: firstClaim.claimId,
    });
    expect(secondClaim.claimId).not.toBe(firstClaim.claimId);
    expect(secondClaim.status).toBe("Submitted - Awaiting HOD approval");

    await page.goto(`/dashboard/claims/${secondClaim.claimId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: secondClaim.claimId })).toBeVisible({
      timeout: 30000,
    });

    const detailDeleteButton = page.getByRole("button", { name: /^Delete Claim$/i }).first();
    await expect(detailDeleteButton).toBeVisible({ timeout: 10000 });

    await detailDeleteButton.click();
    const detailDeleteDialog = page.getByRole("dialog", { name: /^Delete Claim$/i }).first();
    await expect(detailDeleteDialog).toBeVisible({ timeout: 10000 });
    await expect(detailDeleteDialog).toContainText(
      "Are you sure you want to delete this claim? This action will remove it from your queue.",
    );
    await detailDeleteDialog.getByRole("button", { name: /^Delete$/i }).click();

    await expect(page).toHaveURL(/\/dashboard\/my-claims/);
    await waitForClaimAndDetailsInactive(secondClaim.claimId);
  });
});
