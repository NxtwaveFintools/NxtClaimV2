import path from "node:path";
import fs from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { getAuthStatePathByRole } from "../support/auth-state";

loadEnvConfig(process.cwd());

const receiptPath = path.resolve(process.cwd(), "tests/fixtures/dummy-receipt.pdf");
const runTag = process.env.E2E_RUN_TAG ?? `ROUTING-${Date.now()}`;

type AuthStateSessionUser = {
  id: string;
  email: string;
};

type RoutingRuntimeData = {
  reimbursementPaymentModeName: string;
  hodDepartmentName: string;
  founderDisplayName: string;
  founderEmail: string;
  hodEmail: string;
  submitterEmail: string;
};

let runtimeDataPromise: Promise<RoutingRuntimeData> | null = null;

function decodeAuthTokenPayload(rawTokenValue: string): { user?: AuthStateSessionUser } | null {
  const token = rawTokenValue.startsWith("base64-") ? rawTokenValue.slice(7) : rawTokenValue;

  try {
    const decoded = Buffer.from(token, "base64").toString("utf8");
    return JSON.parse(decoded) as { user?: AuthStateSessionUser };
  } catch {
    return null;
  }
}

async function readAuthStateUser(role: "hod" | "submitter"): Promise<AuthStateSessionUser> {
  const filePath = getAuthStatePathByRole(role);
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as {
    cookies?: Array<{ name: string; value: string }>;
  };

  const cookies = parsed.cookies ?? [];
  const chunkedCookies = cookies
    .filter((cookie) => /auth-token(\.\d+)?$/.test(cookie.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (chunkedCookies.length === 0) {
    throw new Error(`No auth token cookie found in ${filePath}.`);
  }

  const combinedValue = chunkedCookies.map((cookie) => cookie.value).join("");
  const payload = decodeAuthTokenPayload(combinedValue);
  const user = payload?.user;

  if (!user?.id || !user?.email) {
    throw new Error(`Unable to resolve user from auth-state file ${filePath}.`);
  }

  return {
    id: user.id,
    email: user.email.toLowerCase(),
  };
}

function getAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase env vars for routing-and-visibility E2E tests.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function resolveRuntimeData(): Promise<RoutingRuntimeData> {
  if (!runtimeDataPromise) {
    runtimeDataPromise = (async () => {
      const client = getAdminSupabaseClient();
      const [hodSessionUser, submitterSessionUser] = await Promise.all([
        readAuthStateUser("hod"),
        readAuthStateUser("submitter"),
      ]);

      const [{ data: paymentMode, error: paymentModeError }, { data: hodUser, error: hodError }] =
        await Promise.all([
          client
            .from("master_payment_modes")
            .select("name")
            .eq("is_active", true)
            .ilike("name", "%reimbursement%")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          client
            .from("users")
            .select("id, full_name")
            .eq("id", hodSessionUser.id)
            .eq("is_active", true)
            .limit(1)
            .maybeSingle(),
        ]);

      if (paymentModeError || !paymentMode?.name) {
        throw new Error(paymentModeError?.message ?? "No active reimbursement payment mode found.");
      }

      if (hodError || !hodUser?.id) {
        throw new Error(hodError?.message ?? "HOD user not found in users table.");
      }

      const { data: hodDepartment, error: hodDepartmentError } = await client
        .from("master_departments")
        .select("id, name, approver1_id, approver2_id")
        .eq("is_active", true)
        .eq("approver1_id", hodUser.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (hodDepartmentError || !hodDepartment?.id || !hodDepartment.approver2_id) {
        throw new Error(hodDepartmentError?.message ?? "No active HOD department mapping found.");
      }

      const { data: founderUser, error: founderError } = await client
        .from("users")
        .select("email, full_name")
        .eq("id", hodDepartment.approver2_id)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (founderError || !founderUser?.email) {
        throw new Error(founderError?.message ?? "Unable to resolve department approver_2 user.");
      }

      return {
        reimbursementPaymentModeName: paymentMode.name,
        hodDepartmentName: hodDepartment.name,
        founderDisplayName: founderUser.full_name ?? founderUser.email,
        founderEmail: founderUser.email,
        hodEmail: hodSessionUser.email,
        submitterEmail: submitterSessionUser.email,
      };
    })();
  }

  return runtimeDataPromise;
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

async function acceptPolicyGateIfPresent(page: Page): Promise<void> {
  const policyGateHeading = page.getByRole("heading", { name: /company policy gate/i }).first();
  const visible = await policyGateHeading.isVisible({ timeout: 1000 }).catch(() => false);

  if (!visible) {
    return;
  }

  const checkbox = page
    .getByRole("checkbox", { name: /i have read and agree to this company policy/i })
    .first();

  await expect(checkbox).toBeVisible({ timeout: 10000 });
  if (!(await checkbox.isChecked().catch(() => false))) {
    await checkbox.check({ force: true });
  }

  const acceptButton = page.getByRole("button", { name: /^i accept$/i }).first();
  await expect(acceptButton).toBeEnabled({ timeout: 10000 });
  await acceptButton.click({ force: true });
  await expect(policyGateHeading).toBeHidden({ timeout: 30000 });
}

async function openClaimForm(page: Page): Promise<void> {
  await gotoWithRetry(page, "/claims/new");
  await acceptPolicyGateIfPresent(page);
  await expect(page.getByRole("button", { name: /submit claim/i })).toBeVisible({ timeout: 15000 });
}

async function selectOptionByLabel(page: Page, label: string | RegExp, optionLabel: string) {
  const select = page.getByRole("combobox", {
    name: typeof label === "string" ? new RegExp(label, "i") : label,
  });

  await expect(select).toBeVisible({ timeout: 10000 });
  await expect
    .poll(
      async () => {
        await select.selectOption({ label: optionLabel });
        return select.evaluate((el) => {
          const selectEl = el as HTMLSelectElement;
          const selected = selectEl.selectedOptions?.[0];
          return selected?.label ?? selected?.textContent?.trim() ?? "";
        });
      },
      {
        timeout: 10000,
        message: `waiting for select value to persist as ${optionLabel}`,
      },
    )
    .toBe(optionLabel);
}

async function submitExpenseClaim(
  page: Page,
  input: {
    paymentModeLabel: string;
    departmentLabel: string;
    employeeId: string;
    billNo: string;
    submissionType?: "Self" | "On Behalf";
    onBehalfEmail?: string;
    onBehalfEmployeeCode?: string;
  },
): Promise<void> {
  await selectOptionByLabel(page, /payment mode/i, input.paymentModeLabel);
  await selectOptionByLabel(page, /department/i, input.departmentLabel);

  if (input.submissionType === "On Behalf") {
    await selectOptionByLabel(page, /submission type/i, "On Behalf");
    await page.getByRole("textbox", { name: /on behalf email/i }).fill(input.onBehalfEmail ?? "");

    const onBehalfEmployeeField = page
      .getByRole("textbox", { name: /on behalf employee (id|code)/i })
      .first();

    const hasAccessibleMatch = await onBehalfEmployeeField
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (hasAccessibleMatch) {
      await onBehalfEmployeeField.fill(input.onBehalfEmployeeCode ?? "");
    } else {
      await page.locator("#onBehalfEmployeeCode").fill(input.onBehalfEmployeeCode ?? "");
    }
  }

  const txDate = new Date().toISOString().slice(0, 10);

  await page.getByRole("textbox", { name: /^Employee ID \*/i }).fill(input.employeeId);
  await page.getByRole("textbox", { name: /^Bill No \*/i }).fill(input.billNo);
  await page.getByRole("textbox", { name: /^Purpose/i }).fill(`Routing visibility ${input.billNo}`);
  await page.getByRole("spinbutton", { name: /^Basic Amount \*/i }).fill("100");
  await page.getByRole("textbox", { name: /^Transaction Date \*/i }).fill(txDate);

  await page.locator("#receiptFile").setInputFiles(receiptPath);
  await page.getByRole("button", { name: /submit claim/i }).click();

  await expect(page).toHaveURL(/\/dashboard\/my-claims(?:\?|$)/, { timeout: 40000 });
}

async function resolveClaimIdByBillNo(billNo: string): Promise<string> {
  const client = getAdminSupabaseClient();

  await expect
    .poll(
      async () => {
        const { data, error } = await client
          .from("claims")
          .select("id, expense_details!inner(bill_no)")
          .eq("expense_details.bill_no", billNo)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          throw new Error(`Claim lookup failed: ${error.message}`);
        }

        return data?.id ?? null;
      },
      {
        timeout: 45000,
        message: `waiting for submitted claim id by bill no ${billNo}`,
      },
    )
    .not.toBeNull();

  const { data, error } = await client
    .from("claims")
    .select("id, expense_details!inner(bill_no)")
    .eq("expense_details.bill_no", billNo)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(error?.message ?? `No claim found for bill no ${billNo}`);
  }

  return data.id as string;
}

async function openClaimReviewPage(page: Page, claimId: string): Promise<void> {
  await gotoWithRetry(page, `/dashboard/claims/${claimId}`);
  await acceptPolicyGateIfPresent(page);
  await expect(page.getByText(/Audit & Review/i)).toBeVisible({ timeout: 20000 });
}

test.describe("Routing and Action Visibility", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90000);

  test.describe("HOD perspective", () => {
    test.use({ storageState: getAuthStatePathByRole("hod") });

    test("Test A: HOD self-submission should not show Approve/Reject on review page", async ({
      page,
    }) => {
      const runtime = await resolveRuntimeData();
      const billNo = `BILL-SELF-${runTag}-${Date.now()}`;

      await openClaimForm(page);
      await submitExpenseClaim(page, {
        paymentModeLabel: runtime.reimbursementPaymentModeName,
        departmentLabel: runtime.hodDepartmentName,
        employeeId: `EMP-HOD-${Date.now()}`,
        billNo,
        submissionType: "Self",
      });

      const claimId = await resolveClaimIdByBillNo(billNo);
      await openClaimReviewPage(page, claimId);

      await expect(page.getByRole("button", { name: /^Approve$/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Reject$/i })).toHaveCount(0);
    });

    test("Test B: HOD proxy submission for employee should show Approve/Reject on review page", async ({
      page,
    }) => {
      const runtime = await resolveRuntimeData();
      const billNo = `BILL-PROXY-${runTag}-${Date.now()}`;

      await openClaimForm(page);
      await submitExpenseClaim(page, {
        paymentModeLabel: runtime.reimbursementPaymentModeName,
        departmentLabel: runtime.hodDepartmentName,
        employeeId: `EMP-PROXY-${Date.now()}`,
        billNo,
        submissionType: "On Behalf",
        onBehalfEmail: runtime.submitterEmail,
        onBehalfEmployeeCode: `OBH-${Date.now()}`,
      });

      const claimId = await resolveClaimIdByBillNo(billNo);
      await openClaimReviewPage(page, claimId);

      await expect(page.getByRole("button", { name: /^Approve$/i }).first()).toBeVisible({
        timeout: 20000,
      });
      await expect(page.getByRole("button", { name: /^Reject$/i }).first()).toBeVisible({
        timeout: 20000,
      });
    });
  });

  test.describe("Employee perspective", () => {
    test.use({ storageState: getAuthStatePathByRole("submitter") });

    test("Test C: On-behalf of HOD should display founder/approver_2 as L1 approver", async ({
      page,
    }) => {
      const runtime = await resolveRuntimeData();

      await openClaimForm(page);
      await selectOptionByLabel(page, /department/i, runtime.hodDepartmentName);
      await selectOptionByLabel(page, /submission type/i, "On Behalf");
      await page.getByRole("textbox", { name: /on behalf email/i }).fill(runtime.hodEmail);

      const onBehalfEmployeeField = page
        .getByRole("textbox", { name: /on behalf employee (id|code)/i })
        .first();
      const hasAccessibleMatch = await onBehalfEmployeeField
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (hasAccessibleMatch) {
        await onBehalfEmployeeField.fill(`OBH-HOD-${Date.now()}`);
      } else {
        await page.locator("#onBehalfEmployeeCode").fill(`OBH-HOD-${Date.now()}`);
      }

      await expect(
        page.getByLabel("Level 1 Approver (Escalated to Approver 2)").first(),
      ).toBeVisible({ timeout: 15000 });

      const approverName = await page
        .getByLabel("Level 1 Approver (Escalated to Approver 2)")
        .first()
        .inputValue();
      const approverEmail = await page
        .getByLabel("Level 1 Approver (Escalated to Approver 2) Email")
        .first()
        .inputValue();

      const nameMatches = approverName.includes(runtime.founderDisplayName);
      const emailMatches = approverEmail.toLowerCase() === runtime.founderEmail.toLowerCase();

      expect(nameMatches || emailMatches).toBeTruthy();
    });
  });
});
