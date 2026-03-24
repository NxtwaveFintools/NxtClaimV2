import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getAuthStatePathForEmail, registerAuthStateEmail } from "./support/auth-state";

const defaultPassword = "password123";
const runTag = process.env.E2E_RUN_TAG ?? `E2E-${Date.now()}`;
const SEMANTIC_CLAIM_ID_REGEX = /^CLAIM-[A-Za-z0-9]+-\d{8}-[A-Za-z0-9]+$/;

const ACTORS = {
  employeeA: {
    email: "user@nxtwave.co.in",
    employeeCode: "EMP-E2E-A-1001",
  },
  finance: {
    email: "finance@nxtwave.co.in",
  },
  employeeB: {
    email: "founder@nxtwave.co.in",
    employeeCode: "EMP-E2E-B-2002",
  },
} as const;

type LeapfrogContext = {
  departmentId: string;
  departmentName: string;
  hodUserId: string;
  hodEmail: string;
  financeUserId: string;
  financeEmail: string;
};

type CrossDepartmentHodEscalationContext = {
  submitterDepartmentId: string;
  submitterDepartmentName: string;
  submitterHodUserId: string;
  submitterHodEmail: string;
  targetDepartmentId: string;
  targetDepartmentName: string;
  targetHodUserId: string;
  targetHodEmail: string;
  targetApprover2UserId: string;
  targetApprover2Email: string;
};

type ProxyFounderContext = {
  departmentId: string;
  departmentName: string;
  founderUserId: string;
  founderEmail: string;
  seniorApproverUserId: string;
};

let leapfrogContextPromise: Promise<LeapfrogContext> | null = null;
let crossDepartmentEscalationContextPromise: Promise<CrossDepartmentHodEscalationContext> | null =
  null;
let proxyFounderContextPromise: Promise<ProxyFounderContext> | null = null;

function getAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for E2E runtime DB assertions.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function resolveLeapfrogContext(): Promise<LeapfrogContext> {
  if (!leapfrogContextPromise) {
    leapfrogContextPromise = (async () => {
      const client = getAdminSupabaseClient();

      const { data: financeRows, error: financeError } = await client
        .from("master_finance_approvers")
        .select("user_id")
        .eq("is_active", true)
        .order("is_primary", { ascending: false })
        .limit(1);

      if (financeError) {
        throw new Error(`Failed to resolve finance approver: ${financeError.message}`);
      }

      const financeUserId = financeRows?.[0]?.user_id;
      if (!financeUserId) {
        throw new Error("No active finance approver found for leapfrog test.");
      }

      const { data: financeUserRows, error: financeUserError } = await client
        .from("users")
        .select("id, email")
        .eq("id", financeUserId)
        .eq("is_active", true)
        .limit(1);

      if (financeUserError) {
        throw new Error(`Failed to resolve finance user profile: ${financeUserError.message}`);
      }

      const financeEmail = financeUserRows?.[0]?.email;
      if (!financeEmail) {
        throw new Error("Active finance user does not have an email.");
      }

      const { data: departmentRows, error: departmentError } = await client
        .from("master_departments")
        .select("id, name, approver_1")
        .eq("is_active", true)
        .eq("approver_2", financeUserId)
        .neq("approver_1", financeUserId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (departmentError) {
        throw new Error(`Failed to resolve leapfrog department: ${departmentError.message}`);
      }

      const department = departmentRows?.[0];
      if (!department) {
        throw new Error(
          "No active department found with approver_2 mapped to active finance approver.",
        );
      }

      const hodUserId = department.approver_1;
      const { data: hodRows, error: hodError } = await client
        .from("users")
        .select("id, email")
        .eq("id", hodUserId)
        .eq("is_active", true)
        .limit(1);

      if (hodError) {
        throw new Error(`Failed to resolve HOD profile: ${hodError.message}`);
      }

      const hodEmail = hodRows?.[0]?.email;
      if (!hodEmail) {
        throw new Error("Resolved HOD does not have an active email.");
      }

      return {
        departmentId: department.id,
        departmentName: department.name,
        hodUserId,
        hodEmail,
        financeUserId,
        financeEmail,
      };
    })();
  }

  return leapfrogContextPromise;
}

async function resolveCrossDepartmentHodEscalationContext(): Promise<CrossDepartmentHodEscalationContext> {
  if (!crossDepartmentEscalationContextPromise) {
    crossDepartmentEscalationContextPromise = (async () => {
      const client = getAdminSupabaseClient();

      const { data: departments, error: departmentsError } = await client
        .from("master_departments")
        .select("id, name, approver_1, approver_2")
        .eq("is_active", true)
        .not("approver_1", "is", null)
        .not("approver_2", "is", null);

      if (departmentsError) {
        throw new Error(
          `Failed to load departments for cross-department escalation test: ${departmentsError.message}`,
        );
      }

      const departmentRows = (departments ?? []) as Array<{
        id: string;
        name: string;
        approver_1: string;
        approver_2: string;
      }>;

      if (departmentRows.length < 2) {
        throw new Error(
          "At least two active departments with approver_1 and approver_2 are required for cross-department HOD escalation test.",
        );
      }

      const lowerName = (name: string) => name.trim().toLowerCase();
      const preferredSubmitterDepartment = departmentRows.find((row) =>
        lowerName(row.name).includes("tech"),
      );
      const preferredTargetDepartment = departmentRows.find((row) =>
        lowerName(row.name).includes("hr"),
      );

      let submitterDepartment =
        preferredSubmitterDepartment &&
        preferredTargetDepartment &&
        preferredSubmitterDepartment.approver_1 !== preferredTargetDepartment.approver_1
          ? preferredSubmitterDepartment
          : null;
      let targetDepartment =
        preferredSubmitterDepartment &&
        preferredTargetDepartment &&
        preferredSubmitterDepartment.approver_1 !== preferredTargetDepartment.approver_1
          ? preferredTargetDepartment
          : null;

      if (!submitterDepartment || !targetDepartment) {
        for (const source of departmentRows) {
          const candidate = departmentRows.find(
            (target) =>
              target.id !== source.id &&
              target.approver_1 !== source.approver_1 &&
              target.approver_2 !== source.approver_1,
          );

          if (candidate) {
            submitterDepartment = source;
            targetDepartment = candidate;
            break;
          }
        }
      }

      if (!submitterDepartment || !targetDepartment) {
        throw new Error(
          "Unable to resolve two departments where submitter is HOD in one department and target department has a different HOD plus an approver_2.",
        );
      }

      const userIds = [
        submitterDepartment.approver_1,
        targetDepartment.approver_1,
        targetDepartment.approver_2,
      ];
      const uniqueUserIds = [...new Set(userIds)];

      const { data: userRows, error: userError } = await client
        .from("users")
        .select("id, email")
        .in("id", uniqueUserIds)
        .eq("is_active", true);

      if (userError) {
        throw new Error(
          `Failed to resolve user profiles for cross-department escalation test: ${userError.message}`,
        );
      }

      const emailByUserId = new Map((userRows ?? []).map((row) => [row.id, row.email]));
      const submitterHodEmail = emailByUserId.get(submitterDepartment.approver_1);
      const targetHodEmail = emailByUserId.get(targetDepartment.approver_1);
      const targetApprover2Email = emailByUserId.get(targetDepartment.approver_2);

      if (!submitterHodEmail || !targetHodEmail || !targetApprover2Email) {
        throw new Error(
          "Resolved approvers for cross-department escalation test must all have active email addresses.",
        );
      }

      return {
        submitterDepartmentId: submitterDepartment.id,
        submitterDepartmentName: submitterDepartment.name,
        submitterHodUserId: submitterDepartment.approver_1,
        submitterHodEmail,
        targetDepartmentId: targetDepartment.id,
        targetDepartmentName: targetDepartment.name,
        targetHodUserId: targetDepartment.approver_1,
        targetHodEmail,
        targetApprover2UserId: targetDepartment.approver_2,
        targetApprover2Email,
      };
    })();
  }

  return crossDepartmentEscalationContextPromise;
}

async function resolveProxyFounderContext(): Promise<ProxyFounderContext> {
  if (!proxyFounderContextPromise) {
    proxyFounderContextPromise = (async () => {
      const client = getAdminSupabaseClient();

      const { data: founderRows, error: founderError } = await client
        .from("users")
        .select("id, email")
        .eq("email", ACTORS.employeeB.email)
        .eq("is_active", true)
        .limit(1);

      if (founderError) {
        throw new Error(`Failed to resolve founder profile: ${founderError.message}`);
      }

      const founder = founderRows?.[0];
      if (!founder?.id || !founder?.email) {
        throw new Error("Configured founder actor is not available as an active user.");
      }

      const { data: departmentRows, error: departmentError } = await client
        .from("master_departments")
        .select("id, name, approver_1, approver_2")
        .eq("is_active", true)
        .eq("approver_2", founder.id)
        .not("approver_1", "is", null)
        .limit(1);

      if (departmentError) {
        throw new Error(`Failed to resolve founder routing department: ${departmentError.message}`);
      }

      const department = departmentRows?.[0];
      if (!department?.id || !department?.name || !department?.approver_2) {
        throw new Error(
          "No active department found where founder is configured as the senior approver.",
        );
      }

      return {
        departmentId: department.id,
        departmentName: department.name,
        founderUserId: founder.id,
        founderEmail: founder.email,
        seniorApproverUserId: department.approver_2,
      };
    })();
  }

  return proxyFounderContextPromise;
}

async function getClaimRouting(
  claimId: string,
): Promise<{ assignedL1ApproverId: string; status: string; departmentId: string }> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("claims")
    .select("assigned_l1_approver_id, status, department_id")
    .eq("id", claimId)
    .eq("is_active", true)
    .limit(1);

  if (error) {
    throw new Error(`Failed to read claim routing for ${claimId}: ${error.message}`);
  }

  const row = data?.[0];
  if (!row) {
    throw new Error(`Claim ${claimId} not found in DB for routing verification.`);
  }

  return {
    assignedL1ApproverId: row.assigned_l1_approver_id,
    status: row.status,
    departmentId: row.department_id,
  };
}

function parseCurrency(value: string): number {
  const normalized = value.replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loginWithEmail(page: Page, email: string): Promise<void> {
  const loginResponse = await page.request.post("/api/auth/email-login", {
    data: {
      email,
      password: defaultPassword,
    },
  });

  if (!loginResponse.ok()) {
    const payload = (await loginResponse.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(
      `Email login failed for ${email}: ${payload?.error?.message ?? `HTTP ${loginResponse.status()}`}`,
    );
  }

  const loginPayload = (await loginResponse.json()) as {
    data?: {
      session?: {
        accessToken?: string;
        refreshToken?: string;
      };
    };
  };

  const accessToken = loginPayload.data?.session?.accessToken;
  const refreshToken = loginPayload.data?.session?.refreshToken;

  if (!accessToken || !refreshToken) {
    throw new Error(`Email login failed for ${email}: missing session tokens`);
  }

  const sessionResponse = await page.request.post("/api/auth/session", {
    data: {
      accessToken,
      refreshToken,
    },
  });

  if (!sessionResponse.ok()) {
    const payload = (await sessionResponse.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(
      `Session bootstrap failed for ${email}: ${payload?.error?.message ?? `HTTP ${sessionResponse.status()}`}`,
    );
  }

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  const errorToast = page.locator('[data-sonner-toast][data-type="error"], [role="alert"]').first();
  const walletHeading = page.getByRole("heading", { name: /wallet summary/i });
  if (await walletHeading.isVisible().catch(() => false)) {
    return;
  }

  if (await errorToast.isVisible().catch(() => false)) {
    throw new Error(await errorToast.innerText());
  }

  await expect(walletHeading).toBeVisible({ timeout: 15000 });
}

async function getAmountReceived(page: Page): Promise<number> {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /wallet summary/i })).toBeVisible();

  const amountText = await page
    .locator("article", { hasText: "Amount Received" })
    .locator("p")
    .nth(1)
    .innerText();

  return parseCurrency(amountText);
}

async function selectOptionByLabel(
  selectLocator: ReturnType<Page["getByLabel"]>,
  label: string,
): Promise<void> {
  const value = await selectLocator.evaluate((el, targetLabel) => {
    const select = el as HTMLSelectElement;
    return Array.from(select.options).find((option) => option.label === targetLabel)?.value ?? "";
  }, label);

  await selectLocator.evaluate((el, selectedValue) => {
    const select = el as HTMLSelectElement;
    select.value = selectedValue;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function submitPettyCashRequest(
  page: Page,
  input: {
    employeeId: string;
    requestedAmount: number;
    purpose: string;
    departmentName?: string;
    onBehalfEmail?: string;
    onBehalfEmployeeCode?: string;
  },
): Promise<{ claimId: string; hodEmail: string }> {
  await page.goto("/claims/new", { waitUntil: "domcontentloaded" });

  try {
    await expect(page.getByRole("button", { name: /submit claim/i })).toBeVisible({
      timeout: 10000,
    });
  } catch (error) {
    console.error("\n=== PAGE CRASH DUMP ===");
    console.error(await page.locator("body").innerText());
    console.error("=======================\n");
    await page.screenshot({ path: "empty-state-crash.png", fullPage: true });
    throw error;
  }
  if (input.onBehalfEmail && input.onBehalfEmployeeCode) {
    const submissionType = page.locator("#submissionType");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await submissionType.selectOption("On Behalf");
      const selected = await submissionType.inputValue();
      if (selected === "On Behalf") {
        break;
      }
      await page.waitForTimeout(200);
    }

    await expect(submissionType).toHaveValue("On Behalf", { timeout: 5000 });
    await expect(page.locator("#onBehalfEmail")).toBeVisible({ timeout: 15000 });
    await page.locator("#onBehalfEmail").fill(input.onBehalfEmail);
    await page.locator("#onBehalfEmployeeCode").fill(input.onBehalfEmployeeCode);
  }

  const approverEmailInput = page
    .locator("div", { hasText: /^HOD Email|^Approver Email/i })
    .locator("input")
    .first();

  const departmentSelect = page.getByRole("combobox", { name: /department/i });
  if (input.departmentName) {
    await departmentSelect.selectOption({ label: input.departmentName });
  } else {
    const values = await departmentSelect
      .locator("option")
      .evaluateAll((options) =>
        options
          .map((option) => (option as HTMLOptionElement).value)
          .filter((value) => value && value.trim().length > 0),
      );

    if (values.length < 2) {
      throw new Error("Department selector does not expose enough active options.");
    }

    await departmentSelect.selectOption(values[1]);
  }

  await page.waitForTimeout(200);
  const resolvedHodEmail = (await approverEmailInput.inputValue()).trim();

  if (!resolvedHodEmail) {
    throw new Error("No routable department/HOD found for claim submission.");
  }

  await page.locator("#employeeId").fill(input.employeeId);

  const paymentMode = page.getByLabel(/payment mode/i);
  await selectOptionByLabel(paymentMode, "Petty Cash Request");

  await page.locator("#requestedAmount").fill(String(input.requestedAmount));
  await page.locator("#expectedUsageDate").evaluate((node) => {
    const inputNode = node as HTMLInputElement;
    inputNode.value = "2026-03-20";
    inputNode.dispatchEvent(new Event("input", { bubbles: true }));
    inputNode.dispatchEvent(new Event("change", { bubbles: true }));
    inputNode.dispatchEvent(new Event("blur", { bubbles: true }));
  });
  await page.locator("#purpose").fill(input.purpose);

  const submitButton = page.getByRole("button", { name: /submit claim/i });
  await submitButton.click();

  await Promise.race([
    page
      .locator("[data-sonner-toast]", { hasText: /success|submitted/i })
      .waitFor({ state: "visible", timeout: 15000 }),
    page
      .locator(".text-destructive")
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(async () => {
        throw new Error(
          `ZOD ERROR: ${await page.locator(".text-destructive").first().innerText()}`,
        );
      }),
    page
      .locator('[data-sonner-toast][data-type="error"]')
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
      .then(async () => {
        throw new Error(
          `BACKEND ERROR: ${await page.locator('[data-sonner-toast][data-type="error"]').first().innerText()}`,
        );
      }),
  ]);

  await page.goto("/dashboard/my-claims", { waitUntil: "domcontentloaded" });
  const firstClaimLink = page.locator("tbody tr td a").first();
  await expect(firstClaimLink).toBeVisible({ timeout: 30000 });

  const claimIdFromTable = (await firstClaimLink.innerText()).trim();
  expect(claimIdFromTable).toMatch(SEMANTIC_CLAIM_ID_REGEX);
  console.info(`SEMANTIC_ID_MAP ${input.purpose} => ${claimIdFromTable}`);
  return { claimId: claimIdFromTable, hodEmail: resolvedHodEmail };
}

async function openApprovalsPage(page: Page): Promise<void> {
  await page.goto("/dashboard/my-claims?view=approvals", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /approvals history/i })).toBeVisible();
}

async function getClaimRow(page: Page, claimId: string) {
  return page.locator("tbody tr", { has: page.getByRole("link", { name: claimId }) }).first();
}

async function expectClaimVisibleInApprovals(
  page: Page,
  claimId: string,
  visible: boolean,
): Promise<void> {
  await openApprovalsPage(page);
  const row = await getClaimRow(page, claimId);

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
  await page.goto("/dashboard/my-claims", { waitUntil: "domcontentloaded" });
  const row = await getClaimRow(page, claimId);

  if (visible) {
    await expect(row).toBeVisible({ timeout: 30000 });
    return;
  }

  await expect(row).toHaveCount(0);
}

async function approveAtL1(page: Page, claimId: string): Promise<void> {
  await openApprovalsPage(page);

  const row = await getClaimRow(page, claimId);
  await expect(row).toBeVisible({ timeout: 30000 });

  await row.getByRole("button", { name: /^Approve$/i }).click();
  await page
    .getByRole("button", { name: /processing/i })
    .first()
    .waitFor({ state: "visible", timeout: 2500 })
    .catch(() => null);
  await expect(page.getByText(/Claim approved\./i)).toBeVisible({ timeout: 30000 });
}

async function approveAndMarkPaidAtFinance(page: Page, claimId: string): Promise<void> {
  await openApprovalsPage(page);

  const row = await getClaimRow(page, claimId);
  await expect(row).toBeVisible({ timeout: 30000 });

  await row.getByRole("button", { name: /^Approve$/i }).click();
  await page
    .getByRole("button", { name: /processing/i })
    .first()
    .waitFor({ state: "visible", timeout: 2500 })
    .catch(() => null);
  await expect(page.getByText(/Finance decision approved\./i)).toBeVisible({ timeout: 30000 });

  await openApprovalsPage(page);
  const paidRow = await getClaimRow(page, claimId);
  await expect(paidRow).toBeVisible({ timeout: 30000 });

  await paidRow.getByRole("button", { name: /^Paid$/i }).click();
  await page
    .getByRole("button", { name: /processing/i })
    .first()
    .waitFor({ state: "visible", timeout: 2500 })
    .catch(() => null);
  await expect(page.getByText(/Claim marked as paid\./i)).toBeVisible({ timeout: 30000 });
}

async function withActorPage<T>(
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
    if (storageStatePath) {
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

      if (/\/auth\/login/i.test(page.url())) {
        await loginWithEmail(page, email);
      }
    } else {
      await loginWithEmail(page, email);
      const discoveredStateRole =
        email.trim().toLowerCase() === ACTORS.finance.email.toLowerCase() ? "finance1" : null;
      if (discoveredStateRole) {
        registerAuthStateEmail(email, discoveredStateRole);
      }
    }
    return await work(page);
  } finally {
    try {
      await context.close();
    } catch {
      // Ignore teardown race conditions when Playwright already disposed this context.
    }
  }
}

test.describe("Claim Lifecycle Wallet Routing", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240000);

  test("standard petty cash lifecycle credits submitter wallet", async ({ browser }) => {
    const amount = 321.5;

    const beforeEmployeeAReceived = await withActorPage(
      browser,
      ACTORS.employeeA.email,
      async (page) => getAmountReceived(page),
    );

    const standardSubmission = await withActorPage(browser, ACTORS.employeeA.email, async (page) =>
      submitPettyCashRequest(page, {
        employeeId: `${ACTORS.employeeA.employeeCode}-${runTag}`,
        requestedAmount: amount,
        purpose: `STANDARD FLOW ${runTag}`,
      }),
    );

    await withActorPage(browser, standardSubmission.hodEmail, async (page) =>
      approveAtL1(page, standardSubmission.claimId),
    );
    await withActorPage(browser, ACTORS.finance.email, async (page) =>
      approveAndMarkPaidAtFinance(page, standardSubmission.claimId),
    );

    const afterEmployeeAReceived = await withActorPage(
      browser,
      ACTORS.employeeA.email,
      async (page) => getAmountReceived(page),
    );

    expect(afterEmployeeAReceived - beforeEmployeeAReceived).toBeCloseTo(amount, 2);
  });

  test("on-behalf petty cash lifecycle credits beneficiary wallet and leaves submitter unchanged", async ({
    browser,
  }) => {
    const amount = 432.75;

    const beforeEmployeeAReceived = await withActorPage(
      browser,
      ACTORS.employeeA.email,
      async (page) => getAmountReceived(page),
    );
    const beforeEmployeeBReceived = await withActorPage(
      browser,
      ACTORS.employeeB.email,
      async (page) => getAmountReceived(page),
    );

    const onBehalfSubmission = await withActorPage(browser, ACTORS.employeeA.email, async (page) =>
      submitPettyCashRequest(page, {
        employeeId: `${ACTORS.employeeA.employeeCode}-${runTag}`,
        requestedAmount: amount,
        purpose: `ON BEHALF FLOW ${runTag}`,
        onBehalfEmail: ACTORS.employeeB.email,
        onBehalfEmployeeCode: `${ACTORS.employeeB.employeeCode}-${runTag}`,
      }),
    );

    await withActorPage(browser, onBehalfSubmission.hodEmail, async (page) =>
      approveAtL1(page, onBehalfSubmission.claimId),
    );
    await withActorPage(browser, ACTORS.finance.email, async (page) =>
      approveAndMarkPaidAtFinance(page, onBehalfSubmission.claimId),
    );

    const afterEmployeeAReceived = await withActorPage(
      browser,
      ACTORS.employeeA.email,
      async (page) => getAmountReceived(page),
    );
    const afterEmployeeBReceived = await withActorPage(
      browser,
      ACTORS.employeeB.email,
      async (page) => getAmountReceived(page),
    );

    expect(afterEmployeeAReceived - beforeEmployeeAReceived).toBeCloseTo(0, 2);
    expect(afterEmployeeBReceived - beforeEmployeeBReceived).toBeCloseTo(amount, 2);
  });

  test("leapfrog routing sends HOD self-submission directly to finance", async ({ browser }) => {
    let leapfrog: LeapfrogContext;
    try {
      leapfrog = await resolveLeapfrogContext();
    } catch (error) {
      test.skip(true, `Leapfrog prerequisites unavailable: ${String(error)}`);
      return;
    }
    const amount = 111.25;

    const submission = await withActorPage(browser, leapfrog.hodEmail, async (page) =>
      submitPettyCashRequest(page, {
        employeeId: `LF-${runTag}`,
        requestedAmount: amount,
        purpose: `LEAPFROG FLOW ${runTag}`,
        departmentName: leapfrog.departmentName,
      }),
    );

    const claimRouting = await getClaimRouting(submission.claimId);

    expect(claimRouting.departmentId).toBe(leapfrog.departmentId);
    expect(claimRouting.assignedL1ApproverId).toBe(leapfrog.financeUserId);
    expect(claimRouting.assignedL1ApproverId).not.toBe(leapfrog.hodUserId);
    expect(claimRouting.status).toBe("Submitted - Awaiting HOD approval");

    await withActorPage(browser, leapfrog.hodEmail, async (page) =>
      expectClaimVisibleInApprovals(page, submission.claimId, false),
    );

    await withActorPage(browser, leapfrog.financeEmail, async (page) =>
      expectClaimVisibleInApprovals(page, submission.claimId, true),
    );
  });

  test("cross-department HOD escalation routes to target department approver_2", async ({
    browser,
  }) => {
    let context: CrossDepartmentHodEscalationContext;
    try {
      context = await resolveCrossDepartmentHodEscalationContext();
    } catch (error) {
      test.skip(true, `Cross-department prerequisites unavailable: ${String(error)}`);
      return;
    }

    console.info(
      `CROSS_DEPARTMENT_ESCALATION submitter=${context.submitterDepartmentName} target=${context.targetDepartmentName}`,
    );

    const submission = await withActorPage(browser, context.submitterHodEmail, async (page) =>
      submitPettyCashRequest(page, {
        employeeId: `XDEPT-${runTag}`,
        requestedAmount: 89.75,
        purpose: `XDEPT HOD ESCALATION ${runTag}`,
        departmentName: context.targetDepartmentName,
      }),
    );

    const claimRouting = await getClaimRouting(submission.claimId);

    expect(claimRouting.departmentId).toBe(context.targetDepartmentId);
    expect(claimRouting.assignedL1ApproverId).toBe(context.targetApprover2UserId);
    expect(claimRouting.assignedL1ApproverId).not.toBe(context.targetHodUserId);
    expect(claimRouting.status).toBe("Submitted - Awaiting HOD approval");

    await withActorPage(browser, context.targetHodEmail, async (page) =>
      expectClaimVisibleInApprovals(page, submission.claimId, false),
    );

    await withActorPage(browser, context.targetApprover2Email, async (page) =>
      expectClaimVisibleInApprovals(page, submission.claimId, true),
    );
  });

  test("PA-to-Founder proxy submission routes to founder senior approver and is visible to both users", async ({
    browser,
  }) => {
    let context: ProxyFounderContext;
    try {
      context = await resolveProxyFounderContext();
    } catch (error) {
      test.skip(true, `Proxy founder prerequisites unavailable: ${String(error)}`);
      return;
    }

    const submission = await withActorPage(browser, ACTORS.employeeA.email, async (page) =>
      submitPettyCashRequest(page, {
        employeeId: `PA2FND-${runTag}`,
        requestedAmount: 76.2,
        purpose: `PA TO FOUNDER ${runTag}`,
        departmentName: context.departmentName,
        onBehalfEmail: context.founderEmail,
        onBehalfEmployeeCode: `${ACTORS.employeeB.employeeCode}-${runTag}`,
      }),
    );

    const claimRouting = await getClaimRouting(submission.claimId);

    expect(claimRouting.departmentId).toBe(context.departmentId);
    expect(claimRouting.assignedL1ApproverId).toBe(context.seniorApproverUserId);
    expect(claimRouting.status).toBe("Submitted - Awaiting HOD approval");

    await withActorPage(browser, ACTORS.employeeA.email, async (page) =>
      expectClaimVisibleInMyClaims(page, submission.claimId, true),
    );

    await withActorPage(browser, context.founderEmail, async (page) =>
      expectClaimVisibleInMyClaims(page, submission.claimId, true),
    );

    await withActorPage(browser, context.founderEmail, async (page) =>
      expectClaimVisibleInApprovals(page, submission.claimId, true),
    );
  });
});
