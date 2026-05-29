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

type UserEmailRelation = { email: string | null } | Array<{ email: string | null }> | null;

type DepartmentActorRow = {
  approver1: UserEmailRelation;
  approver2: UserEmailRelation;
};

type RoleCredential = {
  email: string;
  password: string;
};

type ResolvedRoleCredentials = Record<AuthStateRole, RoleCredential>;

function getRelatedUserEmail(relation: UserEmailRelation): string | null {
  if (Array.isArray(relation)) {
    return relation[0]?.email ?? null;
  }

  return relation?.email ?? null;
}

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

function getPublicClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required for Playwright global setup.",
    );
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function prioritizeCandidates(preferred: Array<string | undefined>, available: string[]): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const candidate of [...preferred, ...available]) {
    const normalized = candidate?.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    ordered.push(normalized);
  }

  return ordered;
}

function getPasswordCandidates(
  email: string,
  defaults: ReturnType<typeof getDefaultSeedEmails>,
): string[] {
  const normalized = email.trim().toLowerCase();
  const candidates = new Set<string>();

  if (normalized === defaults.submitter.toLowerCase() && process.env.E2E_SUBMITTER_PASSWORD) {
    candidates.add(process.env.E2E_SUBMITTER_PASSWORD);
  }

  if (normalized === defaults.hod.toLowerCase() && process.env.E2E_HOD_PASSWORD) {
    candidates.add(process.env.E2E_HOD_PASSWORD);
  }

  if (normalized === defaults.founder.toLowerCase()) {
    candidates.add(process.env.E2E_FOUNDER_PASSWORD ?? "Nxtwave@2026");
  }

  if (normalized === defaults.finance.toLowerCase() && process.env.E2E_FINANCE_PASSWORD) {
    candidates.add(process.env.E2E_FINANCE_PASSWORD);
  }

  if (normalized === defaults.finance2.toLowerCase() && process.env.E2E_FINANCE2_PASSWORD) {
    candidates.add(process.env.E2E_FINANCE2_PASSWORD);
  }

  candidates.add(process.env.E2E_DEFAULT_PASSWORD ?? "password123");
  return [...candidates];
}

async function tryResolveLoginCredential(
  email: string,
  defaults: ReturnType<typeof getDefaultSeedEmails>,
): Promise<RoleCredential | null> {
  const client = getPublicClient();

  for (const password of getPasswordCandidates(email, defaults)) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      continue;
    }

    await client.auth.signOut().catch(() => undefined);
    return { email, password };
  }

  return null;
}

async function resolveLoginCapableCredentials(
  candidates: string[],
  defaults: ReturnType<typeof getDefaultSeedEmails>,
  requiredCount: number,
): Promise<RoleCredential[]> {
  const resolved: RoleCredential[] = [];

  for (const email of candidates) {
    const credential = await tryResolveLoginCredential(email, defaults);
    if (!credential) {
      continue;
    }

    resolved.push(credential);
    if (resolved.length >= requiredCount) {
      break;
    }
  }

  return resolved;
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

async function resolveRoleCredentials(): Promise<ResolvedRoleCredentials> {
  const client = getAdminClient();
  const defaults = getDefaultSeedEmails();

  const [
    { data: baseUsers, error: baseUsersError },
    { data: financeApprovers, error: financeError },
    { data: departmentActors, error: departmentActorsError },
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
    client
      .from("master_departments")
      .select(
        "approver1:users!master_departments_approver1_id_fkey(email), approver2:users!master_departments_approver2_id_fkey(email)",
      )
      .eq("is_active", true),
  ]);

  if (baseUsersError) {
    throw new Error(`Failed to resolve base role users: ${baseUsersError.message}`);
  }

  if (financeError) {
    throw new Error(`Failed to resolve finance approvers: ${financeError.message}`);
  }

  if (departmentActorsError) {
    throw new Error(`Failed to resolve department actors: ${departmentActorsError.message}`);
  }

  const byEmail = new Map(
    ((baseUsers ?? []) as UserRow[]).map((row) => [row.email.toLowerCase(), row]),
  );

  const submitterEmail = byEmail.get(defaults.submitter.toLowerCase())?.email;

  if (!submitterEmail) {
    throw new Error("Required submitter user is missing from public.users for Playwright setup.");
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

  const departmentRows = (departmentActors ?? []) as DepartmentActorRow[];
  const orderedHodCandidates = prioritizeCandidates(
    [defaults.hod],
    departmentRows.map((row) => getRelatedUserEmail(row.approver1) ?? ""),
  );
  const orderedFounderCandidates = prioritizeCandidates(
    [defaults.founder],
    departmentRows.map((row) => getRelatedUserEmail(row.approver2) ?? ""),
  );
  const orderedFinanceCandidates = prioritizeCandidates(
    [defaults.finance, defaults.finance2],
    financeCandidates,
  );

  const authBackedEmails = await findExistingAuthEmails([
    submitterEmail,
    ...orderedHodCandidates,
    ...orderedFounderCandidates,
    ...orderedFinanceCandidates,
  ]);

  const submitterCredentials = await tryResolveLoginCredential(submitterEmail, defaults);
  if (!submitterCredentials) {
    throw new Error(`Unable to sign in with submitter actor ${submitterEmail}.`);
  }

  const hodCredentials = (
    await resolveLoginCapableCredentials(
      orderedHodCandidates.filter((email) => authBackedEmails.has(email)),
      defaults,
      1,
    )
  )[0];

  if (!hodCredentials) {
    throw new Error("Unable to find a login-capable HOD actor for Playwright global setup.");
  }

  const founderCredentials = (
    await resolveLoginCapableCredentials(
      orderedFounderCandidates.filter((email) => authBackedEmails.has(email)),
      defaults,
      1,
    )
  )[0];

  if (!founderCredentials) {
    throw new Error("Unable to find a login-capable founder actor for Playwright global setup.");
  }

  const financeCredentials = await resolveLoginCapableCredentials(
    orderedFinanceCandidates.filter((email) => authBackedEmails.has(email)),
    defaults,
    2,
  );

  if (financeCredentials.length < 2) {
    throw new Error("Unable to find two login-capable finance actors for Playwright global setup.");
  }

  return {
    submitter: submitterCredentials,
    hod: hodCredentials,
    founder: founderCredentials,
    finance1: financeCredentials[0],
    finance2: financeCredentials[1],
  };
}

async function ensureFinanceApprovablePettyCashRequestClaim(): Promise<void> {
  const client = getAdminClient();

  // Check if a PCR claim is already in the Finance-approvable state.
  const { data: existing, error: existingError } = await client
    .from("claims")
    .select("id, status, payment_mode_id, master_payment_modes!inner(name)")
    .eq("status", "HOD approved - Awaiting finance approval")
    .eq("master_payment_modes.name", "Petty Cash Request")
    .eq("is_active", true)
    .limit(1);

  if (existingError) {
    throw new Error(`Failed to query existing PCR claim state: ${existingError.message}`);
  }

  if (existing && existing.length > 0) {
    return; // Idempotent: nothing to seed.
  }

  // No PCR claim is currently Finance-approvable. Transition one
  // "Submitted - Awaiting HOD approval" PCR claim forward by setting
  // status + hod_action_at.
  const { data: candidates, error: candidateError } = await client
    .from("claims")
    .select("id, status, payment_mode_id, master_payment_modes!inner(name)")
    .eq("status", "Submitted - Awaiting HOD approval")
    .eq("master_payment_modes.name", "Petty Cash Request")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);

  if (candidateError) {
    throw new Error(`Failed to query PCR candidates to transition: ${candidateError.message}`);
  }

  if (!candidates || candidates.length === 0) {
    // No candidate to transition — leave the Playwright PCR scenario
    // to skip rather than fail the whole setup.
    console.warn(
      "[playwright/setup] No Petty Cash Request candidate available to transition into HOD-approved state. PCR e2e scenario will skip.",
    );
    return;
  }

  const targetId = candidates[0].id as string;
  const { error: updateError } = await client
    .from("claims")
    .update({
      status: "HOD approved - Awaiting finance approval",
      hod_action_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", targetId);

  if (updateError) {
    throw new Error(
      `Failed to transition PCR claim ${targetId} to HOD-approved: ${updateError.message}`,
    );
  }
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
  password: string,
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://127.0.0.1:3000";

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

  const roleCredentials = await resolveRoleCredentials();
  await verifyAuthUsersExist(Object.values(roleCredentials).map((credential) => credential.email));
  await ensureFinanceApprovablePettyCashRequestClaim();

  for (const [role, credential] of Object.entries(roleCredentials) as Array<
    [AuthStateRole, RoleCredential]
  >) {
    await bootstrapRoleStorage(config, role, credential.email, credential.password);
  }
}
