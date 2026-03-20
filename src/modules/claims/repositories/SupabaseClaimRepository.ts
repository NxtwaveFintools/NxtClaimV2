import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import {
  DB_CLAIM_STATUSES,
  type DbClaimStatus,
  mapCanonicalStatusToDbStatuses,
} from "@/core/constants/statuses";
import type {
  ClaimDepartmentApprovers,
  ClaimExportRecord,
  ClaimDropdownOption,
  ClaimPaymentMode,
  ClaimsExportFetchScope,
  FinanceClaimEditPayload,
  GetMyClaimsFilters,
  MyClaimRecord,
  ClaimRepository,
} from "@/core/domain/claims/contracts";

type ClaimOptionRow = {
  id: string;
  name: string;
};

type PaymentModeRow = {
  id: string;
  name: string;
  is_active: boolean;
};

type ClaimRelationNameRow = {
  name: string;
};

type ClaimSubmitterRow = {
  full_name: string | null;
  email: string;
};

type ClaimExpenseDetailRow = {
  total_amount: number | string | null;
  purpose?: string | null;
  receipt_file_path?: string | null;
  bank_statement_file_path?: string | null;
  master_expense_categories?: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
};

type ClaimAdvanceDetailRow = {
  requested_amount: number | string | null;
  purpose?: string | null;
  supporting_document_path?: string | null;
};

type GetMyClaimsRow = {
  id: string;
  employee_id: string;
  on_behalf_email: string | null;
  submission_type: "Self" | "On Behalf";
  status: DbClaimStatus;
  submitted_at: string;
  master_departments: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  master_payment_modes: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  expense_details: ClaimExpenseDetailRow | ClaimExpenseDetailRow[] | null;
  advance_details: ClaimAdvanceDetailRow | ClaimAdvanceDetailRow[] | null;
};

type GetMyClaimsPaginatedRow = {
  id: string;
  employee_id: string;
  detail_type: "expense" | "advance";
  submission_type: "Self" | "On Behalf";
  submitted_by: string;
  status: DbClaimStatus;
  submitted_at: string;
  created_at: string;
  updated_at: string;
  submitter_user: ClaimSubmitterRow | ClaimSubmitterRow[] | null;
  master_departments: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  master_payment_modes: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  expense_details: ClaimExpenseDetailRow | ClaimExpenseDetailRow[] | null;
  advance_details: ClaimAdvanceDetailRow | ClaimAdvanceDetailRow[] | null;
};

type DepartmentApproverRoleRow = {
  approver_1: string | null;
  approver_2: string | null;
};

type GetPendingApprovalsRow = {
  id: string;
  employee_id: string;
  detail_type: "expense" | "advance";
  submission_type: "Self" | "On Behalf";
  on_behalf_email: string | null;
  submitted_by: string;
  status: DbClaimStatus;
  submitted_at: string;
  created_at: string;
  updated_at: string;
  submitter_user: ClaimSubmitterRow | ClaimSubmitterRow[] | null;
  master_departments: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  master_payment_modes: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  expense_details: ClaimExpenseDetailRow | ClaimExpenseDetailRow[] | null;
  advance_details: ClaimAdvanceDetailRow | ClaimAdvanceDetailRow[] | null;
};

type ClaimExportExpenseDetailRow = {
  bill_no: string | null;
  purpose: string | null;
  remarks: string | null;
  total_amount: number | string | null;
};

type ClaimExportAdvanceDetailRow = {
  purpose: string | null;
  remarks: string | null;
  requested_amount: number | string | null;
};

type GetClaimsForExportRow = {
  id: string;
  employee_id: string;
  status: DbClaimStatus;
  submitted_at: string;
  created_at: string;
  updated_at: string;
  submitter_user: ClaimSubmitterRow | ClaimSubmitterRow[] | null;
  master_departments: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  master_payment_modes: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  expense_details: ClaimExportExpenseDetailRow | ClaimExportExpenseDetailRow[] | null;
  advance_details: ClaimExportAdvanceDetailRow | ClaimExportAdvanceDetailRow[] | null;
};

type ClaimL1DecisionRow = {
  id: string;
  status: DbClaimStatus;
  assigned_l1_approver_id: string;
  assigned_l2_approver_id: string | null;
};

type ClaimL2DecisionRow = {
  id: string;
  status: DbClaimStatus;
  assigned_l2_approver_id: string | null;
};

type ClaimWalletUpdateExpenseRow = {
  total_amount: number | string | null;
};

type ClaimWalletUpdateAdvanceRow = {
  requested_amount: number | string | null;
};

type ClaimWalletUpdateRow = {
  id: string;
  on_behalf_of_id: string;
  detail_type: "expense" | "advance";
  master_payment_modes: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  expense_details: ClaimWalletUpdateExpenseRow | ClaimWalletUpdateExpenseRow[] | null;
  advance_details: ClaimWalletUpdateAdvanceRow | ClaimWalletUpdateAdvanceRow[] | null;
};

type WalletRow = {
  id: string;
  total_reimbursements_received: number | string | null;
  total_petty_cash_received: number | string | null;
  total_petty_cash_spent: number | string | null;
};

type ClaimDetailExpenseRow = {
  bill_no: string;
  purpose: string | null;
  transaction_date: string;
  basic_amount: number | string | null;
  cgst_amount: number | string | null;
  sgst_amount: number | string | null;
  igst_amount: number | string | null;
  total_amount: number | string | null;
  vendor_name: string | null;
  product_id: string | null;
  remarks: string | null;
  receipt_file_path: string | null;
  bank_statement_file_path: string | null;
};

type ClaimDetailAdvanceRow = {
  purpose: string;
  requested_amount: number | string | null;
  expected_usage_date: string;
  product_id: string | null;
  remarks: string | null;
  supporting_document_path: string | null;
};

type ClaimDetailRow = {
  id: string;
  employee_id: string;
  submission_type: "Self" | "On Behalf";
  detail_type: "expense" | "advance";
  on_behalf_email: string | null;
  status: DbClaimStatus;
  rejection_reason: string | null;
  submitted_at: string;
  department_id: string;
  payment_mode_id: string;
  assigned_l1_approver_id: string;
  assigned_l2_approver_id: string | null;
  submitted_by: string;
  submitter_user: ClaimSubmitterRow | ClaimSubmitterRow[] | null;
  master_departments: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  master_payment_modes: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  expense_details: ClaimDetailExpenseRow | ClaimDetailExpenseRow[] | null;
  advance_details: ClaimDetailAdvanceRow | ClaimDetailAdvanceRow[] | null;
};

type FinanceApproverIdRow = {
  id: string;
};

type FinanceApproverSelectionRow = {
  id: string;
  is_primary: boolean;
  created_at: string;
};

type ClaimFinanceEditExpenseRow = {
  receipt_file_path: string | null;
};

type ClaimFinanceEditAdvanceRow = {
  supporting_document_path: string | null;
};

type ClaimFinanceEditRow = {
  id: string;
  detail_type: "expense" | "advance";
  submitted_by: string;
  expense_details: ClaimFinanceEditExpenseRow | ClaimFinanceEditExpenseRow[] | null;
  advance_details: ClaimFinanceEditAdvanceRow | ClaimFinanceEditAdvanceRow[] | null;
};

function mapOptionRows(rows: ClaimOptionRow[] | null): ClaimDropdownOption[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
  }));
}

function getSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

const FINANCE_CLOSED_STATUSES: DbClaimStatus[] = [DB_CLAIM_STATUSES[2], DB_CLAIM_STATUSES[3]];

const PAYMENT_DONE_CLOSED_STATUS = DB_CLAIM_STATUSES[3];
const PAYMENT_MODE_REIMBURSEMENT = "reimbursement";
const PAYMENT_MODE_PETTY_CASH = "petty cash";
const PAYMENT_MODE_PETTY_CASH_REQUEST = "petty cash request";
const PAYMENT_MODE_BULK_PETTY_CASH_REQUEST = "bulk petty cash request";

const FINANCE_NON_REJECTED_VISIBLE_STATUSES: DbClaimStatus[] = [
  DB_CLAIM_STATUSES[1],
  DB_CLAIM_STATUSES[2],
  DB_CLAIM_STATUSES[3],
];

function toPostgrestInList(values: string[]): string {
  return `(${values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",")})`;
}

function normalizeStatusFilter(status: GetMyClaimsFilters["status"]): DbClaimStatus[] {
  if (!status) {
    return [];
  }

  if (Array.isArray(status)) {
    return status.filter((candidate): candidate is DbClaimStatus =>
      DB_CLAIM_STATUSES.includes(candidate as DbClaimStatus),
    );
  }

  return mapCanonicalStatusToDbStatuses(status);
}

function normalizeDateRange(filters?: GetMyClaimsFilters): { fromDate?: string; toDate?: string } {
  return {
    fromDate: filters?.dateFrom ?? filters?.fromDate,
    toDate: filters?.dateTo ?? filters?.toDate,
  };
}

function normalizeSearchInput(filters?: GetMyClaimsFilters): {
  field: GetMyClaimsFilters["searchField"];
  query: string;
} {
  const query = filters?.searchQuery?.trim() ?? "";
  return {
    field: filters?.searchField,
    query,
  };
}

function mapPendingApprovalRows(rows: GetPendingApprovalsRow[]) {
  return rows.map((row) => {
    const department = getSingleRelation(row.master_departments);
    const paymentMode = getSingleRelation(row.master_payment_modes);
    const expense = getSingleRelation(row.expense_details);
    const advance = getSingleRelation(row.advance_details);
    const expenseCategory = getSingleRelation(expense?.master_expense_categories);
    const submitter = getSingleRelation(row.submitter_user);
    const submitterName = submitter?.full_name?.trim();
    const submitterEmail = submitter?.email?.trim();
    const submitterLabel =
      submitterName && submitterEmail
        ? `${submitterName} (${submitterEmail})`
        : (submitterName ?? submitterEmail ?? row.employee_id);

    return {
      id: row.id,
      employeeId: row.employee_id,
      submitter: submitterLabel,
      departmentName: department?.name ?? null,
      paymentModeName: paymentMode?.name ?? "Unknown Payment Mode",
      detailType: row.detail_type,
      submissionType: row.submission_type,
      onBehalfEmail: row.on_behalf_email,
      purpose: expense?.purpose ?? advance?.purpose ?? null,
      categoryName:
        row.detail_type === "expense" ? (expenseCategory?.name ?? "Uncategorized") : "Advance",
      evidenceFilePath:
        row.detail_type === "expense"
          ? (expense?.receipt_file_path ?? null)
          : (advance?.supporting_document_path ?? null),
      expenseReceiptFilePath: expense?.receipt_file_path ?? null,
      expenseBankStatementFilePath: expense?.bank_statement_file_path ?? null,
      advanceSupportingDocumentPath: advance?.supporting_document_path ?? null,
      totalAmount: toNumber(expense?.total_amount) ?? toNumber(advance?.requested_amount) ?? 0,
      status: row.status,
      submittedAt: row.submitted_at,
    };
  });
}

type ClaimsCursor = {
  createdAt: string;
  id: string;
};

function encodeClaimsCursor(input: ClaimsCursor): string {
  return Buffer.from(`${input.createdAt},${input.id}`, "utf8").toString("base64");
}

function decodeClaimsCursor(cursor: string | null): ClaimsCursor | null {
  if (!cursor) {
    return null;
  }

  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const separatorIndex = decoded.lastIndexOf(",");

    if (separatorIndex <= 0 || separatorIndex === decoded.length - 1) {
      return null;
    }

    const createdAt = decoded.slice(0, separatorIndex);
    const id = decoded.slice(separatorIndex + 1);
    const parsedDate = new Date(createdAt);

    if (Number.isNaN(parsedDate.getTime()) || !id) {
      return null;
    }

    return {
      createdAt: parsedDate.toISOString(),
      id,
    };
  } catch {
    return null;
  }
}

function buildMyClaimsOwnershipOrFilter(userId: string): string {
  return `submitted_by.eq.${userId},on_behalf_of_id.eq.${userId}`;
}

function buildMyClaimsOwnershipWithCursorOrFilter(userId: string, cursor: ClaimsCursor): string {
  return [
    `and(submitted_by.eq.${userId},created_at.lt.${cursor.createdAt})`,
    `and(submitted_by.eq.${userId},created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    `and(on_behalf_of_id.eq.${userId},created_at.lt.${cursor.createdAt})`,
    `and(on_behalf_of_id.eq.${userId},created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
  ].join(",");
}

export class SupabaseClaimRepository implements ClaimRepository {
  private async updateWalletTotalsForClosedClaim(
    claimId: string,
  ): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();

    const { data: claimData, error: claimError } = await client
      .from("claims")
      .select(
        "id, on_behalf_of_id, detail_type, master_payment_modes(name), expense_details(total_amount), advance_details(requested_amount)",
      )
      .eq("id", claimId)
      .eq("is_active", true)
      .maybeSingle();

    if (claimError) {
      return { errorMessage: claimError.message };
    }

    if (!claimData) {
      return { errorMessage: "Claim not found for wallet update." };
    }

    const claim = claimData as ClaimWalletUpdateRow;
    const paymentModeName =
      getSingleRelation(claim.master_payment_modes)?.name?.trim().toLowerCase() ?? "";

    const expense = getSingleRelation(claim.expense_details);
    const advance = getSingleRelation(claim.advance_details);

    let incrementColumn:
      | "total_reimbursements_received"
      | "total_petty_cash_received"
      | "total_petty_cash_spent"
      | null = null;

    let incrementAmount = 0;

    if (paymentModeName === PAYMENT_MODE_REIMBURSEMENT) {
      incrementColumn = "total_reimbursements_received";
      incrementAmount = toNumber(expense?.total_amount) ?? 0;
    } else if (
      paymentModeName === PAYMENT_MODE_PETTY_CASH_REQUEST ||
      paymentModeName === PAYMENT_MODE_BULK_PETTY_CASH_REQUEST
    ) {
      incrementColumn = "total_petty_cash_received";
      incrementAmount = toNumber(advance?.requested_amount) ?? 0;
    } else if (paymentModeName === PAYMENT_MODE_PETTY_CASH) {
      incrementColumn = "total_petty_cash_spent";
      incrementAmount = toNumber(expense?.total_amount) ?? 0;
    }

    if (!incrementColumn || incrementAmount <= 0) {
      return { errorMessage: null };
    }

    const { data: walletData, error: walletReadError } = await client
      .from("wallets")
      .select(
        "id, total_reimbursements_received, total_petty_cash_received, total_petty_cash_spent",
      )
      .eq("user_id", claim.on_behalf_of_id)
      .maybeSingle();

    if (walletReadError && walletReadError.code !== "PGRST116") {
      return { errorMessage: walletReadError.message };
    }

    const wallet = (walletData as WalletRow | null) ?? null;

    const nextTotals = {
      total_reimbursements_received:
        (toNumber(wallet?.total_reimbursements_received) ?? 0) +
        (incrementColumn === "total_reimbursements_received" ? incrementAmount : 0),
      total_petty_cash_received:
        (toNumber(wallet?.total_petty_cash_received) ?? 0) +
        (incrementColumn === "total_petty_cash_received" ? incrementAmount : 0),
      total_petty_cash_spent:
        (toNumber(wallet?.total_petty_cash_spent) ?? 0) +
        (incrementColumn === "total_petty_cash_spent" ? incrementAmount : 0),
    };

    if (!wallet) {
      const { error: insertError } = await client.from("wallets").insert({
        user_id: claim.on_behalf_of_id,
        total_reimbursements_received: nextTotals.total_reimbursements_received,
        total_petty_cash_received: nextTotals.total_petty_cash_received,
        total_petty_cash_spent: nextTotals.total_petty_cash_spent,
      });

      if (insertError) {
        return { errorMessage: insertError.message };
      }

      return { errorMessage: null };
    }

    const { error: updateWalletError } = await client
      .from("wallets")
      .update(nextTotals)
      .eq("id", wallet.id);

    if (updateWalletError) {
      return { errorMessage: updateWalletError.message };
    }

    return { errorMessage: null };
  }

  async getClaimEvidenceSignedUrl(input: {
    filePath: string;
    expiresInSeconds: number;
  }): Promise<{ data: string | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client.storage
      .from("claims")
      .createSignedUrl(input.filePath, input.expiresInSeconds);

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    return { data: data?.signedUrl ?? null, errorMessage: null };
  }

  async getFinanceApproverIdsForUser(
    userId: string,
  ): Promise<{ data: string[]; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("master_finance_approvers")
      .select("id")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    const rows = (data ?? []) as FinanceApproverIdRow[];
    return { data: rows.map((row) => row.id), errorMessage: null };
  }

  async getPrimaryFinanceApproverId(): Promise<{
    data: string | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();

    const { data, error } = await client
      .from("master_finance_approvers")
      .select("id, is_primary, created_at")
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    if (!data) {
      return { data: null, errorMessage: null };
    }

    const row = data as FinanceApproverSelectionRow;
    return { data: row.id, errorMessage: null };
  }

  async getClaimForL1Decision(claimId: string): Promise<{
    data: {
      id: string;
      status: DbClaimStatus;
      assignedL1ApproverId: string;
      assignedL2ApproverId: string | null;
    } | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("claims")
      .select("id, status, assigned_l1_approver_id, assigned_l2_approver_id")
      .eq("id", claimId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    if (!data) {
      return { data: null, errorMessage: null };
    }

    const row = data as ClaimL1DecisionRow;
    return {
      data: {
        id: row.id,
        status: row.status,
        assignedL1ApproverId: row.assigned_l1_approver_id,
        assignedL2ApproverId: row.assigned_l2_approver_id,
      },
      errorMessage: null,
    };
  }

  async updateClaimL1Decision(input: {
    claimId: string;
    status: DbClaimStatus;
    assignedL2ApproverId: string | null;
    rejectionReason: string | null;
  }): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { error } = await client
      .from("claims")
      .update({
        status: input.status,
        assigned_l2_approver_id: input.assignedL2ApproverId,
        rejection_reason: input.rejectionReason,
      })
      .eq("id", input.claimId)
      .eq("is_active", true);

    if (error) {
      return { errorMessage: error.message };
    }

    return { errorMessage: null };
  }

  async getClaimForL2Decision(claimId: string): Promise<{
    data: { id: string; status: DbClaimStatus; assignedL2ApproverId: string | null } | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("claims")
      .select("id, status, assigned_l2_approver_id")
      .eq("id", claimId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    if (!data) {
      return { data: null, errorMessage: null };
    }

    const row = data as ClaimL2DecisionRow;

    return {
      data: {
        id: row.id,
        status: row.status,
        assignedL2ApproverId: row.assigned_l2_approver_id,
      },
      errorMessage: null,
    };
  }

  async updateClaimL2Decision(input: {
    claimId: string;
    status: DbClaimStatus;
    assignedL2ApproverId: string | null;
    rejectionReason: string | null;
  }): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { error } = await client
      .from("claims")
      .update({
        status: input.status,
        assigned_l2_approver_id: input.assignedL2ApproverId,
        rejection_reason: input.rejectionReason,
      })
      .eq("id", input.claimId)
      .eq("is_active", true);

    if (error) {
      return { errorMessage: error.message };
    }

    if (input.status === PAYMENT_DONE_CLOSED_STATUS) {
      const walletUpdateResult = await this.updateWalletTotalsForClosedClaim(input.claimId);
      if (walletUpdateResult.errorMessage) {
        return { errorMessage: walletUpdateResult.errorMessage };
      }
    }

    return { errorMessage: null };
  }

  async getClaimDetailById(claimId: string): Promise<{
    data: {
      id: string;
      employeeId: string;
      submissionType: "Self" | "On Behalf";
      detailType: "expense" | "advance";
      onBehalfEmail: string | null;
      status: DbClaimStatus;
      rejectionReason: string | null;
      submittedAt: string;
      departmentName: string | null;
      paymentModeName: string | null;
      assignedL1ApproverId: string;
      assignedL2ApproverId: string | null;
      submittedBy: string;
      submitter: string;
      expense: {
        billNo: string;
        purpose: string | null;
        transactionDate: string;
        basicAmount: number | null;
        cgstAmount: number | null;
        sgstAmount: number | null;
        igstAmount: number | null;
        totalAmount: number | null;
        vendorName: string | null;
        productId: string | null;
        remarks: string | null;
        receiptFilePath: string | null;
        bankStatementFilePath: string | null;
      } | null;
      advance: {
        purpose: string;
        requestedAmount: number | null;
        expectedUsageDate: string;
        productId: string | null;
        remarks: string | null;
        supportingDocumentPath: string | null;
      } | null;
    } | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("claims")
      .select(
        "id, employee_id, submission_type, detail_type, on_behalf_email, status, rejection_reason, submitted_at, department_id, payment_mode_id, assigned_l1_approver_id, assigned_l2_approver_id, submitted_by, submitter_user:users!claims_submitted_by_fkey(full_name, email), master_departments(name), master_payment_modes(name), expense_details(bill_no, purpose, transaction_date, basic_amount, cgst_amount, sgst_amount, igst_amount, total_amount, vendor_name, product_id, remarks, receipt_file_path, bank_statement_file_path), advance_details(purpose, requested_amount, expected_usage_date, product_id, remarks, supporting_document_path)",
      )
      .eq("id", claimId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    if (!data) {
      return { data: null, errorMessage: null };
    }

    const row = data as ClaimDetailRow;
    const submitter = getSingleRelation(row.submitter_user);
    const submitterName = submitter?.full_name?.trim();
    const submitterEmail = submitter?.email?.trim();
    const submitterLabel =
      submitterName && submitterEmail
        ? `${submitterName} (${submitterEmail})`
        : (submitterName ?? submitterEmail ?? row.employee_id);
    const department = getSingleRelation(row.master_departments);
    const paymentMode = getSingleRelation(row.master_payment_modes);
    const expense = getSingleRelation(row.expense_details);
    const advance = getSingleRelation(row.advance_details);

    return {
      data: {
        id: row.id,
        employeeId: row.employee_id,
        submissionType: row.submission_type,
        detailType: row.detail_type,
        onBehalfEmail: row.on_behalf_email,
        status: row.status,
        rejectionReason: row.rejection_reason,
        submittedAt: row.submitted_at,
        departmentName: department?.name ?? null,
        paymentModeName: paymentMode?.name ?? null,
        assignedL1ApproverId: row.assigned_l1_approver_id,
        assignedL2ApproverId: row.assigned_l2_approver_id,
        submittedBy: row.submitted_by,
        submitter: submitterLabel,
        expense: expense
          ? {
              billNo: expense.bill_no,
              purpose: expense.purpose,
              transactionDate: expense.transaction_date,
              basicAmount: toNumber(expense.basic_amount),
              cgstAmount: toNumber(expense.cgst_amount),
              sgstAmount: toNumber(expense.sgst_amount),
              igstAmount: toNumber(expense.igst_amount),
              totalAmount: toNumber(expense.total_amount),
              vendorName: expense.vendor_name,
              productId: expense.product_id,
              remarks: expense.remarks,
              receiptFilePath: expense.receipt_file_path,
              bankStatementFilePath: expense.bank_statement_file_path,
            }
          : null,
        advance: advance
          ? {
              purpose: advance.purpose,
              requestedAmount: toNumber(advance.requested_amount),
              expectedUsageDate: advance.expected_usage_date,
              productId: advance.product_id,
              remarks: advance.remarks,
              supportingDocumentPath: advance.supporting_document_path,
            }
          : null,
      },
      errorMessage: null,
    };
  }

  async getClaimForFinanceEdit(claimId: string): Promise<{
    data: {
      id: string;
      detailType: "expense" | "advance";
      submittedBy: string;
      expenseReceiptFilePath: string | null;
      advanceSupportingDocumentPath: string | null;
    } | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("claims")
      .select(
        "id, detail_type, submitted_by, expense_details(receipt_file_path), advance_details(supporting_document_path)",
      )
      .eq("id", claimId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    if (!data) {
      return { data: null, errorMessage: null };
    }

    const row = data as ClaimFinanceEditRow;
    const expense = getSingleRelation(row.expense_details);
    const advance = getSingleRelation(row.advance_details);

    return {
      data: {
        id: row.id,
        detailType: row.detail_type,
        submittedBy: row.submitted_by,
        expenseReceiptFilePath: expense?.receipt_file_path ?? null,
        advanceSupportingDocumentPath: advance?.supporting_document_path ?? null,
      },
      errorMessage: null,
    };
  }

  async updateClaimDetailsByFinance(
    claimId: string,
    payload: FinanceClaimEditPayload,
  ): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();

    if (payload.detailType === "expense") {
      const { error } = await client
        .from("expense_details")
        .update({
          bill_no: payload.billNo,
          vendor_name: payload.vendorName,
          basic_amount: payload.basicAmount,
          total_amount: payload.totalAmount,
          purpose: payload.purpose,
          product_id: payload.productId,
          remarks: payload.remarks,
          receipt_file_path: payload.receiptFilePath,
        })
        .eq("claim_id", claimId)
        .eq("is_active", true);

      if (error) {
        return { errorMessage: error.message };
      }

      return { errorMessage: null };
    }

    const { error } = await client
      .from("advance_details")
      .update({
        purpose: payload.purpose,
        product_id: payload.productId,
        remarks: payload.remarks,
        supporting_document_path: payload.supportingDocumentPath,
      })
      .eq("claim_id", claimId)
      .eq("is_active", true);

    if (error) {
      return { errorMessage: error.message };
    }

    return { errorMessage: null };
  }

  async getApprovalViewerContext(userId: string): Promise<{
    data: { isHod: boolean; isFounder: boolean; isFinance: boolean };
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();

    const [departmentRoleResult, financeRoleResult] = await Promise.all([
      client
        .from("master_departments")
        .select("approver_1, approver_2")
        .eq("is_active", true)
        .or(`approver_1.eq.${userId},approver_2.eq.${userId}`),
      client
        .from("master_finance_approvers")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true)
        .limit(1),
    ]);

    if (departmentRoleResult.error) {
      return {
        data: { isHod: false, isFounder: false, isFinance: false },
        errorMessage: departmentRoleResult.error.message,
      };
    }

    if (financeRoleResult.error) {
      return {
        data: { isHod: false, isFounder: false, isFinance: false },
        errorMessage: financeRoleResult.error.message,
      };
    }

    const departmentRows = (departmentRoleResult.data ?? []) as DepartmentApproverRoleRow[];

    return {
      data: {
        isHod: departmentRows.some((row) => row.approver_1 === userId),
        isFounder: departmentRows.some((row) => row.approver_2 === userId),
        isFinance: (financeRoleResult.data ?? []).length > 0,
      },
      errorMessage: null,
    };
  }

  async getActivePaymentModes(): Promise<{
    data: ClaimPaymentMode[];
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("master_payment_modes")
      .select("id, name, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    const rows = (data ?? []) as PaymentModeRow[];
    return {
      data: rows.map((row) => ({ id: row.id, name: row.name, isActive: row.is_active })),
      errorMessage: null,
    };
  }

  async getActiveDepartments(): Promise<{
    data: ClaimDropdownOption[];
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("master_departments")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    return { data: mapOptionRows((data ?? []) as ClaimOptionRow[]), errorMessage: null };
  }

  async getActiveExpenseCategories(): Promise<{
    data: ClaimDropdownOption[];
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("master_expense_categories")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    return { data: mapOptionRows((data ?? []) as ClaimOptionRow[]), errorMessage: null };
  }

  async getActiveProducts(): Promise<{ data: ClaimDropdownOption[]; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("master_products")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    return { data: mapOptionRows((data ?? []) as ClaimOptionRow[]), errorMessage: null };
  }

  async getActiveLocations(): Promise<{
    data: ClaimDropdownOption[];
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("master_locations")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    return { data: mapOptionRows((data ?? []) as ClaimOptionRow[]), errorMessage: null };
  }

  async getUserSummary(userId: string): Promise<{
    data: { id: string; email: string; fullName: string | null } | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("users")
      .select("id, email, full_name")
      .eq("id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    if (!data) {
      return { data: null, errorMessage: null };
    }

    return {
      data: {
        id: data.id as string,
        email: data.email as string,
        fullName: (data.full_name as string | null) ?? null,
      },
      errorMessage: null,
    };
  }

  async getPaymentModeById(
    paymentModeId: string,
  ): Promise<{ data: ClaimPaymentMode | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("master_payment_modes")
      .select("id, name, is_active")
      .eq("id", paymentModeId)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    if (!data) {
      return { data: null, errorMessage: null };
    }

    const row = data as PaymentModeRow;
    return {
      data: {
        id: row.id,
        name: row.name,
        isActive: row.is_active,
      },
      errorMessage: null,
    };
  }

  async existsExpenseByCompositeKey(input: {
    billNo: string;
    transactionDate: string;
    totalAmount: number;
  }): Promise<{ exists: boolean; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("expense_details")
      .select("id")
      .eq("bill_no", input.billNo)
      .eq("transaction_date", input.transactionDate)
      .eq("total_amount", input.totalAmount)
      .eq("is_active", true)
      .limit(1);

    if (error) {
      return { exists: false, errorMessage: error.message };
    }

    return { exists: (data ?? []).length > 0, errorMessage: null };
  }

  async getDepartmentApprovers(departmentId: string): Promise<{
    data: ClaimDepartmentApprovers | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("master_departments")
      .select("approver_1, approver_2")
      .eq("id", departmentId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    if (!data) {
      return { data: null, errorMessage: null };
    }

    const row = data as DepartmentApproverRoleRow;
    return {
      data: {
        approver1Id: row.approver_1,
        approver2Id: row.approver_2,
      },
      errorMessage: null,
    };
  }

  async getActiveUserIdByEmail(
    email: string,
  ): Promise<{ data: string | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await client
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    return {
      data: (data?.id as string | undefined) ?? null,
      errorMessage: null,
    };
  }

  async isUserApprover1InAnyDepartment(
    userId: string,
  ): Promise<{ isApprover1: boolean; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("master_departments")
      .select("id")
      .eq("approver_1", userId)
      .eq("is_active", true)
      .limit(1);

    if (error) {
      return { isApprover1: false, errorMessage: error.message };
    }

    return { isApprover1: (data ?? []).length > 0, errorMessage: null };
  }

  async createClaimWithDetail(
    payload: Record<string, unknown>,
  ): Promise<{ claimId: string | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client.rpc("create_claim_with_detail", { p_payload: payload });

    if (error) {
      return { claimId: null, errorMessage: error.message };
    }

    if (typeof data !== "string") {
      return { claimId: null, errorMessage: "Claim creation returned unexpected response." };
    }

    return { claimId: data, errorMessage: null };
  }

  async getMyClaims(
    userId: string,
    filters?: GetMyClaimsFilters,
  ): Promise<{ data: MyClaimRecord[]; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const normalizedStatuses = normalizeStatusFilter(filters?.status);
    const { fromDate, toDate } = normalizeDateRange(filters);
    const dateColumn = filters?.dateTarget === "finance_closed" ? "updated_at" : "submitted_at";
    const normalizedSearch = normalizeSearchInput(filters);

    let query = client
      .from("claims")
      .select(
        "id, employee_id, on_behalf_email, submission_type, status, submitted_at, updated_at, submitter_user:users!claims_submitted_by_fkey!inner(full_name, email), master_departments(name), master_payment_modes(name), expense_details(total_amount), advance_details(requested_amount)",
      )
      .or(buildMyClaimsOwnershipOrFilter(userId))
      .eq("is_active", true)
      .order("submitted_at", { ascending: false });

    if (filters?.detailType) {
      query = query.eq("detail_type", filters.detailType);
    }

    if (filters?.paymentModeId) {
      query = query.eq("payment_mode_id", filters.paymentModeId);
    }

    if (filters?.submissionType) {
      query = query.eq("submission_type", filters.submissionType);
    }

    if (normalizedStatuses.length > 0) {
      query = query.in("status", normalizedStatuses);
    }

    if (filters?.dateTarget === "finance_closed") {
      query = query.in("status", FINANCE_CLOSED_STATUSES);
    }

    if (fromDate) {
      query = query.gte(dateColumn, `${fromDate}T00:00:00.000Z`);
    }

    if (toDate) {
      query = query.lte(dateColumn, `${toDate}T23:59:59.999Z`);
    }

    if (normalizedSearch.query && normalizedSearch.field) {
      if (normalizedSearch.field === "claim_id") {
        query = query.eq("id", normalizedSearch.query);
      }

      if (normalizedSearch.field === "employee_name") {
        query = query.ilike("submitter_user.full_name", `%${normalizedSearch.query}%`);
      }

      if (normalizedSearch.field === "employee_id") {
        query = query.ilike("employee_id", `%${normalizedSearch.query}%`);
      }
    }

    const { data, error } = await query;

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    const rows = (data ?? []) as GetMyClaimsRow[];
    return {
      data: rows.map((row) => {
        const department = getSingleRelation(row.master_departments);
        const paymentMode = getSingleRelation(row.master_payment_modes);
        const expense = getSingleRelation(row.expense_details);
        const advance = getSingleRelation(row.advance_details);

        return {
          id: row.id,
          employeeId: row.employee_id,
          onBehalfEmail: row.on_behalf_email,
          departmentName: department?.name ?? null,
          paymentModeName: paymentMode?.name ?? "Unknown Payment Mode",
          submissionType: row.submission_type,
          status: row.status,
          submittedAt: row.submitted_at,
          expenseTotalAmount: toNumber(expense?.total_amount),
          advanceRequestedAmount: toNumber(advance?.requested_amount),
        };
      }),
      errorMessage: null,
    };
  }

  async getMyClaimsPaginated(
    userId: string,
    cursor: string | null,
    limit: number,
    filters?: GetMyClaimsFilters,
  ): Promise<{
    data: Array<{
      id: string;
      employeeId: string;
      submitter: string;
      departmentName: string | null;
      paymentModeName: string;
      totalAmount: number;
      status: DbClaimStatus;
      submittedAt: string;
      financeApprovedOn: string | null;
    }>;
    nextCursor: string | null;
    hasNextPage: boolean;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const decodedCursor = decodeClaimsCursor(cursor);
    const normalizedStatuses = normalizeStatusFilter(filters?.status);
    const { fromDate, toDate } = normalizeDateRange(filters);
    const dateColumn = filters?.dateTarget === "finance_closed" ? "updated_at" : "submitted_at";
    const normalizedSearch = normalizeSearchInput(filters);

    if (cursor && !decodedCursor) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        errorMessage: "Invalid cursor format.",
      };
    }

    let query = client
      .from("claims")
      .select(
        "id, employee_id, detail_type, submission_type, submitted_by, status, submitted_at, created_at, updated_at, submitter_user:users!claims_submitted_by_fkey!inner(full_name, email), master_departments(name), master_payment_modes(name), expense_details(total_amount), advance_details(requested_amount)",
      )
      .or(
        decodedCursor
          ? buildMyClaimsOwnershipWithCursorOrFilter(userId, decodedCursor)
          : buildMyClaimsOwnershipOrFilter(userId),
      )
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (filters?.detailType) {
      query = query.eq("detail_type", filters.detailType);
    }

    if (filters?.paymentModeId) {
      query = query.eq("payment_mode_id", filters.paymentModeId);
    }

    if (filters?.submissionType) {
      query = query.eq("submission_type", filters.submissionType);
    }

    if (normalizedStatuses.length > 0) {
      query = query.in("status", normalizedStatuses);
    }

    if (filters?.dateTarget === "finance_closed") {
      query = query.in("status", FINANCE_CLOSED_STATUSES);
    }

    if (fromDate) {
      query = query.gte(dateColumn, `${fromDate}T00:00:00.000Z`);
    }

    if (toDate) {
      query = query.lte(dateColumn, `${toDate}T23:59:59.999Z`);
    }

    if (normalizedSearch.query && normalizedSearch.field) {
      if (normalizedSearch.field === "claim_id") {
        query = query.eq("id", normalizedSearch.query);
      }

      if (normalizedSearch.field === "employee_name") {
        query = query.ilike("submitter_user.full_name", `%${normalizedSearch.query}%`);
      }

      if (normalizedSearch.field === "employee_id") {
        query = query.ilike("employee_id", `%${normalizedSearch.query}%`);
      }
    }

    const { data, error } = await query.limit(limit + 1);

    if (error) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        errorMessage: error.message,
      };
    }

    const rows = (data ?? []) as GetMyClaimsPaginatedRow[];
    const hasExtraRecord = rows.length > limit;
    const pageRows = hasExtraRecord ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1] ?? null;
    const nextCursor =
      hasExtraRecord && lastRow
        ? encodeClaimsCursor({ createdAt: lastRow.created_at, id: lastRow.id })
        : null;

    const mappedRows = pageRows.map((row) => {
      const department = getSingleRelation(row.master_departments);
      const paymentMode = getSingleRelation(row.master_payment_modes);
      const expense = getSingleRelation(row.expense_details);
      const advance = getSingleRelation(row.advance_details);
      const submitter = getSingleRelation(row.submitter_user);
      const submitterName = submitter?.full_name?.trim();
      const submitterEmail = submitter?.email?.trim();
      const submitterLabel =
        submitterName && submitterEmail
          ? `${submitterName} (${submitterEmail})`
          : (submitterName ?? submitterEmail ?? row.employee_id);

      return {
        id: row.id,
        employeeId: row.employee_id,
        submitter: submitterLabel,
        departmentName: department?.name ?? null,
        paymentModeName: paymentMode?.name ?? "Unknown Payment Mode",
        totalAmount: toNumber(expense?.total_amount) ?? toNumber(advance?.requested_amount) ?? 0,
        status: row.status,
        submittedAt: row.submitted_at,
        financeApprovedOn: FINANCE_CLOSED_STATUSES.includes(row.status) ? row.updated_at : null,
      };
    });

    return {
      data: mappedRows,
      nextCursor,
      hasNextPage: hasExtraRecord,
      errorMessage: null,
    };
  }

  async getPendingApprovalsForL1(
    userId: string,
    cursor: string | null,
    limit: number,
    filters?: GetMyClaimsFilters,
  ): Promise<{
    data: Array<{
      id: string;
      employeeId: string;
      submitter: string;
      departmentName: string | null;
      paymentModeName: string;
      detailType: "expense" | "advance";
      submissionType: "Self" | "On Behalf";
      onBehalfEmail: string | null;
      purpose: string | null;
      categoryName: string;
      evidenceFilePath: string | null;
      expenseReceiptFilePath: string | null;
      expenseBankStatementFilePath: string | null;
      advanceSupportingDocumentPath: string | null;
      totalAmount: number;
      status: DbClaimStatus;
      submittedAt: string;
    }>;
    nextCursor: string | null;
    hasNextPage: boolean;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const decodedCursor = decodeClaimsCursor(cursor);
    const normalizedStatuses = normalizeStatusFilter(filters?.status);
    const { fromDate, toDate } = normalizeDateRange(filters);
    const dateColumn = filters?.dateTarget === "finance_closed" ? "updated_at" : "submitted_at";
    const normalizedSearch = normalizeSearchInput(filters);

    if (cursor && !decodedCursor) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        errorMessage: "Invalid cursor format.",
      };
    }

    let query = client
      .from("claims")
      .select(
        "id, employee_id, detail_type, submission_type, on_behalf_email, submitted_by, status, submitted_at, created_at, updated_at, submitter_user:users!claims_submitted_by_fkey!inner(full_name, email), master_departments(name), master_payment_modes(name), expense_details(total_amount, purpose, receipt_file_path, bank_statement_file_path, master_expense_categories(name)), advance_details(requested_amount, purpose, supporting_document_path)",
      )
      .eq("assigned_l1_approver_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (filters?.detailType) {
      query = query.eq("detail_type", filters.detailType);
    }

    if (filters?.paymentModeId) {
      query = query.eq("payment_mode_id", filters.paymentModeId);
    }

    if (filters?.submissionType) {
      query = query.eq("submission_type", filters.submissionType);
    }

    if (normalizedStatuses.length > 0) {
      query = query.in("status", normalizedStatuses);
    }

    if (filters?.dateTarget === "finance_closed") {
      query = query.in("status", FINANCE_CLOSED_STATUSES);
    }

    if (fromDate) {
      query = query.gte(dateColumn, `${fromDate}T00:00:00.000Z`);
    }

    if (toDate) {
      query = query.lte(dateColumn, `${toDate}T23:59:59.999Z`);
    }

    if (normalizedSearch.query && normalizedSearch.field) {
      if (normalizedSearch.field === "claim_id") {
        query = query.eq("id", normalizedSearch.query);
      }

      if (normalizedSearch.field === "employee_name") {
        query = query.ilike("submitter_user.full_name", `%${normalizedSearch.query}%`);
      }

      if (normalizedSearch.field === "employee_id") {
        query = query.ilike("employee_id", `%${normalizedSearch.query}%`);
      }
    }

    if (decodedCursor) {
      query = query.or(
        `created_at.lt.${decodedCursor.createdAt},and(created_at.eq.${decodedCursor.createdAt},id.lt.${decodedCursor.id})`,
      );
    }

    const { data, error } = await query.limit(limit + 1);

    if (error) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        errorMessage: error.message,
      };
    }

    const rows = (data ?? []) as GetPendingApprovalsRow[];
    const hasExtraRecord = rows.length > limit;
    const pageRows = hasExtraRecord ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1] ?? null;
    const nextCursor =
      hasExtraRecord && lastRow
        ? encodeClaimsCursor({ createdAt: lastRow.created_at, id: lastRow.id })
        : null;

    return {
      data: mapPendingApprovalRows(pageRows),
      nextCursor,
      hasNextPage: hasExtraRecord,
      errorMessage: null,
    };
  }

  async getPendingApprovalsForFinance(
    userId: string,
    cursor: string | null,
    limit: number,
    filters?: GetMyClaimsFilters,
  ): Promise<{
    data: Array<{
      id: string;
      employeeId: string;
      submitter: string;
      departmentName: string | null;
      paymentModeName: string;
      detailType: "expense" | "advance";
      submissionType: "Self" | "On Behalf";
      onBehalfEmail: string | null;
      purpose: string | null;
      categoryName: string;
      evidenceFilePath: string | null;
      expenseReceiptFilePath: string | null;
      expenseBankStatementFilePath: string | null;
      advanceSupportingDocumentPath: string | null;
      totalAmount: number;
      status: DbClaimStatus;
      submittedAt: string;
    }>;
    nextCursor: string | null;
    hasNextPage: boolean;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const decodedCursor = decodeClaimsCursor(cursor);
    const normalizedStatuses = normalizeStatusFilter(filters?.status);
    const { fromDate, toDate } = normalizeDateRange(filters);
    const dateColumn = filters?.dateTarget === "finance_closed" ? "updated_at" : "submitted_at";
    const normalizedSearch = normalizeSearchInput(filters);

    if (cursor && !decodedCursor) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        errorMessage: "Invalid cursor format.",
      };
    }

    const financeApproversResult = await client
      .from("master_finance_approvers")
      .select("id")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (financeApproversResult.error) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        errorMessage: financeApproversResult.error.message,
      };
    }

    const financeApproverIds = (financeApproversResult.data ?? []).map((row) => row.id as string);
    const isFinanceApprover = financeApproverIds.length > 0;

    if (!isFinanceApprover) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        errorMessage: null,
      };
    }

    const financeNonRejectedStatusesFilter = toPostgrestInList(
      FINANCE_NON_REJECTED_VISIBLE_STATUSES,
    );

    let query = client
      .from("claims")
      .select(
        "id, employee_id, detail_type, submission_type, on_behalf_email, submitted_by, status, submitted_at, created_at, updated_at, submitter_user:users!claims_submitted_by_fkey!inner(full_name, email), master_departments(name), master_payment_modes(name), expense_details(total_amount, purpose, receipt_file_path, bank_statement_file_path, master_expense_categories(name)), advance_details(requested_amount, purpose, supporting_document_path)",
      )
      .or(
        `status.in.${financeNonRejectedStatusesFilter},and(status.eq.Rejected,assigned_l2_approver_id.not.is.null)`,
      )
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (filters?.detailType) {
      query = query.eq("detail_type", filters.detailType);
    }

    if (filters?.paymentModeId) {
      query = query.eq("payment_mode_id", filters.paymentModeId);
    }

    if (filters?.submissionType) {
      query = query.eq("submission_type", filters.submissionType);
    }

    if (normalizedStatuses.length > 0) {
      query = query.in("status", normalizedStatuses);
    }

    if (filters?.dateTarget === "finance_closed") {
      query = query.in("status", FINANCE_CLOSED_STATUSES);
    }

    if (fromDate) {
      query = query.gte(dateColumn, `${fromDate}T00:00:00.000Z`);
    }

    if (toDate) {
      query = query.lte(dateColumn, `${toDate}T23:59:59.999Z`);
    }

    if (normalizedSearch.query && normalizedSearch.field) {
      if (normalizedSearch.field === "claim_id") {
        query = query.eq("id", normalizedSearch.query);
      }

      if (normalizedSearch.field === "employee_name") {
        query = query.ilike("submitter_user.full_name", `%${normalizedSearch.query}%`);
      }

      if (normalizedSearch.field === "employee_id") {
        query = query.ilike("employee_id", `%${normalizedSearch.query}%`);
      }
    }

    if (decodedCursor) {
      query = query.or(
        `created_at.lt.${decodedCursor.createdAt},and(created_at.eq.${decodedCursor.createdAt},id.lt.${decodedCursor.id})`,
      );
    }

    const { data, error } = await query.limit(limit + 1);

    if (error) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        errorMessage: error.message,
      };
    }

    const rows = (data ?? []) as GetPendingApprovalsRow[];
    const hasExtraRecord = rows.length > limit;
    const pageRows = hasExtraRecord ? rows.slice(0, limit) : rows;
    const lastRow = pageRows[pageRows.length - 1] ?? null;
    const nextCursor =
      hasExtraRecord && lastRow
        ? encodeClaimsCursor({ createdAt: lastRow.created_at, id: lastRow.id })
        : null;

    return {
      data: mapPendingApprovalRows(pageRows),
      nextCursor,
      hasNextPage: hasExtraRecord,
      errorMessage: null,
    };
  }

  async getClaimsForExport(input: {
    userId: string;
    fetchScope: ClaimsExportFetchScope;
    filters?: GetMyClaimsFilters;
    limit: number;
    offset: number;
  }): Promise<{ data: ClaimExportRecord[]; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const normalizedStatuses = normalizeStatusFilter(input.filters?.status);
    const { fromDate, toDate } = normalizeDateRange(input.filters);
    const dateColumn =
      input.filters?.dateTarget === "finance_closed" ? "updated_at" : "submitted_at";
    const normalizedSearch = normalizeSearchInput(input.filters);

    let financeApproverIds: string[] = [];

    if (input.fetchScope === "finance_approvals") {
      const financeApproversResult = await client
        .from("master_finance_approvers")
        .select("id")
        .eq("user_id", input.userId)
        .eq("is_active", true)
        .limit(1);

      if (financeApproversResult.error) {
        return {
          data: [],
          errorMessage: financeApproversResult.error.message,
        };
      }

      financeApproverIds = (financeApproversResult.data ?? []).map((row) => row.id as string);

      if (financeApproverIds.length === 0) {
        return { data: [], errorMessage: null };
      }
    }

    let query = client
      .from("claims")
      .select(
        "id, employee_id, detail_type, submission_type, status, submitted_at, created_at, updated_at, submitter_user:users!claims_submitted_by_fkey!inner(full_name, email), master_departments(name), master_payment_modes(name), expense_details(bill_no, purpose, remarks, total_amount), advance_details(purpose, remarks, requested_amount)",
      )
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (input.fetchScope === "submissions") {
      query = query.eq("submitted_by", input.userId);
    }

    if (input.fetchScope === "l1_approvals") {
      query = query.eq("assigned_l1_approver_id", input.userId);
    }

    if (input.fetchScope === "finance_approvals") {
      const financeNonRejectedStatusesFilter = toPostgrestInList(
        FINANCE_NON_REJECTED_VISIBLE_STATUSES,
      );

      query = query.or(
        `status.in.${financeNonRejectedStatusesFilter},and(status.eq.Rejected,assigned_l2_approver_id.not.is.null)`,
      );
    }

    if (input.filters?.detailType) {
      query = query.eq("detail_type", input.filters.detailType);
    }

    if (input.filters?.paymentModeId) {
      query = query.eq("payment_mode_id", input.filters.paymentModeId);
    }

    if (input.filters?.submissionType) {
      query = query.eq("submission_type", input.filters.submissionType);
    }

    if (normalizedStatuses.length > 0) {
      query = query.in("status", normalizedStatuses);
    }

    if (input.filters?.dateTarget === "finance_closed") {
      query = query.in("status", FINANCE_CLOSED_STATUSES);
    }

    if (fromDate) {
      query = query.gte(dateColumn, `${fromDate}T00:00:00.000Z`);
    }

    if (toDate) {
      query = query.lte(dateColumn, `${toDate}T23:59:59.999Z`);
    }

    if (normalizedSearch.query && normalizedSearch.field) {
      if (normalizedSearch.field === "claim_id") {
        query = query.eq("id", normalizedSearch.query);
      }

      if (normalizedSearch.field === "employee_name") {
        query = query.ilike("submitter_user.full_name", `%${normalizedSearch.query}%`);
      }

      if (normalizedSearch.field === "employee_id") {
        query = query.ilike("employee_id", `%${normalizedSearch.query}%`);
      }
    }

    const { data, error } = await query.range(input.offset, input.offset + input.limit - 1);

    if (error) {
      return {
        data: [],
        errorMessage: error.message,
      };
    }

    const rows = (data ?? []) as GetClaimsForExportRow[];

    return {
      data: rows.map((row) => {
        const department = getSingleRelation(row.master_departments);
        const paymentMode = getSingleRelation(row.master_payment_modes);
        const expense = getSingleRelation(row.expense_details);
        const advance = getSingleRelation(row.advance_details);
        const submitter = getSingleRelation(row.submitter_user);
        const submitterName = submitter?.full_name?.trim();
        const submitterEmail = submitter?.email?.trim();

        return {
          claimId: row.id,
          employeeName: submitterName ?? submitterEmail ?? row.employee_id,
          employeeId: row.employee_id,
          departmentName: department?.name ?? null,
          paymentModeName: paymentMode?.name ?? "Unknown Payment Mode",
          submittedAt: row.submitted_at,
          amount: toNumber(expense?.total_amount) ?? toNumber(advance?.requested_amount) ?? 0,
          status: row.status,
          billNo: expense?.bill_no ?? null,
          purpose: expense?.purpose ?? advance?.purpose ?? null,
          remarks: expense?.remarks ?? advance?.remarks ?? null,
        };
      }),
      errorMessage: null,
    };
  }
}
