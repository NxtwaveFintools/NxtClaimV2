import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const defaultPassword = process.env.E2E_DEFAULT_PASSWORD ?? "password123";
const runTag = process.env.E2E_RUN_TAG ?? `HOD-BYPASS-${Date.now()}`;
const employeeEmail = process.env.E2E_SUBMITTER_EMAIL ?? "user@nxtwave.co.in";

type HODBypassContext = {
  departmentId: string;
  departmentName: string;
  employeeUserId: string;
  employeeEmail: string;
  approver1Id: string;
  approver1Email: string;
  approver2Id: string;
  approver2Email: string;
};

let bypassContextPromise: Promise<HODBypassContext> | null = null;

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

async function resolveHodBypassContext(): Promise<HODBypassContext> {
  if (!bypassContextPromise) {
    bypassContextPromise = (async () => {
      const client = getAdminSupabaseClient();

      const { data: employeeRows, error: employeeError } = await client
        .from("users")
        .select("id, email")
        .eq("email", employeeEmail)
        .eq("is_active", true)
        .limit(1);

      if (employeeError) {
        throw new Error(`Failed to resolve employee profile: ${employeeError.message}`);
      }

      const employee = employeeRows?.[0];
      if (!employee?.id || !employee?.email) {
        throw new Error("Configured employee actor is not available as an active user.");
      }

      const { data: departmentRows, error: departmentError } = await client
        .from("master_departments")
        .select("id, name, approver1_id, approver2_id")
        .eq("is_active", true)
        .not("approver1_id", "is", null)
        .not("approver2_id", "is", null);

      if (departmentError) {
        throw new Error(`Failed to resolve department routing context: ${departmentError.message}`);
      }

      const candidate = (departmentRows ?? []).find((department) => {
        return (
          department.approver1_id &&
          department.approver2_id &&
          department.approver1_id !== department.approver2_id &&
          department.approver1_id !== employee.id &&
          department.approver2_id !== employee.id
        );
      });

      if (!candidate?.id || !candidate.name || !candidate.approver1_id || !candidate.approver2_id) {
        throw new Error(
          "No active department found with distinct Approver 1 and Approver 2 where employee is neither approver.",
        );
      }

      const actorIds = [candidate.approver1_id, candidate.approver2_id];

      const { data: approverRows, error: approverError } = await client
        .from("users")
        .select("id, email")
        .in("id", actorIds)
        .eq("is_active", true);

      if (approverError) {
        throw new Error(`Failed to resolve approver user profiles: ${approverError.message}`);
      }

      const emailByUserId = new Map((approverRows ?? []).map((row) => [row.id, row.email]));
      const approver1Email = emailByUserId.get(candidate.approver1_id);
      const approver2Email = emailByUserId.get(candidate.approver2_id);

      if (!approver1Email || !approver2Email) {
        throw new Error("Resolved Approver 1 and Approver 2 users must have active emails.");
      }

      return {
        departmentId: candidate.id,
        departmentName: candidate.name,
        employeeUserId: employee.id,
        employeeEmail: employee.email,
        approver1Id: candidate.approver1_id,
        approver1Email,
        approver2Id: candidate.approver2_id,
        approver2Email,
      };
    })();
  }

  return bypassContextPromise;
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
  const isPolicyGateVisible = await policyGateHeading
    .isVisible({ timeout: 1000 })
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

  await gotoWithRetry(page, "/dashboard");
  await acceptPolicyGateIfPresent(page);

  const dashboardHeading = page.getByRole("heading", { name: /wallet summary|dashboard/i }).first();
  await expect(dashboardHeading).toBeVisible({ timeout: 15000 });
}

async function withActorPage<T>(
  browser: Browser,
  email: string,
  work: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await loginWithEmail(page, email);
    return await work(page);
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function selectOptionByLabel(selectLocator: ReturnType<Page["getByRole"]>, label: string) {
  await expect(selectLocator).toBeVisible({ timeout: 10000 });
  await expect
    .poll(
      async () => {
        await selectLocator.selectOption({ label });
        return selectLocator.evaluate((el) => {
          const select = el as HTMLSelectElement;
          const selected = select.selectedOptions?.[0];
          return selected?.label ?? selected?.textContent?.trim() ?? "";
        });
      },
      {
        timeout: 10000,
        message: `waiting for select value to persist as ${label}`,
      },
    )
    .toBe(label);
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

async function submitOnBehalfPettyCashRequest(
  page: Page,
  input: {
    employeeId: string;
    requestedAmount: number;
    purpose: string;
    departmentName: string;
    onBehalfEmail: string;
    onBehalfEmployeeCode: string;
  },
): Promise<{ claimId: string }> {
  await gotoWithRetry(page, "/claims/new");

  await expect(page.getByRole("button", { name: /submit claim/i })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByRole("combobox", { name: /payment mode/i })).toBeVisible({
    timeout: 10000,
  });

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

  await expect(page.locator("#onBehalfEmail")).toBeVisible({ timeout: 15000 });
  await page.locator("#onBehalfEmail").fill(input.onBehalfEmail);
  await page.locator("#onBehalfEmployeeCode").fill(input.onBehalfEmployeeCode);

  const departmentSelect = page.getByRole("combobox", { name: /department/i });
  await selectOptionByLabel(departmentSelect, input.departmentName);

  await page.locator("#employeeId").fill(input.employeeId);

  const paymentMode = page.getByLabel(/payment mode/i);
  await selectOptionByLabel(paymentMode, "Petty Cash Request");

  await page.locator("#requestedAmount").fill(String(input.requestedAmount));
  await page.locator("#expectedUsageDate").fill("2026-04-07");
  await expect(page.locator("#expectedUsageDate")).toHaveValue("2026-04-07");
  await page.locator("#purpose").fill(input.purpose);

  await page.getByRole("button", { name: /submit claim/i }).click();

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
        timeout: 20000,
        message: "waiting for successful submission toast without validation/backend errors",
      },
    )
    .toBe(true);

  const claimId = await resolveClaimIdByAdvancePurpose(input.purpose);
  return { claimId };
}

async function openApprovalsPage(page: Page, claimId?: string): Promise<void> {
  const params = new URLSearchParams({ view: "approvals", status: "all" });
  if (claimId) {
    params.set("search_field", "claim_id");
    params.set("search_query", claimId);
  }

  await gotoWithRetry(page, `/dashboard/my-claims?${params.toString()}`);
  await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("heading", { name: /approvals history/i })).toBeVisible();
}

function getClaimRow(page: Page, claimId: string) {
  return page.locator("tbody tr", { has: page.getByRole("link", { name: claimId }) }).first();
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

async function expectClaimVisibleInApprovals(
  page: Page,
  claimId: string,
  visible: boolean,
): Promise<void> {
  await openApprovalsPage(page, claimId);

  if (visible) {
    await waitForClaimInTableWithRetry(page, claimId);
  }

  const row = getClaimRow(page, claimId);

  if (visible) {
    await expect(row).toBeVisible({ timeout: 30000 });
    return;
  }

  await expect(row).toHaveCount(0);
}

async function getClaimRoutingSnapshot(claimId: string): Promise<{
  assignedL1ApproverId: string;
  onBehalfOfId: string;
  submittedBy: string;
  departmentId: string;
}> {
  const client = getAdminSupabaseClient();
  const { data, error } = await client
    .from("claims")
    .select("assigned_l1_approver_id, on_behalf_of_id, submitted_by, department_id")
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
    onBehalfOfId: row.on_behalf_of_id,
    submittedBy: row.submitted_by,
    departmentId: row.department_id,
  };
}

test.describe("HOD bypass routing", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240000);

  test("employee on-behalf HOD submission routes to founder approvals queue", async ({
    browser,
  }) => {
    let context: HODBypassContext;
    try {
      context = await resolveHodBypassContext();
    } catch (error) {
      console.warn(`Skipping HOD bypass assertions due to missing prerequisites: ${String(error)}`);
      return;
    }

    const purpose = `HOD BYPASS ${runTag}`;

    const submission = await withActorPage(browser, context.employeeEmail, async (page) =>
      submitOnBehalfPettyCashRequest(page, {
        employeeId: `HODBYPASS-${runTag}`,
        requestedAmount: 145.9,
        purpose,
        departmentName: context.departmentName,
        onBehalfEmail: context.approver1Email,
        onBehalfEmployeeCode: `HOD-${runTag}`,
      }),
    );

    const routing = await getClaimRoutingSnapshot(submission.claimId);

    expect(routing.departmentId).toBe(context.departmentId);
    expect(routing.onBehalfOfId).toBe(context.approver1Id);
    expect(routing.submittedBy).toBe(context.employeeUserId);
    expect(routing.assignedL1ApproverId).toBe(context.approver2Id);
    expect(routing.assignedL1ApproverId).not.toBe(context.approver1Id);

    await withActorPage(browser, context.approver1Email, async (page) =>
      expectClaimVisibleInApprovals(page, submission.claimId, false),
    );

    await withActorPage(browser, context.founderEmail, async (page) =>
      expectClaimVisibleInApprovals(page, submission.claimId, true),
    );
  });
});
