import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import { toEndOfDayIso, toStartOfDayIso } from "@/lib/date-only";
import {
  buildBeneficiaryScopedIlikeOrFilter,
  toContainsIlikePattern,
  toQuotedContainsIlikePattern,
} from "@/lib/postgrest-search";
import {
  DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS,
  DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS,
  DB_PAYMENT_DONE_CLOSED_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
  DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS,
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  type DbClaimStatus,
} from "@/core/constants/statuses";
import {
  isAdminPaymentModeOverrideAllowedName,
  isCorporateCardPaymentModeName,
} from "@/core/constants/payment-modes";
import type {
  AdminClaimRecord,
  AdminClaimOverrideSummary,
  AdminClaimsFilters,
  AdminCursorPaginatedResult,
  AdminCursorPaginationInput,
  AdminRecord,
  AdminRepository,
  AdminUserRecord,
  CreatedDepartmentRecord,
  DepartmentViewerAdminRecord,
  DepartmentWithActors,
  FinanceApproverRecord,
  MasterDataItem,
  MasterDataTableName,
} from "@/core/domain/admin/contracts";
import type { ClaimAuditActionType } from "@/core/domain/claims/contracts";

// ----------------------------------------------------------------
// Shared normalizers
// ----------------------------------------------------------------

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function normalizeAmount(value: number | string | null): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "string" ? parseFloat(value) : value;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function hasAdvancedDateFilters(filters: AdminClaimsFilters): boolean {
  return Boolean(
    filters.submittedFrom ||
    filters.submittedTo ||
    filters.hodActionFrom ||
    filters.hodActionTo ||
    filters.financeActionFrom ||
    filters.financeActionTo,
  );
}

function buildBeneficiaryScopedSearchOrFilter(input: {
  searchQuery: string;
  selfField: string;
  onBehalfField: string;
}): string {
  return buildBeneficiaryScopedIlikeOrFilter(input);
}

function buildEmployeeNameSearchOrFilter(searchQuery: string): string {
  return buildBeneficiaryScopedSearchOrFilter({
    searchQuery,
    selfField: "submitter_name_raw",
    onBehalfField: "beneficiary_name_raw",
  });
}

function buildEmployeeEmailSearchOrFilter(searchQuery: string): string {
  return buildBeneficiaryScopedSearchOrFilter({
    searchQuery,
    selfField: "submitter_email",
    onBehalfField: "on_behalf_email",
  });
}

function buildEmployeeIdSearchOrFilter(searchQuery: string): string {
  return buildBeneficiaryScopedSearchOrFilter({
    searchQuery,
    selfField: "claim_employee_id_raw",
    onBehalfField: "on_behalf_employee_code_raw",
  });
}

const CLAIM_OVERRIDE_REJECTED_STATUSES: readonly DbClaimStatus[] = [
  DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
];

const CLAIM_OVERRIDE_AUDIT_ACTIONS: Readonly<Record<DbClaimStatus, ClaimAuditActionType>> = {
  [DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS]: "SUBMITTED",
  [DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS]: "L1_APPROVED",
  [DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS]: "L2_APPROVED",
  [DB_PAYMENT_DONE_CLOSED_STATUS]: "L2_MARK_PAID",
  [DB_REJECTED_RESUBMISSION_NOT_ALLOWED_STATUS]: "L2_REJECTED",
  [DB_REJECTED_RESUBMISSION_ALLOWED_STATUS]: "L2_REJECTED",
};

function buildClaimReferenceCandidates(claimReference: string): string[] {
  const trimmed = claimReference.trim();
  const upperCased = trimmed.toUpperCase();

  if (trimmed === upperCased) {
    return [trimmed];
  }

  return [trimmed, upperCased];
}

function isRejectedStatus(status: DbClaimStatus): boolean {
  return CLAIM_OVERRIDE_REJECTED_STATUSES.some((candidate) => candidate === status);
}

function resolveOverrideAuditActionType(input: {
  targetStatus: DbClaimStatus;
  assignedL2ApproverId: string | null;
}): ClaimAuditActionType {
  if (isRejectedStatus(input.targetStatus) && !input.assignedL2ApproverId) {
    return "L1_REJECTED";
  }

  return CLAIM_OVERRIDE_AUDIT_ACTIONS[input.targetStatus];
}

function resolveOverrideClaimUpdate(input: {
  currentClaim: ClaimOverrideTransitionRow;
  targetStatus: DbClaimStatus;
  reason: string;
  timestampIso: string;
}): {
  status: DbClaimStatus;
  hod_action_at: string | null;
  finance_action_at: string | null;
  rejection_reason: string | null;
  is_resubmission_allowed: boolean;
} {
  const { currentClaim, targetStatus, reason, timestampIso } = input;
  const hodActionAtFromCurrent = currentClaim.hod_action_at;
  const financeActionAtFromCurrent = currentClaim.finance_action_at;
  const isTargetRejected = isRejectedStatus(targetStatus);
  const isL2Assigned = Boolean(currentClaim.assigned_l2_approver_id);

  if (targetStatus === DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS) {
    return {
      status: targetStatus,
      hod_action_at: null,
      finance_action_at: null,
      rejection_reason: null,
      is_resubmission_allowed: false,
    };
  }

  if (targetStatus === DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS) {
    return {
      status: targetStatus,
      hod_action_at: timestampIso,
      finance_action_at: null,
      rejection_reason: null,
      is_resubmission_allowed: false,
    };
  }

  if (targetStatus === DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS) {
    return {
      status: targetStatus,
      hod_action_at: hodActionAtFromCurrent ?? timestampIso,
      finance_action_at: timestampIso,
      rejection_reason: null,
      is_resubmission_allowed: false,
    };
  }

  if (targetStatus === DB_PAYMENT_DONE_CLOSED_STATUS) {
    return {
      status: targetStatus,
      hod_action_at: hodActionAtFromCurrent ?? timestampIso,
      finance_action_at: financeActionAtFromCurrent ?? timestampIso,
      rejection_reason: null,
      is_resubmission_allowed: false,
    };
  }

  if (isTargetRejected) {
    return {
      status: targetStatus,
      hod_action_at: isL2Assigned ? (hodActionAtFromCurrent ?? timestampIso) : timestampIso,
      finance_action_at: isL2Assigned ? timestampIso : null,
      rejection_reason: reason,
      is_resubmission_allowed: targetStatus === DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
    };
  }

  return {
    status: targetStatus,
    hod_action_at: hodActionAtFromCurrent,
    finance_action_at: financeActionAtFromCurrent,
    rejection_reason: null,
    is_resubmission_allowed: false,
  };
}

function pickClaimAmount(input: {
  expenseDetails: ClaimOverrideExpenseRow | ClaimOverrideExpenseRow[] | null;
  advanceDetails: ClaimOverrideAdvanceRow | ClaimOverrideAdvanceRow[] | null;
}): number {
  const expenseRows = input.expenseDetails
    ? Array.isArray(input.expenseDetails)
      ? input.expenseDetails
      : [input.expenseDetails]
    : [];
  const advanceRows = input.advanceDetails
    ? Array.isArray(input.advanceDetails)
      ? input.advanceDetails
      : [input.advanceDetails]
    : [];

  const activeExpense = expenseRows.find((row) => row.is_active === true);
  if (activeExpense) {
    return normalizeAmount(activeExpense.total_amount);
  }

  const activeAdvance = advanceRows.find((row) => row.is_active === true);
  if (activeAdvance) {
    return normalizeAmount(activeAdvance.requested_amount);
  }

  if (expenseRows[0]) {
    return normalizeAmount(expenseRows[0].total_amount);
  }

  if (advanceRows[0]) {
    return normalizeAmount(advanceRows[0].requested_amount);
  }

  return 0;
}

function isAlreadyRegisteredError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized.includes("already registered") || normalized.includes("already exists");
}

// ----------------------------------------------------------------
// Raw row types (Supabase response shapes)
// ----------------------------------------------------------------

type EnterpriseDashboardRow = {
  claim_id: string;
  employee_name: string;
  employee_id: string;
  submitter_email: string | null;
  on_behalf_email: string | null;
  on_behalf_employee_code_raw: string | null;
  department_name: string;
  type_of_claim: string;
  amount: number | string;
  status: string;
  submitted_on: string;
  hod_action_date: string | null;
  finance_action_date: string | null;
  detail_type: "expense" | "advance";
  submission_type: "Self" | "On Behalf";
  is_active: boolean;
  department_id: string | null;
  deleted_by_name: string | null;
  deleted_by_role: string | null;
  deleted_at: string | null;
};

type UserNameRow = { full_name: string | null; email: string };

type DepartmentActorRow = {
  id: string;
  name: string;
  is_active: boolean;
  hod_user_id: string | null;
  founder_user_id: string | null;
  hod_provisional_email: string | null;
  founder_provisional_email: string | null;
  hod: UserNameRow | UserNameRow[] | null;
  founder: UserNameRow | UserNameRow[] | null;
};

type FinanceApproverRow = {
  id: string;
  user_id: string | null;
  is_active: boolean;
  is_primary: boolean;
  provisional_email: string | null;
  user: UserNameRow | UserNameRow[] | null;
};

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
};

type AdminRow = {
  id: string;
  user_id: string | null;
  provisional_email: string | null;
  created_at: string;
  user: UserNameRow | UserNameRow[] | null;
};

type DepartmentViewerRow = {
  id: string;
  user_id: string;
  is_active: boolean;
  created_at: string;
  department_id: string;
  user: UserNameRow | UserNameRow[] | null;
  department: { name: string } | { name: string }[] | null;
};

type MasterDataRow = {
  id: string;
  name: string;
  is_active: boolean;
};

type DepartmentInsertRow = {
  id: string;
  name: string;
  hod_user_id: string;
  founder_user_id: string;
  is_active: boolean;
};

type ClaimOverrideExpenseRow = {
  total_amount: number | string | null;
  is_active: boolean | null;
};

type ClaimOverrideAdvanceRow = {
  requested_amount: number | string | null;
  is_active: boolean | null;
};

type ClaimOverrideRow = {
  id: string;
  status: DbClaimStatus;
  is_active: boolean;
  assigned_l2_approver_id: string | null;
  hod_action_at: string | null;
  finance_action_at: string | null;
  rejection_reason: string | null;
  is_resubmission_allowed: boolean;
  submitter_user: UserNameRow | UserNameRow[] | null;
  master_departments: { name: string | null } | { name: string | null }[] | null;
  expense_details: ClaimOverrideExpenseRow | ClaimOverrideExpenseRow[] | null;
  advance_details: ClaimOverrideAdvanceRow | ClaimOverrideAdvanceRow[] | null;
};

type ClaimOverrideTransitionRow = {
  id: string;
  status: DbClaimStatus;
  is_active: boolean;
  payment_mode_id: string | null;
  assigned_l2_approver_id: string | null;
  hod_action_at: string | null;
  finance_action_at: string | null;
  rejection_reason: string | null;
  is_resubmission_allowed: boolean;
};

type ClaimPaymentModeLookupRow = {
  id: string;
  name: string;
  is_active: boolean;
};

// ----------------------------------------------------------------
// Repository implementation
// ----------------------------------------------------------------

export class SupabaseAdminRepository implements AdminRepository {
  private get client() {
    return getServiceRoleSupabaseClient();
  }

  private async lookupUserIdByEmail(
    email: string,
  ): Promise<{ userId: string | null; errorMessage: string | null }> {
    const { data, error } = await this.client
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (error) {
      return { userId: null, errorMessage: error.message };
    }

    return {
      userId: (data as { id: string } | null)?.id ?? null,
      errorMessage: null,
    };
  }

  private async resolveUserIdByEmail(
    email: string,
  ): Promise<{ userId: string | null; errorMessage: string | null }> {
    const normalizedEmail = email.trim().toLowerCase();
    const existingLookup = await this.lookupUserIdByEmail(normalizedEmail);

    if (existingLookup.errorMessage) {
      return existingLookup;
    }

    if (existingLookup.userId) {
      return existingLookup;
    }

    const { data: createdUserData, error: createUserError } =
      await this.client.auth.admin.createUser({
        email: normalizedEmail,
        password: "password123",
        email_confirm: true,
      });

    if (createUserError) {
      if (isAlreadyRegisteredError(createUserError.message)) {
        const retryLookup = await this.lookupUserIdByEmail(normalizedEmail);
        if (retryLookup.errorMessage) {
          return retryLookup;
        }

        if (retryLookup.userId) {
          return retryLookup;
        }

        return {
          userId: null,
          errorMessage:
            "User account exists but UUID could not be resolved from public.users. Please retry.",
        };
      }

      return { userId: null, errorMessage: createUserError.message };
    }

    const createdUserId = createdUserData.user?.id ?? null;
    if (!createdUserId) {
      return { userId: null, errorMessage: "Unable to provision user account." };
    }

    return { userId: createdUserId, errorMessage: null };
  }

  // ─── Claims ───────────────────────────────────────────────────

  async getAllClaims(
    filters: AdminClaimsFilters,
    pagination: AdminCursorPaginationInput,
  ): Promise<{
    data: AdminCursorPaginatedResult<AdminClaimRecord> | null;
    errorMessage: string | null;
  }> {
    const limit = pagination.limit + 1;

    let query = this.client
      .from("vw_admin_claims_dashboard")
      .select(
        "claim_id, employee_name, employee_id, submitter_email, on_behalf_email, on_behalf_employee_code_raw, department_name, type_of_claim, amount, status, submitted_on, hod_action_date, finance_action_date, detail_type, submission_type, is_active, department_id, payment_mode_id, location_id, product_id, expense_category_id, deleted_by_name, deleted_by_role, deleted_at",
      )
      .order("submitted_on", { ascending: false })
      .order("claim_id", { ascending: false })
      .limit(limit);

    if (filters.status && filters.status.length > 0) {
      query = query.in("status", filters.status);
    }

    if (filters.departmentId) {
      query = query.eq("department_id", filters.departmentId);
    }

    if (filters.searchQuery) {
      const sq = filters.searchQuery;
      if (filters.searchField === "claim_id") {
        query = query.ilike("claim_id", toContainsIlikePattern(sq));
      } else if (filters.searchField === "employee_name") {
        query = query.or(buildEmployeeNameSearchOrFilter(sq));
      } else if (filters.searchField === "employee_id") {
        query = query.or(buildEmployeeIdSearchOrFilter(sq));
      } else if (filters.searchField === "employee_email") {
        query = query.or(buildEmployeeEmailSearchOrFilter(sq));
      } else {
        query = query.or(
          `claim_id.ilike.${toQuotedContainsIlikePattern(sq)},${buildEmployeeNameSearchOrFilter(sq)},${buildEmployeeIdSearchOrFilter(sq)},${buildEmployeeEmailSearchOrFilter(sq)}`,
        );
      }
    }

    if (filters.isActive !== undefined) {
      query = query.eq("is_active", filters.isActive);
    }

    if (filters.submissionType) {
      query = query.eq("submission_type", filters.submissionType);
    }

    if (filters.paymentModeId) {
      query = query.eq("payment_mode_id", filters.paymentModeId);
    }

    if (filters.locationId) {
      query = query.eq("location_id", filters.locationId);
    }

    if (filters.productId) {
      query = query.eq("product_id", filters.productId);
    }

    if (filters.expenseCategoryId) {
      query = query.eq("expense_category_id", filters.expenseCategoryId);
    }

    if (hasAdvancedDateFilters(filters)) {
      if (filters.submittedFrom) {
        query = query.gte("submitted_on", toStartOfDayIso(filters.submittedFrom));
      }

      if (filters.submittedTo) {
        query = query.lte("submitted_on", toEndOfDayIso(filters.submittedTo));
      }

      if (filters.hodActionFrom) {
        query = query.gte("hod_action_date", toStartOfDayIso(filters.hodActionFrom));
      }

      if (filters.hodActionTo) {
        query = query.lte("hod_action_date", toEndOfDayIso(filters.hodActionTo));
      }

      if (filters.financeActionFrom) {
        query = query.gte("finance_action_date", toStartOfDayIso(filters.financeActionFrom));
      }

      if (filters.financeActionTo) {
        query = query.lte("finance_action_date", toEndOfDayIso(filters.financeActionTo));
      }
    } else {
      if (filters.dateTarget === "finance_closed") {
        query = query.not("finance_action_date", "is", null);
      }

      if (filters.dateTarget === "hod_action") {
        query = query.not("hod_action_date", "is", null);
      }

      if (filters.dateFrom) {
        const column =
          filters.dateTarget === "hod_action"
            ? "hod_action_date"
            : filters.dateTarget === "finance_closed"
              ? "finance_action_date"
              : "submitted_on";
        query = query.gte(column, toStartOfDayIso(filters.dateFrom));
      }

      if (filters.dateTo) {
        const column =
          filters.dateTarget === "hod_action"
            ? "hod_action_date"
            : filters.dateTarget === "finance_closed"
              ? "finance_action_date"
              : "submitted_on";
        query = query.lte(column, toEndOfDayIso(filters.dateTo));
      }
    }

    if (filters.minAmount !== undefined) {
      query = query.gte("amount", filters.minAmount);
    }

    if (filters.maxAmount !== undefined) {
      query = query.lte("amount", filters.maxAmount);
    }

    if (pagination.cursor) {
      query = query.lt("submitted_on", pagination.cursor);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    const rows = (data ?? []) as EnterpriseDashboardRow[];
    const hasNextPage = rows.length > pagination.limit;
    const pageRows = hasNextPage ? rows.slice(0, pagination.limit) : rows;

    const nextCursor = hasNextPage ? (pageRows[pageRows.length - 1]?.submitted_on ?? null) : null;

    return {
      data: {
        data: pageRows.map((row) => ({
          claimId: row.claim_id,
          employeeName: row.employee_name,
          employeeId: row.employee_id,
          submitterEmail: row.submitter_email ?? null,
          onBehalfEmail: row.on_behalf_email ?? null,
          onBehalfEmployeeCode: row.on_behalf_employee_code_raw ?? null,
          departmentName: row.department_name,
          typeOfClaim: row.type_of_claim,
          amount: normalizeAmount(row.amount),
          status: row.status as AdminClaimRecord["status"],
          submittedOn: row.submitted_on,
          hodActionDate: row.hod_action_date,
          financeActionDate: row.finance_action_date,
          detailType: row.detail_type,
          submissionType: row.submission_type,
          isActive: row.is_active,
          departmentId: row.department_id,
          deletedByName: row.deleted_by_name ?? null,
          deletedByRole: row.deleted_by_role ?? null,
          deletedAt: row.deleted_at ?? null,
        })),
        nextCursor,
        hasNextPage,
      },
      errorMessage: null,
    };
  }

  async getClaimOverrideSummary(claimReference: string): Promise<{
    data: AdminClaimOverrideSummary | null;
    errorMessage: string | null;
  }> {
    const referenceCandidates = buildClaimReferenceCandidates(claimReference);

    for (const candidate of referenceCandidates) {
      const { data, error } = await this.client
        .from("claims")
        .select(
          "id, status, is_active, assigned_l2_approver_id, hod_action_at, finance_action_at, rejection_reason, is_resubmission_allowed, submitter_user:users!claims_submitted_by_fkey(full_name, email), master_departments(name), expense_details(total_amount, is_active), advance_details(requested_amount, is_active)",
        )
        .eq("id", candidate)
        .maybeSingle();

      if (error) {
        return { data: null, errorMessage: error.message };
      }

      if (!data) {
        continue;
      }

      const row = data as ClaimOverrideRow;
      const submitter = normalizeRelation(row.submitter_user);
      const department = normalizeRelation(row.master_departments);

      return {
        data: {
          claimId: row.id,
          submitterName: submitter?.full_name ?? null,
          submitterEmail: submitter?.email ?? null,
          status: row.status,
          amount: pickClaimAmount({
            expenseDetails: row.expense_details,
            advanceDetails: row.advance_details,
          }),
          departmentName: department?.name ?? null,
          isActive: row.is_active,
        },
        errorMessage: null,
      };
    }

    return { data: null, errorMessage: null };
  }

  async forceUpdateClaimStatus(input: {
    claimId: string;
    actorId: string;
    newStatus: DbClaimStatus;
    reason: string;
  }): Promise<{ success: boolean; errorMessage: string | null }> {
    const reason = input.reason.trim();

    const { data: currentClaimData, error: fetchError } = await this.client
      .from("claims")
      .select(
        "id, status, assigned_l2_approver_id, hod_action_at, finance_action_at, rejection_reason, is_resubmission_allowed",
      )
      .eq("id", input.claimId)
      .maybeSingle();

    if (fetchError) {
      return { success: false, errorMessage: fetchError.message };
    }

    if (!currentClaimData) {
      return { success: false, errorMessage: "Claim not found." };
    }

    const currentClaim = currentClaimData as ClaimOverrideTransitionRow;
    const timestampIso = new Date().toISOString();
    const auditActionType = resolveOverrideAuditActionType({
      targetStatus: input.newStatus,
      assignedL2ApproverId: currentClaim.assigned_l2_approver_id,
    });

    const updatePayload = resolveOverrideClaimUpdate({
      currentClaim,
      targetStatus: input.newStatus,
      reason,
      timestampIso,
    });

    const { error: updateError } = await this.client
      .from("claims")
      .update(updatePayload)
      .eq("id", input.claimId);

    if (updateError) {
      return { success: false, errorMessage: updateError.message };
    }

    const overrideRemarks = `Admin override: ${currentClaim.status} -> ${input.newStatus}. Reason: ${reason}`;

    const { error: auditError } = await this.client.from("claim_audit_logs").insert({
      claim_id: input.claimId,
      actor_id: input.actorId,
      action_type: auditActionType,
      assigned_to_id: null,
      remarks: overrideRemarks,
    });

    if (!auditError) {
      return { success: true, errorMessage: null };
    }

    const { error: rollbackError } = await this.client
      .from("claims")
      .update({
        status: currentClaim.status,
        hod_action_at: currentClaim.hod_action_at,
        finance_action_at: currentClaim.finance_action_at,
        rejection_reason: currentClaim.rejection_reason,
        is_resubmission_allowed: currentClaim.is_resubmission_allowed,
      })
      .eq("id", input.claimId);

    if (rollbackError) {
      return {
        success: false,
        errorMessage: `Failed to write audit log (${auditError.message}). Rollback also failed (${rollbackError.message}).`,
      };
    }

    return {
      success: false,
      errorMessage: `Failed to write audit log: ${auditError.message}. Status update was reverted.`,
    };
  }

  async forceUpdatePaymentMode(input: {
    claimId: string;
    actorId: string;
    newPaymentModeId: string;
    editReason: string;
  }): Promise<{ success: boolean; errorMessage: string | null }> {
    const editReason = input.editReason.trim();

    if (editReason.length < 5) {
      return { success: false, errorMessage: "Reason must be at least 5 characters." };
    }

    const { data: currentClaimData, error: fetchError } = await this.client
      .from("claims")
      .select("id, status, is_active, payment_mode_id")
      .eq("id", input.claimId)
      .maybeSingle();

    if (fetchError) {
      return { success: false, errorMessage: fetchError.message };
    }

    if (!currentClaimData) {
      return { success: false, errorMessage: "Claim not found." };
    }

    const currentClaim = currentClaimData as Pick<
      ClaimOverrideTransitionRow,
      "id" | "status" | "is_active" | "payment_mode_id"
    >;

    if (!currentClaim.is_active) {
      return { success: false, errorMessage: "Claim is inactive and cannot be updated." };
    }

    if (currentClaim.status === DB_PAYMENT_DONE_CLOSED_STATUS) {
      return {
        success: false,
        errorMessage: "Cannot update payment mode after claim is Payment Done - Closed.",
      };
    }

    if (currentClaim.status !== DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS) {
      return {
        success: false,
        errorMessage:
          "Admin payment mode override is allowed only for Finance Approved - Payment under process claims.",
      };
    }

    const { data: targetPaymentModeData, error: targetPaymentModeError } = await this.client
      .from("master_payment_modes")
      .select("id, name, is_active")
      .eq("id", input.newPaymentModeId)
      .maybeSingle();

    if (targetPaymentModeError) {
      return { success: false, errorMessage: targetPaymentModeError.message };
    }

    if (!targetPaymentModeData) {
      return { success: false, errorMessage: "Selected payment mode was not found." };
    }

    const targetPaymentMode = targetPaymentModeData as ClaimPaymentModeLookupRow;

    if (!targetPaymentMode.is_active) {
      return { success: false, errorMessage: "Selected payment mode is inactive." };
    }

    if (isCorporateCardPaymentModeName(targetPaymentMode.name)) {
      return {
        success: false,
        errorMessage: "Corporate Card cannot be selected for admin payment mode override.",
      };
    }

    if (!isAdminPaymentModeOverrideAllowedName(targetPaymentMode.name)) {
      return {
        success: false,
        errorMessage: "Admin payment mode override supports only Reimbursement or Petty Cash.",
      };
    }

    if (currentClaim.payment_mode_id === input.newPaymentModeId) {
      return { success: true, errorMessage: null };
    }

    let currentPaymentModeName: string | null = null;

    if (currentClaim.payment_mode_id) {
      const { data: existingPaymentModeData, error: existingPaymentModeError } = await this.client
        .from("master_payment_modes")
        .select("id, name, is_active")
        .eq("id", currentClaim.payment_mode_id)
        .maybeSingle();

      if (existingPaymentModeError) {
        return { success: false, errorMessage: existingPaymentModeError.message };
      }

      currentPaymentModeName =
        (existingPaymentModeData as ClaimPaymentModeLookupRow | null)?.name ?? null;
    }

    const { error: updateError } = await this.client
      .from("claims")
      .update({
        payment_mode_id: input.newPaymentModeId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.claimId)
      .eq("is_active", true)
      .eq("status", DB_FINANCE_APPROVED_PAYMENT_UNDER_PROCESS_STATUS);

    if (updateError) {
      return { success: false, errorMessage: updateError.message };
    }

    const sourceLabel =
      currentPaymentModeName ?? currentClaim.payment_mode_id ?? "Unknown current payment mode";
    const overrideRemarks = `Admin Override: Payment Mode changed (${sourceLabel} -> ${targetPaymentMode.name}). Reason: ${editReason}`;

    const { error: auditError } = await this.client.from("claim_audit_logs").insert({
      claim_id: input.claimId,
      actor_id: input.actorId,
      action_type: "ADMIN_PAYMENT_MODE_OVERRIDDEN",
      assigned_to_id: null,
      remarks: overrideRemarks,
    });

    if (!auditError) {
      return { success: true, errorMessage: null };
    }

    const { error: rollbackError } = await this.client
      .from("claims")
      .update({
        payment_mode_id: currentClaim.payment_mode_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.claimId)
      .eq("is_active", true);

    if (rollbackError) {
      return {
        success: false,
        errorMessage: `Failed to write audit log (${auditError.message}). Rollback also failed (${rollbackError.message}).`,
      };
    }

    return {
      success: false,
      errorMessage: `Failed to write audit log: ${auditError.message}. Payment mode update was reverted.`,
    };
  }

  async softDeleteClaim(
    claimId: string,
    actorId: string,
  ): Promise<{ success: boolean; errorMessage: string | null }> {
    // Check if already inactive (idempotent)
    const { data: existingClaim, error: fetchError } = await this.client
      .from("claims")
      .select("is_active")
      .eq("id", claimId)
      .single();

    if (fetchError) {
      return { success: false, errorMessage: fetchError.message };
    }

    if (!existingClaim) {
      return { success: false, errorMessage: "Claim not found" };
    }

    if (!existingClaim.is_active) {
      // Already soft-deleted — idempotent, treat as success
      return { success: true, errorMessage: null };
    }

    const deletedAtIso = new Date().toISOString();

    // Soft-delete claim header
    const { error: updateError } = await this.client
      .from("claims")
      .update({
        is_active: false,
        deleted_by: actorId,
        deleted_at: deletedAtIso,
        updated_at: deletedAtIso,
      })
      .eq("id", claimId);

    if (updateError) {
      return { success: false, errorMessage: updateError.message };
    }

    let auditWarning: string | null = null;

    const { error: auditError } = await this.client.from("claim_audit_logs").insert({
      claim_id: claimId,
      actor_id: actorId,
      action_type: "ADMIN_SOFT_DELETED",
      assigned_to_id: null,
      remarks: "Claim was soft-deleted by admin.",
    });

    if (auditError) {
      auditWarning = `Soft-delete succeeded but audit log failed: ${auditError.message}`;
    }

    // Cascade soft-delete to detail rows so the partial unique index
    // (uq_expense_details_active_bill WHERE is_active = true) releases the
    // slot, allowing the user to re-upload the same receipt after deletion.
    const { error: expenseDetailError } = await this.client
      .from("expense_details")
      .update({ is_active: false })
      .eq("claim_id", claimId);

    if (expenseDetailError) {
      return { success: false, errorMessage: expenseDetailError.message };
    }

    const { error: advanceDetailError } = await this.client
      .from("advance_details")
      .update({ is_active: false })
      .eq("claim_id", claimId);

    if (advanceDetailError) {
      return { success: false, errorMessage: advanceDetailError.message };
    }

    if (auditWarning) {
      // Audit log write failed — log as warning but don't roll back the soft-delete
      return { success: true, errorMessage: auditWarning };
    }

    return { success: true, errorMessage: null };
  }

  // ─── Master data (generic) ────────────────────────────────────

  async getMasterDataItems(
    tableName: MasterDataTableName,
  ): Promise<{ data: MasterDataItem[]; errorMessage: string | null }> {
    const { data, error } = await this.client
      .from(tableName)
      .select("id, name, is_active")
      .order("name", { ascending: true });

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    return {
      data: (data ?? []).map((row: MasterDataRow) => ({
        id: row.id,
        name: row.name,
        isActive: row.is_active,
      })),
      errorMessage: null,
    };
  }

  async createMasterDataItem(
    tableName: MasterDataTableName,
    name: string,
  ): Promise<{ data: MasterDataItem | null; errorMessage: string | null }> {
    const { data, error } = await this.client
      .from(tableName)
      .insert({ name: name.trim() })
      .select("id, name, is_active")
      .single();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    const row = data as MasterDataRow;
    return {
      data: { id: row.id, name: row.name, isActive: row.is_active },
      errorMessage: null,
    };
  }

  async updateMasterDataItem(
    tableName: MasterDataTableName,
    id: string,
    payload: { name?: string; isActive?: boolean },
  ): Promise<{ data: MasterDataItem | null; errorMessage: string | null }> {
    const updatePayload: Record<string, unknown> = {};
    if (payload.name !== undefined) updatePayload.name = payload.name.trim();
    if (payload.isActive !== undefined) updatePayload.is_active = payload.isActive;

    const { data, error } = await this.client
      .from(tableName)
      .update(updatePayload)
      .eq("id", id)
      .select("id, name, is_active")
      .single();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    const row = data as MasterDataRow;
    return {
      data: { id: row.id, name: row.name, isActive: row.is_active },
      errorMessage: null,
    };
  }

  // ─── Departments + actors ─────────────────────────────────────

  async getDepartmentsWithActors(): Promise<{
    data: DepartmentWithActors[];
    errorMessage: string | null;
  }> {
    const { data, error } = await this.client
      .from("master_departments")
      .select(
        "id, name, is_active, hod_user_id, founder_user_id, hod_provisional_email, founder_provisional_email, hod:users!master_departments_hod_user_id_fkey(full_name, email), founder:users!master_departments_founder_user_id_fkey(full_name, email)",
      )
      .order("name", { ascending: true });

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    return {
      data: (data ?? []).map((row: DepartmentActorRow) => {
        const hod = normalizeRelation(row.hod);
        const founder = normalizeRelation(row.founder);

        return {
          id: row.id,
          name: row.name,
          isActive: row.is_active,
          hodUserId: row.hod_user_id,
          hodUserName: hod?.full_name ?? null,
          hodUserEmail: hod?.email ?? null,
          hodProvisionalEmail: row.hod_provisional_email,
          founderUserId: row.founder_user_id,
          founderUserName: founder?.full_name ?? null,
          founderUserEmail: founder?.email ?? null,
          founderProvisionalEmail: row.founder_provisional_email,
        };
      }),
      errorMessage: null,
    };
  }

  async updateDepartmentActors(
    departmentId: string,
    hodUserId: string,
    founderUserId: string,
  ): Promise<{ success: boolean; errorMessage: string | null }> {
    if (hodUserId === founderUserId) {
      return { success: false, errorMessage: "HOD and Founder cannot be the same person." };
    }

    const { error } = await this.client
      .from("master_departments")
      .update({ hod_user_id: hodUserId, founder_user_id: founderUserId })
      .eq("id", departmentId);

    if (error) {
      return { success: false, errorMessage: error.message };
    }

    return { success: true, errorMessage: null };
  }

  async updateDepartmentActorsByEmail(
    departmentId: string,
    hodEmail: string,
    founderEmail: string,
  ): Promise<{ success: boolean; errorMessage: string | null }> {
    // Look up HOD user by email
    const { data: hodUser } = await this.client
      .from("users")
      .select("id")
      .eq("email", hodEmail)
      .maybeSingle();

    // Look up Founder user by email
    const { data: founderUser } = await this.client
      .from("users")
      .select("id")
      .eq("email", founderEmail)
      .maybeSingle();

    const hodUserId = hodUser?.id ?? null;
    const founderUserId = founderUser?.id ?? null;

    if (hodUserId && founderUserId && hodUserId === founderUserId) {
      return { success: false, errorMessage: "HOD and Founder cannot be the same person." };
    }

    const updatePayload: Record<string, unknown> = {
      hod_user_id: hodUserId,
      hod_provisional_email: hodUserId ? null : hodEmail,
      founder_user_id: founderUserId,
      founder_provisional_email: founderUserId ? null : founderEmail,
    };

    const { error } = await this.client
      .from("master_departments")
      .update(updatePayload)
      .eq("id", departmentId);

    if (error) {
      return { success: false, errorMessage: error.message };
    }

    return { success: true, errorMessage: null };
  }

  async createDepartmentWithActorsByEmail(input: {
    name: string;
    hodEmail: string;
    founderEmail: string;
  }): Promise<{ data: CreatedDepartmentRecord | null; errorMessage: string | null }> {
    const name = input.name.trim();
    const hodEmail = input.hodEmail.trim().toLowerCase();
    const founderEmail = input.founderEmail.trim().toLowerCase();

    if (hodEmail === founderEmail) {
      return { data: null, errorMessage: "HOD and Founder cannot be the same person." };
    }

    const [hodLookup, founderLookup] = await Promise.all([
      this.resolveUserIdByEmail(hodEmail),
      this.resolveUserIdByEmail(founderEmail),
    ]);

    if (hodLookup.errorMessage) {
      return { data: null, errorMessage: hodLookup.errorMessage };
    }

    if (founderLookup.errorMessage) {
      return { data: null, errorMessage: founderLookup.errorMessage };
    }

    const hodUserId = hodLookup.userId;
    const founderUserId = founderLookup.userId;

    if (!hodUserId || !founderUserId) {
      return {
        data: null,
        errorMessage: "Failed to resolve HOD/Founder user IDs.",
      };
    }

    if (hodUserId === founderUserId) {
      return { data: null, errorMessage: "HOD and Founder cannot be the same person." };
    }

    const { data, error } = await this.client
      .from("master_departments")
      .insert({
        name,
        hod_user_id: hodUserId,
        founder_user_id: founderUserId,
        hod_provisional_email: null,
        founder_provisional_email: null,
      })
      .select("id, name, hod_user_id, founder_user_id, is_active")
      .single();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    const row = data as DepartmentInsertRow;
    return {
      data: {
        id: row.id,
        name: row.name,
        hodUserId: row.hod_user_id,
        founderUserId: row.founder_user_id,
        isActive: row.is_active,
      },
      errorMessage: null,
    };
  }

  // ─── Finance approvers ────────────────────────────────────────

  async getFinanceApprovers(): Promise<{
    data: FinanceApproverRecord[];
    errorMessage: string | null;
  }> {
    const { data, error } = await this.client
      .from("master_finance_approvers")
      .select(
        "id, user_id, is_active, is_primary, provisional_email, user:users!master_finance_approvers_user_id_fkey(full_name, email)",
      )
      .order("is_primary", { ascending: false });

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    return {
      data: (data ?? []).map((row: FinanceApproverRow) => {
        const user = normalizeRelation(row.user);
        return {
          id: row.id,
          userId: row.user_id,
          email: user?.email ?? row.provisional_email ?? "",
          fullName: user?.full_name ?? null,
          isActive: row.is_active,
          isPrimary: row.is_primary,
          provisionalEmail: row.provisional_email,
        };
      }),
      errorMessage: null,
    };
  }

  async createFinanceApprover(
    userId: string,
  ): Promise<{ data: FinanceApproverRecord | null; errorMessage: string | null }> {
    const { data, error } = await this.client
      .from("master_finance_approvers")
      .insert({ user_id: userId })
      .select(
        "id, user_id, is_active, is_primary, provisional_email, user:users!master_finance_approvers_user_id_fkey(full_name, email)",
      )
      .single();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    const row = data as FinanceApproverRow;
    const user = normalizeRelation(row.user);
    return {
      data: {
        id: row.id,
        userId: row.user_id,
        email: user?.email ?? row.provisional_email ?? "",
        fullName: user?.full_name ?? null,
        isActive: row.is_active,
        isPrimary: row.is_primary,
        provisionalEmail: row.provisional_email,
      },
      errorMessage: null,
    };
  }

  async updateFinanceApprover(
    id: string,
    payload: { isActive?: boolean; isPrimary?: boolean },
  ): Promise<{ data: FinanceApproverRecord | null; errorMessage: string | null }> {
    const updatePayload: Record<string, unknown> = {};
    if (payload.isActive !== undefined) updatePayload.is_active = payload.isActive;
    if (payload.isPrimary !== undefined) updatePayload.is_primary = payload.isPrimary;

    const { data, error } = await this.client
      .from("master_finance_approvers")
      .update(updatePayload)
      .eq("id", id)
      .select(
        "id, user_id, is_active, is_primary, provisional_email, user:users!master_finance_approvers_user_id_fkey(full_name, email)",
      )
      .single();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    const row = data as FinanceApproverRow;
    const user = normalizeRelation(row.user);
    return {
      data: {
        id: row.id,
        userId: row.user_id,
        email: user?.email ?? row.provisional_email ?? "",
        fullName: user?.full_name ?? null,
        isActive: row.is_active,
        isPrimary: row.is_primary,
        provisionalEmail: row.provisional_email,
      },
      errorMessage: null,
    };
  }

  async addFinanceApproverByEmail(
    email: string,
  ): Promise<{ data: FinanceApproverRecord | null; errorMessage: string | null }> {
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Check if user already exists in the users table
    const { data: existingUser } = await this.client
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    // 2. Check for an existing finance approver entry by provisional_email or user_id
    let approverCheckQuery = this.client
      .from("master_finance_approvers")
      .select("id")
      .eq("provisional_email", normalizedEmail);

    if (existingUser) {
      approverCheckQuery = this.client
        .from("master_finance_approvers")
        .select("id")
        .or(`provisional_email.eq.${normalizedEmail},user_id.eq.${existingUser.id}`);
    }

    const { data: existingApprover } = await approverCheckQuery.maybeSingle();

    if (existingApprover) {
      return {
        data: null,
        errorMessage: "This email is already registered as a finance approver.",
      };
    }

    if (existingUser) {
      // User already exists — create a fully-linked entry
      return this.createFinanceApprover(existingUser.id);
    }

    // User hasn't logged in yet — create provisional entry
    const { data, error } = await this.client
      .from("master_finance_approvers")
      .insert({ provisional_email: normalizedEmail })
      .select("id, user_id, is_active, is_primary, provisional_email")
      .single();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    const row = data as FinanceApproverRow;
    return {
      data: {
        id: row.id,
        userId: null,
        email: normalizedEmail,
        fullName: null,
        isActive: row.is_active,
        isPrimary: row.is_primary,
        provisionalEmail: normalizedEmail,
      },
      errorMessage: null,
    };
  }

  // ─── Users ────────────────────────────────────────────────────

  async getAllUsers(pagination: AdminCursorPaginationInput): Promise<{
    data: AdminCursorPaginatedResult<AdminUserRecord> | null;
    errorMessage: string | null;
  }> {
    const limit = pagination.limit + 1;

    let query = this.client
      .from("users")
      .select("id, email, full_name, role, is_active, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);

    if (pagination.cursor) {
      query = query.lt("created_at", pagination.cursor);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    const rows = (data ?? []) as UserRow[];
    const hasNextPage = rows.length > pagination.limit;
    const pageRows = hasNextPage ? rows.slice(0, pagination.limit) : rows;
    const nextCursor = hasNextPage ? (pageRows[pageRows.length - 1]?.created_at ?? null) : null;

    return {
      data: {
        data: pageRows.map((row) => ({
          id: row.id,
          email: row.email,
          fullName: row.full_name,
          role: row.role,
          isActive: row.is_active,
          createdAt: row.created_at,
        })),
        nextCursor,
        hasNextPage,
      },
      errorMessage: null,
    };
  }

  async updateUserRole(
    userId: string,
    role: string,
  ): Promise<{ success: boolean; errorMessage: string | null }> {
    const { error } = await this.client.from("users").update({ role }).eq("id", userId);

    if (error) {
      return { success: false, errorMessage: error.message };
    }

    return { success: true, errorMessage: null };
  }

  // ─── Admins ───────────────────────────────────────────────────

  async getAdmins(): Promise<{ data: AdminRecord[]; errorMessage: string | null }> {
    const { data, error } = await this.client
      .from("admins")
      .select(
        "id, user_id, provisional_email, created_at, user:users!admins_user_id_fkey(full_name, email)",
      )
      .order("created_at", { ascending: true });

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    return {
      data: (data ?? []).map((row: AdminRow) => {
        const user = normalizeRelation(row.user);
        return {
          id: row.id,
          userId: row.user_id,
          email: user?.email ?? row.provisional_email ?? "",
          fullName: user?.full_name ?? null,
          createdAt: row.created_at,
          provisionalEmail: row.provisional_email,
        };
      }),
      errorMessage: null,
    };
  }

  async addAdminByEmail(
    email: string,
  ): Promise<{ data: AdminRecord | null; errorMessage: string | null }> {
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Check if user already exists
    const { data: existingUser } = await this.client
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    // 2. Duplicate check (by provisional_email or user_id)
    const { data: existingAdmin } = await this.client
      .from("admins")
      .select("id")
      .or(
        existingUser
          ? `provisional_email.eq.${normalizedEmail},user_id.eq.${existingUser.id}`
          : `provisional_email.eq.${normalizedEmail}`,
      )
      .maybeSingle();

    if (existingAdmin) {
      return { data: null, errorMessage: "This email is already registered as an admin." };
    }

    if (existingUser) {
      // User exists — create a fully-linked entry immediately
      const { data, error } = await this.client
        .from("admins")
        .insert({ user_id: existingUser.id })
        .select(
          "id, user_id, provisional_email, created_at, user:users!admins_user_id_fkey(full_name, email)",
        )
        .single();

      if (error) return { data: null, errorMessage: error.message };

      const row = data as AdminRow;
      const user = normalizeRelation(row.user);
      return {
        data: {
          id: row.id,
          userId: row.user_id,
          email: user?.email ?? normalizedEmail,
          fullName: user?.full_name ?? null,
          createdAt: row.created_at,
          provisionalEmail: null,
        },
        errorMessage: null,
      };
    }

    // User hasn't logged in yet — create provisional entry (user_id = null)
    const { data, error } = await this.client
      .from("admins")
      .insert({ provisional_email: normalizedEmail })
      .select("id, user_id, provisional_email, created_at")
      .single();

    if (error) return { data: null, errorMessage: error.message };

    const row = data as AdminRow;
    return {
      data: {
        id: row.id,
        userId: null,
        email: normalizedEmail,
        fullName: null,
        createdAt: row.created_at,
        provisionalEmail: normalizedEmail,
      },
      errorMessage: null,
    };
  }

  async removeAdmin(adminId: string): Promise<{ success: boolean; errorMessage: string | null }> {
    const { error } = await this.client.from("admins").delete().eq("id", adminId);

    if (error) {
      return { success: false, errorMessage: error.message };
    }

    return { success: true, errorMessage: null };
  }

  // ─── Department Viewers (POC) ─────────────────────────────────

  async getDepartmentViewers(): Promise<{
    data: DepartmentViewerAdminRecord[];
    errorMessage: string | null;
  }> {
    const { data, error } = await this.client
      .from("department_viewers")
      .select(
        "id, user_id, department_id, is_active, created_at, user:users!department_viewers_user_id_fkey(full_name, email), department:master_departments!department_viewers_department_id_fkey(name)",
      )
      .order("created_at", { ascending: true });

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    return {
      data: (data ?? []).map((row: DepartmentViewerRow) => {
        const user = normalizeRelation(row.user);
        const dept = normalizeRelation(row.department);
        return {
          id: row.id,
          userId: row.user_id,
          email: user?.email ?? "",
          fullName: user?.full_name ?? null,
          departmentId: row.department_id,
          departmentName: dept?.name ?? "",
          isActive: row.is_active,
          createdAt: row.created_at,
        };
      }),
      errorMessage: null,
    };
  }

  async addDepartmentViewerByEmail(
    departmentId: string,
    email: string,
  ): Promise<{ data: DepartmentViewerAdminRecord | null; errorMessage: string | null }> {
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Look up user by email — must already exist (user_id is NOT NULL)
    const { data: existingUser } = await this.client
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (!existingUser) {
      return {
        data: null,
        errorMessage:
          "No user found with this email. The user must sign in at least once before they can be assigned as a Department Viewer.",
      };
    }

    // 2. Duplicate check (same user + department, including inactive)
    const { data: existing } = await this.client
      .from("department_viewers")
      .select("id, is_active")
      .eq("user_id", existingUser.id)
      .eq("department_id", departmentId)
      .maybeSingle();

    if (existing) {
      if (!existing.is_active) {
        // Re-activate existing inactive assignment
        const { error: reactivateError } = await this.client
          .from("department_viewers")
          .update({ is_active: true })
          .eq("id", existing.id);

        if (reactivateError) {
          return { data: null, errorMessage: reactivateError.message };
        }

        // Re-fetch the full row
        const { data: reactivated } = await this.client
          .from("department_viewers")
          .select(
            "id, user_id, department_id, is_active, created_at, user:users!department_viewers_user_id_fkey(full_name, email), department:master_departments!department_viewers_department_id_fkey(name)",
          )
          .eq("id", existing.id)
          .single();

        if (!reactivated) {
          return { data: null, errorMessage: "Failed to re-fetch reactivated viewer." };
        }

        const row = reactivated as DepartmentViewerRow;
        const user = normalizeRelation(row.user);
        const dept = normalizeRelation(row.department);
        return {
          data: {
            id: row.id,
            userId: row.user_id,
            email: user?.email ?? normalizedEmail,
            fullName: user?.full_name ?? null,
            departmentId: row.department_id,
            departmentName: dept?.name ?? "",
            isActive: row.is_active,
            createdAt: row.created_at,
          },
          errorMessage: null,
        };
      }

      return {
        data: null,
        errorMessage: "This user is already assigned as a viewer for this department.",
      };
    }

    // 3. Insert new assignment
    const { data: inserted, error: insertError } = await this.client
      .from("department_viewers")
      .insert({ user_id: existingUser.id, department_id: departmentId })
      .select(
        "id, user_id, department_id, is_active, created_at, user:users!department_viewers_user_id_fkey(full_name, email), department:master_departments!department_viewers_department_id_fkey(name)",
      )
      .single();

    if (insertError) {
      return { data: null, errorMessage: insertError.message };
    }

    const row = inserted as DepartmentViewerRow;
    const user = normalizeRelation(row.user);
    const dept = normalizeRelation(row.department);
    return {
      data: {
        id: row.id,
        userId: row.user_id,
        email: user?.email ?? normalizedEmail,
        fullName: user?.full_name ?? null,
        departmentId: row.department_id,
        departmentName: dept?.name ?? "",
        isActive: row.is_active,
        createdAt: row.created_at,
      },
      errorMessage: null,
    };
  }

  async removeDepartmentViewer(
    viewerId: string,
  ): Promise<{ success: boolean; errorMessage: string | null }> {
    // Soft-delete: set is_active = false
    const { error } = await this.client
      .from("department_viewers")
      .update({ is_active: false })
      .eq("id", viewerId);

    if (error) {
      return { success: false, errorMessage: error.message };
    }

    return { success: true, errorMessage: null };
  }
}
