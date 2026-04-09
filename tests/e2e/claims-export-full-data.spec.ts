import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";
import { getAuthStatePathByRole } from "./support/auth-state";

loadEnvConfig(process.cwd());

test.use({ storageState: getAuthStatePathByRole("finance1") });

function normalizeCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") {
      return value.text;
    }

    if ("hyperlink" in value && typeof value.hyperlink === "string") {
      return value.hyperlink;
    }

    if (
      "result" in value &&
      (typeof value.result === "string" ||
        typeof value.result === "number" ||
        typeof value.result === "boolean")
    ) {
      return String(value.result);
    }

    if ("formula" in value && typeof value.formula === "string") {
      return value.formula;
    }
  }

  return String(value);
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables for E2E export test.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function seedFinanceClaims(seedTag: string): Promise<void> {
  const client = getAdminClient();
  const financeEmail = (process.env.E2E_FINANCE_EMAIL ?? "finance@nxtwave.co.in").toLowerCase();
  const transactionDate = new Date().toISOString().slice(0, 10);

  const [{ data: financeUser, error: financeUserError }, { data: department, error: deptError }] =
    await Promise.all([
      client
        .from("users")
        .select("id")
        .eq("email", financeEmail)
        .eq("is_active", true)
        .maybeSingle(),
      client
        .from("master_departments")
        .select("id, hod_user_id")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
    ]);

  if (financeUserError || !financeUser?.id) {
    throw new Error(financeUserError?.message ?? "Finance user not found for export seed.");
  }

  if (deptError || !department?.id || !department?.hod_user_id) {
    throw new Error(deptError?.message ?? "Department routing not found for export seed.");
  }

  const [
    { data: paymentMode, error: paymentModeError },
    { data: category, error: categoryError },
    { data: location, error: locationError },
  ] = await Promise.all([
    client
      .from("master_payment_modes")
      .select("id")
      .eq("is_active", true)
      .ilike("name", "%reimbursement%")
      .limit(1)
      .maybeSingle(),
    client
      .from("master_expense_categories")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle(),
    client.from("master_locations").select("id").eq("is_active", true).limit(1).maybeSingle(),
  ]);

  if (paymentModeError || !paymentMode?.id) {
    throw new Error(paymentModeError?.message ?? "Payment mode not found for export seed.");
  }

  if (categoryError || !category?.id) {
    throw new Error(categoryError?.message ?? "Expense category not found for export seed.");
  }

  if (locationError || !location?.id) {
    throw new Error(locationError?.message ?? "Location not found for export seed.");
  }

  const claims = Array.from({ length: 12 }, (_, index) => ({
    id: `E2E-CSV-${seedTag}-${String(index + 1).padStart(2, "0")}`,
    status: DB_CLAIM_STATUSES[0],
    submission_type: "Self",
    detail_type: "expense",
    submitted_by: financeUser.id,
    on_behalf_of_id: financeUser.id,
    on_behalf_email: null,
    on_behalf_employee_code: null,
    employee_id: `E2E-FIN-${String(index + 1).padStart(3, "0")}`,
    cc_emails: "NA",
    department_id: department.id,
    payment_mode_id: paymentMode.id,
    assigned_l1_approver_id: department.hod_user_id,
    assigned_l2_approver_id: null,
    submitted_at: new Date(Date.now() - index * 60_000).toISOString(),
    is_active: true,
  }));

  const expenseRows = claims.map((claim, index) => ({
    claim_id: claim.id,
    bill_no: `E2E-BILL-${seedTag}-${index + 1}`,
    expense_category_id: category.id,
    location_id: location.id,
    is_gst_applicable: false,
    gst_number: null,
    transaction_date: transactionDate,
    basic_amount: 100 + index,
    currency_code: "INR",
    vendor_name: "E2E Vendor",
    purpose: `CSV export seed ${index + 1}`,
    cgst_amount: 0,
    sgst_amount: 0,
    igst_amount: 0,
    transaction_id: `E2E-TXN-${seedTag}-${index + 1}`,
    receipt_file_path: `expenses/e2e/${seedTag}/receipt-${index + 1}.pdf`,
    bank_statement_file_path: `expenses/e2e/${seedTag}/bank-${index + 1}.pdf`,
  }));

  const { error: claimsInsertError } = await client.from("claims").upsert(claims, {
    onConflict: "id",
  });

  if (claimsInsertError) {
    throw new Error(`Claims seed failed: ${claimsInsertError.message}`);
  }

  const { error: expenseInsertError } = await client.from("expense_details").upsert(expenseRows, {
    onConflict: "claim_id",
  });

  if (expenseInsertError) {
    throw new Error(`Expense seed failed: ${expenseInsertError.message}`);
  }
}

async function cleanupSeedFinanceClaims(seedTag: string): Promise<void> {
  const client = getAdminClient();
  const claimIds = Array.from(
    { length: 12 },
    (_, index) => `E2E-CSV-${seedTag}-${String(index + 1).padStart(2, "0")}`,
  );

  const { error: claimDeleteError } = await client
    .from("claims")
    .update({ is_active: false })
    .in("id", claimIds);

  if (claimDeleteError) {
    throw new Error(`Claim cleanup failed: ${claimDeleteError.message}`);
  }
}

test("Finance user can download full Excel containing all form fields", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const seedTag = `${Date.now()}`;
  await seedFinanceClaims(seedTag);

  try {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });

    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 30);
    const from = startDate.toISOString().slice(0, 10);
    const to = endDate.toISOString().slice(0, 10);

    await page.goto(`/dashboard/my-claims?view=submissions&from=${from}&to=${to}`, {
      waitUntil: "networkidle",
    });

    const exportButton = page.getByRole("button", { name: /Export Excel/i });
    await expect(exportButton).toBeVisible();

    await fs.mkdir(testInfo.outputDir, { recursive: true });
    const targetPath = path.join(testInfo.outputDir, "claims_export.xlsx");

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }),
      exportButton.click(),
    ]);
    await download.saveAs(targetPath);

    const fileStat = await fs.stat(targetPath);
    if (fileStat.size === 0) {
      throw new Error(
        `Export download produced an empty file. Console errors: ${consoleErrors.join(" | ")}`,
      );
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(targetPath);
    const worksheet = workbook.getWorksheet(1) ?? workbook.worksheets[0];

    if (!worksheet) {
      throw new Error("Exported workbook does not contain a worksheet.");
    }

    expect(worksheet.rowCount).toBeGreaterThan(11);

    const rowValues = worksheet.getRow(1).values as (string | null | undefined)[];
    const headers = rowValues.slice(1).map((header) => normalizeCellValue(header).trim());
    expect(headers).toEqual([
      "Claim ID",
      "Employee ID",
      "Beneficiary Employee ID",
      "Submitter Employee ID",
      "Employee Email",
      "Employee Name",
      "Department",
      "Petty Cash Balance",
      "Submitter",
      "Submitter Email",
      "Payment Mode",
      "Submission Type",
      "Purpose",
      "Claim Raised Date",
      "HOD Approved Date",
      "Finance Approved Date",
      "Bill Date",
      "Claim Status",
      "HOD Status",
      "Finance Status",
      "Bill Status",
      "Bill Number",
      "Basic Amount",
      "CGST",
      "SGST",
      "IGST",
      "Total Amount",
      "Currency",
      "Approved Amount",
      "Vendor Name",
      "Transaction Category",
      "Product",
      "Expense Location",
      "Location Type",
      "Location Details",
      "Bank Statement URL",
      "Bill URL",
      "Petty Cash Photo URL",
      "Petty Cash Request Month",
      "Transaction Count",
      "Claim Remarks",
      "Transaction Remarks",
    ]);

    const bankUrlIndex = headers.indexOf("Bank Statement URL");
    const billUrlIndex = headers.indexOf("Bill URL");
    const pettyCashPhotoUrlIndex = headers.indexOf("Petty Cash Photo URL");

    expect(bankUrlIndex).toBeGreaterThan(-1);
    expect(billUrlIndex).toBeGreaterThan(-1);
    expect(pettyCashPhotoUrlIndex).toBeGreaterThan(-1);

    const bankValues = Array.from({ length: worksheet.rowCount - 1 }, (_, offset) =>
      normalizeCellValue(worksheet.getRow(offset + 2).getCell(bankUrlIndex + 1).value).trim(),
    ).filter((value) => value.length > 0);

    const billValues = Array.from({ length: worksheet.rowCount - 1 }, (_, offset) =>
      normalizeCellValue(worksheet.getRow(offset + 2).getCell(billUrlIndex + 1).value).trim(),
    ).filter((value) => value.length > 0);

    const pettyCashPhotoValues = Array.from({ length: worksheet.rowCount - 1 }, (_, offset) =>
      normalizeCellValue(
        worksheet.getRow(offset + 2).getCell(pettyCashPhotoUrlIndex + 1).value,
      ).trim(),
    ).filter((value) => value.length > 0);

    const urlColumnValuePattern = /document unavailable|https?:\/\/|=HYPERLINK\(/i;

    expect(bankValues.length).toBeGreaterThan(0);
    expect(billValues.length).toBeGreaterThan(0);
    expect(pettyCashPhotoValues.length).toBeGreaterThan(0);

    expect(bankValues.some((value) => urlColumnValuePattern.test(value))).toBe(true);
    expect(billValues.some((value) => urlColumnValuePattern.test(value))).toBe(true);
    expect(pettyCashPhotoValues.some((value) => urlColumnValuePattern.test(value))).toBe(true);
  } finally {
    await cleanupSeedFinanceClaims(seedTag);
  }
});
