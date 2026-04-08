import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

type MigrationTarget = {
  oldEmail: string;
  newEmail: string;
};

type ColumnUpdateConfig = {
  column: string;
  optional: boolean;
};

type ColumnUpdateResult = {
  column: string;
  matchedRows: number;
  updatedRows: number;
  skippedMissingColumn: boolean;
};

type TargetExecutionResult = {
  target: MigrationTarget;
  ok: boolean;
  createdAuthUser: boolean;
  usedPublicUserFallback: boolean;
  oldPublicUserId: string | null;
  newPublicUserId: string | null;
  emailColumnUpdates: ColumnUpdateResult[];
  idColumnUpdates: ColumnUpdateResult[];
  notes: string[];
  errorMessage: string | null;
};

const APPLY_MODE = process.argv.includes("--apply");
const SEARCH_PAGE_SIZE = 200;
const POST_CREATE_DELAY_MS = 1000;
const PUBLIC_USER_LOOKUP_ATTEMPTS = 5;
const PUBLIC_USER_LOOKUP_DELAY_MS = 1000;

const EMAIL_COLUMNS_TO_UPDATE: ColumnUpdateConfig[] = [
  { column: "hod_email", optional: true },
  { column: "founder_email", optional: true },
  { column: "hod_provisional_email", optional: false },
  { column: "founder_provisional_email", optional: false },
];

const ID_COLUMNS_TO_UPDATE: ColumnUpdateConfig[] = [
  { column: "hod_user_id", optional: false },
  { column: "founder_user_id", optional: false },
  { column: "hod_id", optional: true },
  { column: "founder_id", optional: true },
];

const TARGETS: MigrationTarget[] = [
  {
    oldEmail: "vamsitallam@nxtwave.tech",
    newEmail: "vamsitallam@nxtwave.co.in",
  },
  {
    oldEmail: "akhilesh.jhawar@nxtwave.in",
    newEmail: "akhilesh.jhawar@nxtwave.co.in",
  },
  {
    oldEmail: "alekhya.k@nxtwave.tech",
    newEmail: "alekhya.k@nxtwave.co.in",
  },
];

function log(message: string): void {
  console.log(`[seed-and-migrate-emails] ${message}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function generateSecurePassword(): string {
  const raw = randomBytes(32).toString("base64url");
  return `Tmp_${raw}_Aa1!`;
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unexpected unknown error.";
}

function stringifyErrorShape(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return "[unserializable error object]";
    }
  }

  return String(error);
}

function looksLikeMissingColumnError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeError = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  const haystack = [maybeError.code, maybeError.message, maybeError.details, maybeError.hint]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();

  return (
    haystack.includes("column") &&
    (haystack.includes("does not exist") ||
      haystack.includes("not found") ||
      haystack.includes("schema cache"))
  );
}

function createAdminClient(): SupabaseClient {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function findAuthUserByEmail(
  adminClient: SupabaseClient,
  email: string,
): Promise<User | null> {
  let page = 1;

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: SEARCH_PAGE_SIZE,
    });

    if (error) {
      throw new Error(`Failed listing auth users while searching ${email}: ${error.message}`);
    }

    const users = data?.users ?? [];
    const match = users.find((user) => normalizeEmail(user.email ?? "") === email);
    if (match) {
      return match;
    }

    if (users.length < SEARCH_PAGE_SIZE) {
      return null;
    }

    page += 1;
  }
}

async function createAuthUser(adminClient: SupabaseClient, email: string): Promise<User> {
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password: generateSecurePassword(),
    email_confirm: true,
  });

  if (!error && data.user) {
    return data.user;
  }

  const existing = await findAuthUserByEmail(adminClient, email);
  if (existing) {
    return existing;
  }

  throw new Error(`Failed to create auth user for ${email}: ${error?.message ?? "unknown error"}`);
}

async function getPublicUserIdByEmail(
  adminClient: SupabaseClient,
  email: string,
): Promise<string | null> {
  const { data, error } = await adminClient
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed querying public.users for ${email}: ${error.message}`);
  }

  return data?.id ?? null;
}

async function getPublicUserIdWithRetry(
  adminClient: SupabaseClient,
  email: string,
): Promise<string | null> {
  for (let attempt = 1; attempt <= PUBLIC_USER_LOOKUP_ATTEMPTS; attempt += 1) {
    const publicUserId = await getPublicUserIdByEmail(adminClient, email);
    if (publicUserId) {
      return publicUserId;
    }

    if (attempt < PUBLIC_USER_LOOKUP_ATTEMPTS) {
      await sleep(PUBLIC_USER_LOOKUP_DELAY_MS);
    }
  }

  return null;
}

async function upsertPublicUserFromAuth(
  adminClient: SupabaseClient,
  user: User,
  email: string,
): Promise<void> {
  const inferredFullName =
    typeof user.user_metadata?.full_name === "string" &&
    user.user_metadata.full_name.trim().length > 0
      ? user.user_metadata.full_name.trim()
      : null;

  const { error } = await adminClient.from("users").upsert(
    {
      id: user.id,
      email,
      full_name: inferredFullName,
      is_active: true,
    },
    {
      onConflict: "id",
      ignoreDuplicates: false,
    },
  );

  if (error) {
    throw new Error(`Failed upserting public.users fallback for ${email}: ${error.message}`);
  }
}

async function countMasterDepartmentsByColumn(
  adminClient: SupabaseClient,
  columnConfig: ColumnUpdateConfig,
  matchValue: string,
): Promise<{ count: number; skippedMissingColumn: boolean }> {
  const { count, error } = await adminClient
    .from("master_departments")
    .select("id", { head: true, count: "exact" })
    .eq(columnConfig.column, matchValue);

  if (error) {
    if (columnConfig.optional || looksLikeMissingColumnError(error)) {
      return { count: 0, skippedMissingColumn: true };
    }

    throw new Error(
      `Failed counting master_departments rows by ${columnConfig.column}=${matchValue}: ${stringifyErrorShape(error)}`,
    );
  }

  return {
    count: count ?? 0,
    skippedMissingColumn: false,
  };
}

async function updateMasterDepartmentsColumn(
  adminClient: SupabaseClient,
  columnConfig: ColumnUpdateConfig,
  oldValue: string,
  newValue: string,
): Promise<ColumnUpdateResult> {
  const countResult = await countMasterDepartmentsByColumn(adminClient, columnConfig, oldValue);

  if (countResult.skippedMissingColumn) {
    return {
      column: columnConfig.column,
      matchedRows: 0,
      updatedRows: 0,
      skippedMissingColumn: true,
    };
  }

  if (countResult.count === 0) {
    return {
      column: columnConfig.column,
      matchedRows: 0,
      updatedRows: 0,
      skippedMissingColumn: false,
    };
  }

  if (!APPLY_MODE) {
    return {
      column: columnConfig.column,
      matchedRows: countResult.count,
      updatedRows: 0,
      skippedMissingColumn: false,
    };
  }

  const { data, error } = await adminClient
    .from("master_departments")
    .update({ [columnConfig.column]: newValue })
    .eq(columnConfig.column, oldValue)
    .select("id");

  if (error) {
    if (columnConfig.optional || looksLikeMissingColumnError(error)) {
      return {
        column: columnConfig.column,
        matchedRows: 0,
        updatedRows: 0,
        skippedMissingColumn: true,
      };
    }

    throw new Error(
      `Failed updating master_departments ${columnConfig.column} from ${oldValue} to ${newValue}: ${stringifyErrorShape(error)}`,
    );
  }

  return {
    column: columnConfig.column,
    matchedRows: countResult.count,
    updatedRows: data?.length ?? 0,
    skippedMissingColumn: false,
  };
}

async function processTarget(
  adminClient: SupabaseClient,
  target: MigrationTarget,
): Promise<TargetExecutionResult> {
  const oldEmail = normalizeEmail(target.oldEmail);
  const newEmail = normalizeEmail(target.newEmail);

  const notes: string[] = [];
  const emailColumnUpdates: ColumnUpdateResult[] = [];
  const idColumnUpdates: ColumnUpdateResult[] = [];

  try {
    let createdAuthUser = false;
    let usedPublicUserFallback = false;

    let authUser = await findAuthUserByEmail(adminClient, newEmail);
    if (!authUser && APPLY_MODE) {
      notes.push("Auth user for new email not found; creating via Supabase Admin API.");
      authUser = await createAuthUser(adminClient, newEmail);
      createdAuthUser = true;
      await sleep(POST_CREATE_DELAY_MS);
    } else if (!authUser) {
      notes.push("Dry-run: new auth user does not exist; would create it in apply mode.");
    }

    const oldPublicUserId = await getPublicUserIdByEmail(adminClient, oldEmail);
    let newPublicUserId = await getPublicUserIdWithRetry(adminClient, newEmail);

    if (!newPublicUserId && APPLY_MODE && authUser) {
      notes.push("public.users row for new email not found; applying fallback upsert.");
      await upsertPublicUserFromAuth(adminClient, authUser, newEmail);
      usedPublicUserFallback = true;
      newPublicUserId = await getPublicUserIdWithRetry(adminClient, newEmail);
    }

    if (!newPublicUserId && APPLY_MODE) {
      throw new Error(
        `Could not resolve public.users.id for ${newEmail} after retries and fallback upsert.`,
      );
    }

    for (const emailColumn of EMAIL_COLUMNS_TO_UPDATE) {
      const updateResult = await updateMasterDepartmentsColumn(
        adminClient,
        emailColumn,
        oldEmail,
        newEmail,
      );
      emailColumnUpdates.push(updateResult);
    }

    if (!oldPublicUserId) {
      notes.push(`No public.users row found for old email ${oldEmail}; ID-column remap skipped.`);
    } else if (!newPublicUserId) {
      notes.push(
        `New public user ID for ${newEmail} is unresolved in dry-run; ID-column remap skipped.`,
      );
    } else {
      for (const idColumn of ID_COLUMNS_TO_UPDATE) {
        const updateResult = await updateMasterDepartmentsColumn(
          adminClient,
          idColumn,
          oldPublicUserId,
          newPublicUserId,
        );
        idColumnUpdates.push(updateResult);
      }
    }

    return {
      target: { oldEmail, newEmail },
      ok: true,
      createdAuthUser,
      usedPublicUserFallback,
      oldPublicUserId,
      newPublicUserId,
      emailColumnUpdates,
      idColumnUpdates,
      notes,
      errorMessage: null,
    };
  } catch (error) {
    return {
      target: { oldEmail, newEmail },
      ok: false,
      createdAuthUser: false,
      usedPublicUserFallback: false,
      oldPublicUserId: null,
      newPublicUserId: null,
      emailColumnUpdates,
      idColumnUpdates,
      notes,
      errorMessage: asErrorMessage(error),
    };
  }
}

function sumUpdatedRows(results: ColumnUpdateResult[]): number {
  return results.reduce((total, result) => total + result.updatedRows, 0);
}

function sumMatchedRows(results: ColumnUpdateResult[]): number {
  return results.reduce((total, result) => total + result.matchedRows, 0);
}

function listMissingColumns(results: ColumnUpdateResult[]): string[] {
  return results.filter((result) => result.skippedMissingColumn).map((result) => result.column);
}

function printTargetSummary(result: TargetExecutionResult): void {
  const header = `${result.target.oldEmail} -> ${result.target.newEmail}`;

  if (!result.ok) {
    log(`FAIL: ${header} | ${result.errorMessage ?? "Unknown failure"}`);
    return;
  }

  const matchedEmailRows = sumMatchedRows(result.emailColumnUpdates);
  const matchedIdRows = sumMatchedRows(result.idColumnUpdates);
  const updatedEmailRows = sumUpdatedRows(result.emailColumnUpdates);
  const updatedIdRows = sumUpdatedRows(result.idColumnUpdates);

  const missingColumns = [
    ...listMissingColumns(result.emailColumnUpdates),
    ...listMissingColumns(result.idColumnUpdates),
  ];

  if (APPLY_MODE) {
    log(
      `OK: ${header} | authCreated=${result.createdAuthUser} fallbackPublicUpsert=${result.usedPublicUserFallback} matched(email=${matchedEmailRows}, id=${matchedIdRows}) updated(email=${updatedEmailRows}, id=${updatedIdRows})`,
    );
  } else {
    log(
      `DRY-RUN: ${header} | authCreated=${result.createdAuthUser} matched(email=${matchedEmailRows}, id=${matchedIdRows})`,
    );
  }

  if (missingColumns.length > 0) {
    log(`  Missing/optional columns skipped: ${missingColumns.join(", ")}`);
  }

  for (const note of result.notes) {
    log(`  Note: ${note}`);
  }
}

async function main(): Promise<void> {
  log(`Mode: ${APPLY_MODE ? "apply" : "dry-run"}`);
  log(`Targets: ${TARGETS.length}`);

  const adminClient = createAdminClient();

  const results: TargetExecutionResult[] = [];

  for (const target of TARGETS) {
    const result = await processTarget(adminClient, target);
    results.push(result);
    printTargetSummary(result);
  }

  const successCount = results.filter((result) => result.ok).length;
  const failureCount = results.length - successCount;

  const totalUpdatedEmailRows = results.reduce(
    (total, result) => total + sumUpdatedRows(result.emailColumnUpdates),
    0,
  );
  const totalUpdatedIdRows = results.reduce(
    (total, result) => total + sumUpdatedRows(result.idColumnUpdates),
    0,
  );

  log(`Summary: success=${successCount}, failed=${failureCount}`);
  if (APPLY_MODE) {
    log(`Summary updates: emailRows=${totalUpdatedEmailRows}, idRows=${totalUpdatedIdRows}`);
  }

  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[seed-and-migrate-emails] Fatal: ${asErrorMessage(error)}`);
  process.exit(1);
});
