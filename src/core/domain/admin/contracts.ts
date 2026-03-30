import type { DbClaimStatus } from "@/core/constants/statuses";

// ----------------------------------------------------------------
// Shared value types
// ----------------------------------------------------------------

export type MasterDataTableName =
  | "master_expense_categories"
  | "master_products"
  | "master_locations"
  | "master_payment_modes";

export type MasterDataItem = {
  id: string;
  name: string;
  isActive: boolean;
};

export type AdminClaimRecord = {
  claimId: string;
  employeeName: string;
  employeeId: string;
  departmentName: string;
  typeOfClaim: string;
  amount: number;
  status: DbClaimStatus;
  submittedOn: string;
  hodActionDate: string | null;
  financeActionDate: string | null;
  detailType: "expense" | "advance";
  submissionType: "Self" | "On Behalf";
  isActive: boolean;
  departmentId: string | null;
};

export type AdminUserRecord = {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
};

export type AdminRecord = {
  id: string;
  /** Null for provisional entries where the user has not yet signed in. */
  userId: string | null;
  email: string;
  fullName: string | null;
  createdAt: string;
  /** Set when admin was added by email before their first login. Null once promoted. */
  provisionalEmail: string | null;
};

export type DepartmentViewerAdminRecord = {
  id: string;
  userId: string;
  email: string;
  fullName: string | null;
  departmentId: string;
  departmentName: string;
  isActive: boolean;
  createdAt: string;
};

export type DepartmentWithActors = {
  id: string;
  name: string;
  isActive: boolean;
  hodUserId: string | null;
  hodUserName: string | null;
  hodUserEmail: string | null;
  /** Set when HOD was entered by email before their first login. Null once promoted. */
  hodProvisionalEmail: string | null;
  founderUserId: string | null;
  founderUserName: string | null;
  founderUserEmail: string | null;
  /** Set when Founder was entered by email before their first login. Null once promoted. */
  founderProvisionalEmail: string | null;
};

export type FinanceApproverRecord = {
  id: string;
  /** Null for provisional (pre-registered) entries where the user has not yet signed in. */
  userId: string | null;
  email: string;
  fullName: string | null;
  isActive: boolean;
  isPrimary: boolean;
  /** Set when the approver was added by email before their first login. Null once promoted. */
  provisionalEmail: string | null;
};

export type AdminCursorPaginationInput = {
  cursor: string | null;
  limit: number;
};

export type AdminCursorPaginatedResult<T> = {
  data: T[];
  nextCursor: string | null;
  hasNextPage: boolean;
};

export type AdminClaimsFilters = {
  status?: DbClaimStatus[];
  departmentId?: string;
  searchQuery?: string;
  searchField?: "claim_id" | "employee_name" | "employee_id";
  isActive?: boolean;
  submissionType?: "Self" | "On Behalf";
  paymentModeId?: string;
  locationId?: string;
  productId?: string;
  expenseCategoryId?: string;
  dateTarget?: "submitted" | "finance_closed";
  dateFrom?: string;
  dateTo?: string;
};

// ----------------------------------------------------------------
// Logger interface — mirrors the claims domain pattern
// ----------------------------------------------------------------

export type AdminDomainLogger = {
  info(event: string, payload?: Record<string, unknown>): void;
  warn(event: string, payload?: Record<string, unknown>): void;
  error(event: string, payload?: Record<string, unknown>): void;
};

// ----------------------------------------------------------------
// Repository interface
// ----------------------------------------------------------------

export interface AdminRepository {
  // Claims
  getAllClaims(
    filters: AdminClaimsFilters,
    pagination: AdminCursorPaginationInput,
  ): Promise<{
    data: AdminCursorPaginatedResult<AdminClaimRecord> | null;
    errorMessage: string | null;
  }>;

  softDeleteClaim(
    claimId: string,
    actorId: string,
  ): Promise<{ success: boolean; errorMessage: string | null }>;

  // Master data (generic)
  getMasterDataItems(
    tableName: MasterDataTableName,
  ): Promise<{ data: MasterDataItem[]; errorMessage: string | null }>;

  createMasterDataItem(
    tableName: MasterDataTableName,
    name: string,
  ): Promise<{ data: MasterDataItem | null; errorMessage: string | null }>;

  updateMasterDataItem(
    tableName: MasterDataTableName,
    id: string,
    payload: { name?: string; isActive?: boolean },
  ): Promise<{ data: MasterDataItem | null; errorMessage: string | null }>;

  // Departments + actors
  getDepartmentsWithActors(): Promise<{
    data: DepartmentWithActors[];
    errorMessage: string | null;
  }>;

  updateDepartmentActors(
    departmentId: string,
    hodUserId: string,
    founderUserId: string,
  ): Promise<{ success: boolean; errorMessage: string | null }>;

  updateDepartmentActorsByEmail(
    departmentId: string,
    hodEmail: string,
    founderEmail: string,
  ): Promise<{ success: boolean; errorMessage: string | null }>;

  // Finance approvers
  getFinanceApprovers(): Promise<{
    data: FinanceApproverRecord[];
    errorMessage: string | null;
  }>;

  createFinanceApprover(
    userId: string,
  ): Promise<{ data: FinanceApproverRecord | null; errorMessage: string | null }>;

  addFinanceApproverByEmail(
    email: string,
  ): Promise<{ data: FinanceApproverRecord | null; errorMessage: string | null }>;

  updateFinanceApprover(
    id: string,
    payload: { isActive?: boolean; isPrimary?: boolean },
  ): Promise<{ data: FinanceApproverRecord | null; errorMessage: string | null }>;

  // Users
  getAllUsers(pagination: AdminCursorPaginationInput): Promise<{
    data: AdminCursorPaginatedResult<AdminUserRecord> | null;
    errorMessage: string | null;
  }>;

  updateUserRole(
    userId: string,
    role: string,
  ): Promise<{ success: boolean; errorMessage: string | null }>;

  // Admins
  getAdmins(): Promise<{ data: AdminRecord[]; errorMessage: string | null }>;

  addAdminByEmail(
    email: string,
  ): Promise<{ data: AdminRecord | null; errorMessage: string | null }>;

  removeAdmin(adminId: string): Promise<{ success: boolean; errorMessage: string | null }>;

  // Department viewers (POC)
  getDepartmentViewers(): Promise<{
    data: DepartmentViewerAdminRecord[];
    errorMessage: string | null;
  }>;

  addDepartmentViewerByEmail(
    departmentId: string,
    email: string,
  ): Promise<{ data: DepartmentViewerAdminRecord | null; errorMessage: string | null }>;

  removeDepartmentViewer(
    viewerId: string,
  ): Promise<{ success: boolean; errorMessage: string | null }>;
}
