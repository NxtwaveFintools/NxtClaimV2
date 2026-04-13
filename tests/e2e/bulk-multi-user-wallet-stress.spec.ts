import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  RECEIPT_PATH,
  fillTextboxIfEditable,
  getAdminSupabaseClient,
  getClaimRouting,
  gotoWithRetry,
  openClaimForm,
  resolveLatestActiveAdvanceClaimByPurpose,
  resolveLatestActiveExpenseClaimByBillNo,
  resolveRuntimeClaimData,
  selectOptionByLabel,
  withActorPage,
} from "./support/claims-e2e-runtime";

const STATUS_SUBMITTED = "Submitted - Awaiting HOD approval";
const STATUS_L1_APPROVED = "HOD approved - Awaiting finance approval";
const STATUS_FINANCE_APPROVED = "Finance Approved - Payment under process";
const STATUS_PAYMENT_DONE = "Payment Done - Closed";
const PAYMENT_MODE_REIMBURSEMENT_LABEL = "Reimbursement";
const PAYMENT_MODE_PETTY_CASH_REQUEST_LABEL = "Petty Cash Request";

const EMPLOYEE_B_OVERRIDE_EMAIL = process.env.E2E_EMPLOYEE_B_EMAIL?.toLowerCase() ?? null;
const L1_HOD_EMAIL = (process.env.E2E_HOD_EMAIL ?? "hod@nxtwave.co.in").toLowerCase();

type Beneficiary = "A" | "B";
type ClaimKind = "reimbursement" | "petty-cash-request";

type ActiveUser = {
  id: string;
  email: string;
  role: string;
};

type Department = {
  id: string;
  name: string;
  hodUserId: string;
  founderUserId: string;
};

type SeedPlan = {
  key: string;
  beneficiary: Beneficiary;
  claimKind: ClaimKind;
  amount: number;
  submissionType: "Self" | "On Behalf";
  billNo: string | null;
  purpose: string;
};

type SeededClaim = {
  plan: SeedPlan;
  claimId: string;
};

type WalletSnapshot = {
  reimbursements: number;
  pettyCashReceived: number;
  amountReceived: number;
};

type ExpectedWalletDelta = {
  reimbursements: number;
  pettyCashReceived: number;
  amountReceived: number;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toNumber(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return numeric;
}

function buildSeedPlans(runTag: string): SeedPlan[] {
  const reimbursementsA = [111.11, 122.22, 133.33, 144.44, 155.55];
  const pettyCashA = [210.1, 220.2, 230.3, 240.4, 250.5];
  const reimbursementsB = [161.11, 172.22, 183.33, 194.44, 205.55];
  const pettyCashB = [260.1, 270.2, 280.3, 290.4, 300.5];

  const plans: SeedPlan[] = [];

  for (let index = 0; index < 5; index += 1) {
    const item = index + 1;

    plans.push({
      key: `A-R-${item}`,
      beneficiary: "A",
      claimKind: "reimbursement",
      amount: reimbursementsA[index],
      submissionType: "Self",
      billNo: `MUBA-R-${item}-${runTag}`,
      purpose: `MUB A reimbursement ${item} ${runTag}`,
    });

    plans.push({
      key: `B-R-${item}`,
      beneficiary: "B",
      claimKind: "reimbursement",
      amount: reimbursementsB[index],
      submissionType: "On Behalf",
      billNo: `MUBB-R-${item}-${runTag}`,
      purpose: `MUB B reimbursement ${item} ${runTag}`,
    });

    plans.push({
      key: `A-P-${item}`,
      beneficiary: "A",
      claimKind: "petty-cash-request",
      amount: pettyCashA[index],
      submissionType: "Self",
      billNo: null,
      purpose: `MUB A petty request ${item} ${runTag}`,
    });

    plans.push({
      key: `B-P-${item}`,
      beneficiary: "B",
      claimKind: "petty-cash-request",
      amount: pettyCashB[index],
      submissionType: "On Behalf",
      billNo: null,
      purpose: `MUB B petty request ${item} ${runTag}`,
    });
  }

  return plans;
}

function computeExpectedWalletDeltas(plans: SeedPlan[]): Record<Beneficiary, ExpectedWalletDelta> {
  const deltas: Record<Beneficiary, ExpectedWalletDelta> = {
    A: {
      reimbursements: 0,
      pettyCashReceived: 0,
      amountReceived: 0,
    },
    B: {
      reimbursements: 0,
      pettyCashReceived: 0,
      amountReceived: 0,
    },
  };

  for (const plan of plans) {
    const target = deltas[plan.beneficiary];
    if (plan.claimKind === "reimbursement") {
      target.reimbursements = roundMoney(target.reimbursements + plan.amount);
    } else {
      target.pettyCashReceived = roundMoney(target.pettyCashReceived + plan.amount);
    }

    target.amountReceived = roundMoney(target.amountReceived + plan.amount);
  }

  return deltas;
}

async function resolveActiveUserByEmail(email: string): Promise<ActiveUser> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("users")
    .select("id, email, role")
    .eq("email", email)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error || !data?.id || !data?.email || !data?.role) {
    throw new Error(error?.message ?? `Unable to resolve active user for ${email}.`);
  }

  return {
    id: data.id as string,
    email: data.email as string,
    role: data.role as string,
  };
}

async function resolveDepartmentForHodUser(hodUserId: string): Promise<Department> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("master_departments")
    .select("id, name, hod_user_id, founder_user_id")
    .eq("is_active", true)
    .eq("hod_user_id", hodUserId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data?.id || !data?.name || !data?.hod_user_id || !data?.founder_user_id) {
    throw new Error(
      error?.message ?? `Unable to resolve active department for HOD user ${hodUserId}.`,
    );
  }

  return {
    id: data.id as string,
    name: data.name as string,
    hodUserId: data.hod_user_id as string,
    founderUserId: data.founder_user_id as string,
  };
}

async function resolveSecondaryEmployee(input: { excludedUserIds: string[] }): Promise<ActiveUser> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("users")
    .select("id, email, role")
    .eq("is_active", true)
    .eq("role", "employee")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    throw new Error(
      error.message ??
        "Unable to resolve a secondary active employee. Set E2E_EMPLOYEE_B_EMAIL explicitly.",
    );
  }

  const excludedIds = new Set(input.excludedUserIds);
  const candidate = (data ?? []).find(
    (row) =>
      Boolean(row.id) &&
      Boolean(row.email) &&
      String(row.role).toLowerCase() === "employee" &&
      !excludedIds.has(String(row.id)),
  );

  if (!candidate?.id || !candidate.email || !candidate.role) {
    throw new Error(
      "Unable to resolve a secondary active employee that is isolated from configured routing actors.",
    );
  }

  return {
    id: candidate.id as string,
    email: candidate.email as string,
    role: candidate.role as string,
  };
}

function isSingleHodSafeBeneficiary(input: {
  candidate: ActiveUser;
  configuredHodId: string;
  departmentFounderId: string;
  primarySubmitterId: string;
}): boolean {
  return (
    input.candidate.role.toLowerCase() === "employee" &&
    input.candidate.id !== input.primarySubmitterId &&
    input.candidate.id !== input.configuredHodId &&
    input.candidate.id !== input.departmentFounderId
  );
}

async function resolveBeneficiaryEmployeeB(input: {
  primarySubmitterId: string;
  configuredHodId: string;
  departmentFounderId: string;
}): Promise<ActiveUser> {
  if (EMPLOYEE_B_OVERRIDE_EMAIL) {
    const overrideCandidate = await resolveActiveUserByEmail(EMPLOYEE_B_OVERRIDE_EMAIL);

    if (
      isSingleHodSafeBeneficiary({
        candidate: overrideCandidate,
        configuredHodId: input.configuredHodId,
        departmentFounderId: input.departmentFounderId,
        primarySubmitterId: input.primarySubmitterId,
      })
    ) {
      return overrideCandidate;
    }
  }

  return resolveSecondaryEmployee({
    excludedUserIds: [input.primarySubmitterId, input.configuredHodId, input.departmentFounderId],
  });
}

async function getWalletSnapshot(userId: string): Promise<WalletSnapshot> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("wallets")
    .select("total_reimbursements_received, total_petty_cash_received")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load wallet snapshot for ${userId}: ${error.message}`);
  }

  const reimbursements = roundMoney(toNumber(data?.total_reimbursements_received));
  const pettyCashReceived = roundMoney(toNumber(data?.total_petty_cash_received));

  return {
    reimbursements,
    pettyCashReceived,
    amountReceived: roundMoney(reimbursements + pettyCashReceived),
  };
}

async function cleanupStaleStressClaims(): Promise<void> {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const client = getAdminSupabaseClient();

  const { data, error } = await client
    .from("claims")
    .select("id")
    .eq("is_active", true)
    .ilike("employee_id", "EMP-STRESS-%")
    .lt("submitted_at", cutoff)
    .limit(500);

  if (error) {
    throw new Error(`Unable to clean stale stress claims: ${error.message}`);
  }

  const staleClaimIds = (data ?? []).map((row) => String(row.id)).filter((id) => id.length > 0);

  if (staleClaimIds.length === 0) {
    return;
  }

  const { error: updateError } = await client
    .from("claims")
    .update({ is_active: false })
    .in("id", staleClaimIds);

  if (updateError) {
    throw new Error(`Unable to soft-delete stale stress claims: ${updateError.message}`);
  }
}

async function configureSubmissionContext(
  page: Page,
  input: {
    departmentName: string;
    paymentModeName: string;
    employeeId: string;
    onBehalf: { email: string; employeeCode: string } | null;
  },
): Promise<void> {
  const submissionType = page.getByRole("combobox", { name: /submission type/i }).first();
  await expect(submissionType).toBeVisible({ timeout: 15000 });

  if (input.onBehalf) {
    const onBehalfOption = await submissionType.locator("option").evaluateAll((options) => {
      return (
        options
          .map((option) => {
            const htmlOption = option as HTMLOptionElement;
            return {
              value: htmlOption.value,
              label: htmlOption.label,
            };
          })
          .find((option) => /behalf/i.test(`${option.label} ${option.value}`)) ?? null
      );
    });

    if (!onBehalfOption?.value) {
      throw new Error("Submission Type does not expose an On Behalf option for this actor.");
    }

    await expect
      .poll(
        async () => {
          await submissionType.selectOption({ value: onBehalfOption.value });
          return submissionType.inputValue();
        },
        {
          timeout: 10000,
          message: "waiting for Submission Type to persist as On Behalf",
        },
      )
      .toBe(onBehalfOption.value);

    const onBehalfEmail = page.locator("#onBehalfEmail");
    const onBehalfEmployeeCode = page.locator("#onBehalfEmployeeCode");
    await expect(onBehalfEmail).toBeVisible({ timeout: 15000 });
    await expect(onBehalfEmployeeCode).toBeVisible({ timeout: 15000 });
    await onBehalfEmail.fill(input.onBehalf.email);
    await onBehalfEmployeeCode.fill(input.onBehalf.employeeCode);
  } else {
    const selfOptionValue = await submissionType.locator("option").evaluateAll((options) => {
      return (
        options
          .map((option) => {
            const htmlOption = option as HTMLOptionElement;
            return {
              value: htmlOption.value,
              label: htmlOption.label,
            };
          })
          .find((option) => /^self$/i.test(option.label.trim()) || /^self$/i.test(option.value))
          ?.value ?? null
      );
    });

    if (selfOptionValue) {
      await expect
        .poll(
          async () => {
            await submissionType.selectOption({ value: selfOptionValue });
            return submissionType.inputValue();
          },
          {
            timeout: 10000,
            message: "waiting for Submission Type to persist as Self",
          },
        )
        .toBe(selfOptionValue);
    }
  }

  await selectOptionByLabel(page, /Department/i, input.departmentName);

  const paymentModeSelect = page.getByRole("combobox", { name: /payment mode/i }).first();
  await expect(paymentModeSelect).toBeVisible({ timeout: 15000 });

  const resolvedPaymentModeLabel = await paymentModeSelect
    .locator("option")
    .evaluateAll((options, preferredLabel) => {
      const normalizedPreferred = String(preferredLabel ?? "")
        .trim()
        .toLowerCase();
      const labels = options
        .map((option) => (option as HTMLOptionElement).label.trim())
        .filter((label) => label.length > 0);

      return (
        labels.find((label) => label.toLowerCase() === normalizedPreferred) ??
        labels.find((label) => label.toLowerCase().includes(normalizedPreferred)) ??
        null
      );
    }, input.paymentModeName);

  if (!resolvedPaymentModeLabel) {
    throw new Error(`Unable to resolve payment mode option for label: ${input.paymentModeName}`);
  }

  await selectOptionByLabel(page, /Payment Mode/i, resolvedPaymentModeLabel);
  await fillTextboxIfEditable(page, /^Employee ID \*/i, input.employeeId);
}

async function submitReimbursementWithContext(
  page: Page,
  input: {
    submitterEmail: string;
    departmentName: string;
    paymentModeName: string;
    expenseCategoryName: string;
    employeeId: string;
    billNo: string;
    purpose: string;
    amount: number;
    onBehalf: { email: string; employeeCode: string } | null;
  },
): Promise<void> {
  await openClaimForm(page, input.submitterEmail);

  await configureSubmissionContext(page, {
    departmentName: input.departmentName,
    paymentModeName: input.paymentModeName,
    employeeId: input.employeeId,
    onBehalf: input.onBehalf,
  });

  await selectOptionByLabel(page, /Expense Category/i, input.expenseCategoryName);
  await page.getByRole("textbox", { name: /^Bill No \*/i }).fill(input.billNo);
  await page.getByRole("textbox", { name: /^Purpose/i }).fill(input.purpose);
  await page.getByRole("spinbutton", { name: /^Basic Amount \*/i }).fill(String(input.amount));
  await page.getByRole("textbox", { name: /^Transaction Date \*/i }).fill("2026-04-10");
  await page.locator("#receiptFile").setInputFiles(RECEIPT_PATH);

  await page.getByRole("button", { name: /submit claim/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/my-claims(?:\?|$)/, { timeout: 30000 });
}

async function submitPettyCashRequestWithContext(
  page: Page,
  input: {
    submitterEmail: string;
    departmentName: string;
    paymentModeName: string;
    employeeId: string;
    purpose: string;
    amount: number;
    onBehalf: { email: string; employeeCode: string } | null;
  },
): Promise<void> {
  await openClaimForm(page, input.submitterEmail);

  await configureSubmissionContext(page, {
    departmentName: input.departmentName,
    paymentModeName: input.paymentModeName,
    employeeId: input.employeeId,
    onBehalf: input.onBehalf,
  });

  await page.locator("#requestedAmount").fill(String(input.amount));
  await page.locator("#expectedUsageDate").fill("2026-04-10");
  await page.locator("#budgetMonth").selectOption("4");
  await page.locator("#budgetYear").selectOption("2026");
  await page.locator("#purpose").fill(input.purpose);

  await page.getByRole("button", { name: /submit claim/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/my-claims(?:\?|$)/, { timeout: 30000 });
}

async function seedOneClaim(
  page: Page,
  input: {
    runtimeSubmitterId: string;
    submitterEmail: string;
    departmentName: string;
    expenseCategoryName: string;
    commonEmployeeIdMarker: string;
    beneficiaryBEmail: string;
    plan: SeedPlan;
  },
): Promise<SeededClaim> {
  const onBehalfContext =
    input.plan.submissionType === "On Behalf"
      ? {
          email: input.beneficiaryBEmail,
          employeeCode: `${input.commonEmployeeIdMarker}-B-${input.plan.key}`,
        }
      : null;

  if (input.plan.claimKind === "reimbursement") {
    await submitReimbursementWithContext(page, {
      submitterEmail: input.submitterEmail,
      departmentName: input.departmentName,
      paymentModeName: PAYMENT_MODE_REIMBURSEMENT_LABEL,
      expenseCategoryName: input.expenseCategoryName,
      employeeId: input.commonEmployeeIdMarker,
      billNo: input.plan.billNo ?? `${input.commonEmployeeIdMarker}-${input.plan.key}`,
      purpose: input.plan.purpose,
      amount: input.plan.amount,
      onBehalf: onBehalfContext,
    });

    const resolved = await resolveLatestActiveExpenseClaimByBillNo({
      submitterId: input.runtimeSubmitterId,
      billNo: input.plan.billNo ?? "",
    });

    expect(resolved.claimId).toMatch(/^CLAIM-/i);

    return {
      plan: input.plan,
      claimId: resolved.claimId,
    };
  }

  await submitPettyCashRequestWithContext(page, {
    submitterEmail: input.submitterEmail,
    departmentName: input.departmentName,
    paymentModeName: PAYMENT_MODE_PETTY_CASH_REQUEST_LABEL,
    employeeId: input.commonEmployeeIdMarker,
    purpose: input.plan.purpose,
    amount: input.plan.amount,
    onBehalf: onBehalfContext,
  });

  const resolved = await resolveLatestActiveAdvanceClaimByPurpose({
    submitterId: input.runtimeSubmitterId,
    purpose: input.plan.purpose,
  });

  expect(resolved.claimId).toMatch(/^EA-/i);

  return {
    plan: input.plan,
    claimId: resolved.claimId,
  };
}

function isRetryableSupabaseError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("fetch failed") ||
    normalized.includes("network") ||
    normalized.includes("timeout") ||
    normalized.includes("connection")
  );
}

async function waitForClaimsInStatus(
  claimIds: string[],
  expectedStatus: string,
  message: string,
  timeout = 120000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const client = getAdminSupabaseClient();
        const { data, error } = await client
          .from("claims")
          .select("id, status")
          .in("id", claimIds)
          .eq("is_active", true);

        if (error) {
          if (isRetryableSupabaseError(error.message)) {
            return false;
          }

          throw new Error(error.message);
        }

        if ((data ?? []).length !== claimIds.length) {
          return false;
        }

        return (data ?? []).every((row) => row.status === expectedStatus);
      },
      {
        timeout,
        message,
      },
    )
    .toBe(true);
}

async function countClaimsInStatus(claimIds: string[], status: string): Promise<number> {
  const client = getAdminSupabaseClient();

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const { count, error } = await client
      .from("claims")
      .select("id", { count: "exact", head: true })
      .in("id", claimIds)
      .eq("is_active", true)
      .eq("status", status);

    if (!error) {
      return count ?? 0;
    }

    if (!isRetryableSupabaseError(error.message) || attempt === 4) {
      throw new Error(error.message);
    }

    await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }

  return 0;
}

async function openApprovalsWithMarker(
  page: Page,
  status: string,
  employeeIdMarker: string,
): Promise<void> {
  const params = new URLSearchParams({
    view: "approvals",
    status,
    search_field: "employee_id",
    search_query: employeeIdMarker,
  });

  await gotoWithRetry(page, `/dashboard/my-claims?${params.toString()}`);
  await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("heading", { name: /approvals history/i })).toBeVisible({
    timeout: 20000,
  });
}

async function selectAllMatchingClaims(page: Page, expectedTotal: number): Promise<void> {
  const masterCheckbox = page.getByTestId("bulk-master-checkbox").first();
  await expect(masterCheckbox).toBeVisible({ timeout: 30000 });
  await masterCheckbox.check();

  const globalSelectButton = page
    .getByRole("button", {
      name: /^Select all \d+ claims$/i,
    })
    .first();

  const hasGlobalSelectButton = await globalSelectButton.isVisible({ timeout: 3000 }).catch(() => {
    return false;
  });

  if (hasGlobalSelectButton) {
    await globalSelectButton.click();

    const expectedBanner = page.getByText(
      new RegExp(`All ${expectedTotal} matching claims are selected\\.`, "i"),
    );
    const hasExpectedBanner = await expectedBanner.isVisible({ timeout: 2500 }).catch(() => {
      return false;
    });

    if (hasExpectedBanner) {
      await expect(expectedBanner).toBeVisible({ timeout: 15000 });
      return;
    }

    await expect(page.getByText(/All \d+ matching claims are selected\./i).first()).toBeVisible({
      timeout: 15000,
    });
    return;
  }

  await expect(page.getByText(/\b\d+ selected\b/i).first()).toBeVisible({ timeout: 15000 });
}

async function clickBulkApprove(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: /^Bulk Approve$/i }).first();
  await expect(button).toBeVisible({ timeout: 15000 });
  await expect(button).toBeEnabled({ timeout: 15000 });
  await button.click();
}

async function clickBulkMarkPaid(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: /^Bulk Mark Paid$/i }).first();
  await expect(button).toBeVisible({ timeout: 15000 });
  await expect(button).toBeEnabled({ timeout: 15000 });
  await button.click();
}

async function assertNoErrorToast(page: Page, phase: string): Promise<void> {
  const errorToast = page.locator('[data-sonner-toast][data-type="error"]').first();
  const isVisible = await errorToast.isVisible({ timeout: 2000 }).catch(() => false);

  if (!isVisible) {
    return;
  }

  const text = (await errorToast.innerText().catch(() => "Unknown bulk action error")).trim();
  throw new Error(`${phase} failed: ${text}`);
}

async function assertWalletDelta(
  userId: string,
  before: WalletSnapshot,
  expected: ExpectedWalletDelta,
  label: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const after = await getWalletSnapshot(userId);
        return roundMoney(after.amountReceived - before.amountReceived);
      },
      {
        timeout: 90000,
        message: `waiting for amountReceived delta for ${label}`,
      },
    )
    .toBeCloseTo(expected.amountReceived, 2);

  await expect
    .poll(
      async () => {
        const after = await getWalletSnapshot(userId);
        return roundMoney(after.reimbursements - before.reimbursements);
      },
      {
        timeout: 90000,
        message: `waiting for reimbursement delta for ${label}`,
      },
    )
    .toBeCloseTo(expected.reimbursements, 2);

  await expect
    .poll(
      async () => {
        const after = await getWalletSnapshot(userId);
        return roundMoney(after.pettyCashReceived - before.pettyCashReceived);
      },
      {
        timeout: 90000,
        message: `waiting for petty cash received delta for ${label}`,
      },
    )
    .toBeCloseTo(expected.pettyCashReceived, 2);
}

test.describe("Bulk Multi-User Wallet Stress", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(540000);

  test("bulk lifecycle routes mixed payouts to correct beneficiary wallets", async ({
    browser,
  }) => {
    const runTag = randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
    const employeeIdMarker = `EMP-STRESS-${runTag}`;

    await cleanupStaleStressClaims();

    const runtime = await resolveRuntimeClaimData();
    const employeeA = await resolveActiveUserByEmail(runtime.submitterEmail.toLowerCase());
    const configuredHod = await resolveActiveUserByEmail(L1_HOD_EMAIL);
    const l1Department = await resolveDepartmentForHodUser(configuredHod.id);
    const employeeB = await resolveBeneficiaryEmployeeB({
      primarySubmitterId: employeeA.id,
      configuredHodId: configuredHod.id,
      departmentFounderId: l1Department.founderUserId,
    });

    expect(employeeA.id).not.toBe(employeeB.id);
    expect(employeeB.role.toLowerCase()).toBe("employee");
    expect(employeeB.id).not.toBe(configuredHod.id);
    expect(employeeB.id).not.toBe(l1Department.founderUserId);

    const plans = buildSeedPlans(runTag);
    const expectedDeltas = computeExpectedWalletDeltas(plans);

    const walletBeforeA = await getWalletSnapshot(employeeA.id);
    const walletBeforeB = await getWalletSnapshot(employeeB.id);

    const seededClaims = await withActorPage(browser, employeeA.email, async (page) => {
      const created: SeededClaim[] = [];

      for (const plan of plans) {
        const seeded = await seedOneClaim(page, {
          runtimeSubmitterId: runtime.submitterId,
          submitterEmail: employeeA.email,
          departmentName: l1Department.name,
          expenseCategoryName: runtime.expenseCategoryName,
          commonEmployeeIdMarker: employeeIdMarker,
          beneficiaryBEmail: employeeB.email,
          plan,
        });

        created.push(seeded);
      }

      return created;
    });

    expect(seededClaims).toHaveLength(20);
    expect(new Set(seededClaims.map((item) => item.claimId)).size).toBe(20);

    const seededClaimIds = seededClaims.map((item) => item.claimId);

    await waitForClaimsInStatus(
      seededClaimIds,
      STATUS_SUBMITTED,
      `waiting for all seeded claims to reach ${STATUS_SUBMITTED}`,
      120000,
    );

    const routingRows = await Promise.all(
      seededClaimIds.map(async (claimId) => getClaimRouting(claimId)),
    );
    const assignedL1Ids = new Set(routingRows.map((row) => row.assignedL1ApproverId));
    expect(assignedL1Ids.size).toBe(1);
    expect(assignedL1Ids.has(configuredHod.id)).toBe(true);

    await withActorPage(browser, configuredHod.email, async (l1Page) => {
      for (let iteration = 1; iteration <= 25; iteration += 1) {
        const remaining = await countClaimsInStatus(seededClaimIds, STATUS_SUBMITTED);
        if (remaining === 0) {
          return;
        }

        await openApprovalsWithMarker(l1Page, STATUS_SUBMITTED, employeeIdMarker);

        const masterCheckbox = l1Page.getByTestId("bulk-master-checkbox").first();
        const hasBulkControls = await masterCheckbox
          .isVisible({ timeout: 10000 })
          .catch(() => false);

        if (!hasBulkControls) {
          await expect
            .poll(async () => countClaimsInStatus(seededClaimIds, STATUS_SUBMITTED), {
              timeout: 20000,
              message:
                "bulk controls disappeared while waiting for submitted claims to finish transitioning",
            })
            .toBe(0);
          return;
        }

        await selectAllMatchingClaims(l1Page, remaining);
        await clickBulkApprove(l1Page);
        await expect(l1Page.locator(".animate-pulse")).not.toBeVisible({ timeout: 20000 });
        await assertNoErrorToast(l1Page, "L1 bulk approve");
      }
    });

    const remainingAfterL1 = await countClaimsInStatus(seededClaimIds, STATUS_SUBMITTED);
    expect(remainingAfterL1).toBe(0);

    await waitForClaimsInStatus(
      seededClaimIds,
      STATUS_L1_APPROVED,
      `waiting for all seeded claims to reach ${STATUS_L1_APPROVED}`,
      120000,
    );

    await withActorPage(browser, runtime.financeEmail, async (financePage) => {
      for (let iteration = 1; iteration <= 10; iteration += 1) {
        const remaining = await countClaimsInStatus(seededClaimIds, STATUS_L1_APPROVED);
        if (remaining === 0) {
          return;
        }

        await openApprovalsWithMarker(financePage, STATUS_L1_APPROVED, employeeIdMarker);

        const approveMasterCheckbox = financePage.getByTestId("bulk-master-checkbox").first();
        const hasApproveControls = await approveMasterCheckbox
          .isVisible({ timeout: 10000 })
          .catch(() => false);

        if (!hasApproveControls) {
          await expect
            .poll(async () => countClaimsInStatus(seededClaimIds, STATUS_L1_APPROVED), {
              timeout: 20000,
              message: "finance bulk approve controls disappeared while claims were transitioning",
            })
            .toBe(0);
          return;
        }

        await selectAllMatchingClaims(financePage, remaining);
        await clickBulkApprove(financePage);
        await expect(financePage.locator(".animate-pulse")).not.toBeVisible({ timeout: 20000 });
        await assertNoErrorToast(financePage, "Finance bulk approve");
      }

      const finalRemaining = await countClaimsInStatus(seededClaimIds, STATUS_L1_APPROVED);
      throw new Error(
        `Finance bulk approve did not drain queue. Remaining finance-pending claims: ${finalRemaining}`,
      );
    });

    await waitForClaimsInStatus(
      seededClaimIds,
      STATUS_FINANCE_APPROVED,
      `waiting for all seeded claims to reach ${STATUS_FINANCE_APPROVED}`,
      120000,
    );

    await withActorPage(browser, runtime.financeEmail, async (financePage) => {
      for (let iteration = 1; iteration <= 10; iteration += 1) {
        const remaining = await countClaimsInStatus(seededClaimIds, STATUS_FINANCE_APPROVED);
        if (remaining === 0) {
          return;
        }

        await openApprovalsWithMarker(financePage, STATUS_FINANCE_APPROVED, employeeIdMarker);

        const markPaidMasterCheckbox = financePage.getByTestId("bulk-master-checkbox").first();
        const hasMarkPaidControls = await markPaidMasterCheckbox
          .isVisible({ timeout: 10000 })
          .catch(() => false);

        if (!hasMarkPaidControls) {
          await expect
            .poll(async () => countClaimsInStatus(seededClaimIds, STATUS_FINANCE_APPROVED), {
              timeout: 20000,
              message:
                "finance bulk mark-paid controls disappeared while claims were transitioning",
            })
            .toBe(0);
          return;
        }

        await selectAllMatchingClaims(financePage, remaining);
        await clickBulkMarkPaid(financePage);
        await expect(
          financePage.locator("[data-sonner-toast]", { hasText: /paid|success/i }).first(),
        ).toBeVisible({ timeout: 20000 });
        await expect(financePage.locator(".animate-pulse")).not.toBeVisible({ timeout: 20000 });
        await assertNoErrorToast(financePage, "Finance bulk mark paid");
      }

      const finalRemaining = await countClaimsInStatus(seededClaimIds, STATUS_FINANCE_APPROVED);
      throw new Error(
        `Finance bulk mark paid did not drain queue. Remaining payment-pending claims: ${finalRemaining}`,
      );
    });

    await waitForClaimsInStatus(
      seededClaimIds,
      STATUS_PAYMENT_DONE,
      `waiting for all seeded claims to reach ${STATUS_PAYMENT_DONE}`,
      120000,
    );

    await withActorPage(browser, runtime.financeEmail, async (financePage) => {
      await openApprovalsWithMarker(financePage, STATUS_FINANCE_APPROVED, employeeIdMarker);
      await expect(financePage.locator("tbody tr")).toHaveCount(0, { timeout: 45000 });
    });

    await withActorPage(browser, employeeA.email, async (employeeAPage) => {
      await gotoWithRetry(employeeAPage, "/dashboard");
      await assertWalletDelta(employeeA.id, walletBeforeA, expectedDeltas.A, "Employee A");
    });

    await withActorPage(browser, employeeB.email, async (employeeBPage) => {
      await gotoWithRetry(employeeBPage, "/dashboard");
      await assertWalletDelta(employeeB.id, walletBeforeB, expectedDeltas.B, "Employee B");
    });
  });
});
