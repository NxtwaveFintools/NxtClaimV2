/**
 * Export every department with its approver 1 and approver 2 as a CSV file.
 *
 * For each approver, the email/name is resolved from the linked user account
 * (approverN_id → users) when present, otherwise from the provisional email
 * captured before that user signed up. The `*_status` column reports which.
 * Uses the service role key to bypass RLS — strictly READ-ONLY.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/export-departments.ts
 *
 * Output:
 *   department_approvers_export.csv  (project root)
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Env ───────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\n  Missing environment variable: ${name}`);
    console.error(`  Set it in .env.local.\n`);
    process.exit(1);
  }
  return value;
}

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// ── Client ────────────────────────────────────────────────────────────────────

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

// ── Types ─────────────────────────────────────────────────────────────────────

type ApproverUser = {
  email: string;
  full_name: string | null;
} | null;

type DepartmentRow = {
  id: string;
  name: string;
  is_active: boolean;
  approver1_provisional_email: string | null;
  approver2_provisional_email: string | null;
  approver1: ApproverUser;
  approver2: ApproverUser;
};

type ResolvedApprover = {
  email: string;
  name: string;
  status: "linked" | "provisional" | "unassigned";
};

// ── Resolution ────────────────────────────────────────────────────────────────

/** Prefers the linked user account, falling back to the provisional email. */
function resolveApprover(user: ApproverUser, provisionalEmail: string | null): ResolvedApprover {
  if (user) {
    return { email: user.email, name: user.full_name ?? "", status: "linked" };
  }
  if (provisionalEmail) {
    return { email: provisionalEmail, name: "", status: "provisional" };
  }
  return { email: "", name: "", status: "unassigned" };
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

/** Wraps a value in double-quotes if it contains commas, quotes, or newlines. */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const CSV_HEADERS = [
  "department",
  "approver1_email",
  "approver1_name",
  "approver2_email",
  "approver2_name",
  "is_active",
];

function rowToCsv(row: DepartmentRow): string {
  const a1 = resolveApprover(row.approver1, row.approver1_provisional_email);
  const a2 = resolveApprover(row.approver2, row.approver2_provisional_email);
  return [
    csvEscape(row.name),
    csvEscape(a1.email),
    csvEscape(a1.name),
    csvEscape(a2.email),
    csvEscape(a2.name),
    csvEscape(row.is_active),
  ].join(",");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching all departments with approvers...");

  const { data, error } = await supabase
    .from("master_departments")
    .select(
      "id, name, is_active, approver1_provisional_email, approver2_provisional_email, " +
        "approver1:users!master_departments_approver1_id_fkey(email, full_name), " +
        "approver2:users!master_departments_approver2_id_fkey(email, full_name)",
    )
    .order("name", { ascending: true });

  if (error) {
    console.error("\n  Query failed:", error.message, "\n");
    process.exit(1);
  }

  const rows = data as unknown as DepartmentRow[];
  console.log(`Fetched ${rows.length} rows.\n`);

  // Build CSV
  const lines = [CSV_HEADERS.join(","), ...rows.map(rowToCsv)];
  const csv = lines.join("\n");

  // Write to project root
  const outputPath = join(__dirname, "..", "department_approvers_export.csv");
  writeFileSync(outputPath, csv, "utf-8");

  console.log(`CSV written → department_approvers_export.csv`);
  console.log(`Total rows  : ${rows.length}`);
  console.log(`\nFirst 5 data rows:\n`);
  lines.slice(0, 6).forEach((line) => console.log(line));
}

main();
