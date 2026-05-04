import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { FullConfig } from "@playwright/test";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  getAuthStatePathByRole,
  getDefaultSeedEmails,
  registerAuthStateEmail,
  type AuthStateRole,
} from "./e2e/support/auth-state";

loadEnvConfig(process.cwd());

type UserRow = {
  id: string;
  email: string;
};

type FinanceApproverRow = {
  user_id: string;
  is_primary: boolean;
  created_at: string;
};

type ResolvedRoleEmails = Record<AuthStateRole, string>;

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Playwright global setup.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function findExistingAuthEmails(emails: string[]): Promise<Set<string>> {
  const client = getAdminClient();
  const expected = new Set(emails.map((email) => email.toLowerCase()));
  const found = new Set<string>();

  let page = 1;
  while (found.size < expected.size) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw new Error(`Failed to query auth.users: ${error.message}`);
    }

    const users = data?.users ?? [];
    if (users.length === 0) {
      break;
    }

    for (const user of users) {
      const email = user.email?.toLowerCase();
      if (email && expected.has(email)) {
        found.add(email);
      }
    }

    page += 1;
  }

  return found;
}

async function resolveRoleEmails(): Promise<ResolvedRoleEmails> {
  const client = getAdminClient();
  const defaults = getDefaultSeedEmails();

  const [
    { data: baseUsers, error: baseUsersError },
    { data: financeApprovers, error: financeError },
  ] = await Promise.all([
    client
      .from("users")
      .select("id, email")
      .eq("is_active", true)
      .in("email", [defaults.submitter, defaults.hod, defaults.founder]),
    client
      .from("master_finance_approvers")
      .select("user_id, is_primary, created_at")
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true }),
  ]);

  if (baseUsersError) {
    throw new Error(`Failed to resolve base role users: ${baseUsersError.message}`);
  }

  if (financeError) {
    throw new Error(`Failed to resolve finance approvers: ${financeError.message}`);
  }

  const byEmail = new Map(
    ((baseUsers ?? []) as UserRow[]).map((row) => [row.email.toLowerCase(), row]),
  );

  const submitter = byEmail.get(defaults.submitter.toLowerCase())?.email;
  const hod = byEmail.get(defaults.hod.toLowerCase())?.email;
  const founder = byEmail.get(defaults.founder.toLowerCase())?.email;

  if (!submitter || !hod || !founder) {
    throw new Error(
      "Required actor users are missing. Expected active users for submitter/hod/founder from seed emails.",
    );
  }

  const financeRows = (financeApprovers ?? []) as FinanceApproverRow[];
  if (financeRows.length < 2) {
    throw new Error("At least two active finance approvers are required for global auth setup.");
  }

  const financeUserIds = financeRows.map((row) => row.user_id);
  const { data: financeUsers, error: financeUsersError } = await client
    .from("users")
    .select("id, email")
    .eq("is_active", true)
    .in("id", financeUserIds);

  if (financeUsersError) {
    throw new Error(`Failed to resolve finance user profiles: ${financeUsersError.message}`);
  }

  const financeById = new Map(
    ((financeUsers ?? []) as UserRow[]).map((row) => [row.id, row.email]),
  );

  const financeCandidates = financeRows
    .map((row) => financeById.get(row.user_id))
    .filter((email): email is string => Boolean(email));

  const authBackedFinanceEmails = await findExistingAuthEmails(financeCandidates);
  const runnableFinanceEmails = financeCandidates.filter((email) =>
    authBackedFinanceEmails.has(email.toLowerCase()),
  );

  const finance1 = runnableFinanceEmails[0];
  const finance2 = runnableFinanceEmails[1];

  if (!finance1 || !finance2) {
    throw new Error(
      "At least two active finance approvers with auth.users accounts are required for global auth setup.",
    );
  }

  return {
    submitter,
    hod,
    founder,
    finance1,
    finance2,
  };
}

async function verifyAuthUsersExist(emails: string[]): Promise<void> {
  const expected = new Set(emails.map((email) => email.toLowerCase()));
  const found = await findExistingAuthEmails(emails);

  const missing = [...expected].filter((email) => !found.has(email));
  if (missing.length > 0) {
    throw new Error(`auth.users is missing required test accounts: ${missing.join(", ")}`);
  }
}

async function bootstrapRoleStorage(
  config: FullConfig,
  role: AuthStateRole,
  email: string,
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://127.0.0.1:3000";
  const password = process.env.E2E_DEFAULT_PASSWORD ?? "password123";

  try {
    const context = await browser.newContext({ baseURL: String(baseURL) });

    const loginResponse = await context.request.post("/api/auth/email-login", {
      data: { email, password },
    });

    if (!loginResponse.ok()) {
      throw new Error(`Email login failed for ${role} (${email}): HTTP ${loginResponse.status()}`);
    }

    const loginPayload = (await loginResponse.json()) as {
      data?: { session?: { accessToken?: string; refreshToken?: string } };
    };

    const accessToken = loginPayload.data?.session?.accessToken;
    const refreshToken = loginPayload.data?.session?.refreshToken;
    if (!accessToken || !refreshToken) {
      throw new Error(`Missing session tokens for ${role} (${email}).`);
    }

    const sessionResponse = await context.request.post("/api/auth/session", {
      data: { accessToken, refreshToken },
    });

    if (!sessionResponse.ok()) {
      throw new Error(
        `Session bootstrap failed for ${role} (${email}): HTTP ${sessionResponse.status()}`,
      );
    }

    const page = await context.newPage();
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    if (/\/auth\/login/i.test(page.url())) {
      throw new Error(`Auth bootstrap landed on login for ${role} (${email}).`);
    }

    await page.getByRole("button", { name: /sign out/i }).waitFor({
      state: "visible",
      timeout: 15000,
    });

    await context.storageState({ path: getAuthStatePathByRole(role) });
    registerAuthStateEmail(email, role);

    await context.close();
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  await fs.mkdir(path.resolve(process.cwd(), ".auth"), { recursive: true });

  const roleEmails = await resolveRoleEmails();
  await verifyAuthUsersExist(Object.values(roleEmails));

  for (const [role, email] of Object.entries(roleEmails) as Array<[AuthStateRole, string]>) {
    await bootstrapRoleStorage(config, role, email);
  }
}
