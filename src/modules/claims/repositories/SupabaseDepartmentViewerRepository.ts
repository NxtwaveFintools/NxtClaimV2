import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import type {
  DepartmentViewerClaimRecord,
  DepartmentViewerDepartment,
  DepartmentViewerFilters,
  DepartmentViewerPaginatedResult,
  DepartmentViewerPaginationInput,
  DepartmentViewerRepository,
} from "@/core/domain/claims/contracts";

// ----------------------------------------------------------------
// Raw row types (Supabase response shapes)
// ----------------------------------------------------------------

type ViewerDepartmentRow = {
  department_id: string;
  master_departments: { name: string } | { name: string }[] | null;
};

type EnterpriseDashboardRow = {
  claim_id: string;
  employee_name: string;
  employee_id: string;
  submitter_email: string | null;
  department_name: string;
  type_of_claim: string;
  amount: number | string;
  status: string;
  submitted_on: string;
  hod_action_date: string | null;
  finance_action_date: string | null;
  detail_type: "expense" | "advance";
  submission_type: "Self" | "On Behalf";
  department_id: string | null;
};

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function normalizeAmount(value: number | string | null): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "string" ? parseFloat(value) : value;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

// ----------------------------------------------------------------
// Repository implementation
// ----------------------------------------------------------------

export class SupabaseDepartmentViewerRepository implements DepartmentViewerRepository {
  private get client() {
    return getServiceRoleSupabaseClient();
  }

  async getViewerDepartments(
    userId: string,
  ): Promise<{ data: DepartmentViewerDepartment[]; errorMessage: string | null }> {
    const { data, error } = await this.client
      .from("department_viewers")
      .select("department_id, master_departments(name)")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) {
      return { data: [], errorMessage: error.message };
    }

    const rows = (data ?? []) as ViewerDepartmentRow[];

    return {
      data: rows
        .map((row) => {
          const dept = normalizeRelation(row.master_departments);
          return {
            id: row.department_id,
            name: dept?.name ?? "Unknown Department",
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      errorMessage: null,
    };
  }

  async getClaims(
    departmentIds: string[],
    filters: DepartmentViewerFilters,
    pagination: DepartmentViewerPaginationInput,
  ): Promise<{
    data: DepartmentViewerPaginatedResult<DepartmentViewerClaimRecord> | null;
    errorMessage: string | null;
  }> {
    if (departmentIds.length === 0) {
      return {
        data: { data: [], nextCursor: null, hasNextPage: false },
        errorMessage: null,
      };
    }

    const limit = pagination.limit + 1;

    let query = this.client
      .from("vw_enterprise_claims_dashboard")
      .select(
        "claim_id, employee_name, employee_id, submitter_email, department_name, type_of_claim, amount, status, submitted_on, hod_action_date, finance_action_date, detail_type, submission_type, department_id, payment_mode_id, location_id, product_id, expense_category_id",
      )
      .in("department_id", departmentIds)
      .order("submitted_on", { ascending: false })
      .order("claim_id", { ascending: false })
      .limit(limit);

    // Filter to a specific department within assigned departments
    if (filters.departmentId) {
      query = query.eq("department_id", filters.departmentId);
    }

    if (filters.status && filters.status.length > 0) {
      query = query.in("status", filters.status);
    }

    if (filters.searchQuery) {
      const sq = filters.searchQuery;
      if (filters.searchField === "claim_id") {
        query = query.eq("claim_id", sq);
      } else if (filters.searchField === "employee_name") {
        query = query.ilike("employee_name", `%${sq}%`);
      } else if (filters.searchField === "employee_id") {
        query = query.ilike("employee_id", `%${sq}%`);
      } else if (filters.searchField === "employee_email") {
        query = query.ilike("submitter_email", `%${sq}%`);
      } else {
        query = query.or(
          `claim_id.ilike.%${sq}%,employee_name.ilike.%${sq}%,employee_id.ilike.%${sq}%,submitter_email.ilike.%${sq}%`,
        );
      }
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
      query = query.gte(column, `${filters.dateFrom}T00:00:00.000Z`);
    }

    if (filters.dateTo) {
      const column =
        filters.dateTarget === "hod_action"
          ? "hod_action_date"
          : filters.dateTarget === "finance_closed"
            ? "finance_action_date"
            : "submitted_on";
      query = query.lte(column, `${filters.dateTo}T23:59:59.999Z`);
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
          departmentName: row.department_name,
          typeOfClaim: row.type_of_claim,
          amount: normalizeAmount(row.amount),
          status: row.status as DepartmentViewerClaimRecord["status"],
          submittedOn: row.submitted_on,
          hodActionDate: row.hod_action_date,
          financeActionDate: row.finance_action_date,
          detailType: row.detail_type,
          submissionType: row.submission_type,
          departmentId: row.department_id,
        })),
        nextCursor,
        hasNextPage,
      },
      errorMessage: null,
    };
  }
}
