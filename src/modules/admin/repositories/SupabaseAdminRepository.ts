import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import type {
  AdminClaimRecord,
  AdminClaimsFilters,
  AdminCursorPaginatedResult,
  AdminCursorPaginationInput,
  AdminRecord,
  AdminRepository,
  AdminUserRecord,
  DepartmentWithActors,
  FinanceApproverRecord,
  MasterDataItem,
  MasterDataTableName,
} from "@/core/domain/admin/contracts";

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

// ----------------------------------------------------------------
// Raw row types (Supabase response shapes)
// ----------------------------------------------------------------

type EnterpriseDashboardRow = {
  claim_id: string;
  employee_name: string;
  employee_id: string;
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

type MasterDataRow = {
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
      .from("vw_enterprise_claims_dashboard")
      .select(
        "claim_id, employee_name, employee_id, department_name, type_of_claim, amount, status, submitted_on, hod_action_date, finance_action_date, detail_type, submission_type, is_active, department_id",
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
      query = query.or(
        `claim_id.ilike.%${filters.searchQuery}%,employee_name.ilike.%${filters.searchQuery}%,employee_id.ilike.%${filters.searchQuery}%`,
      );
    }

    if (filters.isActive !== undefined) {
      query = query.eq("is_active", filters.isActive);
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
          status: row.status as AdminClaimRecord["status"],
          submittedOn: row.submitted_on,
          hodActionDate: row.hod_action_date,
          financeActionDate: row.finance_action_date,
          detailType: row.detail_type,
          submissionType: row.submission_type,
          isActive: row.is_active,
          departmentId: row.department_id,
        })),
        nextCursor,
        hasNextPage,
      },
      errorMessage: null,
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

    // Soft-delete
    const { error: updateError } = await this.client
      .from("claims")
      .update({ is_active: false })
      .eq("id", claimId);

    if (updateError) {
      return { success: false, errorMessage: updateError.message };
    }

    // Write audit log
    const { error: auditError } = await this.client.from("claim_audit_logs").insert({
      claim_id: claimId,
      actor_id: actorId,
      action_type: "ADMIN_SOFT_DELETED",
      assigned_to_id: null,
      remarks: null,
    });

    if (auditError) {
      // Audit log write failed — log as warning but don't roll back the soft-delete
      return {
        success: true,
        errorMessage: `Soft-delete succeeded but audit log failed: ${auditError.message}`,
      };
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
}
