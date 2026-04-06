import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { getAuthStatePathByRole, getDefaultSeedEmails } from "./support/auth-state";

const seedEmails = getDefaultSeedEmails();
const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "password123";

function getAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase env vars for department-viewer E2E.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let insertedViewerId: string | null = null;
let assignedDepartmentName = "";

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

async function ensureAuthenticated(page: Page, email: string) {
  await gotoWithRetry(page, "/dashboard");

  const signOutButton = page.getByRole("button", { name: /sign out/i });
  const hasSession = await signOutButton.isVisible({ timeout: 3000 }).catch(() => false);
  if (hasSession) {
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

  await gotoWithRetry(page, "/dashboard");
  await expect(page).not.toHaveURL(/\/auth\/login/i);
  await expect(signOutButton).toBeVisible({ timeout: 15000 });
}

function departmentOverviewTab(page: Page) {
  return page
    .locator('a, button, [role="tab"]')
    .filter({ hasText: /department overview/i })
    .first();
}

async function ensureSubmitterDepartmentViewerAccess() {
  const client = getAdminSupabaseClient();
  const submitterEmail = seedEmails.submitter.toLowerCase();

  const [{ data: submitter, error: submitterError }, { data: department, error: departmentError }] =
    await Promise.all([
      client
        .from("users")
        .select("id")
        .eq("email", submitterEmail)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
      client
        .from("master_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  if (submitterError || !submitter?.id) {
    throw new Error(submitterError?.message ?? `Submitter user not found: ${submitterEmail}`);
  }

  if (departmentError || !department?.id || !department?.name) {
    throw new Error(departmentError?.message ?? "No active department found.");
  }

  assignedDepartmentName = String(department.name);

  const { data: existingViewer, error: existingError } = await client
    .from("department_viewers")
    .select("id")
    .eq("user_id", submitter.id)
    .eq("department_id", department.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existingViewer?.id) {
    return;
  }

  const { data: inserted, error: insertError } = await client
    .from("department_viewers")
    .insert({ user_id: submitter.id, department_id: department.id, is_active: true })
    .select("id")
    .single();

  if (insertError || !inserted?.id) {
    throw new Error(insertError?.message ?? "Failed to create department viewer access.");
  }

  insertedViewerId = inserted.id;
}

test.describe("department viewer claims", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: getAuthStatePathByRole("submitter") });

  test.beforeAll(async () => {
    await ensureSubmitterDepartmentViewerAccess();
  });

  test.afterAll(async () => {
    if (!insertedViewerId) {
      return;
    }

    const client = getAdminSupabaseClient();
    await client.from("department_viewers").delete().eq("id", insertedViewerId);
  });

  test("shows Department Overview tab and renders assigned claims section", async ({ page }) => {
    await ensureAuthenticated(page, seedEmails.submitter);
    await gotoWithRetry(page, "/dashboard/my-claims");

    const tab = departmentOverviewTab(page);
    await expect(tab).toBeVisible({ timeout: 10000 });
    await tab.click();

    await expect(page).toHaveURL(/view=department/);
    await expect(page.getByRole("heading", { name: /department overview/i })).toBeVisible();
    await expect(page.getByText(/assigned claims/i)).toBeVisible();
  });

  test("filters by assigned department in department overview", async ({ page }) => {
    await ensureAuthenticated(page, seedEmails.submitter);
    await gotoWithRetry(page, "/dashboard/my-claims?view=department");

    await page.getByRole("button", { name: /filters/i }).click();
    await page.getByLabel("Department").selectOption({ label: assignedDepartmentName });

    await expect(page).toHaveURL(/view=department/);
    await expect(page).toHaveURL(/department_id=/);
  });

  test("department scope can trigger export from filter bar", async ({ page }) => {
    await ensureAuthenticated(page, seedEmails.submitter);
    await gotoWithRetry(page, "/dashboard/my-claims?view=department");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /export excel/i }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
  });
});
