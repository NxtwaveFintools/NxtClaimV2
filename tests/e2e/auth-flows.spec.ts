import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { getAuthStatePathByRole, getDefaultSeedEmails } from "./support/auth-state";

const defaultPassword = process.env.E2E_DEFAULT_PASSWORD ?? "password123";
const seedEmails = getDefaultSeedEmails();

async function loginWithEmailApi(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await request.post("/api/auth/email-login", {
    data: { email, password },
  });

  if (!response.ok()) {
    throw new Error(`Email login failed for ${email}: HTTP ${response.status()}`);
  }

  const payload = (await response.json()) as {
    data?: { session?: { accessToken?: string; refreshToken?: string } };
  };

  const accessToken = payload.data?.session?.accessToken;
  const refreshToken = payload.data?.session?.refreshToken;

  if (!accessToken || !refreshToken) {
    throw new Error(`Missing session tokens for ${email}.`);
  }

  return { accessToken, refreshToken };
}

async function bootstrapSession(page: Page, email: string): Promise<void> {
  const { accessToken, refreshToken } = await loginWithEmailApi(
    page.request,
    email,
    defaultPassword,
  );

  const sessionResponse = await page.request.post("/api/auth/session", {
    data: { accessToken, refreshToken },
  });

  expect(sessionResponse.ok()).toBeTruthy();
}

test.describe("auth flows", () => {
  test("renders login page with email and oauth controls", async ({ page }) => {
    await page.goto("/auth/login", { waitUntil: "domcontentloaded" });

    await expect(page.getByLabel(/work email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with email/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with microsoft/i })).toBeVisible();
  });

  test("rejects invalid email-password credentials", async ({ request }) => {
    const response = await request.post("/api/auth/email-login", {
      data: {
        email: seedEmails.submitter,
        password: "not-the-right-password",
      },
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("logout endpoint is idempotent without auth header", async ({ request }) => {
    const response = await request.post("/api/auth/logout");
    expect(response.ok()).toBeTruthy();

    const payload = (await response.json()) as {
      data?: { loggedOut?: boolean };
    };

    expect(payload.data?.loggedOut).toBe(true);
  });

  test("bootstraps session via API and accesses dashboard", async ({ page }) => {
    await bootstrapSession(page, seedEmails.submitter);

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/auth\/login/i);
    await expect(page.getByRole("heading", { name: /my claims|wallet summary/i })).toBeVisible();
  });

  test("redirects to login after session invalidation", async ({ page }) => {
    await bootstrapSession(page, seedEmails.submitter);

    const invalidateResponse = await page.request.post("/api/auth/logout");
    expect(invalidateResponse.ok()).toBeTruthy();

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/auth\/login/i, { timeout: 20000 });
  });

  test.describe("authenticated sign out", () => {
    test.use({ storageState: getAuthStatePathByRole("submitter") });

    test("sign out button redirects to login", async ({ page }) => {
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();

      await page.getByRole("button", { name: /sign out/i }).click();
      await expect(page).toHaveURL(/\/auth\/login/i, { timeout: 20000 });
    });
  });
});
