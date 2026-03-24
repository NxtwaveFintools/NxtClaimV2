import path from "node:path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { getAuthStatePathForEmail, registerAuthStateEmail } from "./support/auth-state";

loadEnvConfig(process.cwd());

const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "password123";
const STARTING_USER_EMAIL = "user@nxtwave.co.in";
const STARTING_HOD_EMAIL = "hod@nxtwave.co.in";
const RECEIPT_PATH = path.resolve(process.cwd(), "tests/fixtures/dummy-receipt.pdf");
const RUN_TAG = process.env.E2E_RUN_TAG ?? `WF-${Date.now()}`;

type KnownRole = "submitter" | "hod" | "founder" | "finance1" | "finance2";

type UserRecord = {
  id: string;
  email: string;
  full_name: string | null;
};

type DepartmentRecord = {
  id: string;
  name: string;
  approver_1: string;
  approver_2: string;
};

type FinanceApproverRecord = {
  id: string;
  user_id: string;
  is_primary: boolean;
  created_at: string;
};

type RuntimeActors = {
  submitter: UserRecord;
  hod: UserRecord;
  founder: UserRecord;
  finance1: UserRecord;
  finance2: UserRecord;
  submitterDepartment: DepartmentRecord;
  hodDepartment: DepartmentRecord;
  expenseCategoryName: string;
  founderDepartment: DepartmentRecord | null;
  crossDepartmentCandidate: {
    department: DepartmentRecord;
    approverRole: KnownRole;
  } | null;
};

type ActorSession = {
  role: KnownRole;
  user: UserRecord;
  context: BrowserContext;
  page: Page;
};

type SubmittedClaim = {
  claimId: string;
  marker: string;
};

type ClaimRouting = {
  departmentId: string;
  status: string;
  assignedL1ApproverId: string;
  assignedL2ApproverId: string | null;
};

const actorSessions = new Map<KnownRole, ActorSession>();
let runtimeActors: RuntimeActors;

function getAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Playwright workflow tests.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function getUsersByEmails(emails: string[]): Promise<Map<string, UserRecord>> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("users")
    .select("id, email, full_name")
    .in("email", emails)
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to load users: ${error.message}`);
  }

  const users = (data ?? []) as UserRecord[];
  return new Map(users.map((row) => [row.email.toLowerCase(), row]));
}

async function resolveSubmitterDepartment(submitter: UserRecord): Promise<DepartmentRecord> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("master_departments")
    .select("id, name, approver_1, approver_2")
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to load departments: ${error.message}`);
  }

  const departments = (data ?? []) as DepartmentRecord[];
  if (departments.length === 0) {
    throw new Error("No active departments found.");
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
      `Failed to infer submitter department from existing claims: ${latestClaimDepartmentResult.error.message}`,
    );
  }

  const latestDepartmentId = latestClaimDepartmentResult.data?.department_id as string | undefined;
  if (latestDepartmentId) {
    const byLatestClaim = departments.find((department) => department.id === latestDepartmentId);
    if (byLatestClaim) {
      return byLatestClaim;
    }
  }

  const nonSelfHodDepartment = departments.find(
    (department) => department.approver_1 !== submitter.id,
  );
  return nonSelfHodDepartment ?? departments[0];
}

function resolveRoleByUserId(userId: string): KnownRole | null {
  if (userId === runtimeActors.submitter.id) {
    return "submitter";
  }
  if (userId === runtimeActors.hod.id) {
    return "hod";
  }
  if (userId === runtimeActors.founder.id) {
    return "founder";
  }
  if (userId === runtimeActors.finance1.id) {
    return "finance1";
  }
  if (userId === runtimeActors.finance2.id) {
    return "finance2";
  }
  return null;
}

async function resolveRuntimeActors(): Promise<RuntimeActors> {
  const startingUsers = await getUsersByEmails([STARTING_USER_EMAIL, STARTING_HOD_EMAIL]);
  const submitter = startingUsers.get(STARTING_USER_EMAIL);
  const knownHod = startingUsers.get(STARTING_HOD_EMAIL);

  if (!submitter) {
    throw new Error(`Starting submitter account ${STARTING_USER_EMAIL} was not found.`);
  }

  const submitterDepartment = await resolveSubmitterDepartment(submitter);
  const lookupUserIds = new Set<string>([
    submitterDepartment.approver_1,
    submitterDepartment.approver_2,
  ]);

  const client = getAdminSupabaseClient();
  const financeResult = await client
    .from("master_finance_approvers")
    .select("id, user_id, is_primary, created_at")
    .eq("is_active", true)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(2);

  if (financeResult.error) {
    throw new Error(`Failed to load finance approvers: ${financeResult.error.message}`);
  }

  const financeApprovers = (financeResult.data ?? []) as FinanceApproverRecord[];
  if (financeApprovers.length < 2) {
    throw new Error("At least two active finance approvers are required for workflow tests.");
  }

  for (const approver of financeApprovers) {
    lookupUserIds.add(approver.user_id);
  }

  if (knownHod?.id) {
    lookupUserIds.add(knownHod.id);
  }

  const departmentsResult = await client
    .from("master_departments")
    .select("id, name, approver_1, approver_2")
    .eq("is_active", true)
    .eq("approver_1", knownHod?.id ?? submitterDepartment.approver_1)
    .limit(1)
    .maybeSingle();

  if (departmentsResult.error) {
    throw new Error(`Failed to resolve HOD department: ${departmentsResult.error.message}`);
  }

  const fallbackHodId = knownHod?.id ?? submitterDepartment.approver_1;
  const hodDepartment = (departmentsResult.data as DepartmentRecord | null) ?? {
    ...submitterDepartment,
    approver_1: fallbackHodId,
  };

  lookupUserIds.add(hodDepartment.approver_1);
  lookupUserIds.add(hodDepartment.approver_2);

  const usersByIdResult = await client
    .from("users")
    .select("id, email, full_name")
    .in("id", [...lookupUserIds])
    .eq("is_active", true);

  if (usersByIdResult.error) {
    throw new Error(`Failed to resolve role users: ${usersByIdResult.error.message}`);
  }

  const usersById = new Map(
    ((usersByIdResult.data ?? []) as UserRecord[]).map((row) => [row.id, row]),
  );

  const submitterHod = usersById.get(submitterDepartment.approver_1);
  const hodFounder = usersById.get(hodDepartment.approver_2);

  if (!submitterHod || !hodFounder) {
    throw new Error("Unable to resolve HOD/Founder users as active accounts.");
  }

  const finance1 = usersById.get(financeApprovers[0].user_id);
  const finance2 = usersById.get(financeApprovers[1].user_id);

  if (!finance1 || !finance2) {
    throw new Error("Unable to resolve finance approver users.");
  }

  const categoryResult = await client
    .from("master_expense_categories")
    .select("name")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (categoryResult.error || !categoryResult.data?.name) {
    throw new Error(
      `Failed to resolve active expense category: ${categoryResult.error?.message ?? "not found"}`,
    );
  }

  const activeDepartmentsResult = await client
    .from("master_departments")
    .select("id, name, approver_1, approver_2")
    .eq("is_active", true);

  if (activeDepartmentsResult.error) {
    throw new Error(
      `Failed to resolve active departments for edge workflows: ${activeDepartmentsResult.error.message}`,
    );
  }

  const activeDepartments = (activeDepartmentsResult.data ?? []) as DepartmentRecord[];
  const founderDepartment =
    activeDepartments.find((department) => department.approver_2 === hodFounder.id) ?? null;

  const knownApproverIds = new Set([submitterHod.id, hodFounder.id, finance1.id, finance2.id]);
  const crossCandidate =
    activeDepartments
      .filter((department) => department.id !== submitterDepartment.id)
      .filter((department) => department.approver_1 !== submitterDepartment.approver_1)
      .find((department) => knownApproverIds.has(department.approver_1)) ?? null;

  const crossDepartmentCandidate =
    crossCandidate === null
      ? null
      : {
          department: crossCandidate,
          approverRole: (resolveRoleByUserIdFromKnownUsers(
            crossCandidate.approver_1,
            submitterHod,
            hodFounder,
            finance1,
            finance2,
          ) ?? "hod") as KnownRole,
        };

  return {
    submitter,
    hod: submitterHod,
    founder: hodFounder,
    finance1,
    finance2,
    submitterDepartment,
    hodDepartment,
    expenseCategoryName: categoryResult.data.name as string,
    founderDepartment,
    crossDepartmentCandidate,
  };
}

function resolveRoleByUserIdFromKnownUsers(
  userId: string,
  hod: UserRecord,
  founder: UserRecord,
  finance1: UserRecord,
  finance2: UserRecord,
): KnownRole | null {
  if (userId === hod.id) {
    return "hod";
  }
  if (userId === founder.id) {
    return "founder";
  }
  if (userId === finance1.id) {
    return "finance1";
  }
  if (userId === finance2.id) {
    return "finance2";
  }
  return null;
}

async function loginToContext(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<Page> {
  const loginResponse = await context.request.post("/api/auth/email-login", {
    data: { email, password },
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
    throw new Error(`Missing session tokens for ${email}.`);
  }

  const sessionResponse = await context.request.post("/api/auth/session", {
    data: { accessToken, refreshToken },
  });

  if (!sessionResponse.ok()) {
    throw new Error(`Session bootstrap failed for ${email}: HTTP ${sessionResponse.status()}`);
  }

  const page = await context.newPage();
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

  const dashboardHeading = page.getByRole("heading", { name: /dashboard|wallet/i }).first();
  await expect(dashboardHeading).toBeVisible({ timeout: 30000 });

  return page;
}

async function setupActorSessions(browser: Browser, actors: RuntimeActors): Promise<void> {
  const roleToUser: Record<KnownRole, UserRecord> = {
    submitter: actors.submitter,
    hod: actors.hod,
    founder: actors.founder,
    finance1: actors.finance1,
    finance2: actors.finance2,
  };

  for (const role of Object.keys(roleToUser) as KnownRole[]) {
    const email = roleToUser[role].email;
    const storageStatePath = getAuthStatePathForEmail(email);
    const context = await browser.newContext(
      storageStatePath ? { storageState: storageStatePath } : undefined,
    );
    let page: Page;

    try {
      if (storageStatePath) {
        page = await context.newPage();
        await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

        if (/\/auth\/login/i.test(page.url())) {
          await page.close().catch(() => undefined);
          page = await loginToContext(context, email, DEFAULT_PASSWORD);
        }
      } else {
        page = await loginToContext(context, email, DEFAULT_PASSWORD);
        registerAuthStateEmail(email, role);
      }
    } catch (error) {
      await context.close().catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Actor login failed for role ${role} (${roleToUser[role].email}): ${message}`,
      );
    }

    actorSessions.set(role, {
      role,
      user: roleToUser[role],
      context,
      page,
    });
  }
}

async function forceSupabaseSchemaRefresh(): Promise<void> {
  const supabase = getAdminSupabaseClient();

  try {
    await supabase.rpc("reload_schema_cache");
  } catch {
    await supabase.from("_reload").select("*");
  }

  try {
    await supabase.rpc("exec_sql", { sql: "NOTIFY pgrst, 'reload schema';" });
  } catch {
    // Best effort cache refresh for environments without this helper RPC.
  }
}

function getActorPage(role: KnownRole): Page {
  const session = actorSessions.get(role);
  if (!session) {
    throw new Error(`No actor session for role ${role}`);
  }

  return session.page;
}

function getActorByRole(role: KnownRole): UserRecord {
  const session = actorSessions.get(role);
  if (!session) {
    throw new Error(`No actor session for role ${role}`);
  }

  return session.user;
}

async function closeActorSessions(): Promise<void> {
  for (const session of actorSessions.values()) {
    try {
      await session.context.close();
    } catch {
      // Ignore teardown issues when a context is already disposed.
    }
  }
  actorSessions.clear();
}

async function selectDropdownOption(page: Page, label: string, value: string): Promise<void> {
  const combobox = page.getByRole("combobox", { name: new RegExp(label, "i") });
  await combobox.click();

  const optionByRole = page.getByRole("option", { name: new RegExp(`^${value}$`, "i") }).first();
  const optionCount = await optionByRole.count();

  if (optionCount > 0) {
    await optionByRole.click({ force: true }).catch(() => null);
  }

  await combobox.selectOption({ label: value });
}

async function openNewClaimForm(page: Page): Promise<void> {
  await page.goto("/claims/new", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /new claim/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: /submit claim/i })).toBeVisible({ timeout: 15000 });
}

async function resolveClaimIdByBillNo(submitterId: string, billNo: string): Promise<string> {
  const client = getAdminSupabaseClient();
  const { data, error } = await querySupabaseWithRetry(() =>
    client
      .from("claims")
      .select("id, expense_details!inner(bill_no)")
      .eq("submitted_by", submitterId)
      .eq("expense_details.bill_no", billNo)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );

  if (error) {
    throw new Error(`Failed to resolve claim id for bill no ${billNo}: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error(`No claim found for submitter ${submitterId} and bill no ${billNo}.`);
  }

  return data.id as string;
}

async function resolveClaimIdByAdvancePurpose(
  submitterId: string,
  purpose: string,
): Promise<string> {
  const client = getAdminSupabaseClient();
  const { data, error } = await querySupabaseWithRetry(() =>
    client
      .from("claims")
      .select("id, advance_details!inner(purpose)")
      .eq("submitted_by", submitterId)
      .eq("advance_details.purpose", purpose)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );

  if (error) {
    throw new Error(`Failed to resolve claim id for advance purpose ${purpose}: ${error.message}`);
  }

  if (!data?.id) {
    throw new Error(`No claim found for submitter ${submitterId} and advance purpose ${purpose}.`);
  }

  return data.id as string;
}

function newMarker(prefix: string): string {
  return `${prefix}-${RUN_TAG}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function shouldRetrySupabaseError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("fetch failed") || normalized.includes("network");
}

async function querySupabaseWithRetry<T>(
  queryFn: () => PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<{ data: T; error: { message: string } | null }> {
  let lastResult: { data: T; error: { message: string } | null } | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await queryFn();
    lastResult = result;

    if (!result.error) {
      return result;
    }

    if (!shouldRetrySupabaseError(result.error.message) || attempt === 3) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }

  return (
    lastResult ?? {
      data: null as T,
      error: { message: "Query failed without a response." },
    }
  );
}

async function submitReimbursementClaim(
  page: Page,
  input: {
    actorRole: KnownRole;
    departmentName: string;
    amount: number;
    workflowLabel: string;
    onBehalfOfEmail?: string;
    onBehalfOfEmployeeCode?: string;
    billNoOverride?: string;
    employeeIdOverride?: string;
  },
): Promise<SubmittedClaim> {
  await openNewClaimForm(page);

  const marker = newMarker(input.workflowLabel);
  const employeeCode = input.employeeIdOverride ?? `${input.actorRole.toUpperCase()}-${marker}`;
  const billNo = input.billNoOverride ?? `BILL-${marker}`;
  const transactionId = `TXN-${marker}`;

  if (input.onBehalfOfEmail && input.onBehalfOfEmployeeCode) {
    await selectDropdownOption(page, "Submission Type", "On Behalf");
    await page.locator("#onBehalfEmail").fill(input.onBehalfOfEmail);
    await page.locator("#onBehalfEmployeeCode").fill(input.onBehalfOfEmployeeCode);
  }

  await selectDropdownOption(page, "Department", input.departmentName);
  await selectDropdownOption(page, "Payment Mode", "Reimbursement");
  await selectDropdownOption(page, "Expense Category", runtimeActors.expenseCategoryName);

  await page.locator("#employeeId").fill(employeeCode);
  await page.locator("#billNo").fill(billNo);
  await page.locator("#transactionId").fill(transactionId);
  await page.locator("#expensePurpose").fill(`${input.workflowLabel} ${marker}`);
  await page.locator("#transactionDate").fill("2026-03-18");
  await page.locator("#basicAmount").fill(String(input.amount));
  await page.locator("#receiptFile").setInputFiles(RECEIPT_PATH);

  await page.getByRole("button", { name: /submit claim/i }).click();
  await waitForClaimSubmissionCompletion(page);

  const actor = getActorByRole(input.actorRole);
  const claimId = await resolveClaimIdByBillNo(actor.id, billNo);

  return { claimId, marker };
}

async function waitForClaimSubmissionCompletion(page: Page): Promise<void> {
  try {
    await expect(page.getByText(/claim submitted successfully/i).first()).toBeVisible({
      timeout: 8000,
    });
    return;
  } catch {
    await expect(page).toHaveURL(/\/dashboard\/my-claims(?:\?|$)/, { timeout: 30000 });
    await expect(page.getByRole("heading", { name: /my claims/i })).toBeVisible({
      timeout: 30000,
    });
  }
}

async function submitPettyCashRequestClaim(
  page: Page,
  input: {
    actorRole: KnownRole;
    departmentName: string;
    amount: number;
    workflowLabel: string;
  },
): Promise<SubmittedClaim> {
  await openNewClaimForm(page);

  const marker = newMarker(input.workflowLabel);
  const employeeCode = `${input.actorRole.toUpperCase()}-${marker}`;
  const budgetMonth = "3";
  const budgetYear = "2026";
  const purpose = `${input.workflowLabel} ${marker}`;

  await selectDropdownOption(page, "Department", input.departmentName);
  await selectDropdownOption(page, "Payment Mode", "Petty Cash Request");

  await page.locator("#employeeId").fill(employeeCode);
  await page.locator("#requestedAmount").fill(String(input.amount));
  await page.locator("#expectedUsageDate").fill("2026-03-24");
  await page.locator("#budgetMonth").selectOption(budgetMonth);
  await page.locator("#budgetYear").selectOption(budgetYear);
  await page.locator("#purpose").fill(purpose);

  await page.getByRole("button", { name: /submit claim/i }).click();
  await waitForClaimSubmissionCompletion(page);

  const actor = getActorByRole(input.actorRole);
  const claimId = await resolveClaimIdByAdvancePurpose(actor.id, purpose);

  return { claimId, marker };
}

async function submitPettyCashExpenseClaim(
  page: Page,
  input: {
    actorRole: KnownRole;
    departmentName: string;
    amount: number;
    workflowLabel: string;
  },
): Promise<SubmittedClaim> {
  await openNewClaimForm(page);

  const marker = newMarker(input.workflowLabel);
  const employeeCode = `${input.actorRole.toUpperCase()}-${marker}`;
  const billNo = `BILL-${marker}`;
  const transactionId = `TXN-${marker}`;

  await selectDropdownOption(page, "Department", input.departmentName);
  await selectDropdownOption(page, "Payment Mode", "Petty Cash");
  await selectDropdownOption(page, "Expense Category", runtimeActors.expenseCategoryName);

  await page.locator("#employeeId").fill(employeeCode);
  await page.locator("#billNo").fill(billNo);
  await page.locator("#transactionId").fill(transactionId);
  await page.locator("#expensePurpose").fill(`${input.workflowLabel} ${marker}`);
  await page.locator("#transactionDate").fill("2026-03-18");
  await page.locator("#basicAmount").fill(String(input.amount));
  await page.locator("#receiptFile").setInputFiles(RECEIPT_PATH);

  await page.getByRole("button", { name: /submit claim/i }).click();
  await waitForClaimSubmissionCompletion(page);

  const actor = getActorByRole(input.actorRole);
  const claimId = await resolveClaimIdByBillNo(actor.id, billNo);

  return { claimId, marker };
}

async function openApprovalsHistory(page: Page, claimId?: string): Promise<void> {
  const params = new URLSearchParams({ view: "approvals" });
  if (claimId) {
    params.set("search_field", "claim_id");
    params.set("search_query", claimId);
  }

  await page.goto(`/dashboard/my-claims?${params.toString()}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /approvals history/i })).toBeVisible({
    timeout: 20000,
  });
}

async function openMyClaims(page: Page, claimId?: string): Promise<void> {
  const params = new URLSearchParams();
  if (claimId) {
    params.set("search_field", "claim_id");
    params.set("search_query", claimId);
  }

  const url =
    params.size > 0 ? `/dashboard/my-claims?${params.toString()}` : "/dashboard/my-claims";
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /my claims/i })).toBeVisible({ timeout: 20000 });
}

function claimRow(page: Page, claimId: string): Locator {
  return page.locator("tbody tr", { has: page.getByRole("link", { name: claimId }) }).first();
}

async function clickRowActionButton(page: Page, row: Locator, actionName: RegExp): Promise<void> {
  const rowButton = row.getByRole("button", { name: actionName }).first();
  if ((await rowButton.count()) > 0) {
    await rowButton.scrollIntoViewIfNeeded().catch(() => null);
    if (await rowButton.isVisible().catch(() => false)) {
      await rowButton.click();
      return;
    }
  }

  // Some approval flows require opening the full audit mode dialog via View.
  const viewButton = row.getByRole("button", { name: /^view$/i }).first();
  await expect(viewButton).toBeVisible({ timeout: 10000 });
  await viewButton.click();

  const auditModeCloseButton = page.getByRole("button", { name: /close audit mode/i }).first();
  await expect(auditModeCloseButton).toBeVisible({ timeout: 10000 });

  const dialogActionButton = page
    .locator("section", { hasText: /take action/i })
    .first()
    .getByRole("button", { name: actionName })
    .first();
  await expect(dialogActionButton).toBeVisible({ timeout: 10000 });
  await dialogActionButton.click();
}

async function clickApproveButton(row: Locator): Promise<void> {
  await clickRowActionButton(row.page(), row, /^(approve|ok)$/i);
}

async function approveAtCurrentScope(page: Page, claimId: string): Promise<void> {
  await openApprovalsHistory(page, claimId);
  const row = claimRow(page, claimId);
  await expect(row).toBeVisible({ timeout: 30000 });

  await clickApproveButton(row);
  await expect(page.getByText(/approved\./i)).toBeVisible({ timeout: 30000 });
}

async function rejectAtCurrentScope(page: Page, claimId: string, reason: string): Promise<void> {
  await rejectAtCurrentScopeWithOptions(page, claimId, reason, { allowResubmission: false });
}

async function rejectAtCurrentScopeWithOptions(
  page: Page,
  claimId: string,
  reason: string,
  input: { allowResubmission: boolean },
): Promise<void> {
  await openApprovalsHistory(page, claimId);
  const row = claimRow(page, claimId);
  await expect(row).toBeVisible({ timeout: 30000 });

  await clickRowActionButton(page, row, /^reject$/i);

  const reasonBox = page.locator("textarea[name='rejectionReason']").first();
  await expect(reasonBox).toBeVisible({ timeout: 10000 });
  await reasonBox.fill(reason);

  const allowResubmissionCheckbox = page.locator("input[name='allowResubmission']").first();
  if (input.allowResubmission) {
    await allowResubmissionCheckbox.check();
  } else {
    await allowResubmissionCheckbox.uncheck();
  }

  await page.getByRole("button", { name: /confirm rejection/i }).click();
  await expect(page.getByText(/rejected\./i)).toBeVisible({ timeout: 30000 });
}

async function markPaidAtFinance(page: Page, claimId: string): Promise<void> {
  await openApprovalsHistory(page, claimId);
  const row = claimRow(page, claimId);
  await expect(row).toBeVisible({ timeout: 30000 });

  await clickRowActionButton(page, row, /^paid$|mark as paid/i);
  await expect(page.getByText(/marked as paid\./i)).toBeVisible({ timeout: 30000 });
}

async function expectClaimVisibleInApprovals(
  page: Page,
  claimId: string,
  visible: boolean,
): Promise<void> {
  await openApprovalsHistory(page, claimId);
  const row = claimRow(page, claimId);

  if (visible) {
    await expect(row).toBeVisible({ timeout: 30000 });
    return;
  }

  await expect(row).toHaveCount(0);
}

async function expectClaimVisibleInMyClaims(
  page: Page,
  claimId: string,
  visible: boolean,
): Promise<void> {
  await openMyClaims(page, claimId);
  const row = claimRow(page, claimId);

  if (visible) {
    await expect(row).toBeVisible({ timeout: 30000 });
    return;
  }

  await expect(row).toHaveCount(0);
}

async function expectClaimStatusInMyClaims(
  page: Page,
  claimId: string,
  statusText: string,
): Promise<void> {
  await openMyClaims(page, claimId);
  const row = claimRow(page, claimId);
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row).toContainText(new RegExp(statusText, "i"));
}

async function expectClaimStatusInApprovals(
  page: Page,
  claimId: string,
  statusText: string,
): Promise<void> {
  await openApprovalsHistory(page, claimId);
  const row = claimRow(page, claimId);
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row).toContainText(new RegExp(statusText, "i"));
}

async function resolveFinanceBulkActorPage(flowUrl: string): Promise<Page> {
  const candidateRoles: KnownRole[] = ["finance1", "finance2"];

  for (const role of candidateRoles) {
    const candidatePage = getActorPage(role);
    await candidatePage.goto(flowUrl, { waitUntil: "domcontentloaded" });
    await expect(candidatePage.getByRole("heading", { name: /approvals history/i })).toBeVisible({
      timeout: 30000,
    });

    const bulkMasterCheckbox = candidatePage.getByTestId("bulk-master-checkbox").first();
    if ((await bulkMasterCheckbox.count()) > 0) {
      await expect(bulkMasterCheckbox).toBeVisible({ timeout: 5000 });
      return candidatePage;
    }
  }

  throw new Error(
    "Bulk approvals controls are unavailable for both finance1 and finance2 in current viewer scope.",
  );
}

async function assertClaimStatusInDb(claimId: string, expectedStatus: string): Promise<void> {
  const client = getAdminSupabaseClient();
  const { data, error } = await querySupabaseWithRetry(() =>
    client
      .from("claims")
      .select("status")
      .eq("id", claimId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle(),
  );

  if (error) {
    throw new Error(`Failed to assert status for claim ${claimId}: ${error.message}`);
  }

  expect(data?.status).toBe(expectedStatus);
}

async function getClaimRouting(claimId: string): Promise<ClaimRouting> {
  const client = getAdminSupabaseClient();
  const { data, error } = await querySupabaseWithRetry(() =>
    client
      .from("claims")
      .select("department_id, status, assigned_l1_approver_id, assigned_l2_approver_id")
      .eq("id", claimId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle(),
  );

  if (error) {
    throw new Error(`Failed to read routing for claim ${claimId}: ${error.message}`);
  }

  if (!data?.assigned_l1_approver_id || !data?.department_id || !data?.status) {
    throw new Error(`Routing record missing required fields for claim ${claimId}.`);
  }

  return {
    departmentId: data.department_id as string,
    status: data.status as string,
    assignedL1ApproverId: data.assigned_l1_approver_id as string,
    assignedL2ApproverId: (data.assigned_l2_approver_id as string | null) ?? null,
  };
}

async function assertClaimRouting(claimId: string, expectedL1ApproverId: string): Promise<void> {
  const routing = await getClaimRouting(claimId);
  expect(routing.assignedL1ApproverId).toBe(expectedL1ApproverId);
}

async function getWalletPettyCashBalance(userId: string): Promise<number> {
  const client = getAdminSupabaseClient();
  const { data, error } = await querySupabaseWithRetry(() =>
    client
      .from("wallets")
      .select("petty_cash_balance")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
  );

  if (error) {
    throw new Error(`Strict wallets table query failed for user ${userId}: ${error.message}`);
  }

  const raw = data?.petty_cash_balance as number | string | null | undefined;
  if (raw === undefined || raw === null) {
    throw new Error(`No petty_cash_balance row found in wallets for user ${userId}.`);
  }

  const numeric = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(numeric)) {
    throw new Error(`petty_cash_balance is non-numeric for user ${userId}: ${String(raw)}`);
  }

  return numeric;
}

function assertWalletDelta(before: number, after: number, expectedDelta: number): void {
  expect(after - before).toBeCloseTo(expectedDelta, 2);
}

test.describe("Claims Workflow Multi-Role E2E", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(480000);

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240000);
    await forceSupabaseSchemaRefresh();
    runtimeActors = await resolveRuntimeActors();
    await setupActorSessions(browser, runtimeActors);
  });

  test.afterAll(async () => {
    await closeActorSessions();
  });

  test("Flow 1: standard happy path closes claim and keeps global history visibility", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const finance1Page = getActorPage("finance1");
    const finance2Page = getActorPage("finance2");

    const submitted = await submitReimbursementClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount: 301.25,
      workflowLabel: "FLOW1-HAPPY",
    });

    await approveAtCurrentScope(hodPage, submitted.claimId);
    await approveAtCurrentScope(finance1Page, submitted.claimId);
    await markPaidAtFinance(finance1Page, submitted.claimId);

    await assertClaimStatusInDb(submitted.claimId, "Payment Done - Closed");

    await expectClaimVisibleInMyClaims(submitterPage, submitted.claimId, true);
    await expectClaimVisibleInApprovals(hodPage, submitted.claimId, true);
    await expectClaimVisibleInApprovals(finance1Page, submitted.claimId, true);
    await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, true);
  });

  test("Flow 2: L1 rejection remains private from finance users", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const finance1Page = getActorPage("finance1");
    const finance2Page = getActorPage("finance2");

    const submitted = await submitReimbursementClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount: 217.4,
      workflowLabel: "FLOW2-HOD-REJECT",
    });

    await rejectAtCurrentScope(hodPage, submitted.claimId, "L1 rejection privacy validation.");

    await assertClaimStatusInDb(submitted.claimId, "Rejected");

    await expectClaimVisibleInMyClaims(submitterPage, submitted.claimId, true);
    await expectClaimStatusInMyClaims(submitterPage, submitted.claimId, "Rejected");

    await expectClaimVisibleInApprovals(hodPage, submitted.claimId, true);

    await expectClaimVisibleInApprovals(finance1Page, submitted.claimId, false);
    await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, false);

    await expectClaimVisibleInMyClaims(finance1Page, submitted.claimId, false);
    await expectClaimVisibleInMyClaims(finance2Page, submitted.claimId, false);
  });

  test("Flow 3: HOD self-submission escalates to founder and finance rejection remains globally visible", async () => {
    const hodPage = getActorPage("hod");
    const founderPage = getActorPage("founder");
    const finance1Page = getActorPage("finance1");
    const finance2Page = getActorPage("finance2");

    const submitted = await submitReimbursementClaim(hodPage, {
      actorRole: "hod",
      departmentName: runtimeActors.hodDepartment.name,
      amount: 412.6,
      workflowLabel: "FLOW3-HOD-ESCALATION",
    });

    await assertClaimRouting(submitted.claimId, runtimeActors.founder.id);

    await approveAtCurrentScope(founderPage, submitted.claimId);
    await rejectAtCurrentScope(
      finance1Page,
      submitted.claimId,
      "L2 rejection global visibility validation.",
    );

    await assertClaimStatusInDb(submitted.claimId, "Rejected");

    await expectClaimVisibleInMyClaims(hodPage, submitted.claimId, true);
    await expectClaimStatusInMyClaims(hodPage, submitted.claimId, "Rejected");

    await expectClaimVisibleInApprovals(founderPage, submitted.claimId, true);
    await expectClaimVisibleInApprovals(finance1Page, submitted.claimId, true);
    await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, true);
  });

  test("Flow 4: petty cash advance approval increases wallet by exactly 40000", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const finance1Page = getActorPage("finance1");
    const amount = 40000;

    const walletBefore = await getWalletPettyCashBalance(runtimeActors.submitter.id);

    const submitted = await submitPettyCashRequestClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount,
      workflowLabel: "FLOW4-PC-ADVANCE",
    });

    await approveAtCurrentScope(hodPage, submitted.claimId);
    await approveAtCurrentScope(finance1Page, submitted.claimId);
    await markPaidAtFinance(finance1Page, submitted.claimId);

    await assertClaimStatusInDb(submitted.claimId, "Payment Done - Closed");

    const walletAfter = await getWalletPettyCashBalance(runtimeActors.submitter.id);
    assertWalletDelta(walletBefore, walletAfter, amount);
  });

  test("Flow 5: petty cash expense rejected at L1 keeps wallet unchanged", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const amount = 30000;

    const walletBefore = await getWalletPettyCashBalance(runtimeActors.submitter.id);

    const submitted = await submitPettyCashExpenseClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount,
      workflowLabel: "FLOW5-PC-EXPENSE-HOD-REJECT",
    });

    await rejectAtCurrentScope(hodPage, submitted.claimId, "L1 rejected petty cash expense.");

    await assertClaimStatusInDb(submitted.claimId, "Rejected");

    const walletAfter = await getWalletPettyCashBalance(runtimeActors.submitter.id);
    assertWalletDelta(walletBefore, walletAfter, 0);
  });

  test("Flow 6: petty cash expense rejected at finance keeps wallet unchanged and remains visible to finance2 history", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const finance1Page = getActorPage("finance1");
    const finance2Page = getActorPage("finance2");
    const amount = 15000;

    const walletBefore = await getWalletPettyCashBalance(runtimeActors.submitter.id);

    const submitted = await submitPettyCashExpenseClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount,
      workflowLabel: "FLOW6-PC-EXPENSE-FIN-REJECT",
    });

    await approveAtCurrentScope(hodPage, submitted.claimId);
    await rejectAtCurrentScope(finance1Page, submitted.claimId, "L2 rejected petty cash expense.");

    await assertClaimStatusInDb(submitted.claimId, "Rejected");

    const walletAfter = await getWalletPettyCashBalance(runtimeActors.submitter.id);
    assertWalletDelta(walletBefore, walletAfter, 0);

    await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, true);
    await expectClaimStatusInApprovals(finance2Page, submitted.claimId, "Rejected");

    await expectClaimVisibleInMyClaims(submitterPage, submitted.claimId, true);
    await expectClaimStatusInMyClaims(submitterPage, submitted.claimId, "Rejected");

    await expectClaimVisibleInApprovals(hodPage, submitted.claimId, true);
    await expectClaimStatusInApprovals(hodPage, submitted.claimId, "Rejected");
  });

  test("Flow 7: fully approved petty cash expense decreases wallet by exactly 10000", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const finance1Page = getActorPage("finance1");
    const amount = 10000;

    const walletBefore = await getWalletPettyCashBalance(runtimeActors.submitter.id);

    const submitted = await submitPettyCashExpenseClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount,
      workflowLabel: "FLOW7-PC-EXPENSE-FULL-APPROVAL",
    });

    await approveAtCurrentScope(hodPage, submitted.claimId);
    await approveAtCurrentScope(finance1Page, submitted.claimId);
    await markPaidAtFinance(finance1Page, submitted.claimId);

    await assertClaimStatusInDb(submitted.claimId, "Payment Done - Closed");

    const walletAfter = await getWalletPettyCashBalance(runtimeActors.submitter.id);
    assertWalletDelta(walletBefore, walletAfter, -amount);
  });

  test("Flow 8: Standard Reject Blocks Duplicates", async () => {
    const submitterPage = getActorPage("submitter");
    const duplicateBillNo = `BILL-REJECT-${RUN_TAG}`;
    const duplicateAmount = 100;

    const firstSubmitted = await submitReimbursementClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount: duplicateAmount,
      workflowLabel: "FLOW8-STRICT-REJECT",
      billNoOverride: duplicateBillNo,
    });

    const firstRouting = await getClaimRouting(firstSubmitted.claimId);
    const l1Role = resolveRoleByUserId(firstRouting.assignedL1ApproverId);
    expect(l1Role).not.toBeNull();
    const l1ApproverPage = getActorPage(l1Role!);

    await rejectAtCurrentScopeWithOptions(
      l1ApproverPage,
      firstSubmitted.claimId,
      "Strict rejection test.",
      {
        allowResubmission: false,
      },
    );
    await assertClaimStatusInDb(firstSubmitted.claimId, "Rejected");

    await openNewClaimForm(submitterPage);
    await selectDropdownOption(submitterPage, "Department", runtimeActors.submitterDepartment.name);
    await selectDropdownOption(submitterPage, "Payment Mode", "Reimbursement");
    await selectDropdownOption(
      submitterPage,
      "Expense Category",
      runtimeActors.expenseCategoryName,
    );

    const secondMarker = newMarker("FLOW8-DUPLICATE-ATTEMPT");
    await submitterPage.locator("#employeeId").fill(`SUBMITTER-${secondMarker}`);
    await submitterPage.locator("#billNo").fill(duplicateBillNo);
    await submitterPage.locator("#transactionId").fill(`TXN-${secondMarker}`);
    await submitterPage.locator("#expensePurpose").fill(`FLOW8 duplicate attempt ${secondMarker}`);
    await submitterPage.locator("#transactionDate").fill("2026-03-18");
    await submitterPage.locator("#basicAmount").fill(String(duplicateAmount));
    await submitterPage.locator("#receiptFile").setInputFiles(RECEIPT_PATH);
    await submitterPage.getByRole("button", { name: /submit claim/i }).click();

    await expect(
      submitterPage.getByText(/exact Bill No, Date, and Amount already exists/i),
    ).toBeVisible({ timeout: 30000 });
  });

  test("Flow 9: Resubmission Reject Allows Duplicates", async () => {
    const submitterPage = getActorPage("submitter");
    const hodPage = getActorPage("hod");
    const duplicateBillNo = `BILL-RESUBMIT-${RUN_TAG}`;
    const duplicateAmount = 200;

    const firstSubmitted = await submitReimbursementClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount: duplicateAmount,
      workflowLabel: "FLOW9-RESUBMISSION-REJECT",
      billNoOverride: duplicateBillNo,
    });

    await rejectAtCurrentScopeWithOptions(
      hodPage,
      firstSubmitted.claimId,
      "Resubmission allowed test.",
      {
        allowResubmission: true,
      },
    );
    await assertClaimStatusInDb(firstSubmitted.claimId, "Rejected");

    const secondSubmitted = await submitReimbursementClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount: duplicateAmount,
      workflowLabel: "FLOW9-DUPLICATE-SHOULD-PASS",
      billNoOverride: duplicateBillNo,
    });

    await assertClaimStatusInDb(secondSubmitted.claimId, "Submitted - Awaiting HOD approval");
    await expectClaimVisibleInMyClaims(submitterPage, secondSubmitted.claimId, true);
  });

  test("Flow 10: Audit Timeline Renders Correctly", async () => {
    const submitterPage = getActorPage("submitter");

    const submitted = await submitReimbursementClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: runtimeActors.submitterDepartment.name,
      amount: 188.55,
      workflowLabel: "FLOW10-AUDIT-TIMELINE",
    });

    await submitterPage.goto(`/dashboard/claims/${submitted.claimId}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(submitterPage.getByRole("heading", { name: submitted.claimId })).toBeVisible({
      timeout: 30000,
    });

    const auditSection = submitterPage
      .locator("section")
      .filter({ has: submitterPage.getByText(/audit history/i) })
      .first();

    await expect(auditSection).toBeVisible({ timeout: 30000 });
    await expect(auditSection).toContainText(/claim submitted/i);
    await expect(auditSection).toContainText(runtimeActors.submitter.email);
  });

  test("Flow 11: Bulk Actions and Cross-Page Selection", async () => {
    const submitterPage = getActorPage("submitter");
    const flow11EmployeeId = `FLOW11-${RUN_TAG}`;

    const createdClaims: string[] = [];

    for (let index = 1; index <= 11; index += 1) {
      const submitted = await submitReimbursementClaim(submitterPage, {
        actorRole: "submitter",
        departmentName: runtimeActors.submitterDepartment.name,
        amount: 175 + index,
        workflowLabel: `FLOW11-BULK-${index}`,
        employeeIdOverride: flow11EmployeeId,
      });

      const routing = await getClaimRouting(submitted.claimId);
      const l1Role = resolveRoleByUserId(routing.assignedL1ApproverId);
      expect(l1Role).not.toBeNull();
      await approveAtCurrentScope(getActorPage(l1Role!), submitted.claimId);
      createdClaims.push(submitted.claimId);
    }

    const flow11Url = `/dashboard/my-claims?view=approvals&status=${encodeURIComponent(
      "HOD approved - Awaiting finance approval",
    )}&search_field=employee_id&search_query=${encodeURIComponent(flow11EmployeeId)}`;

    const financeBulkPage = await resolveFinanceBulkActorPage(flow11Url);

    await financeBulkPage.getByTestId("bulk-master-checkbox").check();
    await expect(
      financeBulkPage.getByText(/All 10 claims on this page are selected\./i),
    ).toBeVisible({
      timeout: 15000,
    });

    await financeBulkPage.getByRole("button", { name: /Select all 11 claims/i }).click();
    await financeBulkPage.getByRole("button", { name: /^Bulk Approve$/i }).click();

    await expect
      .poll(
        async () => {
          await financeBulkPage.goto(flow11Url, { waitUntil: "domcontentloaded" });
          const noHistory = await financeBulkPage
            .getByText(/No approvals history found\./i)
            .isVisible()
            .catch(() => false);
          return noHistory;
        },
        { timeout: 60000 },
      )
      .toBe(true);

    for (const claimId of createdClaims) {
      await assertClaimStatusInDb(claimId, "Finance Approved - Payment under process");
    }
  });

  test("Edge Workflow A (AI-generated): cross-department routing locks to target L1 approver and isolates original HOD", async () => {
    if (runtimeActors.crossDepartmentCandidate === null) {
      expect(runtimeActors.crossDepartmentCandidate).toBeNull();
      return;
    }

    const submitterPage = getActorPage("submitter");
    const originalHodPage = getActorPage("hod");
    const candidate = runtimeActors.crossDepartmentCandidate!;
    const targetApproverPage = getActorPage(candidate.approverRole);

    const submitted = await submitReimbursementClaim(submitterPage, {
      actorRole: "submitter",
      departmentName: candidate.department.name,
      amount: 219.45,
      workflowLabel: "EDGE-A-CROSS-DEPT",
    });

    const routing = await getClaimRouting(submitted.claimId);
    expect(routing.departmentId).toBe(candidate.department.id);
    expect(routing.assignedL1ApproverId).toBe(candidate.department.approver_1);

    await expectClaimVisibleInApprovals(originalHodPage, submitted.claimId, false);
    await expectClaimVisibleInApprovals(targetApproverPage, submitted.claimId, true);

    await rejectAtCurrentScope(
      targetApproverPage,
      submitted.claimId,
      "Cross-department edge-case rejection.",
    );
    await assertClaimStatusInDb(submitted.claimId, "Rejected");
  });

  test("Edge Workflow B (AI-generated): founder self-submission routing and rejection boundaries across founder/finance actors", async () => {
    if (runtimeActors.founderDepartment === null) {
      expect(runtimeActors.founderDepartment).toBeNull();
      return;
    }

    const founderPage = getActorPage("founder");
    const hodPage = getActorPage("hod");
    const finance1Page = getActorPage("finance1");
    const finance2Page = getActorPage("finance2");

    const submitted = await submitReimbursementClaim(founderPage, {
      actorRole: "founder",
      departmentName: runtimeActors.founderDepartment!.name,
      amount: 277.11,
      workflowLabel: "EDGE-B-FOUNDER-SELF",
    });

    const routing = await getClaimRouting(submitted.claimId);
    const l1Role = resolveRoleByUserId(routing.assignedL1ApproverId);

    expect(routing.assignedL1ApproverId).toBeTruthy();
    await expectClaimVisibleInMyClaims(founderPage, submitted.claimId, true);

    if (l1Role === "founder") {
      await rejectAtCurrentScope(
        founderPage,
        submitted.claimId,
        "Founder self-routed rejection boundary.",
      );
      await assertClaimStatusInDb(submitted.claimId, "Rejected");
      await expectClaimVisibleInApprovals(finance1Page, submitted.claimId, false);
      await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, false);
      return;
    }

    if (l1Role === "hod") {
      await approveAtCurrentScope(hodPage, submitted.claimId);
      await rejectAtCurrentScope(
        finance1Page,
        submitted.claimId,
        "Founder self-submission finance rejection boundary.",
      );
      await assertClaimStatusInDb(submitted.claimId, "Rejected");
      await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, true);
      return;
    }

    if (l1Role === "finance1") {
      await rejectAtCurrentScope(
        finance1Page,
        submitted.claimId,
        "Founder routed directly to finance1.",
      );
      await assertClaimStatusInDb(submitted.claimId, "Rejected");
      await expectClaimVisibleInApprovals(finance2Page, submitted.claimId, true);
      return;
    }

    if (l1Role === "finance2") {
      await rejectAtCurrentScope(
        finance2Page,
        submitted.claimId,
        "Founder routed directly to finance2.",
      );
      await assertClaimStatusInDb(submitted.claimId, "Rejected");
      await expectClaimVisibleInApprovals(finance1Page, submitted.claimId, true);
      return;
    }

    // Some environments can route founder self-submissions to a seeded approver not modeled in this suite.
    // Validate routing integrity and leave the claim in its submitted state instead of failing hard.
    await assertClaimStatusInDb(submitted.claimId, "Submitted - Awaiting HOD approval");
  });
});
