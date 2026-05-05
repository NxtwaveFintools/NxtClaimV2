import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
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
const PREFERRED_L1_HOD_EMAIL = (process.env.E2E_HOD_EMAIL ?? "hod@nxtwave.co.in").toLowerCase();
const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "password123";

type Beneficiary = "A" | "B";
type ClaimKind = "reimbursement" | "petty-cash-request";

type ActiveUser = {
  id: string;
  email: string;
};

type Department = {
  id: string;
  name: string;
  hodUserId: string;
  founderUserId: string;
};

type DepartmentWithHodEmail = Department & {
  hodEmail: string;
};

type UserEmailRelation = { email: string | null } | Array<{ email: string | null }> | null;

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

function getRelatedUserEmail(relation: UserEmailRelation): string | null {
  if (Array.isArray(relation)) {
    return relation[0]?.email ?? null;
  }

  return relation?.email ?? null;
}

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
    .select("id, email")
    .eq("email", email)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error || !data?.id || !data?.email) {
    throw new Error(error?.message ?? `Unable to resolve active user for ${email}.`);
  }

  return {
    id: data.id as string,
    email: data.email as string,
  };
}

function getPublicSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.");
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

const loginCapabilityCache = new Map<string, boolean>();

async function canLoginWithDefaultPassword(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (loginCapabilityCache.has(normalized)) {
    return loginCapabilityCache.get(normalized) ?? false;
  }

  const client = getPublicSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: normalized,
    password: DEFAULT_PASSWORD,
  });

  const canLogin = !error && Boolean(data.session);
  if (data.session) {
    await client.auth.signOut().catch(() => undefined);
  }

  loginCapabilityCache.set(normalized, canLogin);
  return canLogin;
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

async function resolveLoginCapableL1Department(): Promise<{
  hod: ActiveUser;
  department: Department;
}> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("master_departments")
    .select(
      "id, name, hod_user_id, founder_user_id, hod:users!master_departments_hod_user_id_fkey(email)",
    )
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      error.message ?? "Unable to resolve active departments for bulk wallet stress.",
    );
  }

  const departmentRows = (
    (data ?? []) as Array<{
      id: string | null;
      name: string | null;
      hod_user_id: string | null;
      founder_user_id: string | null;
      hod: UserEmailRelation;
    }>
  )
    .filter(
      (
        row,
      ): row is {
        id: string;
        name: string;
        hod_user_id: string;
        founder_user_id: string;
        hod: UserEmailRelation;
      } =>
        Boolean(
          row.id &&
          row.name &&
          row.hod_user_id &&
          row.founder_user_id &&
          getRelatedUserEmail(row.hod),
        ),
    )
    .map(
      (row) =>
        ({
          id: row.id,
          name: row.name,
          hodUserId: row.hod_user_id,
          founderUserId: row.founder_user_id,
          hodEmail: getRelatedUserEmail(row.hod)!.toLowerCase(),
        }) satisfies DepartmentWithHodEmail,
    );

  const orderedDepartments = [
    ...departmentRows.filter((row) => row.hodEmail === PREFERRED_L1_HOD_EMAIL),
    ...departmentRows.filter((row) => row.hodEmail !== PREFERRED_L1_HOD_EMAIL),
  ];

  for (const department of orderedDepartments) {
    if (!(await canLoginWithDefaultPassword(department.hodEmail))) {
      continue;
    }

    return {
      hod: {
        id: department.hodUserId,
        email: department.hodEmail,
      },
      department: {
        id: department.id,
        name: department.name,
        hodUserId: department.hodUserId,
        founderUserId: department.founderUserId,
      },
    };
  }

  throw new Error("Unable to find an active department with a login-capable HOD actor.");
}

async function resolveReservedActorIds(): Promise<Set<string>> {
  const client = getAdminSupabaseClient();
  const [adminsResult, financeResult, departmentsResult] = await Promise.all([
    client.from("admins").select("user_id").not("user_id", "is", null),
    client
      .from("master_finance_approvers")
      .select("user_id")
      .eq("is_active", true)
      .not("user_id", "is", null),
    client.from("master_departments").select("hod_user_id, founder_user_id").eq("is_active", true),
  ]);

  if (adminsResult.error || financeResult.error || departmentsResult.error) {
    throw new Error(
      adminsResult.error?.message ??
        financeResult.error?.message ??
        departmentsResult.error?.message ??
        "Unable to resolve reserved routing actors for bulk wallet stress coverage.",
    );
  }

  const reservedActorIds = new Set<string>();

  for (const row of adminsResult.data ?? []) {
    if (row.user_id) {
      reservedActorIds.add(String(row.user_id));
    }
  }

  for (const row of financeResult.data ?? []) {
    if (row.user_id) {
      reservedActorIds.add(String(row.user_id));
    }
  }

  for (const row of departmentsResult.data ?? []) {
    if (row.hod_user_id) {
      reservedActorIds.add(String(row.hod_user_id));
    }

    if (row.founder_user_id) {
      reservedActorIds.add(String(row.founder_user_id));
    }
  }

  return reservedActorIds;
}

async function resolveSecondaryEmployee(input: {
  excludedUserIds: string[];
  reservedActorIds: Set<string>;
}): Promise<ActiveUser> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("users")
    .select("id, email")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    throw new Error(
      error.message ??
        "Unable to resolve a secondary active employee. Set E2E_EMPLOYEE_B_EMAIL explicitly.",
    );
  }

  const excludedIds = new Set([...input.excludedUserIds, ...input.reservedActorIds]);
  const candidate = (data ?? []).find(
    (row) => Boolean(row.id) && Boolean(row.email) && !excludedIds.has(String(row.id)),
  );

  if (!candidate?.id || !candidate.email) {
    throw new Error(
      "Unable to resolve a secondary active employee that is isolated from configured routing actors.",
    );
  }

  return {
    id: candidate.id as string,
    email: candidate.email as string,
  };
}

function isSafeBeneficiaryCandidate(input: {
  candidate: ActiveUser;
  excludedUserIds: string[];
  reservedActorIds: Set<string>;
}): boolean {
  const excludedIds = new Set(input.excludedUserIds);
  return !excludedIds.has(input.candidate.id) && !input.reservedActorIds.has(input.candidate.id);
}

async function resolveBeneficiaryEmployeeB(input: {
  primarySubmitterId: string;
  configuredHodId: string;
  departmentFounderId: string;
  reservedActorIds: Set<string>;
}): Promise<ActiveUser> {
  const excludedUserIds = [
    input.primarySubmitterId,
    input.configuredHodId,
    input.departmentFounderId,
  ];

  if (EMPLOYEE_B_OVERRIDE_EMAIL) {
    const overrideCandidate = await resolveActiveUserByEmail(EMPLOYEE_B_OVERRIDE_EMAIL);

    if (
      isSafeBeneficiaryCandidate({
        candidate: overrideCandidate,
        excludedUserIds,
        reservedActorIds: input.reservedActorIds,
      })
    ) {
      return overrideCandidate;
    }
  }

  return resolveSecondaryEmployee({
    excludedUserIds,
    reservedActorIds: input.reservedActorIds,
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

async function waitForBulkControlsOrStatusClear(input: {
  page: Page;
  status: string;
  employeeIdMarker: string;
  claimIds: string[];
  timeout: number;
  message: string;
}): Promise<boolean> {
  const masterCheckbox = input.page.getByTestId("bulk-master-checkbox").first();

  await expect
    .poll(
      async () => {
        await openApprovalsWithMarker(input.page, input.status, input.employeeIdMarker);

        const hasBulkControls = await masterCheckbox
          .isVisible({ timeout: 1500 })
          .catch(() => false);

        if (hasBulkControls) {
          return "controls";
        }

        const remaining = await countClaimsInStatus(input.claimIds, input.status);
        return remaining === 0 ? "cleared" : "waiting";
      },
      {
        timeout: input.timeout,
        message: input.message,
      },
    )
    .not.toBe("waiting");

  const remaining = await countClaimsInStatus(input.claimIds, input.status);
  if (remaining === 0) {
    return false;
  }

  return masterCheckbox.isVisible({ timeout: 5000 }).catch(() => false);
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
    const { hod: configuredHod, department: l1Department } =
      await resolveLoginCapableL1Department();
    const reservedActorIds = await resolveReservedActorIds();
    const employeeB = await resolveBeneficiaryEmployeeB({
      primarySubmitterId: employeeA.id,
      configuredHodId: configuredHod.id,
      departmentFounderId: l1Department.founderUserId,
      reservedActorIds,
    });

    expect(employeeA.id).not.toBe(employeeB.id);
    expect(reservedActorIds.has(employeeB.id)).toBe(false);
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

        const hasBulkControls = await waitForBulkControlsOrStatusClear({
          page: l1Page,
          status: STATUS_SUBMITTED,
          employeeIdMarker,
          claimIds: seededClaimIds,
          timeout: 45000,
          message:
            "waiting for L1 approvals table to surface bulk controls or for submitted claims to finish transitioning",
        });

        if (!hasBulkControls) {
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

        const hasApproveControls = await waitForBulkControlsOrStatusClear({
          page: financePage,
          status: STATUS_L1_APPROVED,
          employeeIdMarker,
          claimIds: seededClaimIds,
          timeout: 45000,
          message:
            "waiting for finance approvals table to surface bulk approve controls or for L1-approved claims to finish transitioning",
        });

        if (!hasApproveControls) {
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

        const hasMarkPaidControls = await waitForBulkControlsOrStatusClear({
          page: financePage,
          status: STATUS_FINANCE_APPROVED,
          employeeIdMarker,
          claimIds: seededClaimIds,
          timeout: 45000,
          message:
            "waiting for finance approvals table to surface bulk mark-paid controls or for finance-approved claims to finish transitioning",
        });

        if (!hasMarkPaidControls) {
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
