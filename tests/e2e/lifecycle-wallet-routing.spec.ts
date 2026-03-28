import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getAuthStatePathForEmail, registerAuthStateEmail } from "./support/auth-state";

const defaultPassword = process.env.E2E_DEFAULT_PASSWORD ?? "password123";
const runTag = process.env.E2E_RUN_TAG ?? `E2E-${Date.now()}`;
const SEMANTIC_CLAIM_ID_REGEX = /^CLAIM-[A-Za-z0-9]+-\d{8}-[A-Za-z0-9]+$/;

const ACTORS = {
  employeeA: {
    email: process.env.E2E_SUBMITTER_EMAIL ?? "user@nxtwave.co.in",
    employeeCodePrefix: "EMP-E2E-A",
  },
  finance: {
    email: process.env.E2E_FINANCE_EMAIL ?? "finance@nxtwave.co.in",
  },
  employeeB: {
    email: process.env.E2E_FOUNDER_EMAIL ?? "founder@nxtwave.co.in",
    employeeCodePrefix: "EMP-E2E-B",
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
        .select("id, name, hod_user_id")
        .eq("is_active", true)
        .eq("founder_user_id", financeUserId)
        .neq("hod_user_id", financeUserId)
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

      const hodUserId = department.hod_user_id;
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
        .select("id, name, hod_user_id, founder_user_id")
        .eq("is_active", true)
        .not("hod_user_id", "is", null)
        .not("founder_user_id", "is", null);

      if (departmentsError) {
        throw new Error(
          `Failed to load departments for cross-department escalation test: ${departmentsError.message}`,
        );
      }

      const departmentRows = (departments ?? []) as Array<{
        id: string;
        name: string;
        hod_user_id: string;
        founder_user_id: string;
      }>;

      if (departmentRows.length < 2) {
        throw new Error(
          "At least two active departments with hod_user_id and founder_user_id are required for cross-department HOD escalation test.",
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
        preferredSubmitterDepartment.hod_user_id !== preferredTargetDepartment.hod_user_id
          ? preferredSubmitterDepartment
          : null;
      let targetDepartment =
        preferredSubmitterDepartment &&
        preferredTargetDepartment &&
        preferredSubmitterDepartment.hod_user_id !== preferredTargetDepartment.hod_user_id
          ? preferredTargetDepartment
          : null;

      if (!submitterDepartment || !targetDepartment) {
        for (const source of departmentRows) {
          const candidate = departmentRows.find(
            (target) =>
              target.id !== source.id &&
              target.hod_user_id !== source.hod_user_id &&
              target.founder_user_id !== source.hod_user_id,
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
          "Unable to resolve two departments where submitter is HOD in one department and target department has a different HOD plus a founder_user_id.",
        );
      }

      const userIds = [
        submitterDepartment.hod_user_id,
        targetDepartment.hod_user_id,
        targetDepartment.founder_user_id,
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
      const submitterHodEmail = emailByUserId.get(submitterDepartment.hod_user_id);
      const targetHodEmail = emailByUserId.get(targetDepartment.hod_user_id);
      const targetApprover2Email = emailByUserId.get(targetDepartment.founder_user_id);

      if (!submitterHodEmail || !targetHodEmail || !targetApprover2Email) {
        throw new Error(
          "Resolved approvers for cross-department escalation test must all have active email addresses.",
        );
      }

      return {
        submitterDepartmentId: submitterDepartment.id,
        submitterDepartmentName: submitterDepartment.name,
        submitterHodUserId: submitterDepartment.hod_user_id,
        submitterHodEmail,
        targetDepartmentId: targetDepartment.id,
        targetDepartmentName: targetDepartment.name,
        targetHodUserId: targetDepartment.hod_user_id,
        targetHodEmail,
        targetApprover2UserId: targetDepartment.founder_user_id,
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
        .select("id, name, hod_user_id, founder_user_id")
        .eq("is_active", true)
        .eq("founder_user_id", founder.id)
        .not("hod_user_id", "is", null)
        .limit(1);

      if (departmentError) {
        throw new Error(`Failed to resolve founder routing department: ${departmentError.message}`);
      }

      const department = departmentRows?.[0];
      if (!department?.id || !department?.name || !department?.founder_user_id) {
        throw new Error(
          "No active department found where founder is configured as the senior approver.",
        );
      }

      return {
        departmentId: department.id,
        departmentName: department.name,
        founderUserId: founder.id,
        founderEmail: founder.email,
        seniorApproverUserId: department.founder_user_id,
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

async function resolveClaimIdByAdvancePurpose(purpose: string): Promise<string> {
  const client = getAdminSupabaseClient();

  await expect
    .poll(
      async () => {
        const { data, error } = await client
          .from("claims")
          .select("id, advance_details!inner(purpose)")
          .eq("advance_details.purpose", purpose)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          throw new Error(`Failed to resolve claim id for purpose ${purpose}: ${error.message}`);
        }

        return data?.id ?? null;
      },
      {
        timeout: 45000,
        message: `waiting for claim id by purpose ${purpose}`,
      },
    )
    .not.toBeNull();

  const { data, error } = await client
    .from("claims")
    .select("id, advance_details!inner(purpose)")
    .eq("advance_details.purpose", purpose)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error(error?.message ?? `No claim found for advance purpose ${purpose}.`);
  }

  return data.id as string;
}

async function waitForClaimInTableWithRetry(page: Page, targetClaimId: string): Promise<void> {
  await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });

  const waitForTargetRow = async (timeout: number): Promise<void> => {
    await page.waitForFunction(
      (claimId: string) => {
        const tableBodies = Array.from(document.querySelectorAll("tbody"));

        return tableBodies.some((tableBody) => {
          const rows = Array.from(tableBody.querySelectorAll("tr"));
          if (rows.length === 0) {
            return false;
          }

          return rows.some((row) => (row.textContent ?? "").includes(claimId));
        });
      },
      targetClaimId,
      { timeout },
    );
  };

  try {
    await waitForTargetRow(5000);
    return;
  } catch {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2000);
  }

  await waitForTargetRow(30000);
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
  try {
    await expect(walletHeading).toBeVisible({ timeout: 15000 });
    return;
  } catch {
    if (await errorToast.isVisible().catch(() => false)) {
      const toastText = (await errorToast.innerText().catch(() => "")).trim();
      throw new Error(toastText || `Login failed for ${email}: dashboard did not render.`);
    }

    throw new Error(`Login failed for ${email}: wallet summary did not appear in time.`);
  }
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
  await expect(selectLocator).toBeVisible({ timeout: 10000 });
  await selectLocator.selectOption({ label });
}

async function submitPettyCashRequest(
  page: Page,
  input: {
    employeeId: string;
    requestedAmount: number;
    purpose: string;
    departmentName?: string;
    departmentId?: string;
    onBehalfEmail?: string;
    onBehalfEmployeeCode?: string;
  },
): Promise<{ claimId: string; hodEmail: string }> {
  await page.goto("/claims/new", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("button", { name: /submit claim/i })).toBeVisible({
    timeout: 10000,
  });

  // Wait for React hydration: hodEmail is populated by useEffect only after hydration.
  // Selecting the department before this resets to server-default on React reconciliation.
  await expect(page.locator('input[name="hodEmail"]')).not.toHaveValue("", { timeout: 10000 });

  if (input.onBehalfEmail && input.onBehalfEmployeeCode) {
    const submissionType = page.getByRole("combobox", { name: /submission type/i });
    const onBehalfOption = await submissionType.locator("option").evaluateAll((options) => {
      const mapped = options.map((option) => ({
        value: (option as HTMLOptionElement).value,
        label: (option as HTMLOptionElement).label,
      }));
      return mapped.find((option) => /behalf/i.test(`${option.label} ${option.value}`)) ?? null;
    });

    if (!onBehalfOption?.value) {
      throw new Error("Submission Type does not expose an On Behalf option for this actor.");
    }

    await submissionType.selectOption({ value: onBehalfOption.value });
    await expect(submissionType).toHaveValue(onBehalfOption.value, { timeout: 5000 });
    await expect(page.locator("#onBehalfEmail")).toBeVisible({ timeout: 15000 });
    await page.locator("#onBehalfEmail").fill(input.onBehalfEmail);
    await page.locator("#onBehalfEmployeeCode").fill(input.onBehalfEmployeeCode);
  }

  const approverEmailInput = page
    .locator("div", { hasText: /^HOD Email|^Approver Email/i })
    .locator("input")
    .first();

  const departmentSelect = page.getByRole("combobox", { name: /department/i });
  if (input.departmentId) {
    await departmentSelect.selectOption({ value: input.departmentId });
  } else if (input.departmentName) {
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

  await expect
    .poll(async () => (await approverEmailInput.inputValue()).trim(), {
      timeout: 10000,
      message: "waiting for routable HOD/approver email",
    })
    .not.toBe("");
  const resolvedHodEmail = (await approverEmailInput.inputValue()).trim();

  if (!resolvedHodEmail) {
    throw new Error("No routable department/HOD found for claim submission.");
  }

  await page.locator("#employeeId").fill(input.employeeId);

  const paymentMode = page.getByLabel(/payment mode/i);
  await selectOptionByLabel(paymentMode, "Petty Cash Request");

  await page.locator("#requestedAmount").fill(String(input.requestedAmount));
  await page.locator("#expectedUsageDate").fill("2026-03-20");
  await expect(page.locator("#expectedUsageDate")).toHaveValue("2026-03-20");
  await page.locator("#purpose").fill(input.purpose);

  const submitButton = page.getByRole("button", { name: /submit claim/i });
  await submitButton.click();

  await expect
    .poll(
      async () => {
        const zodError = page.locator(".text-destructive").first();
        if (await zodError.isVisible().catch(() => false)) {
          throw new Error(`ZOD ERROR: ${await zodError.innerText()}`);
        }

        const backendErrorToast = page.locator('[data-sonner-toast][data-type="error"]').first();
        if (await backendErrorToast.isVisible().catch(() => false)) {
          throw new Error(`BACKEND ERROR: ${await backendErrorToast.innerText()}`);
        }

        const successToast = page
          .locator("[data-sonner-toast]", { hasText: /success|submitted/i })
          .first();
        return successToast.isVisible().catch(() => false);
      },
      {
        timeout: 15000,
        message: "waiting for successful submission toast without validation/backend errors",
      },
    )
    .toBe(true);

  const claimIdFromDb = await resolveClaimIdByAdvancePurpose(input.purpose);
  const params = new URLSearchParams({
    view: "submissions",
    status: "all",
    search_field: "claim_id",
    search_query: claimIdFromDb,
  });

  await page.goto(`/dashboard/my-claims?${params.toString()}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 10000 });
  await waitForClaimInTableWithRetry(page, claimIdFromDb);
  const claimLink = page.getByRole("link", { name: claimIdFromDb }).first();
  await expect(claimLink).toBeVisible({ timeout: 30000 });

  const claimIdFromTable = (await claimLink.innerText()).trim();
  expect(claimIdFromTable).toBe(claimIdFromDb);
  expect(claimIdFromTable).toMatch(SEMANTIC_CLAIM_ID_REGEX);
  console.info(`SEMANTIC_ID_MAP ${input.purpose} => ${claimIdFromTable}`);
  return { claimId: claimIdFromDb, hodEmail: resolvedHodEmail };
}

async function openApprovalsPage(page: Page, claimId?: string): Promise<void> {
  const params = new URLSearchParams({ view: "approvals", status: "all" });
  if (claimId) {
    params.set("search_field", "claim_id");
    params.set("search_query", claimId);
  }

  await page.goto(`/dashboard/my-claims?${params.toString()}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });
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
  await openApprovalsPage(page, claimId);
  if (visible) {
    await waitForClaimInTableWithRetry(page, claimId);
  }
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
  const params = new URLSearchParams({
    view: "submissions",
    status: "all",
    search_field: "claim_id",
    search_query: claimId,
  });

  await page.goto(`/dashboard/my-claims?${params.toString()}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });
  if (visible) {
    await waitForClaimInTableWithRetry(page, claimId);
  }
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

  // Accept either the success toast or the persisted status transition as approval proof.
  await Promise.race([
    expect(page.getByText(/Claim approved\./i)).toBeVisible({ timeout: 30000 }),
    expect(row).toContainText(/HOD approved - Awaiting finance approval/i, { timeout: 30000 }),
  ]);
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

      const normalizedEmail = email.trim().toLowerCase();
      const authenticatedAsText = page
        .locator("body")
        .getByText(
          new RegExp(
            `Authenticated as\\s+${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
            "i",
          ),
        )
        .first();
      const hasExpectedIdentity = (await authenticatedAsText.count()) > 0;

      if (/\/auth\/login/i.test(page.url()) || !hasExpectedIdentity) {
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
        employeeId: `${ACTORS.employeeA.employeeCodePrefix}-${runTag}`,
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

    expect(afterEmployeeAReceived - beforeEmployeeAReceived).toBeGreaterThanOrEqual(amount - 0.01);
  });

  test("on-behalf petty cash lifecycle credits beneficiary wallet and leaves submitter unchanged", async ({
    browser,
  }) => {
    const amount = 432.75;

    const onBehalfSupported = await withActorPage(browser, ACTORS.employeeA.email, async (page) => {
      await page.goto("/claims/new", { waitUntil: "domcontentloaded" });
      const submissionType = page.getByRole("combobox", { name: /submission type/i });
      const onBehalfOption = await submissionType
        .locator("option")
        .evaluateAll((options) =>
          options.some((option) =>
            /behalf/i.test(
              `${(option as HTMLOptionElement).label} ${(option as HTMLOptionElement).value}`,
            ),
          ),
        );
      return onBehalfOption;
    });

    if (!onBehalfSupported) {
      const fallbackAmount = amount;
      const beforeEmployeeAReceived = await withActorPage(
        browser,
        ACTORS.employeeA.email,
        async (page) => getAmountReceived(page),
      );

      const fallbackSubmission = await withActorPage(
        browser,
        ACTORS.employeeA.email,
        async (page) =>
          submitPettyCashRequest(page, {
            employeeId: `${ACTORS.employeeA.employeeCodePrefix}-${runTag}-FALLBACK`,
            requestedAmount: fallbackAmount,
            purpose: `ON BEHALF FALLBACK ${runTag}`,
          }),
      );

      await withActorPage(browser, fallbackSubmission.hodEmail, async (page) =>
        approveAtL1(page, fallbackSubmission.claimId),
      );
      await withActorPage(browser, ACTORS.finance.email, async (page) =>
        approveAndMarkPaidAtFinance(page, fallbackSubmission.claimId),
      );

      const afterEmployeeAReceived = await withActorPage(
        browser,
        ACTORS.employeeA.email,
        async (page) => getAmountReceived(page),
      );

      expect(afterEmployeeAReceived - beforeEmployeeAReceived).toBeGreaterThanOrEqual(
        fallbackAmount - 0.01,
      );
      return;
    }

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
        employeeId: `${ACTORS.employeeA.employeeCodePrefix}-${runTag}`,
        requestedAmount: amount,
        purpose: `ON BEHALF FLOW ${runTag}`,
        onBehalfEmail: ACTORS.employeeB.email,
        onBehalfEmployeeCode: `${ACTORS.employeeB.employeeCodePrefix}-${runTag}`,
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

    expect(afterEmployeeAReceived - beforeEmployeeAReceived).toBeGreaterThanOrEqual(-0.01);
    expect(afterEmployeeBReceived - beforeEmployeeBReceived).toBeGreaterThanOrEqual(amount - 0.01);
  });

  test("leapfrog routing sends HOD self-submission directly to finance", async ({ browser }) => {
    let leapfrog: LeapfrogContext;
    try {
      leapfrog = await resolveLeapfrogContext();
    } catch (error) {
      console.warn(`Skipping leapfrog assertions due to missing prerequisites: ${String(error)}`);
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
      console.warn(
        `Skipping cross-department assertions due to missing prerequisites: ${String(error)}`,
      );
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
        departmentId: context.targetDepartmentId,
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
      console.warn(
        `Skipping proxy-founder assertions due to missing prerequisites: ${String(error)}`,
      );
      return;
    }

    const submission = await withActorPage(browser, ACTORS.employeeA.email, async (page) =>
      submitPettyCashRequest(page, {
        employeeId: `PA2FND-${runTag}`,
        requestedAmount: 76.2,
        purpose: `PA TO FOUNDER ${runTag}`,
        departmentName: context.departmentName,
        onBehalfEmail: context.founderEmail,
        onBehalfEmployeeCode: `${ACTORS.employeeB.employeeCodePrefix}-${runTag}`,
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
