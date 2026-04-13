import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import {
  DB_CLAIM_STATUSES,
  DB_FINANCE_ACTIONABLE_STATUSES as SHARED_FINANCE_ACTIONABLE_STATUSES,
  DB_FINANCE_EXCLUDED_QUEUE_AND_HISTORY_STATUSES,
  DB_FINANCE_NON_REJECTED_VISIBLE_STATUSES as SHARED_FINANCE_NON_REJECTED_VISIBLE_STATUSES,
  DB_FINANCE_REJECTED_VISIBLE_STATUSES as SHARED_FINANCE_REJECTED_VISIBLE_STATUSES,
  DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS,
  DB_PAYMENT_DONE_CLOSED_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
  DB_REJECTED_STATUSES,
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  type DbClaimStatus,
  mapCanonicalStatusToDbStatuses,
} from "@/core/constants/statuses";
import type {
  ClaimAuditActionType,
  ClaimAuditLogRecord,
  ClaimDateTarget,
  ClaimDepartmentApprovers,
  ClaimExportRecord,
  ClaimFullExportRecord,
  ClaimDropdownOption,
  ClaimListDetail,
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

type EnterpriseClaimsDashboardRow = {
  claim_id: string;
  employee_name: string;
  employee_id: string;
  department_name: string;
  type_of_claim: string;
  amount: number | string;
  status: DbClaimStatus;
  submitted_on: string;
  hod_action_date: string | null;
  finance_action_date: string | null;
  detail_type: "expense" | "advance";
  submission_type: "Self" | "On Behalf";
  created_at: string;
  submitted_by?: string;
  on_behalf_of_id?: string | null;
  on_behalf_email?: string | null;
  assigned_l1_approver_id?: string;
  assigned_l2_approver_id?: string | null;
  department_id?: string;
  payment_mode_id?: string;
  submitter_email?: string | null;
  hod_email?: string | null;
  finance_email?: string | null;
  // Enriched columns added by 20260407000100 migration
  submitter_label?: string | null;
  category_name?: string | null;
  purpose?: string | null;
  receipt_file_path?: string | null;
  bank_statement_file_path?: string | null;
  supporting_document_path?: string | null;
};

type ClaimAuditLogActorRow = {
  full_name: string | null;
  email: string | null;
};

type ClaimAuditLogClaimRow = {
  assigned_l1_approver_id: string | null;
  l1_approver_user: ClaimAuditLogActorRow | ClaimAuditLogActorRow[] | null;
};

type ClaimAuditLogRow = {
  id: string;
  claim_id: string;
  actor_id: string;
  action_type: ClaimAuditActionType;
  assigned_to_id: string | null;
  remarks: string | null;
  created_at: string;
  actor: ClaimAuditLogActorRow | ClaimAuditLogActorRow[] | null;
  assigned_to: ClaimAuditLogActorRow | ClaimAuditLogActorRow[] | null;
  claim?: ClaimAuditLogClaimRow | ClaimAuditLogClaimRow[] | null;
};

type DepartmentApproverRoleRow = {
  hod_user_id: string | null;
  founder_user_id: string | null;
};

type UserLookupRow = {
  id: string;
  is_active: boolean;
};

type GetPendingApprovalsRow = {
  id: string;
  employee_id: string;
  detail_type: "expense" | "advance";
  submission_type: "Self" | "On Behalf";
  on_behalf_email: string | null;
  status: DbClaimStatus;
  submitted_at: string;
  created_at: string;
  hod_action_at: string | null;
  finance_action_at: string | null;
  submitter_user: ClaimSubmitterRow | ClaimSubmitterRow[] | null;
  master_departments: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  master_payment_modes: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  expense_details: ClaimExpenseDetailRow | ClaimExpenseDetailRow[] | null;
  advance_details: ClaimAdvanceDetailRow | ClaimAdvanceDetailRow[] | null;
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

type ClaimMarkPaidFallbackRow = {
  id: string;
  submitted_by: string;
  on_behalf_of_id: string | null;
  status: DbClaimStatus;
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
  id: string;
  bill_no: string;
  purpose: string | null;
  expense_category_id: string | null;
  location_id: string | null;
  location_type: string | null;
  location_details: string | null;
  transaction_date: string;
  is_gst_applicable: boolean | null;
  gst_number: string | null;
  basic_amount: number | string | null;
  cgst_amount: number | string | null;
  sgst_amount: number | string | null;
  igst_amount: number | string | null;
  total_amount: number | string | null;
  vendor_name: string | null;
  product_id: string | null;
  people_involved: string | null;
  remarks: string | null;
  receipt_file_path: string | null;
  bank_statement_file_path: string | null;
  master_expense_categories: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  master_products: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
  master_locations: ClaimRelationNameRow | ClaimRelationNameRow[] | null;
};

type ClaimDetailAdvanceRow = {
  id: string;
  purpose: string;
  requested_amount: number | string | null;
  expected_usage_date: string;
  product_id: string | null;
  location_id: string | null;
  remarks: string | null;
  supporting_document_path: string | null;
};

type ClaimDetailRow = {
  id: string;
  employee_id: string;
  submission_type: "Self" | "On Behalf";
  detail_type: "expense" | "advance";
  on_behalf_of_id: string | null;
  on_behalf_email: string | null;
  on_behalf_employee_code: string | null;
  status: DbClaimStatus;
  rejection_reason: string | null;
  is_resubmission_allowed: boolean;
  submitted_at: string;
  department_id: string;
  payment_mode_id: string;
  assigned_l1_approver_id: string;
  assigned_l2_approver_id: string | null;
  submitted_by: string;
  submitter_user: ClaimSubmitterRow | ClaimSubmitterRow[] | null;
  beneficiary_user: ClaimSubmitterRow | ClaimSubmitterRow[] | null;
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

type BulkProcessClaimsRpcResponse = number | string | null;

type ClaimFinanceEditExpenseRow = {
  receipt_file_path: string | null;
  bank_statement_file_path: string | null;
};

type ClaimFinanceEditAdvanceRow = {
  supporting_document_path: string | null;
};

type ClaimFinanceEditRow = {
  id: string;
  detail_type: "expense" | "advance";
  status: DbClaimStatus;
  submitted_by: string;
  assigned_l1_approver_id: string;
  expense_details: ClaimFinanceEditExpenseRow | ClaimFinanceEditExpenseRow[] | null;
  advance_details: ClaimFinanceEditAdvanceRow | ClaimFinanceEditAdvanceRow[] | null;
};

type ClaimDeleteSnapshotRow = {
  id: string;
  status: DbClaimStatus;
  submitted_by: string;
};

type ExportClaimUserRow = {
  full_name: string | null;
  email: string | null;
};

type ExportClaimFinanceApproverRow = {
  approver_user: ExportClaimUserRow | ExportClaimUserRow[] | null;
};

type ExportClaimLookupRow = {
  id: string;
  name: string;
};

type ExportClaimExpenseRow = {
  bill_no: string | null;
  transaction_id: string | null;
  purpose: string | null;
  expense_category_id: string | null;
  product_id: string | null;
  location_id: string | null;
  location_type: string | null;
  location_details: string | null;
  is_gst_applicable: boolean | null;
  gst_number: string | null;
  transaction_date: string | null;
  basic_amount: number | string | null;
  cgst_amount: number | string | null;
  sgst_amount: number | string | null;
  igst_amount: number | string | null;
  total_amount: number | string | null;
  currency_code: string | null;
  vendor_name: string | null;
  people_involved: string | null;
  remarks: string | null;
  receipt_file_path: string | null;
  bank_statement_file_path: string | null;
  master_expense_categories: ExportClaimLookupRow | ExportClaimLookupRow[] | null;
  master_products: ExportClaimLookupRow | ExportClaimLookupRow[] | null;
  master_locations: ExportClaimLookupRow | ExportClaimLookupRow[] | null;
};

type ExportClaimAdvanceRow = {
  requested_amount: number | string | null;
  budget_month: number | null;
  budget_year: number | null;
  expected_usage_date: string | null;
  purpose: string | null;
  product_id: string | null;
  location_id: string | null;
  remarks: string | null;
  supporting_document_path: string | null;
  master_products: ExportClaimLookupRow | ExportClaimLookupRow[] | null;
  master_locations: ExportClaimLookupRow | ExportClaimLookupRow[] | null;
};

type ExportClaimRow = {
  id: string;
  status: DbClaimStatus;
  submission_type: "Self" | "On Behalf";
  detail_type: "expense" | "advance";
  submitted_by: string;
  on_behalf_of_id: string | null;
  employee_id: string;
  cc_emails: string | null;
  on_behalf_email: string | null;
  on_behalf_employee_code: string | null;
  department_id: string;
  payment_mode_id: string;
  assigned_l1_approver_id: string;
  assigned_l2_approver_id: string | null;
  submitted_at: string;
  hod_action_at: string | null;
  finance_action_at: string | null;
  rejection_reason: string | null;
  is_resubmission_allowed: boolean;
  created_at: string;
  updated_at: string;
  submitter_user: ExportClaimUserRow | ExportClaimUserRow[] | null;
  beneficiary_user: ExportClaimUserRow | ExportClaimUserRow[] | null;
  l1_approver_user: ExportClaimUserRow | ExportClaimUserRow[] | null;
  l2_finance_approver: ExportClaimFinanceApproverRow | ExportClaimFinanceApproverRow[] | null;
  master_departments: ExportClaimLookupRow | ExportClaimLookupRow[] | null;
  master_payment_modes: ExportClaimLookupRow | ExportClaimLookupRow[] | null;
  expense_details: ExportClaimExpenseRow | ExportClaimExpenseRow[] | null;
  advance_details: ExportClaimAdvanceRow | ExportClaimAdvanceRow[] | null;
};

type ExportWalletBalanceRow = {
  user_id: string;
  petty_cash_balance: number | string | null;
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

const FINANCE_NON_REJECTED_VISIBLE_STATUSES: DbClaimStatus[] = [
  ...SHARED_FINANCE_NON_REJECTED_VISIBLE_STATUSES,
];
const FINANCE_REJECTED_VISIBLE_STATUSES: DbClaimStatus[] = [
  ...SHARED_FINANCE_REJECTED_VISIBLE_STATUSES,
];
const FINANCE_VISIBLE_STATUSES: DbClaimStatus[] = [
  ...FINANCE_NON_REJECTED_VISIBLE_STATUSES,
  ...FINANCE_REJECTED_VISIBLE_STATUSES,
];
const FINANCE_VISIBLE_STATUS_SET = new Set<DbClaimStatus>(FINANCE_VISIBLE_STATUSES);
const FINANCE_EXCLUDED_QUEUE_AND_HISTORY_STATUSES_FILTER = toPostgrestInList([
  ...DB_FINANCE_EXCLUDED_QUEUE_AND_HISTORY_STATUSES,
]);
const FINANCE_CLOSED_STATUSES: DbClaimStatus[] = [
  DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS,
  DB_PAYMENT_DONE_CLOSED_STATUS,
  ...FINANCE_REJECTED_VISIBLE_STATUSES,
];

const PAYMENT_DONE_CLOSED_STATUS = DB_PAYMENT_DONE_CLOSED_STATUS;
const PAYMENT_MODE_REIMBURSEMENT = "reimbursement";
const PAYMENT_MODE_PETTY_CASH = "petty cash";
const PAYMENT_MODE_PETTY_CASH_REQUEST = "petty cash request";
const PAYMENT_MODE_BULK_PETTY_CASH_REQUEST = "bulk petty cash request";

const L1_ACTIONABLE_STATUSES: DbClaimStatus[] = [DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS];
const FINANCE_ACTIONABLE_STATUSES: DbClaimStatus[] = [...SHARED_FINANCE_ACTIONABLE_STATUSES];
const EXPORT_CLAIM_LOOKUP_BATCH_SIZE = 50;
const EXPORT_WALLET_LOOKUP_BATCH_SIZE = 200;
const MAX_LIST_PAGE_SIZE = 50;
const UNIQUE_VIOLATION_CODE = "23505";
const DUPLICATE_ACTIVE_EXPENSE_BILL_CONSTRAINT = "uq_expense_details_active_bill";

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    return [values];
  }

  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

function clampListPageSize(limit: number): number {
  if (!Number.isFinite(limit)) {
    return MAX_LIST_PAGE_SIZE;
  }

  return Math.max(1, Math.min(Math.trunc(limit), MAX_LIST_PAGE_SIZE));
}

function toPostgrestInList(values: string[]): string {
  return `(${values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",")})`;
}

function containsDuplicateExpenseBillConstraint(value: string | null | undefined): boolean {
  return (
    typeof value === "string" &&
    value.toLowerCase().includes(DUPLICATE_ACTIVE_EXPENSE_BILL_CONSTRAINT)
  );
}

function isDuplicateExpenseBillConstraintError(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  constraint?: string | null;
}): boolean {
  if (error.code !== UNIQUE_VIOLATION_CODE) {
    return false;
  }

  return [error.message, error.details, error.hint, error.constraint].some((value) =>
    containsDuplicateExpenseBillConstraint(value),
  );
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

function normalizeFinanceVisibleStatusFilter(
  status: GetMyClaimsFilters["status"],
): DbClaimStatus[] {
  const normalized = normalizeStatusFilter(status);

  if (normalized.length === 0) {
    return [];
  }

  return [...new Set(normalized.filter((candidate) => FINANCE_VISIBLE_STATUS_SET.has(candidate)))];
}

function normalizeDateRange(filters?: GetMyClaimsFilters): { fromDate?: string; toDate?: string } {
  return {
    fromDate: filters?.dateFrom ?? filters?.fromDate,
    toDate: filters?.dateTo ?? filters?.toDate,
  };
}

function hasAdvancedEnterpriseDateFilters(filters?: GetMyClaimsFilters): boolean {
  return Boolean(
    filters?.submittedFrom ||
    filters?.submittedTo ||
    filters?.hodActionFrom ||
    filters?.hodActionTo ||
    filters?.financeActionFrom ||
    filters?.financeActionTo,
  );
}

function toStartOfDayIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function toEndOfDayIso(date: string): string {
  return `${date}T23:59:59.999Z`;
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

function buildEmployeeEmailOrFilter(searchQuery: string, submitterEmailColumn: string): string {
  return `${submitterEmailColumn}.ilike.%${searchQuery}%,on_behalf_email.ilike.%${searchQuery}%`;
}

function resolveEnterpriseDateColumn(dateTarget?: ClaimDateTarget): string {
  if (dateTarget === "hod_action") return "hod_action_date";
  if (dateTarget === "finance_closed") return "finance_action_date";
  return "submitted_on";
}

function resolvePendingApprovalsDateColumn(
  dateTarget?: ClaimDateTarget,
  defaultColumn: string = "submitted_at",
): string {
  if (dateTarget === "hod_action") return "hod_action_at";
  // Use the dedicated finance_action_at column rather than the generic updated_at proxy.
  if (dateTarget === "finance_closed") return "finance_action_at";
  return defaultColumn;
}

type EnterpriseDashboardQueryChain<TQuery> = {
  eq(column: string, value: string): TQuery;
  in(column: string, values: DbClaimStatus[]): TQuery;
  not(column: string, operator: string, value: null): TQuery;
  gte(column: string, value: string | number): TQuery;
  lte(column: string, value: string | number): TQuery;
  ilike(column: string, pattern: string): TQuery;
  or(filters: string): TQuery;
};

function applyEnterpriseDashboardFilters<
  TQuery extends EnterpriseDashboardQueryChain<TQuery>,
>(params: {
  query: TQuery;
  filters?: GetMyClaimsFilters;
  normalizedStatuses: DbClaimStatus[];
  fromDate?: string;
  toDate?: string;
  normalizedSearch: { field: GetMyClaimsFilters["searchField"]; query: string };
}): TQuery {
  let { query } = params;

  if (params.filters?.paymentModeId) {
    query = query.eq("payment_mode_id", params.filters.paymentModeId);
  }

  if (params.filters?.departmentId) {
    query = query.eq("department_id", params.filters.departmentId);
  }

  if (params.filters?.locationId) {
    query = query.eq("location_id", params.filters.locationId);
  }

  if (params.filters?.productId) {
    query = query.eq("product_id", params.filters.productId);
  }

  if (params.filters?.expenseCategoryId) {
    query = query.eq("expense_category_id", params.filters.expenseCategoryId);
  }

  if (params.filters?.submissionType) {
    query = query.eq("submission_type", params.filters.submissionType);
  }

  if (params.normalizedStatuses.length > 0) {
    query = query.in("status", params.normalizedStatuses);
  }

  if (hasAdvancedEnterpriseDateFilters(params.filters)) {
    if (params.filters?.submittedFrom) {
      query = query.gte("submitted_on", toStartOfDayIso(params.filters.submittedFrom));
    }

    if (params.filters?.submittedTo) {
      query = query.lte("submitted_on", toEndOfDayIso(params.filters.submittedTo));
    }

    if (params.filters?.hodActionFrom) {
      query = query.gte("hod_action_date", toStartOfDayIso(params.filters.hodActionFrom));
    }

    if (params.filters?.hodActionTo) {
      query = query.lte("hod_action_date", toEndOfDayIso(params.filters.hodActionTo));
    }

    if (params.filters?.financeActionFrom) {
      query = query.gte("finance_action_date", toStartOfDayIso(params.filters.financeActionFrom));
    }

    if (params.filters?.financeActionTo) {
      query = query.lte("finance_action_date", toEndOfDayIso(params.filters.financeActionTo));
    }
  } else {
    if (params.filters?.dateTarget === "finance_closed") {
      query = query.not("finance_action_date", "is", null);
    }

    if (params.filters?.dateTarget === "hod_action") {
      query = query.not("hod_action_date", "is", null);
    }

    if (params.fromDate) {
      const column = resolveEnterpriseDateColumn(params.filters?.dateTarget);
      query = query.gte(column, toStartOfDayIso(params.fromDate));
    }

    if (params.toDate) {
      const column = resolveEnterpriseDateColumn(params.filters?.dateTarget);
      query = query.lte(column, toEndOfDayIso(params.toDate));
    }
  }

  if (typeof params.filters?.minAmount === "number" && Number.isFinite(params.filters.minAmount)) {
    query = query.gte("amount", params.filters.minAmount);
  }

  if (typeof params.filters?.maxAmount === "number" && Number.isFinite(params.filters.maxAmount)) {
    query = query.lte("amount", params.filters.maxAmount);
  }

  if (params.normalizedSearch.query && params.normalizedSearch.field) {
    if (params.normalizedSearch.field === "claim_id") {
      query = query.ilike("claim_id", `%${params.normalizedSearch.query}%`);
    }

    if (params.normalizedSearch.field === "employee_name") {
      query = query.ilike("employee_name", `%${params.normalizedSearch.query}%`);
    }

    if (params.normalizedSearch.field === "employee_id") {
      query = query.ilike("employee_id", `%${params.normalizedSearch.query}%`);
    }

    if (params.normalizedSearch.field === "employee_email") {
      query = query.or(
        buildEmployeeEmailOrFilter(params.normalizedSearch.query, "submitter_email"),
      );
    }
  }

  return query;
}

type PendingApprovalsQueryChain<TQuery> = {
  eq(column: string, value: string): TQuery;
  in(column: string, values: DbClaimStatus[]): TQuery;
  not(column: string, operator: string, value: null): TQuery;
  gte(column: string, value: string): TQuery;
  lte(column: string, value: string): TQuery;
  ilike(column: string, pattern: string): TQuery;
  or(filters: string): TQuery;
};

function applyPendingApprovalsFilters<TQuery extends PendingApprovalsQueryChain<TQuery>>(params: {
  query: TQuery;
  filters?: GetMyClaimsFilters;
  normalizedStatuses: DbClaimStatus[];
  fromDate?: string;
  toDate?: string;
  dateColumn: string;
  normalizedSearch: { field: GetMyClaimsFilters["searchField"]; query: string };
}): TQuery {
  let { query } = params;

  const equalityFilters: Array<[string, string | undefined]> = [
    ["detail_type", params.filters?.detailType],
    ["payment_mode_id", params.filters?.paymentModeId],
    ["department_id", params.filters?.departmentId],
    ["expense_details.location_id", params.filters?.locationId],
    ["expense_details.product_id", params.filters?.productId],
    ["expense_details.expense_category_id", params.filters?.expenseCategoryId],
    ["submission_type", params.filters?.submissionType],
  ];

  for (const [column, value] of equalityFilters) {
    if (value) {
      query = query.eq(column, value);
    }
  }

  if (params.normalizedStatuses.length > 0) {
    query = query.in("status", params.normalizedStatuses);
  }

  // Only restrict by financed-closed status set when the user has NOT set an explicit status filter.
  // If both were applied, they would be AND-ed by PostgREST, and any status not in FINANCE_CLOSED_STATUSES
  // would intersect to an empty set and return 0 results.
  if (params.filters?.dateTarget === "finance_closed" && params.normalizedStatuses.length === 0) {
    query = query.in("status", FINANCE_CLOSED_STATUSES);
  }

  if (params.filters?.dateTarget === "hod_action") {
    query = query.not("hod_action_at", "is", null);
  }

  if (hasAdvancedEnterpriseDateFilters(params.filters)) {
    if (params.filters?.submittedFrom) {
      query = query.gte("submitted_at", toStartOfDayIso(params.filters.submittedFrom));
    }

    if (params.filters?.submittedTo) {
      query = query.lte("submitted_at", toEndOfDayIso(params.filters.submittedTo));
    }

    if (params.filters?.hodActionFrom) {
      query = query.gte("hod_action_at", toStartOfDayIso(params.filters.hodActionFrom));
    }

    if (params.filters?.hodActionTo) {
      query = query.lte("hod_action_at", toEndOfDayIso(params.filters.hodActionTo));
    }

    if (params.filters?.financeActionFrom) {
      query = query.gte("finance_action_at", toStartOfDayIso(params.filters.financeActionFrom));
    }

    if (params.filters?.financeActionTo) {
      query = query.lte("finance_action_at", toEndOfDayIso(params.filters.financeActionTo));
    }
  } else {
    if (params.fromDate) {
      query = query.gte(params.dateColumn, `${params.fromDate}T00:00:00.000Z`);
    }

    if (params.toDate) {
      query = query.lte(params.dateColumn, `${params.toDate}T23:59:59.999Z`);
    }
  }

  if (params.normalizedSearch.query && params.normalizedSearch.field) {
    if (params.normalizedSearch.field === "claim_id") {
      query = query.ilike("id", `%${params.normalizedSearch.query}%`);
    }

    if (params.normalizedSearch.field === "employee_name") {
      query = query.ilike("submitter_user.full_name", `%${params.normalizedSearch.query}%`);
    }

    if (params.normalizedSearch.field === "employee_id") {
      query = query.ilike("employee_id", `%${params.normalizedSearch.query}%`);
    }

    if (params.normalizedSearch.field === "employee_email") {
      query = query.or(
        buildEmployeeEmailOrFilter(params.normalizedSearch.query, "submitter_user.email"),
      );
    }
  }

  return query;
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
      hodActionAt: row.hod_action_at ?? null,
      financeActionAt: row.finance_action_at ?? null,
    };
  });
}

function mapClaimAuditLogRow(row: ClaimAuditLogRow): ClaimAuditLogRecord {
  const actor = getSingleRelation(row.actor);
  const assignedTo = getSingleRelation(row.assigned_to);
  const claim = getSingleRelation(row.claim);
  const claimL1Approver = getSingleRelation(claim?.l1_approver_user);
  const isSubmittedAction = row.action_type === "SUBMITTED";

  const effectiveAssignedToId = isSubmittedAction
    ? (claim?.assigned_l1_approver_id ?? row.assigned_to_id)
    : row.assigned_to_id;
  const effectiveAssignedToName = isSubmittedAction
    ? (claimL1Approver?.full_name ?? assignedTo?.full_name ?? null)
    : (assignedTo?.full_name ?? null);
  const effectiveAssignedToEmail = isSubmittedAction
    ? (claimL1Approver?.email ?? assignedTo?.email ?? null)
    : (assignedTo?.email ?? null);

  return {
    id: row.id,
    claimId: row.claim_id,
    actorId: row.actor_id,
    actorName: actor?.full_name ?? null,
    actorEmail: actor?.email ?? null,
    actionType: row.action_type,
    assignedToId: effectiveAssignedToId,
    assignedToName: effectiveAssignedToName,
    assignedToEmail: effectiveAssignedToEmail,
    remarks: row.remarks,
    createdAt: row.created_at,
  };
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

export class SupabaseClaimRepository implements ClaimRepository {
  private isAlreadyRegisteredError(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return normalized.includes("already registered") || normalized.includes("already exists");
  }

  private isRpcNullableJoinLockError(message: string): boolean {
    return /for update cannot be applied to the nullable side of an outer join/i.test(message);
  }

  private async runMarkPaidFallback(input: {
    claimId: string;
    actorUserId: string;
  }): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();

    const { data: financeApproverData, error: financeApproverError } = await client
      .from("master_finance_approvers")
      .select("id")
      .eq("user_id", input.actorUserId)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (financeApproverError) {
      return { errorMessage: financeApproverError.message };
    }

    const financeApproverId = (financeApproverData as { id: string } | null)?.id ?? null;
    if (!financeApproverId) {
      return { errorMessage: "p_actor_id is not an active finance approver" };
    }

    const { data: claimData, error: claimError } = await client
      .from("claims")
      .select(
        "id, submitted_by, on_behalf_of_id, status, master_payment_modes(name), expense_details(total_amount), advance_details(requested_amount)",
      )
      .eq("id", input.claimId)
      .eq("is_active", true)
      .maybeSingle();

    if (claimError) {
      return { errorMessage: claimError.message };
    }

    if (!claimData) {
      return { errorMessage: `Claim not found or inactive: ${input.claimId}` };
    }

    const claim = claimData as ClaimMarkPaidFallbackRow;

    if (claim.status !== DB_CLAIM_STATUSES[2]) {
      return { errorMessage: "Claim is not in payment-under-process stage." };
    }

    const beneficiaryUserId = claim.on_behalf_of_id ?? claim.submitted_by;
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

    const { data: updatedClaim, error: updateClaimError } = await client
      .from("claims")
      .update({
        status: PAYMENT_DONE_CLOSED_STATUS,
        assigned_l2_approver_id: financeApproverId,
        rejection_reason: null,
        is_resubmission_allowed: false,
        finance_action_at: new Date().toISOString(),
      })
      .eq("id", input.claimId)
      .eq("is_active", true)
      .eq("status", DB_CLAIM_STATUSES[2])
      .select("id")
      .maybeSingle();

    if (updateClaimError) {
      return { errorMessage: updateClaimError.message };
    }

    if (!updatedClaim) {
      return {
        errorMessage: `Claim state changed during mark-paid transition: ${input.claimId}`,
      };
    }

    if (beneficiaryUserId && incrementColumn && incrementAmount > 0) {
      const { data: walletData, error: walletReadError } = await client
        .from("wallets")
        .select(
          "id, total_reimbursements_received, total_petty_cash_received, total_petty_cash_spent",
        )
        .eq("user_id", beneficiaryUserId)
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
          user_id: beneficiaryUserId,
          total_reimbursements_received: nextTotals.total_reimbursements_received,
          total_petty_cash_received: nextTotals.total_petty_cash_received,
          total_petty_cash_spent: nextTotals.total_petty_cash_spent,
        });

        if (insertError) {
          return { errorMessage: insertError.message };
        }
      } else {
        const { error: updateWalletError } = await client
          .from("wallets")
          .update(nextTotals)
          .eq("id", wallet.id);

        if (updateWalletError) {
          return { errorMessage: updateWalletError.message };
        }
      }
    }

    const auditResult = await this.createClaimAuditLog({
      claimId: input.claimId,
      actorId: input.actorUserId,
      actionType: "L2_MARK_PAID",
      assignedToId: null,
      remarks: null,
    });

    if (auditResult.errorMessage) {
      return { errorMessage: auditResult.errorMessage };
    }

    return { errorMessage: null };
  }

  private async getUserByEmail(
    email: string,
  ): Promise<{ data: UserLookupRow | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("users")
      .select("id, is_active")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    return {
      data: (data as UserLookupRow | null) ?? null,
      errorMessage: null,
    };
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

  async getFinancePendingApprovalsCount(
    userId: string,
    filters?: GetMyClaimsFilters,
  ): Promise<{ count: number; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const normalizedStatuses = normalizeStatusFilter(filters?.status);
    const { fromDate, toDate } = normalizeDateRange(filters);
    const normalizedSearch = normalizeSearchInput(filters);

    const financeApproversResult = await client
      .from("master_finance_approvers")
      .select("id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1);

    if (financeApproversResult.error) {
      return { count: 0, errorMessage: financeApproversResult.error.message };
    }

    if ((financeApproversResult.data ?? []).length === 0) {
      return { count: 0, errorMessage: null };
    }

    let query = client
      .from("vw_enterprise_claims_dashboard")
      .select("claim_id", { count: "exact", head: true })
      .in("status", FINANCE_ACTIONABLE_STATUSES);

    query = applyEnterpriseDashboardFilters({
      query,
      filters,
      normalizedStatuses,
      fromDate,
      toDate,
      normalizedSearch,
    });

    const { count, error } = await query;

    if (error) {
      return { count: 0, errorMessage: error.message };
    }

    return { count: count ?? 0, errorMessage: null };
  }

  async getL1PendingApprovalsCount(
    userId: string,
    filters?: GetMyClaimsFilters,
  ): Promise<{ count: number; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const normalizedStatuses = normalizeStatusFilter(filters?.status);
    const { fromDate, toDate } = normalizeDateRange(filters);
    const dateColumn = resolvePendingApprovalsDateColumn(filters?.dateTarget);
    const normalizedSearch = normalizeSearchInput(filters);

    if (filters?.dateTarget === "finance_closed") {
      return { count: 0, errorMessage: null };
    }

    let query = client
      .from("claims")
      .select("id, submitter_user:users!claims_submitted_by_fkey!inner(full_name, email)", {
        count: "exact",
        head: true,
      })
      .eq("assigned_l1_approver_id", userId)
      .eq("is_active", true)
      .in("status", L1_ACTIONABLE_STATUSES);

    if (filters?.detailType) {
      query = query.eq("detail_type", filters.detailType);
    }

    if (filters?.paymentModeId) {
      query = query.eq("payment_mode_id", filters.paymentModeId);
    }

    if (filters?.departmentId) {
      query = query.eq("department_id", filters.departmentId);
    }

    if (filters?.submissionType) {
      query = query.eq("submission_type", filters.submissionType);
    }

    if (normalizedStatuses.length > 0) {
      const actionableStatuses = normalizedStatuses.filter((status) =>
        L1_ACTIONABLE_STATUSES.includes(status),
      );

      if (actionableStatuses.length === 0) {
        return { count: 0, errorMessage: null };
      }

      query = query.in("status", actionableStatuses);
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

      if (normalizedSearch.field === "employee_email") {
        query = query.or(
          buildEmployeeEmailOrFilter(normalizedSearch.query, "submitter_user.email"),
        );
      }
    }

    const { count, error } = await query;

    if (error) {
      return { count: 0, errorMessage: error.message };
    }

    return { count: count ?? 0, errorMessage: null };
  }

  async listFinancePendingApprovalIds(
    userId: string,
    filters?: GetMyClaimsFilters,
  ): Promise<{ data: string[]; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const normalizedStatuses = normalizeFinanceVisibleStatusFilter(filters?.status);
    const { fromDate, toDate } = normalizeDateRange(filters);
    const normalizedSearch = normalizeSearchInput(filters);

    if (filters?.status && normalizedStatuses.length === 0) {
      return { data: [], errorMessage: null };
    }

    const financeApproversResult = await client
      .from("master_finance_approvers")
      .select("id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(1);

    if (financeApproversResult.error) {
      return { data: [], errorMessage: financeApproversResult.error.message };
    }

    if ((financeApproversResult.data ?? []).length === 0) {
      return { data: [], errorMessage: null };
    }

    const financeNonRejectedStatusesFilter = toPostgrestInList(
      FINANCE_NON_REJECTED_VISIBLE_STATUSES,
    );
    const financeRejectedStatusesFilter = toPostgrestInList(FINANCE_REJECTED_VISIBLE_STATUSES);

    let query = client
      .from("vw_enterprise_claims_dashboard")
      .select("claim_id")
      .or(
        `status.in.${financeNonRejectedStatusesFilter},and(status.in.${financeRejectedStatusesFilter},assigned_l2_approver_id.not.is.null)`,
      )
      .not("status", "in", FINANCE_EXCLUDED_QUEUE_AND_HISTORY_STATUSES_FILTER)
      .order("created_at", { ascending: false })
      .order("claim_id", { ascending: false });

    query = applyEnterpriseDashboardFilters({
      query,
      filters,
      normalizedStatuses,
      fromDate,
      toDate,
      normalizedSearch,
    });

    const { data, error } = await query;

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    return {
      data: (data ?? []).map((row) => row.claim_id as string).filter((id) => id.length > 0),
      errorMessage: null,
    };
  }

  async bulkProcessClaims(input: {
    claimIds: string[];
    action: "L2_APPROVE" | "L2_REJECT" | "MARK_PAID";
    actorUserId: string;
    reason?: string;
    allowResubmission?: boolean;
  }): Promise<{ processedCount: number; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client.rpc("bulk_process_claims", {
      p_claim_ids: input.claimIds,
      p_action: input.action,
      p_actor_id: input.actorUserId,
      p_reason: input.reason ?? null,
      p_allow_resubmission: input.allowResubmission === true,
    });

    if (error) {
      return { processedCount: 0, errorMessage: error.message };
    }

    if (data === null || data === undefined) {
      return { processedCount: input.claimIds.length, errorMessage: null };
    }

    const raw = data as BulkProcessClaimsRpcResponse;
    const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 0;

    if (!Number.isFinite(parsed)) {
      return {
        processedCount: 0,
        errorMessage: "Bulk claim process RPC returned an invalid response.",
      };
    }

    return { processedCount: parsed, errorMessage: null };
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
    actorUserId: string;
    status: DbClaimStatus;
    assignedL2ApproverId: string | null;
    rejectionReason: string | null;
    allowResubmission: boolean;
  }): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const isRejectedStatus = DB_REJECTED_STATUSES.some((status) => status === input.status);
    const isL1TerminalStatus =
      input.status === DB_CLAIM_STATUSES[1] ||
      (isRejectedStatus && input.assignedL2ApproverId === null);

    const { error } = await client
      .from("claims")
      .update({
        status: input.status,
        assigned_l2_approver_id: input.assignedL2ApproverId,
        rejection_reason: input.rejectionReason,
        is_resubmission_allowed: input.allowResubmission,
        hod_action_at: isL1TerminalStatus ? new Date().toISOString() : null,
      })
      .eq("id", input.claimId)
      .eq("is_active", true);

    if (error) {
      return { errorMessage: error.message };
    }

    if (input.status === DB_REJECTED_RESUBMISSION_ALLOWED_STATUS && input.allowResubmission) {
      const [{ error: expenseDeactivateError }, { error: advanceDeactivateError }] =
        await Promise.all([
          client
            .from("expense_details")
            .update({ is_active: false })
            .eq("claim_id", input.claimId)
            .eq("is_active", true),
          client
            .from("advance_details")
            .update({ is_active: false })
            .eq("claim_id", input.claimId)
            .eq("is_active", true),
        ]);

      if (expenseDeactivateError) {
        return { errorMessage: expenseDeactivateError.message };
      }

      if (advanceDeactivateError) {
        return { errorMessage: advanceDeactivateError.message };
      }
    }

    const auditActionType: ClaimAuditActionType | null =
      input.status === DB_CLAIM_STATUSES[1]
        ? "L1_APPROVED"
        : isRejectedStatus
          ? "L1_REJECTED"
          : null;

    if (auditActionType) {
      let auditAssignedToId: string | null = null;

      if (auditActionType === "L1_APPROVED" && input.assignedL2ApproverId) {
        const financeApproverLookup = await client
          .from("master_finance_approvers")
          .select("user_id")
          .eq("id", input.assignedL2ApproverId)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();

        if (financeApproverLookup.error) {
          return { errorMessage: financeApproverLookup.error.message };
        }

        const financeApproverUserId =
          (financeApproverLookup.data as { user_id: string } | null)?.user_id ?? null;
        auditAssignedToId = financeApproverUserId;
      }

      const auditResult = await this.createClaimAuditLog({
        claimId: input.claimId,
        actorId: input.actorUserId,
        actionType: auditActionType,
        assignedToId: auditAssignedToId,
        remarks: input.rejectionReason,
      });

      if (auditResult.errorMessage) {
        return { errorMessage: auditResult.errorMessage };
      }
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
    actorUserId: string;
    status: DbClaimStatus;
    assignedL2ApproverId: string | null;
    rejectionReason: string | null;
    allowResubmission: boolean;
  }): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();

    if (input.status === PAYMENT_DONE_CLOSED_STATUS) {
      const { error } = await client.rpc("process_l2_mark_paid_transition", {
        p_claim_id: input.claimId,
        p_actor_id: input.actorUserId,
      });

      if (error) {
        if (!this.isRpcNullableJoinLockError(error.message)) {
          return { errorMessage: error.message };
        }

        return this.runMarkPaidFallback({
          claimId: input.claimId,
          actorUserId: input.actorUserId,
        });
      }

      return { errorMessage: null };
    }

    const isRejectedStatus = DB_REJECTED_STATUSES.some((status) => status === input.status);
    const isFinanceTerminalStatus =
      input.status === DB_CLAIM_STATUSES[2] ||
      (isRejectedStatus && input.assignedL2ApproverId !== null);

    const { error } = await client
      .from("claims")
      .update({
        status: input.status,
        assigned_l2_approver_id: input.assignedL2ApproverId,
        rejection_reason: input.rejectionReason,
        is_resubmission_allowed: input.allowResubmission,
        finance_action_at: isFinanceTerminalStatus ? new Date().toISOString() : null,
      })
      .eq("id", input.claimId)
      .eq("is_active", true);

    if (error) {
      return { errorMessage: error.message };
    }

    if (input.status === DB_REJECTED_RESUBMISSION_ALLOWED_STATUS && input.allowResubmission) {
      const [{ error: expenseDeactivateError }, { error: advanceDeactivateError }] =
        await Promise.all([
          client
            .from("expense_details")
            .update({ is_active: false })
            .eq("claim_id", input.claimId)
            .eq("is_active", true),
          client
            .from("advance_details")
            .update({ is_active: false })
            .eq("claim_id", input.claimId)
            .eq("is_active", true),
        ]);

      if (expenseDeactivateError) {
        return { errorMessage: expenseDeactivateError.message };
      }

      if (advanceDeactivateError) {
        return { errorMessage: advanceDeactivateError.message };
      }
    }

    const auditActionType: ClaimAuditActionType | null =
      input.status === DB_CLAIM_STATUSES[2]
        ? "L2_APPROVED"
        : isRejectedStatus
          ? "L2_REJECTED"
          : null;

    if (auditActionType) {
      const auditResult = await this.createClaimAuditLog({
        claimId: input.claimId,
        actorId: input.actorUserId,
        actionType: auditActionType,
        assignedToId: null,
        remarks: input.rejectionReason,
      });

      if (auditResult.errorMessage) {
        return { errorMessage: auditResult.errorMessage };
      }
    }

    return { errorMessage: null };
  }

  async getClaimDetailById(claimId: string): Promise<{
    data: {
      id: string;
      employeeId: string;
      departmentId: string;
      paymentModeId: string;
      submissionType: "Self" | "On Behalf";
      detailType: "expense" | "advance";
      onBehalfOfId: string | null;
      onBehalfEmail: string | null;
      onBehalfEmployeeCode: string | null;
      status: DbClaimStatus;
      rejectionReason: string | null;
      submittedAt: string;
      departmentName: string | null;
      paymentModeName: string | null;
      assignedL1ApproverId: string;
      assignedL2ApproverId: string | null;
      submittedBy: string;
      submitter: string;
      submitterName: string | null;
      submitterEmail: string | null;
      beneficiaryName: string | null;
      beneficiaryEmail: string | null;
      expense: {
        id: string;
        billNo: string;
        purpose: string | null;
        expenseCategoryId: string | null;
        expenseCategoryName: string | null;
        productName: string | null;
        locationId: string | null;
        locationName: string | null;
        locationType: string | null;
        locationDetails: string | null;
        transactionDate: string;
        isGstApplicable: boolean | null;
        gstNumber: string | null;
        basicAmount: number | null;
        cgstAmount: number | null;
        sgstAmount: number | null;
        igstAmount: number | null;
        totalAmount: number | null;
        vendorName: string | null;
        productId: string | null;
        peopleInvolved: string | null;
        remarks: string | null;
        receiptFilePath: string | null;
        bankStatementFilePath: string | null;
      } | null;
      advance: {
        id: string;
        purpose: string;
        requestedAmount: number | null;
        expectedUsageDate: string;
        productId: string | null;
        locationId: string | null;
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
        "id, employee_id, submission_type, detail_type, on_behalf_of_id, on_behalf_email, on_behalf_employee_code, status, rejection_reason, is_resubmission_allowed, submitted_at, department_id, payment_mode_id, assigned_l1_approver_id, assigned_l2_approver_id, submitted_by, submitter_user:users!claims_submitted_by_fkey(full_name, email), beneficiary_user:users!claims_on_behalf_of_id_fkey(full_name, email), master_departments(name), master_payment_modes(name), expense_details(id, bill_no, purpose, expense_category_id, product_id, location_id, location_type, location_details, is_gst_applicable, gst_number, transaction_date, basic_amount, cgst_amount, sgst_amount, igst_amount, total_amount, vendor_name, people_involved, remarks, receipt_file_path, bank_statement_file_path, master_expense_categories(name), master_products(name), master_locations(name)), advance_details(id, purpose, requested_amount, expected_usage_date, product_id, location_id, remarks, supporting_document_path)",
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
    const beneficiary = getSingleRelation(row.beneficiary_user);
    const submitterName = submitter?.full_name?.trim();
    const submitterEmail = submitter?.email?.trim();
    const beneficiaryName = beneficiary?.full_name?.trim();
    const beneficiaryEmail = beneficiary?.email?.trim();
    const submitterLabel =
      submitterName && submitterEmail
        ? `${submitterName} (${submitterEmail})`
        : (submitterName ?? submitterEmail ?? row.employee_id);
    const department = getSingleRelation(row.master_departments);
    const paymentMode = getSingleRelation(row.master_payment_modes);
    const expense = getSingleRelation(row.expense_details);
    const advance = getSingleRelation(row.advance_details);
    const expenseCategory = getSingleRelation(expense?.master_expense_categories);
    const expenseProduct = getSingleRelation(expense?.master_products);
    const expenseLocation = getSingleRelation(expense?.master_locations);

    return {
      data: {
        id: row.id,
        employeeId: row.employee_id,
        departmentId: row.department_id,
        paymentModeId: row.payment_mode_id,
        submissionType: row.submission_type,
        detailType: row.detail_type,
        onBehalfOfId: row.on_behalf_of_id,
        onBehalfEmail: row.on_behalf_email,
        onBehalfEmployeeCode: row.on_behalf_employee_code,
        status: row.status,
        rejectionReason: row.rejection_reason,
        submittedAt: row.submitted_at,
        departmentName: department?.name ?? null,
        paymentModeName: paymentMode?.name ?? null,
        assignedL1ApproverId: row.assigned_l1_approver_id,
        assignedL2ApproverId: row.assigned_l2_approver_id,
        submittedBy: row.submitted_by,
        submitter: submitterLabel,
        submitterName: submitterName ?? null,
        submitterEmail: submitterEmail ?? null,
        beneficiaryName: beneficiaryName ?? null,
        beneficiaryEmail: beneficiaryEmail ?? null,
        expense: expense
          ? {
              id: expense.id,
              billNo: expense.bill_no,
              purpose: expense.purpose,
              expenseCategoryId: expense.expense_category_id,
              expenseCategoryName: expenseCategory?.name ?? null,
              productName: expenseProduct?.name ?? null,
              locationId: expense.location_id,
              locationName: expenseLocation?.name ?? null,
              locationType: expense.location_type ?? null,
              locationDetails: expense.location_details ?? null,
              transactionDate: expense.transaction_date,
              isGstApplicable: expense.is_gst_applicable,
              gstNumber: expense.gst_number,
              basicAmount: toNumber(expense.basic_amount),
              cgstAmount: toNumber(expense.cgst_amount),
              sgstAmount: toNumber(expense.sgst_amount),
              igstAmount: toNumber(expense.igst_amount),
              totalAmount: toNumber(expense.total_amount),
              vendorName: expense.vendor_name,
              productId: expense.product_id,
              peopleInvolved: expense.people_involved,
              remarks: expense.remarks,
              receiptFilePath: expense.receipt_file_path,
              bankStatementFilePath: expense.bank_statement_file_path,
            }
          : null,
        advance: advance
          ? {
              id: advance.id,
              purpose: advance.purpose,
              requestedAmount: toNumber(advance.requested_amount),
              expectedUsageDate: advance.expected_usage_date,
              productId: advance.product_id,
              locationId: advance.location_id,
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
      status: DbClaimStatus;
      submittedBy: string;
      assignedL1ApproverId: string;
      expenseReceiptFilePath: string | null;
      expenseBankStatementFilePath: string | null;
      advanceSupportingDocumentPath: string | null;
    } | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("claims")
      .select(
        "id, detail_type, status, submitted_by, assigned_l1_approver_id, expense_details(receipt_file_path, bank_statement_file_path), advance_details(supporting_document_path)",
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
        status: row.status,
        submittedBy: row.submitted_by,
        assignedL1ApproverId: row.assigned_l1_approver_id,
        expenseReceiptFilePath: expense?.receipt_file_path ?? null,
        expenseBankStatementFilePath: expense?.bank_statement_file_path ?? null,
        advanceSupportingDocumentPath: advance?.supporting_document_path ?? null,
      },
      errorMessage: null,
    };
  }

  async getClaimForSubmitterDelete(claimId: string): Promise<{
    data: {
      id: string;
      status: DbClaimStatus;
      submittedBy: string;
    } | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("claims")
      .select("id, status, submitted_by")
      .eq("id", claimId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    if (!data) {
      return { data: null, errorMessage: null };
    }

    const row = data as ClaimDeleteSnapshotRow;

    return {
      data: {
        id: row.id,
        status: row.status,
        submittedBy: row.submitted_by,
      },
      errorMessage: null,
    };
  }

  async softDeleteClaimBySubmitter(
    claimId: string,
    actorUserId: string,
  ): Promise<{ success: boolean; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data: updatedClaim, error: claimError } = await client
      .from("claims")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", claimId)
      .eq("submitted_by", actorUserId)
      .eq("is_active", true)
      .select("id")
      .maybeSingle();

    if (claimError) {
      return { success: false, errorMessage: claimError.message };
    }

    if (!updatedClaim) {
      return { success: false, errorMessage: "Claim not found or already deleted." };
    }

    const [{ error: expenseDeactivateError }, { error: advanceDeactivateError }] =
      await Promise.all([
        client
          .from("expense_details")
          .update({ is_active: false })
          .eq("claim_id", claimId)
          .eq("is_active", true),
        client
          .from("advance_details")
          .update({ is_active: false })
          .eq("claim_id", claimId)
          .eq("is_active", true),
      ]);

    if (expenseDeactivateError) {
      return { success: false, errorMessage: expenseDeactivateError.message };
    }

    if (advanceDeactivateError) {
      return { success: false, errorMessage: advanceDeactivateError.message };
    }

    return { success: true, errorMessage: null };
  }

  async updateClaimDetailsByFinance(
    claimId: string,
    payload: FinanceClaimEditPayload,
  ): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();

    const { data: updatedClaim, error: claimError } = await client
      .from("claims")
      .update({
        updated_at: new Date().toISOString(),
      })
      .eq("id", claimId)
      .eq("is_active", true)
      .select("id")
      .maybeSingle();

    if (claimError) {
      return { errorMessage: claimError.message };
    }

    if (!updatedClaim) {
      return { errorMessage: "Claim not found or inactive." };
    }

    if (payload.detailType === "expense") {
      const { data: updatedExpenseDetail, error: expenseError } = await client
        .from("expense_details")
        .update({
          bill_no: payload.billNo,
          expense_category_id: payload.expenseCategoryId,
          product_id: payload.productId,
          location_id: payload.locationId,
          transaction_date: payload.transactionDate,
          is_gst_applicable: payload.isGstApplicable,
          gst_number: payload.gstNumber,
          basic_amount: payload.basicAmount,
          cgst_amount: payload.cgstAmount,
          sgst_amount: payload.sgstAmount,
          igst_amount: payload.igstAmount,
          vendor_name: payload.vendorName,
          purpose: payload.purpose,
          people_involved: payload.peopleInvolved,
          remarks: payload.remarks,
          receipt_file_path: payload.receiptFilePath,
          bank_statement_file_path: payload.bankStatementFilePath,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.detailId)
        .eq("claim_id", claimId)
        .eq("is_active", true)
        .select("id")
        .maybeSingle();

      if (expenseError) {
        if (isDuplicateExpenseBillConstraintError(expenseError)) {
          throw expenseError;
        }

        return { errorMessage: expenseError.message };
      }

      if (!updatedExpenseDetail) {
        return { errorMessage: "Active expense detail not found for claim." };
      }
    } else {
      const { data: updatedAdvanceDetail, error: advanceError } = await client
        .from("advance_details")
        .update({
          purpose: payload.purpose,
          requested_amount: payload.requestedAmount,
          expected_usage_date: payload.expectedUsageDate,
          product_id: payload.productId,
          location_id: payload.locationId,
          remarks: payload.remarks,
          supporting_document_path: payload.supportingDocumentPath,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.detailId)
        .eq("claim_id", claimId)
        .eq("is_active", true)
        .select("id")
        .maybeSingle();

      if (advanceError) {
        return { errorMessage: advanceError.message };
      }

      if (!updatedAdvanceDetail) {
        return { errorMessage: "Active advance detail not found for claim." };
      }
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
        .select("hod_user_id, founder_user_id")
        .eq("is_active", true)
        .or(`hod_user_id.eq.${userId},founder_user_id.eq.${userId}`),
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
        isHod: departmentRows.some((row) => row.hod_user_id === userId),
        isFounder: departmentRows.some((row) => row.founder_user_id === userId),
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
    basicAmount: number;
    totalAmount: number;
  }): Promise<{ exists: boolean; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const epsilon = 0.01;

    const { data, error } = await client
      .from("expense_details")
      .select("basic_amount, total_amount")
      .eq("bill_no", input.billNo)
      .eq("transaction_date", input.transactionDate)
      .eq("is_active", true)
      .limit(50);

    if (error) {
      return { exists: false, errorMessage: error.message };
    }

    const rows = (data ?? []) as Array<{ basic_amount: number; total_amount: number }>;
    const normalizedBasic = Number(input.basicAmount);
    const normalizedTotal = Number(input.totalAmount);

    const exists = rows.some((row) => {
      const candidateBasic = Number(row.basic_amount);
      const candidateTotal = Number(row.total_amount);

      const basicMatches = Math.abs(candidateBasic - normalizedBasic) <= epsilon;
      const totalMatches = Math.abs(candidateTotal - normalizedTotal) <= epsilon;

      return basicMatches || totalMatches;
    });

    return { exists, errorMessage: null };
  }

  async getDepartmentApprovers(departmentId: string): Promise<{
    data: ClaimDepartmentApprovers | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("master_departments")
      .select("hod_user_id, founder_user_id")
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
        approver1Id: row.hod_user_id,
        approver2Id: row.founder_user_id,
      },
      errorMessage: null,
    };
  }

  async getActiveUserIdByEmail(
    email: string,
  ): Promise<{ data: string | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const normalizedEmail = email.trim().toLowerCase();

    const existingLookup = await this.getUserByEmail(normalizedEmail);
    if (existingLookup.errorMessage) {
      return { data: null, errorMessage: existingLookup.errorMessage };
    }

    if (existingLookup.data?.is_active) {
      return { data: existingLookup.data.id, errorMessage: null };
    }

    if (existingLookup.data && !existingLookup.data.is_active) {
      return {
        data: null,
        errorMessage: "On-behalf beneficiary exists but is inactive.",
      };
    }

    const { data: createdUserData, error: createUserError } = await client.auth.admin.createUser({
      email: normalizedEmail,
      password: "password123",
      email_confirm: true,
    });

    if (createUserError) {
      if (this.isAlreadyRegisteredError(createUserError.message)) {
        const retryLookup = await this.getUserByEmail(normalizedEmail);
        if (retryLookup.errorMessage) {
          return { data: null, errorMessage: retryLookup.errorMessage };
        }

        if (retryLookup.data?.is_active) {
          return { data: retryLookup.data.id, errorMessage: null };
        }

        if (retryLookup.data && !retryLookup.data.is_active) {
          return {
            data: null,
            errorMessage: "On-behalf beneficiary exists but is inactive.",
          };
        }
      }

      return {
        data: null,
        errorMessage: `Unable to provision on-behalf beneficiary: ${createUserError.message}`,
      };
    }

    const createdUserId = createdUserData.user?.id;
    if (!createdUserId) {
      return {
        data: null,
        errorMessage: "Unable to provision on-behalf beneficiary.",
      };
    }

    const syncedLookup = await this.getUserByEmail(normalizedEmail);
    if (syncedLookup.errorMessage) {
      return { data: null, errorMessage: syncedLookup.errorMessage };
    }

    if (syncedLookup.data?.is_active) {
      return { data: syncedLookup.data.id, errorMessage: null };
    }

    if (syncedLookup.data && !syncedLookup.data.is_active) {
      return {
        data: null,
        errorMessage: "On-behalf beneficiary exists but is inactive.",
      };
    }

    return {
      data: createdUserId,
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
      .eq("hod_user_id", userId)
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

    const submittedEmployeeId =
      typeof payload.employee_id === "string" ? payload.employee_id.trim() : "";
    if (submittedEmployeeId.length > 0) {
      const employeeIdPersistResult = await client
        .from("claims")
        .update({ employee_id: submittedEmployeeId })
        .eq("id", data)
        .eq("is_active", true);

      if (employeeIdPersistResult.error) {
        return {
          claimId: null,
          errorMessage: `Claim created but employee_id persistence failed: ${employeeIdPersistResult.error.message}`,
        };
      }
    }

    const actorId = typeof payload.submitted_by === "string" ? payload.submitted_by : null;
    const assignedToId =
      typeof payload.assigned_l1_approver_id === "string" ? payload.assigned_l1_approver_id : null;

    if (!actorId) {
      return { claimId: null, errorMessage: "Missing submitter for claim audit log creation." };
    }

    const auditResult = await this.createClaimAuditLog({
      claimId: data,
      actorId,
      actionType: "SUBMITTED",
      assignedToId,
      remarks: null,
    });

    if (auditResult.errorMessage) {
      return {
        claimId: null,
        errorMessage: `Claim created but audit logging failed: ${auditResult.errorMessage}`,
      };
    }

    return { claimId: data, errorMessage: null };
  }

  async createClaimAuditLog(input: {
    claimId: string;
    actorId: string;
    actionType: ClaimAuditActionType;
    assignedToId: string | null;
    remarks: string | null;
  }): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const payload = {
      claim_id: input.claimId,
      actor_id: input.actorId,
      action_type: input.actionType,
      assigned_to_id: input.assignedToId,
      remarks: input.remarks,
    };

    const { error } = await client.from("claim_audit_logs").insert(payload);

    if (
      error &&
      input.assignedToId &&
      /claim_audit_logs_assigned_to_id_fkey/i.test(error.message)
    ) {
      const fallback = await client.from("claim_audit_logs").insert({
        ...payload,
        assigned_to_id: null,
      });

      if (fallback.error) {
        return { errorMessage: fallback.error.message };
      }

      return { errorMessage: null };
    }

    if (error) {
      return { errorMessage: error.message };
    }

    return { errorMessage: null };
  }

  async getClaimAuditLogs(claimId: string): Promise<{
    data: ClaimAuditLogRecord[];
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("claim_audit_logs")
      .select(
        "id, claim_id, actor_id, action_type, assigned_to_id, remarks, created_at, actor:users!claim_audit_logs_actor_id_fkey(full_name, email), assigned_to:users!claim_audit_logs_assigned_to_id_fkey(full_name, email), claim:claims!claim_audit_logs_claim_id_fkey(assigned_l1_approver_id, l1_approver_user:users!claims_assigned_l1_approver_id_fkey(full_name, email))",
      )
      .eq("claim_id", claimId)
      .order("created_at", { ascending: true });

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    const rows = (data ?? []) as ClaimAuditLogRow[];
    return {
      data: rows.map(mapClaimAuditLogRow),
      errorMessage: null,
    };
  }

  async getClaimAuditLogsBatch(claimIds: string[]): Promise<{
    data: Record<string, ClaimAuditLogRecord[]>;
    errorMessage: string | null;
  }> {
    if (claimIds.length === 0) {
      return { data: {}, errorMessage: null };
    }

    const scopedClaimIds = claimIds.slice(0, MAX_LIST_PAGE_SIZE);
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("claim_audit_logs")
      .select(
        "id, claim_id, actor_id, action_type, assigned_to_id, remarks, created_at, actor:users!claim_audit_logs_actor_id_fkey(full_name, email), assigned_to:users!claim_audit_logs_assigned_to_id_fkey(full_name, email), claim:claims!claim_audit_logs_claim_id_fkey(assigned_l1_approver_id, l1_approver_user:users!claims_assigned_l1_approver_id_fkey(full_name, email))",
      )
      .in("claim_id", scopedClaimIds)
      .order("created_at", { ascending: true });

    if (error) {
      return { data: {}, errorMessage: error.message };
    }

    const rows = (data ?? []) as ClaimAuditLogRow[];
    const grouped: Record<string, ClaimAuditLogRecord[]> = {};

    for (const claimId of scopedClaimIds) {
      grouped[claimId] = [];
    }

    for (const row of rows) {
      const claimId = row.claim_id;
      if (!grouped[claimId]) {
        grouped[claimId] = [];
      }

      grouped[claimId].push(mapClaimAuditLogRow(row));
    }

    return {
      data: grouped,
      errorMessage: null,
    };
  }

  async getMyClaims(
    userId: string,
    filters?: GetMyClaimsFilters,
  ): Promise<{ data: MyClaimRecord[]; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const normalizedStatuses = normalizeStatusFilter(filters?.status);
    const { fromDate, toDate } = normalizeDateRange(filters);
    const dateColumn = resolvePendingApprovalsDateColumn(filters?.dateTarget);
    const normalizedSearch = normalizeSearchInput(filters);

    const needsExpenseInnerJoin =
      filters?.locationId || filters?.productId || filters?.expenseCategoryId;

    const expenseDetailsJoin = needsExpenseInnerJoin
      ? "expense_details!inner(total_amount, location_id, product_id, expense_category_id)"
      : "expense_details(total_amount)";

    let query = client
      .from("claims")
      .select(
        `id, employee_id, on_behalf_email, submission_type, status, submitted_at, updated_at, submitter_user:users!claims_submitted_by_fkey!inner(full_name, email), master_departments(name), master_payment_modes(name), ${expenseDetailsJoin}, advance_details(requested_amount)`,
      )
      .or(buildMyClaimsOwnershipOrFilter(userId))
      .eq("is_active", true)
      .order("submitted_at", { ascending: false })
      .limit(MAX_LIST_PAGE_SIZE);

    if (filters?.detailType) {
      query = query.eq("detail_type", filters.detailType);
    }

    if (filters?.paymentModeId) {
      query = query.eq("payment_mode_id", filters.paymentModeId);
    }

    if (filters?.departmentId) {
      query = query.eq("department_id", filters.departmentId);
    }

    if (filters?.locationId) {
      query = query.eq("expense_details.location_id", filters.locationId);
    }

    if (filters?.productId) {
      query = query.eq("expense_details.product_id", filters.productId);
    }

    if (filters?.expenseCategoryId) {
      query = query.eq("expense_details.expense_category_id", filters.expenseCategoryId);
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

      if (normalizedSearch.field === "employee_email") {
        query = query.or(
          buildEmployeeEmailOrFilter(normalizedSearch.query, "submitter_user.email"),
        );
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
    page: number,
    limit: number,
    filters?: GetMyClaimsFilters,
  ): Promise<{
    data: Array<{
      id: string;
      employeeId: string;
      employeeName: string;
      departmentName: string;
      typeOfClaim: string;
      totalAmount: number;
      status: DbClaimStatus;
      submittedAt: string;
      hodActionDate: string | null;
      financeActionDate: string | null;
      detailType: "expense" | "advance";
      submissionType: "Self" | "On Behalf";
      onBehalfEmail: string | null;
      submitterEmail: string | null;
      hodEmail: string | null;
      financeEmail: string | null;
      submitterLabel: string | null;
      categoryName: string | null;
      purpose: string | null;
      expenseReceiptFilePath: string | null;
      expenseBankStatementFilePath: string | null;
      advanceSupportingDocumentPath: string | null;
    }>;
    totalCount: number;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const normalizedStatuses = normalizeStatusFilter(filters?.status);
    const { fromDate, toDate } = normalizeDateRange(filters);
    const normalizedSearch = normalizeSearchInput(filters);
    const safeLimit = clampListPageSize(limit);
    const safePage = Math.max(1, Math.floor(page));
    const from = (safePage - 1) * safeLimit;
    const to = from + safeLimit - 1;

    let query = client
      .from("vw_enterprise_claims_dashboard")
      .select(
        "claim_id, employee_name, employee_id, department_name, type_of_claim, amount, status, submitted_on, hod_action_date, finance_action_date, detail_type, submission_type, on_behalf_email, created_at, submitter_email, hod_email, finance_email, submitter_label, category_name, purpose, receipt_file_path, bank_statement_file_path, supporting_document_path",
        { count: "exact" },
      )
      .or(buildMyClaimsOwnershipOrFilter(userId))
      .order("created_at", { ascending: false })
      .order("claim_id", { ascending: false });

    query = applyEnterpriseDashboardFilters({
      query,
      filters,
      normalizedStatuses,
      fromDate,
      toDate,
      normalizedSearch,
    });

    const { data, count, error } = await query.range(from, to);

    if (error) {
      return {
        data: [],
        totalCount: 0,
        errorMessage: error.message,
      };
    }

    const rows = (data ?? []) as EnterpriseClaimsDashboardRow[];

    const mappedRows = rows.map((row) => ({
      id: row.claim_id,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      departmentName: row.department_name,
      typeOfClaim: row.type_of_claim,
      totalAmount: toNumber(row.amount) ?? 0,
      status: row.status,
      submittedAt: row.submitted_on,
      hodActionDate: row.hod_action_date,
      financeActionDate: row.finance_action_date,
      detailType: row.detail_type,
      submissionType: row.submission_type,
      onBehalfEmail: row.on_behalf_email ?? null,
      submitterEmail: row.submitter_email ?? null,
      hodEmail: row.hod_email ?? null,
      financeEmail: row.finance_email ?? null,
      submitterLabel: row.submitter_label ?? null,
      categoryName: row.category_name ?? null,
      purpose: row.purpose ?? null,
      expenseReceiptFilePath: row.receipt_file_path ?? null,
      expenseBankStatementFilePath: row.bank_statement_file_path ?? null,
      advanceSupportingDocumentPath: row.supporting_document_path ?? null,
    }));

    return {
      data: mappedRows,
      totalCount: count ?? 0,
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
      hodActionAt: string | null;
      financeActionAt: string | null;
    }>;
    nextCursor: string | null;
    hasNextPage: boolean;
    totalCount: number;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const decodedCursor = decodeClaimsCursor(cursor);
    const normalizedStatuses = normalizeStatusFilter(filters?.status);
    const { fromDate, toDate } = normalizeDateRange(filters);
    // Default to hod_action_at so date-range filters reflect when the L1 approver acted,
    // not when the submitter originally submitted the claim.
    const dateColumn = resolvePendingApprovalsDateColumn(filters?.dateTarget, "hod_action_at");
    const normalizedSearch = normalizeSearchInput(filters);
    const safeLimit = clampListPageSize(limit);

    if (cursor && !decodedCursor) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        totalCount: 0,
        errorMessage: "Invalid cursor format.",
      };
    }

    const needsExpenseInnerJoin =
      filters?.locationId || filters?.productId || filters?.expenseCategoryId;

    const expenseDetailsJoin = needsExpenseInnerJoin
      ? "expense_details!inner(total_amount, purpose, receipt_file_path, bank_statement_file_path, master_expense_categories(name), location_id, product_id, expense_category_id)"
      : "expense_details(total_amount, purpose, receipt_file_path, bank_statement_file_path, master_expense_categories(name))";

    let query = client
      .from("claims")
      .select(
        `id, employee_id, detail_type, submission_type, on_behalf_email, status, submitted_at, created_at, hod_action_at, finance_action_at, submitter_user:users!claims_submitted_by_fkey!inner(full_name, email), master_departments(name), master_payment_modes(name), ${expenseDetailsJoin}, advance_details(requested_amount, purpose, supporting_document_path)`,
        { count: "exact" },
      )
      .eq("assigned_l1_approver_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    query = applyPendingApprovalsFilters({
      query,
      filters,
      normalizedStatuses,
      fromDate,
      toDate,
      dateColumn,
      normalizedSearch,
    });

    if (decodedCursor) {
      query = query.or(
        `created_at.lt.${decodedCursor.createdAt},and(created_at.eq.${decodedCursor.createdAt},id.lt.${decodedCursor.id})`,
      );
    }

    const { data, error, count } = await query.limit(safeLimit + 1);

    if (error) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        totalCount: 0,
        errorMessage: error.message,
      };
    }

    const rows = (data ?? []) as GetPendingApprovalsRow[];
    const hasExtraRecord = rows.length > safeLimit;
    const pageRows = hasExtraRecord ? rows.slice(0, safeLimit) : rows;
    const lastRow = pageRows[pageRows.length - 1] ?? null;
    const nextCursor =
      hasExtraRecord && lastRow
        ? encodeClaimsCursor({ createdAt: lastRow.created_at, id: lastRow.id })
        : null;

    return {
      data: mapPendingApprovalRows(pageRows),
      nextCursor,
      hasNextPage: hasExtraRecord,
      totalCount: count ?? 0,
      errorMessage: null,
    };
  }

  async getPendingApprovalsForFinance(
    _userId: string,
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
      hodActionAt: string | null;
      financeActionAt: string | null;
    }>;
    nextCursor: string | null;
    hasNextPage: boolean;
    totalCount: number;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const decodedCursor = decodeClaimsCursor(cursor);
    const normalizedStatuses = normalizeFinanceVisibleStatusFilter(filters?.status);
    const { fromDate, toDate } = normalizeDateRange(filters);
    // Default to finance_action_at so date-range filters reflect when the Finance approver acted,
    // not when the submitter originally submitted the claim.
    const dateColumn = resolvePendingApprovalsDateColumn(filters?.dateTarget, "finance_action_at");
    const normalizedSearch = normalizeSearchInput(filters);
    const safeLimit = clampListPageSize(limit);

    if (filters?.status && normalizedStatuses.length === 0) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        totalCount: 0,
        errorMessage: null,
      };
    }

    if (cursor && !decodedCursor) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        totalCount: 0,
        errorMessage: "Invalid cursor format.",
      };
    }

    const financeNonRejectedStatusesFilter = toPostgrestInList(
      FINANCE_NON_REJECTED_VISIBLE_STATUSES,
    );
    const financeRejectedStatusesFilter = toPostgrestInList(FINANCE_REJECTED_VISIBLE_STATUSES);

    const needsExpenseInnerJoin =
      filters?.locationId || filters?.productId || filters?.expenseCategoryId;

    const expenseDetailsJoin = needsExpenseInnerJoin
      ? "expense_details!inner(total_amount, purpose, receipt_file_path, bank_statement_file_path, master_expense_categories(name), location_id, product_id, expense_category_id)"
      : "expense_details(total_amount, purpose, receipt_file_path, bank_statement_file_path, master_expense_categories(name))";

    let query = client
      .from("claims")
      .select(
        `id, employee_id, detail_type, submission_type, on_behalf_email, status, submitted_at, created_at, hod_action_at, finance_action_at, submitter_user:users!claims_submitted_by_fkey!inner(full_name, email), master_departments(name), master_payment_modes(name), ${expenseDetailsJoin}, advance_details(requested_amount, purpose, supporting_document_path)`,
        { count: "exact" },
      )
      .or(
        `status.in.${financeNonRejectedStatusesFilter},and(status.in.${financeRejectedStatusesFilter},assigned_l2_approver_id.not.is.null)`,
      )
      .not("status", "in", FINANCE_EXCLUDED_QUEUE_AND_HISTORY_STATUSES_FILTER)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    query = applyPendingApprovalsFilters({
      query,
      filters,
      normalizedStatuses,
      fromDate,
      toDate,
      dateColumn,
      normalizedSearch,
    });

    if (decodedCursor) {
      query = query.or(
        `created_at.lt.${decodedCursor.createdAt},and(created_at.eq.${decodedCursor.createdAt},id.lt.${decodedCursor.id})`,
      );
    }

    const { data, error, count } = await query.limit(safeLimit + 1);

    if (error) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        totalCount: 0,
        errorMessage: error.message,
      };
    }

    const rows = (data ?? []) as GetPendingApprovalsRow[];
    const hasExtraRecord = rows.length > safeLimit;
    const pageRows = hasExtraRecord ? rows.slice(0, safeLimit) : rows;
    const lastRow = pageRows[pageRows.length - 1] ?? null;
    const nextCursor =
      hasExtraRecord && lastRow
        ? encodeClaimsCursor({ createdAt: lastRow.created_at, id: lastRow.id })
        : null;

    return {
      data: mapPendingApprovalRows(pageRows),
      nextCursor,
      hasNextPage: hasExtraRecord,
      totalCount: count ?? 0,
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
    const normalizedStatuses =
      input.fetchScope === "finance_approvals"
        ? normalizeFinanceVisibleStatusFilter(input.filters?.status)
        : normalizeStatusFilter(input.filters?.status);
    const { fromDate, toDate } = normalizeDateRange(input.filters);
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

      if (input.filters?.status && normalizedStatuses.length === 0) {
        return { data: [], errorMessage: null };
      }
    }

    let query = client
      .from("vw_enterprise_claims_dashboard")
      .select(
        "claim_id, employee_name, employee_id, department_name, type_of_claim, amount, status, submitted_on, hod_action_date, finance_action_date, submitted_by, on_behalf_of_id, assigned_l1_approver_id, assigned_l2_approver_id, department_id, payment_mode_id, detail_type, submission_type, created_at",
      )
      .order("created_at", { ascending: false })
      .order("claim_id", { ascending: false });

    if (input.fetchScope === "submissions") {
      query = query.or(buildMyClaimsOwnershipOrFilter(input.userId));
    }

    if (input.fetchScope === "l1_approvals") {
      query = query.eq("assigned_l1_approver_id", input.userId);
    }

    if (input.fetchScope === "finance_approvals") {
      const financeNonRejectedStatusesFilter = toPostgrestInList(
        FINANCE_NON_REJECTED_VISIBLE_STATUSES,
      );
      const financeRejectedStatusesFilter = toPostgrestInList(FINANCE_REJECTED_VISIBLE_STATUSES);

      query = query.or(
        `status.in.${financeNonRejectedStatusesFilter},and(status.in.${financeRejectedStatusesFilter},assigned_l2_approver_id.not.is.null)`,
      );

      query = query.not("status", "in", FINANCE_EXCLUDED_QUEUE_AND_HISTORY_STATUSES_FILTER);
    }

    query = applyEnterpriseDashboardFilters({
      query,
      filters: input.filters,
      normalizedStatuses,
      fromDate,
      toDate,
      normalizedSearch,
    });

    const { data, error } = await query.range(input.offset, input.offset + input.limit - 1);

    if (error) {
      return {
        data: [],
        errorMessage: error.message,
      };
    }

    const rows = (data ?? []) as EnterpriseClaimsDashboardRow[];

    return {
      data: rows.map((row) => ({
        claimId: row.claim_id,
        employeeName: row.employee_name,
        employeeId: row.employee_id,
        departmentName: row.department_name,
        typeOfClaim: row.type_of_claim,
        amount: toNumber(row.amount) ?? 0,
        status: row.status,
        submittedOn: row.submitted_on,
        hodActionDate: row.hod_action_date,
        financeActionDate: row.finance_action_date,
      })),
      errorMessage: null,
    };
  }

  async getClaimsForFullExport(input: {
    userId: string;
    fetchScope: ClaimsExportFetchScope;
    filters?: GetMyClaimsFilters;
    limit: number;
    cursor?: { createdAt: string; claimId: string };
    departmentIds?: string[];
  }): Promise<{ data: ClaimFullExportRecord[]; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const normalizedStatuses =
      input.fetchScope === "finance_approvals"
        ? normalizeFinanceVisibleStatusFilter(input.filters?.status)
        : normalizeStatusFilter(input.filters?.status);
    const { fromDate, toDate } = normalizeDateRange(input.filters);
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

      if (input.filters?.status && normalizedStatuses.length === 0) {
        return { data: [], errorMessage: null };
      }
    }

    let idsQuery = client
      .from("vw_enterprise_claims_dashboard")
      .select("claim_id, created_at")
      .order("created_at", { ascending: false })
      .order("claim_id", { ascending: false });

    if (input.fetchScope === "submissions") {
      idsQuery = idsQuery.or(buildMyClaimsOwnershipOrFilter(input.userId));
    }

    if (input.fetchScope === "l1_approvals") {
      idsQuery = idsQuery.eq("assigned_l1_approver_id", input.userId);
    }

    if (input.fetchScope === "finance_approvals") {
      const financeNonRejectedStatusesFilter = toPostgrestInList(
        FINANCE_NON_REJECTED_VISIBLE_STATUSES,
      );
      const financeRejectedStatusesFilter = toPostgrestInList(FINANCE_REJECTED_VISIBLE_STATUSES);

      idsQuery = idsQuery.or(
        `status.in.${financeNonRejectedStatusesFilter},and(status.in.${financeRejectedStatusesFilter},assigned_l2_approver_id.not.is.null)`,
      );

      idsQuery = idsQuery.not("status", "in", FINANCE_EXCLUDED_QUEUE_AND_HISTORY_STATUSES_FILTER);
    }

    // Admin scope: no user-level filter — return all claims
    // (authorization is verified in the domain service)

    if (input.fetchScope === "department_viewer") {
      if (input.departmentIds && input.departmentIds.length > 0) {
        idsQuery = idsQuery.in("department_id", input.departmentIds);
      } else {
        return { data: [], errorMessage: null };
      }
    }

    idsQuery = applyEnterpriseDashboardFilters({
      query: idsQuery,
      filters: input.filters,
      normalizedStatuses,
      fromDate,
      toDate,
      normalizedSearch,
    });

    if (input.cursor) {
      idsQuery = idsQuery.or(
        `created_at.lt.${input.cursor.createdAt},and(created_at.eq.${input.cursor.createdAt},claim_id.lt.${input.cursor.claimId})`,
      );
    }

    const { data: idData, error: idError } = await idsQuery.limit(input.limit);

    if (idError) {
      return {
        data: [],
        errorMessage: idError.message,
      };
    }

    const orderedClaimIds: string[] = [];
    for (const row of idData ?? []) {
      const claimId = String((row as { claim_id: string }).claim_id);
      if (claimId.length > 0) {
        orderedClaimIds.push(claimId);
      }
    }

    if (orderedClaimIds.length === 0) {
      return {
        data: [],
        errorMessage: null,
      };
    }

    const rows: ExportClaimRow[] = [];

    for (const claimIdChunk of chunkArray(orderedClaimIds, EXPORT_CLAIM_LOOKUP_BATCH_SIZE)) {
      const { data, error } = await client
        .from("claims")
        .select(
          "id, status, submission_type, detail_type, submitted_by, on_behalf_of_id, employee_id, cc_emails, on_behalf_email, on_behalf_employee_code, department_id, payment_mode_id, assigned_l1_approver_id, assigned_l2_approver_id, submitted_at, hod_action_at, finance_action_at, rejection_reason, is_resubmission_allowed, created_at, updated_at, submitter_user:users!claims_submitted_by_fkey(full_name, email), beneficiary_user:users!claims_on_behalf_of_id_fkey(full_name, email), l1_approver_user:users!claims_assigned_l1_approver_id_fkey(full_name, email), l2_finance_approver:master_finance_approvers!claims_assigned_l2_approver_id_fkey(approver_user:users!master_finance_approvers_user_id_fkey(full_name, email)), master_departments(id, name), master_payment_modes(id, name), expense_details(bill_no, transaction_id, purpose, expense_category_id, product_id, location_id, location_type, location_details, is_gst_applicable, gst_number, transaction_date, basic_amount, cgst_amount, sgst_amount, igst_amount, total_amount, currency_code, vendor_name, people_involved, remarks, receipt_file_path, bank_statement_file_path, master_expense_categories(id, name), master_products(id, name), master_locations(id, name)), advance_details(requested_amount, budget_month, budget_year, expected_usage_date, purpose, product_id, location_id, remarks, supporting_document_path, master_products(id, name), master_locations(id, name))",
        )
        .in("id", claimIdChunk)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (error) {
        return {
          data: [],
          errorMessage: error.message,
        };
      }

      rows.push(...((data ?? []) as ExportClaimRow[]));
    }

    const walletUserIdSet = new Set<string>();
    for (const row of rows) {
      const walletUserId = row.on_behalf_of_id ?? row.submitted_by;
      if (walletUserId) {
        walletUserIdSet.add(walletUserId);
      }
    }

    const walletUserIds = [...walletUserIdSet];
    const walletBalanceByUserId = new Map<string, number | null>();

    if (walletUserIds.length > 0) {
      for (const walletUserIdChunk of chunkArray(walletUserIds, EXPORT_WALLET_LOOKUP_BATCH_SIZE)) {
        const { data: walletRows, error: walletError } = await client
          .from("wallets")
          .select("user_id, petty_cash_balance")
          .in("user_id", walletUserIdChunk);

        if (walletError) {
          return {
            data: [],
            errorMessage: walletError.message,
          };
        }

        for (const walletRow of (walletRows ?? []) as ExportWalletBalanceRow[]) {
          walletBalanceByUserId.set(walletRow.user_id, toNumber(walletRow.petty_cash_balance));
        }
      }
    }

    return {
      data: rows.map((row) => {
        const walletUserId = row.on_behalf_of_id ?? row.submitted_by;
        const submitter = getSingleRelation(row.submitter_user);
        const beneficiary = getSingleRelation(row.beneficiary_user);
        const l1Approver = getSingleRelation(row.l1_approver_user);
        const l2FinanceApprover = getSingleRelation(row.l2_finance_approver);
        const l2Approver = getSingleRelation(l2FinanceApprover?.approver_user);
        const department = getSingleRelation(row.master_departments);
        const paymentMode = getSingleRelation(row.master_payment_modes);
        const expense = getSingleRelation(row.expense_details);
        const advance = getSingleRelation(row.advance_details);
        const expenseCategory = getSingleRelation(expense?.master_expense_categories);
        const expenseProduct = getSingleRelation(expense?.master_products);
        const expenseLocation = getSingleRelation(expense?.master_locations);
        const advanceProduct = getSingleRelation(advance?.master_products);
        const advanceLocation = getSingleRelation(advance?.master_locations);

        return {
          claimId: row.id,
          status: row.status,
          submissionType: row.submission_type,
          detailType: row.detail_type,
          submittedBy: row.submitted_by,
          onBehalfOfId: row.on_behalf_of_id,
          employeeId: row.employee_id,
          ccEmails: row.cc_emails,
          onBehalfEmail: row.on_behalf_email,
          onBehalfEmployeeCode: row.on_behalf_employee_code,
          departmentId: row.department_id,
          departmentName: department?.name ?? null,
          paymentModeId: row.payment_mode_id,
          paymentModeName: paymentMode?.name ?? null,
          assignedL1ApproverId: row.assigned_l1_approver_id,
          assignedL2ApproverId: row.assigned_l2_approver_id,
          submittedAt: row.submitted_at,
          hodActionAt: row.hod_action_at,
          financeActionAt: row.finance_action_at,
          rejectionReason: row.rejection_reason,
          isResubmissionAllowed: row.is_resubmission_allowed,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          submitterName: submitter?.full_name ?? null,
          submitterEmail: submitter?.email ?? null,
          beneficiaryName: beneficiary?.full_name ?? null,
          beneficiaryEmail: beneficiary?.email ?? null,
          pettyCashBalance: walletBalanceByUserId.get(walletUserId) ?? null,
          l1ApproverName: l1Approver?.full_name ?? null,
          l1ApproverEmail: l1Approver?.email ?? null,
          l2ApproverName: l2Approver?.full_name ?? null,
          l2ApproverEmail: l2Approver?.email ?? null,
          expenseBillNo: expense?.bill_no ?? null,
          expenseTransactionId: expense?.transaction_id ?? null,
          expensePurpose: expense?.purpose ?? null,
          expenseCategoryId: expense?.expense_category_id ?? null,
          expenseCategoryName: expenseCategory?.name ?? null,
          expenseProductId: expense?.product_id ?? null,
          expenseProductName: expenseProduct?.name ?? null,
          expenseLocationId: expense?.location_id ?? null,
          expenseLocationName: expenseLocation?.name ?? null,
          expenseLocationType: expense?.location_type ?? null,
          expenseLocationDetails: expense?.location_details ?? null,
          expenseIsGstApplicable: expense?.is_gst_applicable ?? null,
          expenseGstNumber: expense?.gst_number ?? null,
          expenseTransactionDate: expense?.transaction_date ?? null,
          expenseBasicAmount: toNumber(expense?.basic_amount),
          expenseCgstAmount: toNumber(expense?.cgst_amount),
          expenseSgstAmount: toNumber(expense?.sgst_amount),
          expenseIgstAmount: toNumber(expense?.igst_amount),
          expenseTotalAmount: toNumber(expense?.total_amount),
          expenseCurrencyCode: expense?.currency_code ?? null,
          expenseVendorName: expense?.vendor_name ?? null,
          expensePeopleInvolved: expense?.people_involved ?? null,
          expenseRemarks: expense?.remarks ?? null,
          expenseReceiptFilePath: expense?.receipt_file_path ?? null,
          expenseBankStatementFilePath: expense?.bank_statement_file_path ?? null,
          advanceRequestedAmount: toNumber(advance?.requested_amount),
          advanceBudgetMonth: advance?.budget_month ?? null,
          advanceBudgetYear: advance?.budget_year ?? null,
          advanceExpectedUsageDate: advance?.expected_usage_date ?? null,
          advancePurpose: advance?.purpose ?? null,
          advanceProductId: advance?.product_id ?? null,
          advanceProductName: advanceProduct?.name ?? null,
          advanceLocationId: advance?.location_id ?? null,
          advanceLocationName: advanceLocation?.name ?? null,
          advanceRemarks: advance?.remarks ?? null,
          advanceSupportingDocumentPath: advance?.supporting_document_path ?? null,
        } satisfies ClaimFullExportRecord;
      }),
      errorMessage: null,
    };
  }

  async getClaimEvidencePublicUrl(input: {
    filePath: string;
  }): Promise<{ data: string | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data } = client.storage.from("claims").getPublicUrl(input.filePath);

    return {
      data: data.publicUrl ?? null,
      errorMessage: null,
    };
  }

  async createBulkSignedUrls(input: { filePaths: string[]; expiresInSeconds: number }): Promise<{
    data: Record<string, string>;
    errorMessage: string | null;
  }> {
    if (input.filePaths.length === 0) {
      return { data: {}, errorMessage: null };
    }

    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client.storage
      .from("claims")
      .createSignedUrls(input.filePaths, input.expiresInSeconds);

    if (error) {
      return { data: {}, errorMessage: error.message };
    }

    const urlMap: Record<string, string> = {};
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl && !entry.error) {
        urlMap[entry.path] = entry.signedUrl;
      }
    }

    return { data: urlMap, errorMessage: null };
  }

  async getClaimListDetails(
    claimIds: string[],
  ): Promise<{ data: Record<string, ClaimListDetail>; errorMessage: string | null }> {
    if (claimIds.length === 0) {
      return { data: {}, errorMessage: null };
    }

    const scopedClaimIds = claimIds.slice(0, MAX_LIST_PAGE_SIZE);

    const client = getServiceRoleSupabaseClient();

    const { data, error } = await client
      .from("claims")
      .select(
        "id, detail_type, submission_type, on_behalf_email, employee_id, submitter_user:users!claims_submitted_by_fkey(full_name, email), expense_details(purpose, receipt_file_path, bank_statement_file_path, master_expense_categories(name)), advance_details(purpose, supporting_document_path)",
      )
      .in("id", scopedClaimIds)
      .eq("is_active", true)
      .limit(scopedClaimIds.length);

    if (error) {
      return { data: {}, errorMessage: error.message };
    }

    type BatchRow = {
      id: string;
      detail_type: "expense" | "advance";
      submission_type: "Self" | "On Behalf";
      on_behalf_email: string | null;
      employee_id: string;
      submitter_user: ClaimSubmitterRow | ClaimSubmitterRow[] | null;
      expense_details: ClaimExpenseDetailRow | ClaimExpenseDetailRow[] | null;
      advance_details: ClaimAdvanceDetailRow | ClaimAdvanceDetailRow[] | null;
    };

    const rows = (data ?? []) as BatchRow[];
    const result: Record<string, ClaimListDetail> = {};

    for (const row of rows) {
      const submitter = getSingleRelation(row.submitter_user);
      const expense = getSingleRelation(row.expense_details);
      const advance = getSingleRelation(row.advance_details);
      const expenseCategory = getSingleRelation(expense?.master_expense_categories);

      const submitterName = submitter?.full_name?.trim();
      const submitterEmail = submitter?.email?.trim();
      const submitterLabel =
        submitterName && submitterEmail
          ? `${submitterName} (${submitterEmail})`
          : (submitterName ?? submitterEmail ?? row.employee_id);

      result[row.id] = {
        detailType: row.detail_type,
        submissionType: row.submission_type,
        onBehalfEmail: row.on_behalf_email,
        submitter: submitterLabel,
        categoryName:
          row.detail_type === "expense" ? (expenseCategory?.name ?? "Uncategorized") : "Advance",
        purpose: expense?.purpose ?? advance?.purpose ?? null,
        expenseReceiptFilePath: expense?.receipt_file_path ?? null,
        expenseBankStatementFilePath: expense?.bank_statement_file_path ?? null,
        advanceSupportingDocumentPath: advance?.supporting_document_path ?? null,
      };
    }

    return { data: result, errorMessage: null };
  }

  async isUserAdmin(userId: string): Promise<{ data: boolean; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { count, error } = await client
      .from("admins")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (error) {
      return { data: false, errorMessage: error.message };
    }

    return { data: (count ?? 0) > 0, errorMessage: null };
  }

  async getViewerDepartmentIds(
    userId: string,
  ): Promise<{ data: string[]; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("department_viewers")
      .select("department_id")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    return {
      data: (data ?? []).map((row) => row.department_id as string),
      errorMessage: null,
    };
  }
}
