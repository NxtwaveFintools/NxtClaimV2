import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { getAuthStatePathByRole, getDefaultSeedEmails } from "./support/auth-state";

const seedEmails = getDefaultSeedEmails();
const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "password123";

function getAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase env vars for admin-settings E2E.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let insertedAdminId: string | null = null;

async function ensureAuthenticated(page: Page, email: string) {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

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

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/auth\/login/i);
  await expect(signOutButton).toBeVisible({ timeout: 15000 });
}

function settingsNavItem(page: Page, name: RegExp) {
  return page
    .locator(
      'nav[aria-label="Settings navigation"] a, nav[aria-label="Settings navigation"] button, nav[aria-label="Settings navigation"] [role="tab"]',
    )
    .filter({ hasText: name })
    .first();
}

async function ensureFounderAdminAccess() {
  const client = getAdminSupabaseClient();
  const founderEmail = seedEmails.founder.toLowerCase();

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

  insertedAdminId = insertedAdmin.id;
}

test.describe("admin settings", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: getAuthStatePathByRole("founder") });

  test.beforeAll(async () => {
    await ensureFounderAdminAccess();
  });

  test.afterAll(async () => {
    if (!insertedAdminId) {
      return;
    }

    const client = getAdminSupabaseClient();
    await client.from("admins").delete().eq("id", insertedAdminId);
  });

  test("loads settings page and renders core admin tabs", async ({ page }) => {
    await ensureAuthenticated(page, seedEmails.founder);
    await page.goto("/dashboard/admin/settings", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/dashboard\/admin\/settings/);
    await expect(settingsNavItem(page, /expense categories/i)).toBeVisible();
    await expect(settingsNavItem(page, /finance approvers/i)).toBeVisible();
    await expect(settingsNavItem(page, /department viewers/i)).toBeVisible();
    await expect(settingsNavItem(page, /users/i)).toBeVisible();
    await expect(settingsNavItem(page, /administrators|admins/i)).toBeVisible();
    await expect(settingsNavItem(page, /claim override/i)).toBeVisible();
  });

  test("switches between finance, viewers, users, and admins sections", async ({ page }) => {
    await ensureAuthenticated(page, seedEmails.founder);
    await page.goto("/dashboard/admin/settings", { waitUntil: "domcontentloaded" });

    await settingsNavItem(page, /finance approvers/i).click();
    await expect(page.getByRole("heading", { level: 2, name: /finance approvers/i })).toBeVisible();

    await settingsNavItem(page, /department viewers/i).click();
    await expect(
      page.getByRole("heading", { level: 2, name: /department viewers/i }),
    ).toBeVisible();

    await settingsNavItem(page, /users/i).click();
    await expect(page.getByRole("heading", { level: 2, name: /^users$/i })).toBeVisible();

    await settingsNavItem(page, /administrators|admins/i).click();
    await expect(
      page.getByRole("heading", { level: 2, name: /administrators|admins/i }),
    ).toBeVisible();

    await settingsNavItem(page, /claim override/i).click();
    await expect(page.getByRole("heading", { level: 2, name: /claim override/i })).toBeVisible();
  });

  test("master data tabs are reachable from sidebar", async ({ page }) => {
    await ensureAuthenticated(page, seedEmails.founder);
    await page.goto("/dashboard/admin/settings", { waitUntil: "domcontentloaded" });

    await settingsNavItem(page, /products/i).click();
    await expect(page.getByRole("heading", { level: 2, name: /products/i })).toBeVisible();

    await settingsNavItem(page, /locations/i).click();
    await expect(page.getByRole("heading", { level: 2, name: /locations/i })).toBeVisible();

    await settingsNavItem(page, /payment modes/i).click();
    await expect(page.getByRole("heading", { level: 2, name: /payment modes/i })).toBeVisible();
  });
});
