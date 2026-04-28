import { expect, test, type Page } from "@playwright/test";
import { getDefaultSeedEmails } from "./support/auth-state";

const seedEmails = getDefaultSeedEmails();
const DEFAULT_PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "password123";
const FOUNDER_PASSWORD = process.env.E2E_FOUNDER_PASSWORD ?? "Nxtwave@2026";

function resolvePasswordForEmail(email: string): string {
  if (email.trim().toLowerCase() === seedEmails.founder.toLowerCase()) {
    return FOUNDER_PASSWORD;
  }

  return DEFAULT_PASSWORD;
}

async function ensureAuthenticated(page: Page, email: string) {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

  const signOutButton = page.getByRole("button", { name: /sign out/i });
  const hasSession = await signOutButton.isVisible({ timeout: 3000 }).catch(() => false);
  if (hasSession) {
    return;
  }

  const loginResponse = await page.request.post("/api/auth/email-login", {
    data: { email, password: resolvePasswordForEmail(email) },
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

async function ensureAuthenticatedWithFallback(page: Page, emails: string[]) {
  let lastError: unknown;

  for (const email of emails) {
    try {
      await ensureAuthenticated(page, email);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

test.describe("analytics finance raw summary", () => {
  test.describe.configure({ mode: "serial" });

  test.describe("admin scope", () => {
    test("renders finance raw summary with overall and approver breakdown", async ({ page }) => {
      await ensureAuthenticated(page, seedEmails.founder);
      await page.goto("/dashboard/analytics", { waitUntil: "domcontentloaded" });
      await expect(page).not.toHaveURL(/\/auth\/login/i);

      await expect(page.getByRole("heading", { name: /analytics command center/i })).toBeVisible();

      const financeRawHeading = page.getByRole("heading", {
        name: /finance efficiency summary \(raw\)/i,
      });
      await expect(financeRawHeading).toBeVisible();

      const financeCard = financeRawHeading.locator(
        "xpath=ancestor::div[.//h3[contains(., 'Finance Efficiency Summary (Raw)')] and .//p[contains(., 'Overall Team:')]][1]",
      );
      await expect(
        financeCard.getByText(/Overall Team:\s*\d+\.\d{2}\s*days\s*\|\s*\d+\s*claims/i),
      ).toBeVisible();

      const approverRows = financeCard.locator("li");
      if ((await approverRows.count()) > 0) {
        await expect(approverRows.first()).toContainText(/days\s*\|\s*\d+\s*claims/i);
      } else {
        await expect(
          financeCard.getByText(/No finance approval efficiency records in this period\./i),
        ).toBeVisible();
      }
    });
  });

  test.describe("finance scope", () => {
    test("does not render admin-only finance raw summary", async ({ page }) => {
      await ensureAuthenticatedWithFallback(page, [seedEmails.finance, seedEmails.finance2]);
      await page.goto("/dashboard/analytics", { waitUntil: "domcontentloaded" });
      await expect(page).not.toHaveURL(/\/auth\/login/i);

      await expect(page.getByRole("heading", { name: /analytics command center/i })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /finance efficiency summary \(raw\)/i }),
      ).toHaveCount(0);
    });
  });
});
