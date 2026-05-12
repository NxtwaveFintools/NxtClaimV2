import { test, expect, type Locator, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { getAuthStatePathByRole } from "../support/auth-state";

loadEnvConfig(process.cwd());

const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "password123";
const SUBMITTER_EMAIL = process.env.E2E_SUBMITTER_EMAIL ?? "user@nxtwave.co.in";

const DEACTIVATED_PRODUCT_NAMES = [
  "NIAT Application",
  "NIAT DS Transport",
  "NxtWave Abroad Service",
  "NxtWave Abroad Commission",
  "NIFA",
] as const;

const ACTIVE_PRODUCT_NAMES = ["Academy Online", "Common", "Intensive Online"] as const;

type RuntimeFormOptions = {
  reimbursementPaymentModeName: string;
  departmentOptionLabel: string;
  locationOptionLabel: string;
};

let runtimeFormOptionsPromise: Promise<RuntimeFormOptions> | null = null;

function getAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables for migration-state-validation E2E.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function resolvePreferredActiveOption(
  tableName: "master_departments" | "master_locations",
  preferredName: string,
): Promise<string> {
  const client = getAdminSupabaseClient();

  const { data: preferredRow, error: preferredError } = await client
    .from(tableName)
    .select("name")
    .eq("is_active", true)
    .eq("name", preferredName)
    .limit(1)
    .maybeSingle();

  if (preferredError) {
    throw new Error(`Failed to query ${tableName}: ${preferredError.message}`);
  }

  if (preferredRow?.name) {
    return preferredRow.name;
  }

  const { data: fallbackRow, error: fallbackError } = await client
    .from(tableName)
    .select("name")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fallbackError || !fallbackRow?.name) {
    throw new Error(
      fallbackError?.message ??
        `No active rows available in ${tableName} for claim form validation.`,
    );
  }

  return fallbackRow.name;
}

async function resolveRuntimeFormOptions(): Promise<RuntimeFormOptions> {
  if (!runtimeFormOptionsPromise) {
    runtimeFormOptionsPromise = (async () => {
      const client = getAdminSupabaseClient();

      const { data: reimbursementPaymentMode, error: reimbursementError } = await client
        .from("master_payment_modes")
        .select("name")
        .eq("is_active", true)
        .ilike("name", "%reimbursement%")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (reimbursementError || !reimbursementPaymentMode?.name) {
        throw new Error(
          reimbursementError?.message ?? "No active reimbursement payment mode found for E2E.",
        );
      }

      const [departmentOptionLabel, locationOptionLabel] = await Promise.all([
        resolvePreferredActiveOption("master_departments", "Pre-Sales"),
        resolvePreferredActiveOption("master_locations", "Presales-Bangalore"),
      ]);

      return {
        reimbursementPaymentModeName: reimbursementPaymentMode.name,
        departmentOptionLabel,
        locationOptionLabel,
      };
    })();
  }

  return runtimeFormOptionsPromise;
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

async function ensureAuthenticated(page: Page, email: string): Promise<void> {
  await gotoWithRetry(page, "/dashboard");
  await acceptPolicyGateIfPresent(page);

  const signOutButton = page.getByRole("button", { name: /sign out/i });
  const hasSession =
    !/\/auth\/login/i.test(page.url()) &&
    (await signOutButton.isVisible({ timeout: 3000 }).catch(() => false));

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
  await acceptPolicyGateIfPresent(page);
  await expect(page).not.toHaveURL(/\/auth\/login/i);
  await expect(signOutButton).toBeVisible({ timeout: 15000 });
}

async function openClaimForm(page: Page): Promise<void> {
  await ensureAuthenticated(page, SUBMITTER_EMAIL);
  await gotoWithRetry(page, "/claims/new");
  await acceptPolicyGateIfPresent(page);

  const hydrationBanner = page.getByText(/unable to load claim form data/i);
  if ((await hydrationBanner.count()) > 0) {
    await ensureAuthenticated(page, SUBMITTER_EMAIL);
    await gotoWithRetry(page, "/claims/new");
    await acceptPolicyGateIfPresent(page);
  }

  await expect(page.getByRole("heading", { name: /new claim/i })).toBeVisible({
    timeout: 15000,
  });
  await expect(hydrationBanner).toHaveCount(0);
  await expect(page.getByRole("button", { name: /submit claim/i })).toBeVisible();
}

async function selectOptionByLabel(page: Page, label: string | RegExp, optionLabel: string) {
  const select = page.getByRole("combobox", {
    name: typeof label === "string" ? new RegExp(label, "i") : label,
  });

  await expect(select).toBeVisible();
  await expect
    .poll(
      async () => {
        await select.selectOption({ label: optionLabel });
        return select.evaluate((el) => {
          const selectEl = el as HTMLSelectElement;
          const selected = selectEl.selectedOptions?.[0];
          return selected?.label ?? selected?.textContent?.trim() ?? "";
        });
      },
      {
        timeout: 10000,
        message: `waiting for select value to persist as ${optionLabel}`,
      },
    )
    .toBe(optionLabel);
}

async function getSelectOptionLabels(select: Locator): Promise<string[]> {
  return select
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => option.textContent?.trim() ?? "").filter((label) => label.length > 0),
    );
}

test.describe("Claim Form Migration State Validation", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: getAuthStatePathByRole("submitter") });
  test.setTimeout(90000);

  test.beforeAll(async () => {
    await resolveRuntimeFormOptions();
  });

  test("hides deactivated products while keeping active products visible", async ({ page }) => {
    const runtimeOptions = await resolveRuntimeFormOptions();

    await openClaimForm(page);
    await selectOptionByLabel(page, /payment mode/i, runtimeOptions.reimbursementPaymentModeName);

    const productSelect = page.locator("#expenseProductId");
    await expect(productSelect).toBeVisible();

    await expect
      .poll(async () => (await getSelectOptionLabels(productSelect)).length, {
        timeout: 10000,
        message: "waiting for product options to populate",
      })
      .toBeGreaterThan(0);

    const productLabels = await getSelectOptionLabels(productSelect);

    for (const productName of ACTIVE_PRODUCT_NAMES) {
      expect(productLabels).toContain(productName);
    }

    for (const productName of DEACTIVATED_PRODUCT_NAMES) {
      expect(productLabels).not.toContain(productName);
    }
  });

  test("department and location dropdowns populate and remain selectable", async ({ page }) => {
    const runtimeOptions = await resolveRuntimeFormOptions();

    await openClaimForm(page);
    await selectOptionByLabel(page, /payment mode/i, runtimeOptions.reimbursementPaymentModeName);

    const departmentSelect = page.locator("#departmentId");
    const locationSelect = page.locator("#expenseLocationId");

    await expect
      .poll(async () => (await getSelectOptionLabels(departmentSelect)).length, {
        timeout: 10000,
        message: "waiting for department options to populate",
      })
      .toBeGreaterThan(0);

    await expect
      .poll(async () => (await getSelectOptionLabels(locationSelect)).length, {
        timeout: 10000,
        message: "waiting for location options to populate",
      })
      .toBeGreaterThan(0);

    await selectOptionByLabel(page, /department/i, runtimeOptions.departmentOptionLabel);
    await selectOptionByLabel(page, /location/i, runtimeOptions.locationOptionLabel);

    await expect(page.getByRole("button", { name: /submit claim/i })).toBeVisible();
    await expect(page.getByText(/unable to load claim form data/i)).toHaveCount(0);
  });
});
