/**
 * Navigation / Filter Stability (NAV) + Finance Edit (FIN) tests
 *
 * NAV-1: Search debounce & URL sync without layout unmount
 * NAV-2: Status filter updates URL and refreshes table
 * FIN-1: Finance edit updates amount, toggles GST, verifies save toast
 */
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { getAuthStatePathForEmail, registerAuthStateEmail } from "./support/auth-state";

const defaultPassword = process.env.E2E_DEFAULT_PASSWORD ?? "password123";
const runTag = process.env.E2E_RUN_TAG ?? `NAV-FIN-${Date.now()}`;
const RECEIPT_PATH = path.resolve(process.cwd(), "tests/fixtures/dummy-receipt.pdf");

const ACTORS = {
  employee: {
    email: process.env.E2E_SUBMITTER_EMAIL ?? "user@nxtwave.co.in",
    employeeCodePrefix: "EMP-E2E-NAV",
  },
  founder: {
    email: process.env.E2E_FOUNDER_EMAIL ?? "founder@nxtwave.co.in",
  },
  finance: {
    email: process.env.E2E_FINANCE_EMAIL ?? "finance@nxtwave.co.in",
  },
} as const;

let insertedFounderAdminId: string | null = null;

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
    data: { accessToken, refreshToken },
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
  const walletHeading = page.getByRole("heading", { name: /wallet summary/i });
  await expect(walletHeading).toBeVisible({ timeout: 15000 });
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
      await gotoWithRetry(page, "/dashboard");
      await acceptPolicyGateIfPresent(page);

      const signOutButton = page.getByRole("button", { name: /sign out/i });
      const hasSession =
        !/\/auth\/login/i.test(page.url()) &&
        (await signOutButton.isVisible({ timeout: 3000 }).catch(() => false));

      if (!hasSession) {
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
      // Ignore teardown race conditions.
    }
  }
}

async function selectOptionByLabel(
  selectLocator: ReturnType<Page["getByLabel"]>,
  label: string,
): Promise<void> {
  await expect(selectLocator).toBeVisible({ timeout: 10000 });
  await selectLocator.selectOption({ label });
}

async function resolveDepartmentAndCategory(): Promise<{
  departmentName: string;
  expenseCategoryName: string;
}> {
  const client = getAdminSupabaseClient();

  const { data: departments, error: deptError } = await client
    .from("master_departments")
    .select("name")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (deptError || !departments?.name) {
    throw new Error(
      `Failed to resolve active department: ${deptError?.message ?? "no rows returned"}`,
    );
  }

  const { data: category, error: catError } = await client
    .from("master_expense_categories")
    .select("name")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (catError || !category?.name) {
    throw new Error(
      `Failed to resolve active expense category: ${catError?.message ?? "no rows returned"}`,
    );
  }

  return {
    departmentName: String(departments.name),
    expenseCategoryName: String(category.name),
  };
}

/**
 * Submit a reimbursement claim and return the semantic claim ID.
 */
async function submitReimbursementClaim(
  page: Page,
  options: {
    departmentName: string;
    expenseCategoryName: string;
    marker: string;
    amount: number;
  },
): Promise<string> {
  const { departmentName, expenseCategoryName, marker, amount } = options;

  await gotoWithRetry(page, "/claims/new");

  const hydrationBanner = page.getByText(/unable to load claim form data/i);
  if ((await hydrationBanner.count()) > 0) {
    await loginWithEmail(page, ACTORS.employee.email);
    await gotoWithRetry(page, "/claims/new");
  }

  await expect(page.getByRole("heading", { name: /new claim/i })).toBeVisible({ timeout: 15000 });

  const departmentSelect = page.getByRole("combobox", { name: /department/i });
  await selectOptionByLabel(departmentSelect, departmentName);
  await selectOptionByLabel(page.getByLabel(/payment mode/i), "Reimbursement");
  await selectOptionByLabel(page.getByLabel(/expense category/i), expenseCategoryName);

  await page.locator("#employeeId").fill(`EMP-${marker}`);
  await page.locator("#billNo").fill(`BILL-${marker}`);
  await page.locator("#expensePurpose").fill(`NAV-FIN-PURPOSE-${marker}`);
  await page.locator("#transactionDate").fill("2026-03-24");
  await page.locator("#basicAmount").fill(String(amount));
  await page.locator("#receiptFile").setInputFiles(RECEIPT_PATH);

  await page.getByRole("button", { name: /submit claim/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/my-claims(?:\?|$)/, { timeout: 30000 });
  await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });

  const firstClaimLink = page.locator("tbody tr td a").first();
  await expect(firstClaimLink).toBeVisible({ timeout: 30000 });
  return (await firstClaimLink.innerText()).trim();
}

/**
 * Push the claim from L1 to Finance stage via direct DB status update (test helper shortcut).
 */
async function fastForwardToFinance(claimId: string): Promise<void> {
  const client = getAdminSupabaseClient();

  // assigned_l2_approver_id references master_finance_approvers.id (not users.id).
  const { data: financeRows, error: financeError } = await client
    .from("master_finance_approvers")
    .select("id")
    .eq("is_active", true)
    .order("is_primary", { ascending: false })
    .limit(1);

  if (financeError || !financeRows?.[0]?.id) {
    throw new Error(
      `Failed to resolve finance approver: ${financeError?.message ?? "no rows returned"}`,
    );
  }

  const financeApproverId = financeRows[0].id;

  const { error: updateError } = await client
    .from("claims")
    .update({
      status: "HOD approved - Awaiting finance approval",
      assigned_l2_approver_id: financeApproverId,
    })
    .eq("id", claimId)
    .eq("is_active", true);

  if (updateError) {
    throw new Error(`Failed to fast-forward claim ${claimId} to finance: ${updateError.message}`);
  }
}

async function ensureFounderAdminAccess(): Promise<void> {
  const client = getAdminSupabaseClient();
  const founderEmail = ACTORS.founder.email.trim().toLowerCase();

  const { data: founderUser, error: founderError } = await client
    .from("users")
    .select("id")
    .eq("email", founderEmail)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (founderError || !founderUser?.id) {
    throw new Error(founderError?.message ?? `Founder user not found: ${founderEmail}`);
  }

  const { data: existingAdmin, error: existingError } = await client
    .from("admins")
    .select("id")
    .eq("user_id", founderUser.id)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existingAdmin?.id) {
    return;
  }

  const { data: insertedAdmin, error: insertError } = await client
    .from("admins")
    .insert({ user_id: founderUser.id })
    .select("id")
    .single();

  if (insertError || !insertedAdmin?.id) {
    throw new Error(insertError?.message ?? "Failed to insert founder admin row.");
  }

  insertedFounderAdminId = insertedAdmin.id;
}

test.describe("Navigation Filter Stability & Finance Edit", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240000);

  let departmentName: string;
  let expenseCategoryName: string;

  test.beforeAll(async () => {
    const resolved = await resolveDepartmentAndCategory();
    departmentName = resolved.departmentName;
    expenseCategoryName = resolved.expenseCategoryName;
    await ensureFounderAdminAccess();
  });

  test.afterAll(async () => {
    if (!insertedFounderAdminId) {
      return;
    }

    const client = getAdminSupabaseClient();
    await client.from("admins").delete().eq("id", insertedFounderAdminId);
  });

  test("NAV-1: search debounce updates URL params without unmounting layout", async ({
    browser,
  }) => {
    await withActorPage(browser, ACTORS.employee.email, async (page) => {
      await gotoWithRetry(page, "/dashboard/my-claims");

      // Verify the heading and filter bar are present
      const heading = page.getByRole("heading", { name: /my claims|submissions/i }).first();
      await expect(heading).toBeVisible({ timeout: 15000 });

      // Type in the search input (name="search_query" per spec, but locator by placeholder/role)
      const searchInput = page.getByRole("textbox").first();

      // If the search input is not immediately visible, expand filters
      if (!(await searchInput.isVisible().catch(() => false))) {
        const toggleButton = page.getByRole("button", { name: /toggle filters/i });
        if (await toggleButton.isVisible().catch(() => false)) {
          await toggleButton.click();
          await page.waitForTimeout(300);
        }
      }

      await expect(searchInput).toBeVisible({ timeout: 10000 });

      const searchTerm = `UNIQUE-NAV-${runTag}`;
      await searchInput.fill(searchTerm);

      // The heading should NEVER unmount during the debounce + server fetch cycle
      await expect(heading).toBeVisible();

      // Wait for debounce (400ms) + URL update
      await expect
        .poll(
          () => {
            const url = new URL(page.url());
            return url.searchParams.get("search_query");
          },
          {
            timeout: 10000,
            message: "waiting for search_query URL param to appear after debounce",
          },
        )
        .toBe(searchTerm);

      // The layout heading must still be visible (no unmount)
      await expect(heading).toBeVisible();

      // Verify cursor params are cleared on search
      const url = new URL(page.url());
      expect(url.searchParams.has("cursor")).toBe(false);
      expect(url.searchParams.has("prevCursor")).toBe(false);
    });
  });

  test("NAV-2: status filter updates URL and table reflects filtered state", async ({
    browser,
  }) => {
    // First submit a claim so there's data to filter
    const claimId = await withActorPage(browser, ACTORS.employee.email, async (page) => {
      return submitReimbursementClaim(page, {
        departmentName,
        expenseCategoryName,
        marker: `NAV2-${runTag}`,
        amount: 200,
      });
    });

    await withActorPage(browser, ACTORS.employee.email, async (page) => {
      await gotoWithRetry(page, "/dashboard/my-claims");
      await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });

      // Expand filters if collapsed
      const toggleButton = page.getByRole("button", { name: /toggle filters/i });
      if (await toggleButton.isVisible().catch(() => false)) {
        const isExpanded = await toggleButton.getAttribute("aria-expanded");
        if (isExpanded !== "true") {
          await toggleButton.click();
          await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });
        }
      }

      // Select a specific status filter
      const statusSelect = page.getByRole("combobox", { name: /^Status$/i });
      await expect(statusSelect).toBeVisible({ timeout: 10000 });

      await statusSelect.selectOption({ label: "Submitted - Awaiting HOD approval" });
      await expect(page.locator(".animate-pulse")).not.toBeVisible({ timeout: 15000 });

      // Wait for URL to reflect the status param
      await expect
        .poll(
          () => {
            const url = new URL(page.url());
            return url.searchParams.get("status");
          },
          {
            timeout: 15000,
            message: "waiting for status URL param to be set",
          },
        )
        .toBeTruthy();

      // The table should still be rendered (not unmounted)
      const tableBody = page.locator("tbody").first();
      await expect(tableBody).toBeVisible({ timeout: 15000 });

      // Verify the "Active" filter badge is shown
      await expect(page.getByText("Active")).toBeVisible({ timeout: 5000 });

      // The submitted claim should appear since it's in "Submitted - Awaiting HOD approval"
      const claimLink = page.getByRole("link", { name: claimId });
      await expect(claimLink).toBeVisible({ timeout: 15000 });

      // Clear filters and verify URL cleans up
      const clearButton = page.getByRole("button", { name: /clear all/i });
      if (await clearButton.isVisible().catch(() => false)) {
        await clearButton.click();

        await expect
          .poll(
            () => {
              const url = new URL(page.url());
              return url.searchParams.has("status");
            },
            {
              timeout: 10000,
              message: "waiting for status URL param to be cleared",
            },
          )
          .toBe(false);
      }
    });
  });

  test("FIN-1: finance edit updates amount, toggles GST, and saves via toast confirmation", async ({
    browser,
  }) => {
    // Submit a claim first
    const claimId = await withActorPage(browser, ACTORS.employee.email, async (page) => {
      return submitReimbursementClaim(page, {
        departmentName,
        expenseCategoryName,
        marker: `FIN1-${runTag}`,
        amount: 500,
      });
    });

    // Fast-forward the claim to finance stage so finance user can access edit
    await fastForwardToFinance(claimId);

    // Login as finance and navigate to claim detail page
    await withActorPage(browser, ACTORS.finance.email, async (page) => {
      await gotoWithRetry(page, `/dashboard/claims/${claimId}?view=approvals`);

      // Verify we're on the claim detail page
      await expect(page.getByText(claimId)).toBeVisible({ timeout: 15000 });

      // Click "Edit Claim" to open the edit form
      const editButton = page.getByRole("button", { name: /edit claim/i });
      await expect(editButton).toBeVisible({ timeout: 10000 });
      await editButton.click();

      // Wait for the finance edit form to render
      const formHeading = page.getByText("Edit Claim");
      await expect(formHeading).toBeVisible({ timeout: 10000 });

      // Update basic amount
      const basicAmountInput = page.locator('input[name="basicAmount"]');
      await expect(basicAmountInput).toBeVisible();
      await basicAmountInput.clear();
      await basicAmountInput.fill("750");

      // Toggle GST to "Yes"
      const gstSelect = page.locator('select[name="isGstApplicable"]');
      await expect(gstSelect).toBeVisible();
      await gstSelect.selectOption({ value: "true" });

      // Fill GST amounts
      const cgstInput = page.locator('input[name="cgstAmount"]');
      await expect(cgstInput).toBeVisible();
      await cgstInput.clear();
      await cgstInput.fill("67.50");

      const sgstInput = page.locator('input[name="sgstAmount"]');
      await expect(sgstInput).toBeVisible();
      await sgstInput.clear();
      await sgstInput.fill("67.50");

      // Update total amount
      const totalAmountInput = page.locator('input[name="totalAmount"]');
      await expect(totalAmountInput).toBeVisible();
      await totalAmountInput.clear();
      await totalAmountInput.fill("885");

      // Submit the finance edit form
      const saveButton = page.getByRole("button", { name: /save claim edits/i });
      await expect(saveButton).toBeVisible();
      await saveButton.click();

      // Wait for the success toast
      await expect(page.getByText("Claim edits saved.")).toBeVisible({ timeout: 30000 });

      // The edit form should close after success (isOpen → false)
      await expect(page.getByRole("button", { name: /edit claim/i })).toBeVisible({
        timeout: 10000,
      });

      // Verify the updated amounts are reflected on the detail page
      // The total amount should now show ₹885.00 on the page
      await expect(page.getByText(/^₹885\.00$/).first()).toBeVisible({ timeout: 10000 });
    });

    // Verify the DB was updated correctly
    const client = getAdminSupabaseClient();
    const { data, error } = await client
      .from("expense_details")
      .select("basic_amount, cgst_amount, sgst_amount, total_amount")
      .eq("claim_id", claimId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(Number(data!.basic_amount)).toBe(750);
    expect(Number(data!.cgst_amount)).toBe(67.5);
    expect(Number(data!.sgst_amount)).toBe(67.5);
    expect(Number(data!.total_amount)).toBe(885);
  });

  test("NAV-3: advanced filters are admin-only and apply/reset URL keys", async ({ browser }) => {
    await withActorPage(browser, ACTORS.employee.email, async (page) => {
      await gotoWithRetry(page, "/dashboard/my-claims");
      await expect(page.getByRole("button", { name: /advanced filters/i })).toHaveCount(0);
    });

    await withActorPage(browser, ACTORS.founder.email, async (page) => {
      await gotoWithRetry(page, "/dashboard/my-claims?view=admin");

      await expect(
        page.getByRole("heading", { name: /admin overview\s*[\u2014-]\s*all claims/i }),
      ).toBeVisible({ timeout: 15000 });

      const advancedTrigger = page.getByRole("button", { name: /advanced filters/i });
      await expect(advancedTrigger).toBeVisible({ timeout: 10000 });
      await advancedTrigger.click();

      await expect(page.getByRole("heading", { name: /advanced filters/i })).toBeVisible({
        timeout: 10000,
      });

      const advancedDialog = page.getByRole("dialog");

      const submittedDateSection = advancedDialog.locator("section", {
        hasText: /Submitted Date/i,
      });
      await submittedDateSection.getByLabel(/^From$/i).fill("2026-03-01");

      const financeDateSection = advancedDialog.locator("section", {
        hasText: /Finance Action Date/i,
      });
      await financeDateSection.getByLabel(/^To$/i).fill("2026-03-30");

      await advancedDialog.getByLabel(/Min Amount/i).fill("100");
      await advancedDialog.getByLabel(/Max Amount/i).fill("500");

      await advancedDialog.getByRole("button", { name: /apply/i }).click();

      await expect
        .poll(() => {
          const url = new URL(page.url());
          return {
            advSubFrom: url.searchParams.get("adv_sub_from"),
            advFinTo: url.searchParams.get("adv_fin_to"),
            minAmt: url.searchParams.get("min_amt"),
            maxAmt: url.searchParams.get("max_amt"),
            hasDateTarget: url.searchParams.has("date_target"),
            hasFrom: url.searchParams.has("from"),
            hasTo: url.searchParams.has("to"),
          };
        })
        .toEqual({
          advSubFrom: "2026-03-01",
          advFinTo: "2026-03-30",
          minAmt: "100",
          maxAmt: "500",
          hasDateTarget: false,
          hasFrom: false,
          hasTo: false,
        });

      await advancedTrigger.click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /reset advanced/i })
        .click();

      await expect
        .poll(() => {
          const url = new URL(page.url());
          return {
            hasAdvSubFrom: url.searchParams.has("adv_sub_from"),
            hasAdvFinTo: url.searchParams.has("adv_fin_to"),
            hasMinAmt: url.searchParams.has("min_amt"),
            hasMaxAmt: url.searchParams.has("max_amt"),
          };
        })
        .toEqual({
          hasAdvSubFrom: false,
          hasAdvFinTo: false,
          hasMinAmt: false,
          hasMaxAmt: false,
        });
    });
  });
});
