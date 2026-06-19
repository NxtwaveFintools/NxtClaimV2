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

export type DepartmentResponsibleMappingRecord = {
  id: string;
  departmentId: string;
  responsibleDepartmentCode: string;
  beneficiaryDepartmentCode: string;
  isActive: boolean;
  createdAt: string;
};

export type AdminClaimRecord = {
  claimId: string;
  employeeName: string;
  employeeId: string;
  submitterEmail?: string | null;
  onBehalfEmail?: string | null;
  onBehalfEmployeeCode?: string | null;
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
  deletedByName: string | null;
  deletedByRole: string | null;
  deletedAt: string | null;
};

export type AdminClaimOverrideSummary = {
  claimId: string;
  submitterName: string | null;
  submitterEmail: string | null;
  status: DbClaimStatus;
  amount: number;
  departmentName: string | null;
  isActive: boolean;
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
  approver1Id: string | null;
  approver1Name: string | null;
  approver1Email: string | null;
  /** Set when Approver 1 was entered by email before their first login. Null once promoted. */
  approver1ProvisionalEmail: string | null;
  approver2Id: string | null;
  approver2Name: string | null;
  approver2Email: string | null;
  /** Set when Approver 2 was entered by email before their first login. Null once promoted. */
  approver2ProvisionalEmail: string | null;
};

export type CreatedDepartmentRecord = {
  id: string;
  name: string;
  approver1Id: string;
  approver2Id: string;
  isActive: boolean;
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
  searchField?: "claim_id" | "employee_name" | "employee_id" | "employee_email" | "bill_no";
  isActive?: boolean;
  submissionType?: "Self" | "On Behalf";
  paymentModeId?: string;
  locationId?: string;
  productId?: string;
  expenseCategoryId?: string;
  dateTarget?: "submitted" | "hod_action" | "finance_closed";
  dateFrom?: string;
  dateTo?: string;
  submittedFrom?: string;
  submittedTo?: string;
  hodActionFrom?: string;
  hodActionTo?: string;
  financeActionFrom?: string;
  financeActionTo?: string;
  minAmount?: number;
  maxAmount?: number;
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

  getClaimOverrideSummary(claimReference: string): Promise<{
    data: AdminClaimOverrideSummary | null;
    errorMessage: string | null;
  }>;

  forceUpdateClaimStatus(input: {
    claimId: string;
    actorId: string;
    newStatus: DbClaimStatus;
    reason: string;
  }): Promise<{ success: boolean; errorMessage: string | null }>;

  forceUpdatePaymentMode(input: {
    claimId: string;
    actorId: string;
    newPaymentModeId: string;
    editReason: string;
  }): Promise<{ success: boolean; errorMessage: string | null }>;

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
    approver1Id: string,
    approver2Id: string,
  ): Promise<{ success: boolean; errorMessage: string | null }>;

  updateDepartmentActorsByEmail(
    departmentId: string,
    approver1Email: string,
    approver2Email: string,
  ): Promise<{ success: boolean; errorMessage: string | null }>;

  createDepartmentWithActorsByEmail(input: {
    name: string;
    approver1Email: string;
    approver2Email: string;
  }): Promise<{
    data: CreatedDepartmentRecord | null;
    errorMessage: string | null;
  }>;

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
