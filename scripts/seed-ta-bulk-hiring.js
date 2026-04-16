/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs/promises");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const DEFAULT_PASSWORD = "password123";
const DRY_RUN = !process.argv.includes("--apply");

const FOUNDER = {
  email: "anupam@nxtwave.co.in",
  fullName: "Anupam Pedarla",
  role: "founder",
};

const HOD = {
  email: "saravan@nxtwave.co.in",
  fullName: "Saravan Kumar Bollimunta",
  role: "hod",
};

const DEPARTMENT_NAME = "TA - BULK HIRING";

async function loadEnvFiles() {
  const envPaths = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), ".env.local")];

  for (const envPath of envPaths) {
    let raw;
    try {
      raw = await fs.readFile(envPath, "utf8");
    } catch {
      continue;
    }

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();

      if (!key || process.env[key]) continue;

      const unquoted = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      process.env[key] = unquoted;
    }
  }
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveAuthDisplayName(user, fallback) {
  const metadata = user.user_metadata || {};
  const fullName = String(metadata.full_name || "").trim();
  if (fullName) return fullName;

  const name = String(metadata.name || "").trim();
  if (name) return name;

  const emailPrefix = String(user.email || "")
    .split("@")[0]
    ?.trim();
  if (emailPrefix) return emailPrefix;

  return fallback;
}

function createAdminClient() {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function findAuthUserByEmail(adminClient, email) {
  const targetEmail = normalizeEmail(email);
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed to list auth users while searching ${email}: ${error.message}`);
    }

    const users = data?.users ?? [];
    const match = users.find((user) => normalizeEmail(user.email) === targetEmail);
    if (match) {
      return match;
    }

    if (users.length < perPage) {
      break;
    }

    page += 1;
  }

  return null;
}

async function ensureAuthUser(adminClient, target) {
  const created = await adminClient.auth.admin.createUser({
    email: target.email,
    password: DEFAULT_PASSWORD,
    email_confirm: true,
    user_metadata: {
      full_name: target.fullName,
    },
  });

  if (!created.error && created.data?.user) {
    return { user: created.data.user, created: true };
  }

  const existing = await findAuthUserByEmail(adminClient, target.email);
  if (existing) {
    return { user: existing, created: false };
  }

  throw new Error(
    `Failed to create or find auth user for ${target.email}: ${created.error?.message ?? "unknown error"}`,
  );
}

async function ensurePublicUser(adminClient, user, fullName, role) {
  const normalizedEmail = normalizeEmail(user.email);

  const { data: existingByEmail, error: existingByEmailError } = await adminClient
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (existingByEmailError) {
    throw new Error(
      `Failed to query public.users by email ${normalizedEmail}: ${existingByEmailError.message}`,
    );
  }

  if (existingByEmail?.id && existingByEmail.id !== user.id) {
    throw new Error(
      `Email conflict in public.users for ${normalizedEmail}: existing id ${existingByEmail.id}, expected ${user.id}`,
    );
  }

  const payload = {
    id: user.id,
    email: normalizedEmail,
    full_name: fullName,
    role,
    is_active: true,
  };

  const { error } = await adminClient.from("users").upsert(payload, {
    onConflict: "id",
    ignoreDuplicates: false,
  });

  if (error) {
    throw new Error(`Failed to upsert public.users for ${normalizedEmail}: ${error.message}`);
  }
}

async function ensureWallet(adminClient, userId) {
  const { error } = await adminClient.from("wallets").upsert(
    {
      user_id: userId,
    },
    {
      onConflict: "user_id",
      ignoreDuplicates: false,
    },
  );

  if (error) {
    throw new Error(`Failed to upsert wallet for user ${userId}: ${error.message}`);
  }
}

async function upsertDepartment(adminClient, hodUserId, founderUserId) {
  const { error } = await adminClient.from("master_departments").upsert(
    {
      name: DEPARTMENT_NAME,
      hod_user_id: hodUserId,
      founder_user_id: founderUserId,
      is_active: true,
    },
    {
      onConflict: "name",
      ignoreDuplicates: false,
    },
  );

  if (error) {
    throw new Error(`Failed to upsert ${DEPARTMENT_NAME} department: ${error.message}`);
  }
}

async function main() {
  await loadEnvFiles();

  console.log(`[seed-ta-bulk-hiring] Mode: ${DRY_RUN ? "dry-run" : "apply"}`);

  if (DRY_RUN) {
    console.log(`[seed-ta-bulk-hiring] Founder email (must exist): ${FOUNDER.email}`);
    console.log(`[seed-ta-bulk-hiring] HOD email (create-or-use): ${HOD.email}`);
    console.log(`[seed-ta-bulk-hiring] Department: ${DEPARTMENT_NAME}`);
    console.log("[seed-ta-bulk-hiring] Dry-run complete. Re-run with --apply to write data.");
    return;
  }

  const adminClient = createAdminClient();

  const founderAuthUser = await findAuthUserByEmail(adminClient, FOUNDER.email);
  if (!founderAuthUser) {
    throw new Error(
      `Founder ${FOUNDER.email} does not exist in auth.users. Create it first, then rerun this script.`,
    );
  }

  const founderFullName = resolveAuthDisplayName(founderAuthUser, FOUNDER.fullName);
  await ensurePublicUser(adminClient, founderAuthUser, founderFullName, FOUNDER.role);

  const saravanResult = await ensureAuthUser(adminClient, HOD);
  const saravanFullName = resolveAuthDisplayName(saravanResult.user, HOD.fullName);

  await ensurePublicUser(adminClient, saravanResult.user, saravanFullName, HOD.role);
  await ensureWallet(adminClient, saravanResult.user.id);

  await upsertDepartment(adminClient, saravanResult.user.id, founderAuthUser.id);

  console.log(
    `[seed-ta-bulk-hiring] Founder: ${FOUNDER.email} (${founderAuthUser.id}) linked in public.users as founder.`,
  );
  console.log(
    `[seed-ta-bulk-hiring] Saravan: ${HOD.email} (${saravanResult.user.id}) ${saravanResult.created ? "created" : "already existed"}.`,
  );
  console.log(
    `[seed-ta-bulk-hiring] Department upserted: ${DEPARTMENT_NAME} (hod=${saravanResult.user.id}, founder=${founderAuthUser.id}).`,
  );
}

main().catch((error) => {
  console.error(`[seed-ta-bulk-hiring] Failed: ${error.message}`);
  process.exit(1);
});
