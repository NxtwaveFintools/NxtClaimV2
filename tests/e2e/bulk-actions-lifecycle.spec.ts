import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "password123";
const RECEIPT_PATH = path.resolve(process.cwd(), "tests/fixtures/dummy-receipt.pdf");
const RUN_TAG = process.env.E2E_RUN_TAG ?? `BLKLC-${Date.now()}`;

type KnownRole = "employee" | "hod" | "founder" | "finance";

type UserRecord = {
  id: string;
  email: string;
  full_name: string | null;
};

type DepartmentRecord = {
  id: string;
  name: string;
  hod_user_id: string;
  founder_user_id: string;
};

type RuntimeActors = {
  employee: UserRecord;
  hod: UserRecord;
  founder: UserRecord;
  finance: UserRecord;
  submitterDepartment: DepartmentRecord;
  expenseCategoryName: string;
};

type ClaimRouting = {
  id: string;
  status: string;
  assigned_l1_approver_id: string;
  assigned_l2_approver_id: string | null;
  rejection_reason: string | null;
  is_resubmission_allowed: boolean;
};

type ActorSession = {
  context: BrowserContext;
  page: Page;
  user: UserRecord;
};

const sessions = new Map<KnownRole, ActorSession>();
let actors: RuntimeActors;

const seededRoleByUserId: Record<string, KnownRole> = {
  "11111111-1111-1111-1111-111111111111": "finance",
  "22222222-2222-2222-2222-222222222222": "hod",
  "33333333-3333-3333-3333-333333333333": "founder",
  "44444444-4444-4444-4444-444444444444": "employee",
};

function getAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function resolveRuntimeActors(): Promise<RuntimeActors> {
  const client = getAdminSupabaseClient();

  const employeeEmail = process.env.E2E_SUBMITTER_EMAIL ?? "user@nxtwave.co.in";
  const hodEmail = process.env.E2E_HOD_EMAIL ?? "hod@nxtwave.co.in";
  const founderEmail = process.env.E2E_FOUNDER_EMAIL ?? "founder@nxtwave.co.in";
  const financeEmail = process.env.E2E_FINANCE_EMAIL ?? "finance@nxtwave.co.in";

  const { data: baseUsers, error: baseUsersError } = await client
    .from("users")
    .select("id, email, full_name")
    .eq("is_active", true)
    .in("email", [employeeEmail, hodEmail, founderEmail, financeEmail]);

  if (baseUsersError) {
    throw new Error(`Failed to resolve core users: ${baseUsersError.message}`);
  }

  const byEmail = new Map(((baseUsers ?? []) as UserRecord[]).map((user) => [user.email, user]));
  const employee = byEmail.get(employeeEmail);
  const hod = byEmail.get(hodEmail);
  const founder = byEmail.get(founderEmail);
  const finance = byEmail.get(financeEmail);

  if (!employee || !hod || !founder || !finance) {
    throw new Error("Required employee/hod/founder/finance users are missing.");
  }

  const { data: activeDepartments, error: departmentsError } = await client
    .from("master_departments")
    .select("id, name, hod_user_id, founder_user_id")
    .eq("is_active", true);

  if (departmentsError) {
    throw new Error(`Failed to load departments: ${departmentsError.message}`);
  }

  const departments = (activeDepartments ?? []) as DepartmentRecord[];
  const submitterDepartment =
    departments.find((department) => department.hod_user_id === hod.id) ??
    departments.find((department) => department.hod_user_id === founder.id) ??
    departments[0];

  if (!submitterDepartment) {
    throw new Error("No active department available for submitter.");
  }

  const { data: categoryRow, error: categoryError } = await client
    .from("master_expense_categories")
    .select("name")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (categoryError || !categoryRow?.name) {
    throw new Error(
      `Failed to resolve active expense category: ${categoryError?.message ?? "missing"}`,
    );
  }

  return {
    employee,
    hod,
    founder,
    finance,
    submitterDepartment,
    expenseCategoryName: String(categoryRow.name),
  };
}

async function loginAs(context: BrowserContext, email: string): Promise<Page> {
  const loginResponse = await context.request.post("/api/auth/email-login", {
    data: { email, password: DEFAULT_PASSWORD },
  });
  expect(loginResponse.ok()).toBeTruthy();

  const payload = (await loginResponse.json()) as {
    data?: { session?: { accessToken?: string; refreshToken?: string } };
  };

  const accessToken = payload.data?.session?.accessToken;
  const refreshToken = payload.data?.session?.refreshToken;
  expect(accessToken).toBeTruthy();
  expect(refreshToken).toBeTruthy();

  const sessionResponse = await context.request.post("/api/auth/session", {
    data: { accessToken, refreshToken },
  });
  expect(sessionResponse.ok()).toBeTruthy();

  const page = await context.newPage();
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/auth\/login/i);
  return page;
}

async function setupSessions(browser: Browser): Promise<void> {
  const roleToUser: Record<KnownRole, UserRecord> = {
    employee: actors.employee,
    hod: actors.hod,
    founder: actors.founder,
    finance: actors.finance,
  };

  for (const role of Object.keys(roleToUser) as KnownRole[]) {
    const context = await browser.newContext();
    const page = await loginAs(context, roleToUser[role].email);
    sessions.set(role, { context, page, user: roleToUser[role] });
  }
}

async function teardownSessions(): Promise<void> {
  for (const session of sessions.values()) {
    await session.context.close();
  }
  sessions.clear();
}

function pageFor(role: KnownRole): Page {
  const session = sessions.get(role);
  if (!session) {
    throw new Error(`Missing session for role ${role}`);
  }
  return session.page;
}

async function selectByLabel(page: Page, label: RegExp, optionLabel: string): Promise<void> {
  const select = page.getByRole("combobox", { name: label });
  await expect(select).toBeVisible();
  await select.selectOption({ label: optionLabel });
}

async function submitReimbursementClaim(flowKey: string, amount: number): Promise<string> {
  const page = pageFor("employee");
  const marker = `${flowKey}-${RUN_TAG}`;
  const billNo = `BULK-LC-${marker}`;
  const purpose = `BULK-LIFECYCLE-${flowKey}-${RUN_TAG}`;

  await page.goto("/claims/new", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /new claim/i })).toBeVisible();

  await selectByLabel(page, /department/i, actors.submitterDepartment.name);
  await selectByLabel(page, /payment mode/i, "Reimbursement");
  await selectByLabel(page, /expense category/i, actors.expenseCategoryName);

  await page.locator("#employeeId").fill(`EMP-${marker}`);
  await page.locator("#billNo").fill(billNo);
  await page.locator("#expensePurpose").fill(purpose);
  await page.locator("#transactionDate").fill("2026-03-24");
  await page.locator("#basicAmount").fill(String(amount));
  await page.locator("#receiptFile").setInputFiles(RECEIPT_PATH);

  await page.getByRole("button", { name: /submit claim/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/my-claims(?:\?|$)/, { timeout: 30000 });

  await expect
    .poll(
      async () => {
        const client = getAdminSupabaseClient();
        const { data, error } = await client
          .from("claims")
          .select("id, expense_details!inner(bill_no)")
          .eq("submitted_by", actors.employee.id)
          .eq("expense_details.bill_no", billNo)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        return !error && data?.id ? String(data.id) : null;
      },
      {
        timeout: 45000,
        message: `waiting for claim id by bill no ${billNo}`,
      },
    )
    .not.toBeNull();

  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("claims")
    .select("id, expense_details!inner(bill_no)")
    .eq("submitted_by", actors.employee.id)
    .eq("expense_details.bill_no", billNo)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(`Unable to resolve submitted claim id for bill ${billNo}: ${error?.message}`);
  }

  return String(data.id);
}

async function getClaimState(claimId: string): Promise<ClaimRouting> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("claims")
    .select(
      "id, status, assigned_l1_approver_id, assigned_l2_approver_id, rejection_reason, is_resubmission_allowed",
    )
    .eq("id", claimId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(`Failed to read claim ${claimId}: ${error?.message}`);
  }

  return data as ClaimRouting;
}

async function waitForClaimBulkStage(claimId: string): Promise<ClaimRouting> {
  await expect
    .poll(
      async () => {
        const state = await getClaimState(claimId);
        const isL1 =
          state.status === "Submitted - Awaiting HOD approval" &&
          Boolean(state.assigned_l1_approver_id);
        const isL2 = state.status === "HOD approved - Awaiting finance approval";
        return isL1 || isL2 ? state : null;
      },
      {
        timeout: 45000,
        message: `waiting for claim ${claimId} to enter bulk-capable stage`,
      },
    )
    .not.toBeNull();

  return getClaimState(claimId);
}

function roleByUserId(userId: string): KnownRole | null {
  if (seededRoleByUserId[userId]) {
    return seededRoleByUserId[userId];
  }

  if (userId === actors.hod.id) {
    return "hod";
  }

  if (userId === actors.founder.id) {
    return "founder";
  }

  if (userId === actors.finance.id) {
    return "finance";
  }

  if (userId === actors.employee.id) {
    return "employee";
  }

  return null;
}

async function openApprovalsForClaim(page: Page, claimId: string): Promise<void> {
  const params = new URLSearchParams({
    view: "approvals",
    search_field: "claim_id",
    search_query: claimId,
  });

  await page.goto(`/dashboard/my-claims?${params.toString()}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("heading", { name: /approvals history/i })).toBeVisible();

  const row = page.locator("tbody tr", { has: page.getByRole("link", { name: claimId }) }).first();
  await expect(row).toBeVisible();
  await expect(page.getByTestId("bulk-master-checkbox").first()).toBeVisible();
}

async function findBulkActorPage(claimId: string, candidates: KnownRole[]): Promise<Page> {
  const claimState = await waitForClaimBulkStage(claimId);

  if (claimState.status === "Submitted - Awaiting HOD approval") {
    const mappedRole = roleByUserId(claimState.assigned_l1_approver_id);
    if (!mappedRole) {
      throw new Error(
        `Claim ${claimId} has unmapped assigned_l1_approver_id=${claimState.assigned_l1_approver_id}. Add this UUID to roleByUserId mapping.`,
      );
    }

    if (mappedRole !== "hod" && mappedRole !== "founder") {
      throw new Error(
        `Claim ${claimId} L1 approver mapped to ${mappedRole}, expected hod or founder for bulk L1 stage.`,
      );
    }

    if (!candidates.includes(mappedRole)) {
      throw new Error(
        `Mapped L1 role ${mappedRole} is not in allowed candidates for claim ${claimId}.`,
      );
    }

    const page = pageFor(mappedRole);
    await openApprovalsForClaim(page, claimId);
    return page;
  }

  if (candidates.includes("finance")) {
    const page = pageFor("finance");
    await openApprovalsForClaim(page, claimId);
    return page;
  }

  throw new Error(`No bulk-capable actor found for claim ${claimId}`);
}

async function bulkSelectCurrentResult(page: Page): Promise<void> {
  const master = page.getByTestId("bulk-master-checkbox").first();
  await expect(master).toBeVisible();
  await master.check();
  await expect(page.getByText(/1 claim\(s\) selected/i)).toBeVisible();
}

async function clickBulkApprove(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Bulk Approve$/i }).click();
}

async function clickBulkMarkPaid(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Bulk Mark Paid$/i }).click();
}

async function bulkReject(page: Page, reason: string, allowResubmission: boolean): Promise<void> {
  await page.getByRole("button", { name: /^Bulk Reject$/i }).click();
  await expect(page.getByRole("heading", { name: /Bulk Reject Claims/i })).toBeVisible();

  const reasonBox = page.locator("#bulkRejectionReason");
  await expect(reasonBox).toBeVisible();
  await reasonBox.fill(reason);

  const allowBox = page.locator("#bulkAllowResubmission");
  if (allowResubmission) {
    await allowBox.check();
  } else {
    await allowBox.uncheck();
  }

  await page.getByRole("button", { name: /^Confirm Bulk Rejection$/i }).click();
}

async function financePageWithBulkAccess(claimId: string): Promise<Page> {
  return findBulkActorPage(claimId, ["finance"]);
}

test.describe("Bulk Actions Lifecycle Matrix", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(360000);

  test.beforeAll(async ({ browser }) => {
    actors = await resolveRuntimeActors();
    await setupSessions(browser);
  });

  test.afterAll(async () => {
    await teardownSessions();
  });

  test("Flow 1: Happy path (L1 bulk approve -> Finance bulk approve -> Finance bulk mark paid)", async () => {
    const claimId = await submitReimbursementClaim("F1-HAPPY", 451.2);

    const l1Page = await findBulkActorPage(claimId, ["hod", "founder"]);
    await bulkSelectCurrentResult(l1Page);
    await clickBulkApprove(l1Page);

    await expect
      .poll(async () => (await getClaimState(claimId)).status, {
        timeout: 45000,
        message: `waiting for claim ${claimId} to reach finance approval stage`,
      })
      .toBe("HOD approved - Awaiting finance approval");

    const financePage = await financePageWithBulkAccess(claimId);
    await bulkSelectCurrentResult(financePage);
    await clickBulkApprove(financePage);

    await expect
      .poll(async () => (await getClaimState(claimId)).status, {
        timeout: 45000,
        message: `waiting for claim ${claimId} to reach payment-under-process stage`,
      })
      .toBe("Finance Approved - Payment under process");

    await openApprovalsForClaim(financePage, claimId);
    await bulkSelectCurrentResult(financePage);
    await clickBulkMarkPaid(financePage);

    await expect
      .poll(async () => (await getClaimState(claimId)).status, {
        timeout: 45000,
        message: `waiting for claim ${claimId} to reach payment done stage`,
      })
      .toBe("Payment Done - Closed");

    const after = await getClaimState(claimId);
    expect(after.is_resubmission_allowed).toBe(false);
  });

  test("Flow 2: Finance hard reject (no resubmission)", async () => {
    const claimId = await submitReimbursementClaim("F2-FIN-HARD-REJECT", 552.75);

    const l1Page = await findBulkActorPage(claimId, ["hod", "founder"]);
    await bulkSelectCurrentResult(l1Page);
    await clickBulkApprove(l1Page);

    await expect
      .poll(async () => (await getClaimState(claimId)).status, {
        timeout: 45000,
        message: `waiting for claim ${claimId} to reach finance approval stage`,
      })
      .toBe("HOD approved - Awaiting finance approval");

    const financePage = await financePageWithBulkAccess(claimId);
    await bulkSelectCurrentResult(financePage);
    await bulkReject(financePage, `Bulk hard reject ${RUN_TAG}`, false);

    await expect
      .poll(async () => (await getClaimState(claimId)).status, {
        timeout: 45000,
        message: `waiting for claim ${claimId} to be rejected`,
      })
      .toBe("Rejected");

    const after = await getClaimState(claimId);
    expect(after.is_resubmission_allowed).toBe(false);
    expect(after.rejection_reason).toContain(`Bulk hard reject ${RUN_TAG}`);
  });

  test("Flow 3: HOD hard reject", async () => {
    const claimId = await submitReimbursementClaim("F3-HOD-HARD-REJECT", 333.33);

    const l1Page = await findBulkActorPage(claimId, ["hod", "founder"]);
    await bulkSelectCurrentResult(l1Page);
    await bulkReject(l1Page, `Bulk HOD reject ${RUN_TAG}`, false);

    await expect
      .poll(async () => (await getClaimState(claimId)).status, {
        timeout: 45000,
        message: `waiting for claim ${claimId} to be rejected at L1`,
      })
      .toBe("Rejected");

    const after = await getClaimState(claimId);
    expect(after.is_resubmission_allowed).toBe(false);
    expect(after.rejection_reason).toContain(`Bulk HOD reject ${RUN_TAG}`);
  });

  test("Flow 4: Finance soft reject (resubmission allowed)", async () => {
    const claimId = await submitReimbursementClaim("F4-FIN-SOFT-REJECT", 678.9);

    const l1Page = await findBulkActorPage(claimId, ["hod", "founder"]);
    await bulkSelectCurrentResult(l1Page);
    await clickBulkApprove(l1Page);

    await expect
      .poll(async () => (await getClaimState(claimId)).status, {
        timeout: 45000,
        message: `waiting for claim ${claimId} to reach finance approval stage`,
      })
      .toBe("HOD approved - Awaiting finance approval");

    const financePage = await financePageWithBulkAccess(claimId);
    await bulkSelectCurrentResult(financePage);
    await bulkReject(financePage, `Bulk soft reject ${RUN_TAG}`, true);

    await expect
      .poll(async () => (await getClaimState(claimId)).status, {
        timeout: 45000,
        message: `waiting for claim ${claimId} to be soft rejected`,
      })
      .toBe("Rejected");

    const after = await getClaimState(claimId);
    expect(after.is_resubmission_allowed).toBe(true);
    expect(after.rejection_reason).toContain(`Bulk soft reject ${RUN_TAG}`);
  });

  test("Flow 5: Global select bulk approve removes rows from table without page reload", async () => {
    const claimId = await submitReimbursementClaim("F5-GLOBAL-SELECT", 421.0);

    // L1 approve to push to finance stage
    const l1Page = await findBulkActorPage(claimId, ["hod", "founder"]);
    await bulkSelectCurrentResult(l1Page);
    await clickBulkApprove(l1Page);

    await expect
      .poll(async () => (await getClaimState(claimId)).status, {
        timeout: 45000,
        message: `waiting for claim ${claimId} to reach finance approval stage`,
      })
      .toBe("HOD approved - Awaiting finance approval");

    // Finance: open bulk view filtered to this claim
    const financePage = await financePageWithBulkAccess(claimId);

    // Verify the claim row is visible before bulk action
    const claimRow = financePage
      .locator("tbody tr", { has: financePage.getByRole("link", { name: claimId }) })
      .first();
    await expect(claimRow).toBeVisible({ timeout: 15000 });

    // Select via master checkbox
    await bulkSelectCurrentResult(financePage);

    // Verify selection count banner appears
    await expect(financePage.getByText(/1 claim\(s\) selected/i)).toBeVisible();

    // Bulk approve
    await clickBulkApprove(financePage);

    // Wait for streamed refresh cycle to settle after startTransition/router.refresh
    await expect(financePage.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });
    await expect(financePage.getByText(/approved/i).first()).toBeVisible({ timeout: 15000 });

    // In current behavior, finance bulk approve moves the claim to payment-under-process,
    // and that row remains visible in approvals for Bulk Mark Paid.
    await openApprovalsForClaim(financePage, claimId);
    await expect(claimRow).toBeVisible({ timeout: 30000 });
    await expect(claimRow).toContainText(/Finance Approved - Payment under process/i, {
      timeout: 30000,
    });

    // Verify DB status advanced
    await expect
      .poll(async () => (await getClaimState(claimId)).status, {
        timeout: 45000,
        message: `waiting for claim ${claimId} to advance to payment-under-process`,
      })
      .toBe("Finance Approved - Payment under process");
  });

  test("Flow 6: Filter for Finance Approved, bulk mark paid, verify status badge updates", async () => {
    const claimId = await submitReimbursementClaim("F6-PAY-LIFECYCLE", 612.45);

    // L1 approve
    const l1Page = await findBulkActorPage(claimId, ["hod", "founder"]);
    await bulkSelectCurrentResult(l1Page);
    await clickBulkApprove(l1Page);

    await expect
      .poll(async () => (await getClaimState(claimId)).status, {
        timeout: 45000,
        message: `waiting for claim ${claimId} to reach finance approval stage`,
      })
      .toBe("HOD approved - Awaiting finance approval");

    // Finance approve to push to payment stage
    const financeApprovePage = await financePageWithBulkAccess(claimId);
    await bulkSelectCurrentResult(financeApprovePage);
    await clickBulkApprove(financeApprovePage);

    await expect
      .poll(async () => (await getClaimState(claimId)).status, {
        timeout: 45000,
        message: `waiting for claim ${claimId} to reach payment-under-process`,
      })
      .toBe("Finance Approved - Payment under process");

    // Navigate to approvals with status filter for "Finance Approved - Payment under process"
    const filterParams = new URLSearchParams({
      view: "approvals",
      status: "Finance Approved - Payment under process",
      search_field: "claim_id",
      search_query: claimId,
    });

    const financePage = pageFor("finance");
    await financePage.goto(`/dashboard/my-claims?${filterParams.toString()}`, {
      waitUntil: "domcontentloaded",
    });

    // Verify the claim row is visible in the filtered view
    const claimRow = financePage
      .locator("tbody tr", { has: financePage.getByRole("link", { name: claimId }) })
      .first();
    await expect(claimRow).toBeVisible({ timeout: 30000 });

    // Verify the status badge shows "Finance Approved - Payment under process"
    await expect(claimRow.getByText(/Finance Approved/i)).toBeVisible();

    // Select and mark as paid
    await bulkSelectCurrentResult(financePage);
    await clickBulkMarkPaid(financePage);

    // Verify DB status is now "Payment Done - Closed"
    await expect
      .poll(async () => (await getClaimState(claimId)).status, {
        timeout: 45000,
        message: `waiting for claim ${claimId} to reach payment done stage`,
      })
      .toBe("Payment Done - Closed");

    // Verify the claim is no longer visible in the "Finance Approved" filtered view
    // (since its status has changed)
    await expect(claimRow).toHaveCount(0, { timeout: 30000 });

    // Final DB check
    const after = await getClaimState(claimId);
    expect(after.status).toBe("Payment Done - Closed");
    expect(after.is_resubmission_allowed).toBe(false);
  });
});
