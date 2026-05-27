/**
 * Export all employee wallet data as a CSV file.
 *
 * Joins wallets → users to include email, full_name, and is_active.
 * Uses the service role key to bypass RLS — strictly READ-ONLY.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/export-wallets.ts
 *
 * Output:
 *   employee_wallets_export.csv  (project root)
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

type WalletRow = {
  id: string;
  user_id: string;
  total_reimbursements_received: number;
  total_petty_cash_received: number;
  total_petty_cash_spent: number;
  petty_cash_balance: number;
  created_at: string;
  updated_at: string;
  users: {
    email: string;
    full_name: string | null;
    is_active: boolean;
  } | null;
};

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
  "email",
  "full_name",
  "total_reimbursements_received",
  "total_petty_cash_received",
  "total_petty_cash_spent",
  "petty_cash_balance",
  "is_active",
];

function rowToCsv(row: WalletRow): string {
  return [
    csvEscape(row.users?.email),
    csvEscape(row.users?.full_name),
    csvEscape(row.total_reimbursements_received),
    csvEscape(row.total_petty_cash_received),
    csvEscape(row.total_petty_cash_spent),
    csvEscape(row.petty_cash_balance),
    csvEscape(row.users?.is_active),
  ].join(",");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching all wallet records...");

  const { data, error } = await supabase
    .from("wallets")
    .select("*, users(email, full_name, is_active)")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("\n  Query failed:", error.message, "\n");
    process.exit(1);
  }

  const rows = data as WalletRow[];
  console.log(`Fetched ${rows.length} rows.\n`);

  // Build CSV
  const lines = [CSV_HEADERS.join(","), ...rows.map(rowToCsv)];
  const csv = lines.join("\n");

  // Write to project root
  const outputPath = join(__dirname, "..", "employee_wallets_export.csv");
  writeFileSync(outputPath, csv, "utf-8");

  console.log(`CSV written → employee_wallets_export.csv`);
  console.log(`Total rows  : ${rows.length}`);
  console.log(`\nFirst 5 data rows:\n`);
  lines.slice(0, 6).forEach((line) => console.log(line));
}

main();
