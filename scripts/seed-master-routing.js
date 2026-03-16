/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs/promises");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const DEFAULT_PASSWORD = "password123";
const CSV_PATH = path.resolve(process.cwd(), "departments_HOD.csv");
const DRY_RUN = !process.argv.includes("--apply");

const ROLE_PRIORITY = {
  hod: 1,
  founder: 2,
  finance: 3,
};

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
  if (!email) return null;
  const value = String(email).trim().toLowerCase();
  if (!value || value === "na" || value === "n/a") return null;
  return value;
}

function normalizeName(name) {
  if (!name) return null;
  const value = String(name).trim();
  if (!value || value.toLowerCase() === "na") return null;
  return value;
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("departments_HOD.csv is empty or missing data rows.");
  }

  const headers = lines[0].split(",").map((header) => header.trim().toLowerCase());
  const idx = {
    department: headers.indexOf("departments"),
    hodName: headers.indexOf("hod"),
    hodEmail: headers.indexOf("hod mails"),
    founderName: headers.indexOf("founders"),
    founderEmail: headers.indexOf("founders mail"),
  };

  for (const [key, value] of Object.entries(idx)) {
    if (value === -1) {
      throw new Error(`Missing required CSV column: ${key}`);
    }
  }

  return lines.slice(1).map((line, lineIndex) => {
    const parts = line.split(",");
    const departmentName = normalizeName(parts[idx.department]);
    const hodName = normalizeName(parts[idx.hodName]);
    const hodEmail = normalizeEmail(parts[idx.hodEmail]);
    const founderName = normalizeName(parts[idx.founderName]);
    const founderEmail = normalizeEmail(parts[idx.founderEmail]);

    if (!departmentName || !hodEmail || !founderEmail) {
      throw new Error(
        `Invalid row at CSV line ${lineIndex + 2}: department/HOD/founder data required.`,
      );
    }

    return {
      departmentName,
      hodName,
      hodEmail,
      founderName,
      founderEmail,
    };
  });
}

function updateRoleMap(roleMap, email, role) {
  const existing = roleMap.get(email);
  if (!existing || ROLE_PRIORITY[role] > ROLE_PRIORITY[existing]) {
    roleMap.set(email, role);
  }
}

async function findAuthUserByEmail(adminClient, email) {
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Failed to list auth users while searching ${email}: ${error.message}`);
    }

    const users = data?.users ?? [];
    const match = users.find((user) => user.email?.toLowerCase() === email);
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

async function ensureAuthUser(adminClient, email, fullName) {
  const created = await adminClient.auth.admin.createUser({
    email,
    password: DEFAULT_PASSWORD,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
    },
  });

  if (!created.error && created.data?.user) {
    return { user: created.data.user, created: true };
  }

  const existing = await findAuthUserByEmail(adminClient, email);
  if (existing) {
    return { user: existing, created: false };
  }

  throw new Error(
    `Failed to create or find auth user for ${email}: ${created.error?.message ?? "unknown error"}`,
  );
}

async function upsertPublicUser(adminClient, user, fullName) {
  const payload = {
    id: user.id,
    email: user.email,
    full_name: fullName,
    is_active: true,
  };

  const { error } = await adminClient
    .from("users")
    .upsert(payload, { onConflict: "email", ignoreDuplicates: false });

  if (error) {
    throw new Error(`Failed to upsert public.users for ${user.email}: ${error.message}`);
  }
}

async function main() {
  await loadEnvFiles();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const csvRaw = await fs.readFile(CSV_PATH, "utf8");
  const rows = parseCsv(csvRaw);

  const roleMap = new Map();
  const nameMap = new Map();

  for (const row of rows) {
    updateRoleMap(roleMap, row.hodEmail, "hod");
    updateRoleMap(roleMap, row.founderEmail, "founder");
    if (row.hodName) nameMap.set(row.hodEmail, row.hodName);
    if (row.founderName) nameMap.set(row.founderEmail, row.founderName);
  }

  const financeEmailsFromCsv = rows
    .filter((row) => row.departmentName.toLowerCase() === "finance")
    .map((row) => row.hodEmail)
    .filter(Boolean);

  const financeEmailsFromEnv = (process.env.FINANCE_APPROVER_EMAILS || "")
    .split(",")
    .map((item) => normalizeEmail(item))
    .filter(Boolean);

  const financeEmails = new Set([...financeEmailsFromCsv, ...financeEmailsFromEnv]);
  for (const email of financeEmails) {
    updateRoleMap(roleMap, email, "finance");
  }

  console.log(`[seed-master-routing] Mode: ${DRY_RUN ? "dry-run" : "apply"}`);
  console.log(`[seed-master-routing] Departments rows: ${rows.length}`);
  console.log(`[seed-master-routing] Unique users (HOD/Founder/Finance): ${roleMap.size}`);

  if (DRY_RUN) {
    console.log(`[seed-master-routing] Finance approver candidates: ${financeEmails.size}`);
    console.log("[seed-master-routing] Dry-run complete. Re-run with --apply to write data.");
    return;
  }

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply mode.",
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const authUsers = new Map();
  let authCreatedCount = 0;

  for (const [email, role] of roleMap.entries()) {
    void role;
    const fullName = nameMap.get(email) || email.split("@")[0];
    const { user, created } = await ensureAuthUser(adminClient, email, fullName);
    if (created) authCreatedCount += 1;

    authUsers.set(email, user);
    await upsertPublicUser(adminClient, user, fullName);
  }

  let departmentUpsertedCount = 0;
  for (const row of rows) {
    const hodUser = authUsers.get(row.hodEmail);
    const founderUser = authUsers.get(row.founderEmail);
    if (!hodUser || !founderUser) {
      throw new Error(`Missing auth user mapping for department ${row.departmentName}`);
    }

    const { error } = await adminClient.from("master_departments").upsert(
      {
        name: row.departmentName,
        hod_user_id: hodUser.id,
        founder_user_id: founderUser.id,
        is_active: true,
      },
      { onConflict: "name", ignoreDuplicates: false },
    );

    if (error) {
      throw new Error(
        `Failed to upsert master_departments for ${row.departmentName}: ${error.message}`,
      );
    }

    departmentUpsertedCount += 1;
  }

  let financeUpsertedCount = 0;
  for (const email of financeEmails) {
    const financeUser = authUsers.get(email);
    if (!financeUser) {
      throw new Error(`Finance approver user not found for ${email}`);
    }

    const { error } = await adminClient.from("master_finance_approvers").upsert(
      {
        user_id: financeUser.id,
        is_primary: financeUpsertedCount === 0,
        is_active: true,
      },
      { onConflict: "user_id", ignoreDuplicates: false },
    );

    if (error) {
      throw new Error(`Failed to upsert master_finance_approvers for ${email}: ${error.message}`);
    }

    financeUpsertedCount += 1;
  }

  console.log(`[seed-master-routing] Auth users created: ${authCreatedCount}`);
  console.log(`[seed-master-routing] master_departments upserted: ${departmentUpsertedCount}`);
  console.log(`[seed-master-routing] master_finance_approvers upserted: ${financeUpsertedCount}`);
}

main().catch((error) => {
  console.error("[seed-master-routing] Failed:", error.message);
  process.exit(1);
});
