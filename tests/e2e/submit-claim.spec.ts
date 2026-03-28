import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getAuthStatePathByRole } from "./support/auth-state";

const receiptPath = path.resolve(process.cwd(), "tests/fixtures/dummy-receipt.pdf");
const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "password123";
const RUN_TAG = process.env.E2E_RUN_TAG ?? `SUBMIT-${Date.now()}`;

type RuntimeFormData = {
  reimbursementPaymentModeName: string;
  hodDepartmentName: string;
};

type ExpenseFingerprint = {
  billNo: string;
};

let runtimeFormDataPromise: Promise<RuntimeFormData> | null = null;

function getAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables for submit-claim E2E.");
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
      const hodEmail = (process.env.E2E_HOD_EMAIL ?? "hod@nxtwave.co.in").toLowerCase();

      const [{ data: paymentMode, error: paymentModeError }, { data: hod, error: hodError }] =
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
            .select("id")
            .eq("email", hodEmail)
            .eq("is_active", true)
            .limit(1)
            .maybeSingle(),
        ]);

      if (paymentModeError || !paymentMode?.name) {
        throw new Error(paymentModeError?.message ?? "No active reimbursement payment mode found.");
      }

      if (hodError || !hod?.id) {
        throw new Error(hodError?.message ?? "Configured HOD user not found.");
      }

      const { data: hodDepartment, error: hodDepartmentError } = await client
        .from("master_departments")
        .select("name")
        .eq("is_active", true)
        .eq("hod_user_id", hod.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (hodDepartmentError || !hodDepartment?.name) {
        throw new Error(hodDepartmentError?.message ?? "No active department mapped to HOD.");
      }

      return {
        reimbursementPaymentModeName: paymentMode.name,
        hodDepartmentName: hodDepartment.name,
      };
    })();
  }

  return runtimeFormDataPromise;
}

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

async function selectOptionByLabel(page: Page, label: string | RegExp, optionLabel: string) {
  const select = page.getByRole("combobox", {
    name: typeof label === "string" ? new RegExp(label, "i") : label,
  });
  await expect(select).toBeVisible();
  await select.selectOption({ label: optionLabel });
}

async function fillMandatoryExpenseFields(page: Page): Promise<ExpenseFingerprint> {
  const uniq = `${RUN_TAG}-${Date.now()}`;
  const billNo = `BILL-E2E-${uniq}`;
  const transactionDate = new Date().toISOString().slice(0, 10);

  const employeeIdInput = page.getByRole("textbox", { name: /^Employee ID \*/i });
  await employeeIdInput.fill(`EMP-${uniq}`);
  await expect(employeeIdInput).toHaveValue(`EMP-${uniq}`);

  await page.getByRole("textbox", { name: /^Bill No \*/i }).fill(billNo);
  await page.getByRole("textbox", { name: /^Purpose/i }).fill("Client visit and documentation");
  await page.getByRole("spinbutton", { name: /^Basic Amount \*/i }).fill("100");

  await page.getByRole("textbox", { name: /^Transaction Date \*/i }).fill(transactionDate);
  await expect(page.getByRole("textbox", { name: /^Transaction Date \*/i })).toHaveValue(
    transactionDate,
  );

  await expect(page.getByRole("spinbutton", { name: /^Basic Amount \*/i })).toHaveValue("100");
  await page.locator("#receiptFile").setInputFiles(receiptPath);

  return {
    billNo,
  };
}

async function resolveSubmittedClaimId(billNo: string): Promise<string> {
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
          throw new Error(`Submit verification query failed: ${error.message}`);
        }

        return data?.id ?? null;
      },
      {
        timeout: 45000,
        message: `waiting for submitted claim using bill ${billNo}`,
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
    throw new Error(error?.message ?? `Claim was not created for bill ${billNo}`);
  }

  return data.id;
}

test.describe("Submit Claim Golden Paths", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(90000);

  test.beforeAll(async () => {
    await resolveRuntimeFormData();
  });

  async function expectSubmitOutcome(billNo: string): Promise<void> {
    await resolveSubmittedClaimId(billNo);
  }

  test.describe("submitter path", () => {
    test.use({ storageState: getAuthStatePathByRole("submitter") });

    test("Test A: Standard employee submits reimbursement claim with GST", async ({ page }) => {
      await openClaimForm(page, process.env.E2E_SUBMITTER_EMAIL ?? "user@nxtwave.co.in");
      const runtimeFormData = await resolveRuntimeFormData();

      await selectOptionByLabel(
        page,
        /Payment Mode/i,
        runtimeFormData.reimbursementPaymentModeName,
      );

      const fingerprint = await fillMandatoryExpenseFields(page);
      await page.getByRole("button", { name: /submit claim/i }).click();
      await expectSubmitOutcome(fingerprint.billNo);
    });
  });

  test.describe("hod path", () => {
    test.use({ storageState: getAuthStatePathByRole("hod") });

    test("Test B: HOD submission resolves a valid senior approver", async ({ page }) => {
      await openClaimForm(page, process.env.E2E_HOD_EMAIL ?? "hod@nxtwave.co.in");
      const runtimeFormData = await resolveRuntimeFormData();

      await selectOptionByLabel(page, /Department/i, runtimeFormData.hodDepartmentName);

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

      await selectOptionByLabel(
        page,
        /Payment Mode/i,
        runtimeFormData.reimbursementPaymentModeName,
      );

      const fingerprint = await fillMandatoryExpenseFields(page);
      await page.getByRole("button", { name: /submit claim/i }).click();
      await expectSubmitOutcome(fingerprint.billNo);
    });
  });
});
