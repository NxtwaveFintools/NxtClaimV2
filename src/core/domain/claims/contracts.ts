import type { ClaimStatus, DbClaimStatus } from "@/core/constants/statuses";

export type ClaimDetailType = "expense" | "advance";

export type ClaimSubmissionType = "Self" | "On Behalf";

export type MyClaimsDateType = "claim_date";

export type ClaimSearchField = "claim_id" | "employee_name" | "employee_id" | "employee_email";

export type ClaimDateTarget = "submitted" | "hod_action" | "finance_closed";

export type ClaimPaymentMode = {
  id: string;
  name: string;
  isActive: boolean;
};

export type ClaimDropdownOption = {
  id: string;
  name: string;
};

export type ClaimDepartmentApprovers = {
  approver1Id: string | null;
  approver2Id: string | null;
};

export type ClaimSubmissionInput = {
  submissionType: ClaimSubmissionType;
  detailType: ClaimDetailType;
  submittedBy: string;
  onBehalfOfId: string | null;
  employeeId: string;
  ccEmails: string | null;
  onBehalfEmail: string | null;
  onBehalfEmployeeCode: string | null;
  departmentId: string;
  paymentModeId: string;
  assignedL2ApproverId: string | null;
  expense?: {
    billNo: string;
    transactionId: string;
    purpose: string;
    expenseCategoryId: string;
    productId: string;
    locationId: string;
    locationType: string | null;
    locationDetails: string | null;
    isGstApplicable: boolean;
    gstNumber: string | null;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    transactionDate: string;
    basicAmount: number;
    currencyCode: string;
    vendorName: string | null;
    receiptFilePath: string | null;
    bankStatementFilePath: string | null;
    peopleInvolved: string | null;
    remarks: string | null;
  };
  advance?: {
    requestedAmount: number;
    budgetMonth: number;
    budgetYear: number;
    expectedUsageDate: string | null;
    purpose: string;
    supportingDocumentPath: string | null;
    productId: string | null;
    locationId: string | null;
    remarks: string | null;
  };
};

export type FinanceExpenseEditPayload = {
  detailType: "expense";
  departmentId: string;
  paymentModeId: string;
  billNo: string;
  expenseCategoryId: string;
  locationId: string;
  transactionDate: string;
  isGstApplicable: boolean;
  gstNumber: string | null;
  vendorName: string | null;
  basicAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  purpose: string;
  productId: string | null;
  peopleInvolved: string | null;
  remarks: string | null;
  receiptFilePath: string | null;
  bankStatementFilePath: string | null;
};

export type FinanceAdvanceEditPayload = {
  detailType: "advance";
  departmentId: string;
  paymentModeId: string;
  purpose: string;
  requestedAmount: number;
  expectedUsageDate: string;
  productId: string | null;
  locationId: string | null;
  remarks: string | null;
  supportingDocumentPath: string | null;
};

export type FinanceClaimEditPayload = FinanceExpenseEditPayload | FinanceAdvanceEditPayload;

export type ClaimFinanceEditSnapshot = {
  id: string;
  detailType: ClaimDetailType;
  submittedBy: string;
  expenseReceiptFilePath: string | null;
  expenseBankStatementFilePath: string | null;
  advanceSupportingDocumentPath: string | null;
};

export type GetMyClaimsFilters = {
  paymentModeId?: string;
  departmentId?: string;
  locationId?: string;
  productId?: string;
  expenseCategoryId?: string;
  detailType?: ClaimDetailType;
  submissionType?: ClaimSubmissionType;
  status?: ClaimStatus | DbClaimStatus[];
  dateType?: MyClaimsDateType;
  dateTarget?: ClaimDateTarget;
  fromDate?: string;
  toDate?: string;
  dateFrom?: string;
  dateTo?: string;
  searchField?: ClaimSearchField;
  searchQuery?: string;
  submittedFrom?: string;
  submittedTo?: string;
  hodActionFrom?: string;
  hodActionTo?: string;
  financeActionFrom?: string;
  financeActionTo?: string;
  minAmount?: number;
  maxAmount?: number;
};

export type ClaimsExportFetchScope =
  | "submissions"
  | "l1_approvals"
  | "finance_approvals"
  | "admin"
  | "department_viewer";

export type ClaimExportRecord = {
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
};

export type ClaimFullExportRecord = {
  claimId: string;
  status: DbClaimStatus;
  submissionType: ClaimSubmissionType;
  detailType: ClaimDetailType;
  submittedBy: string;
  onBehalfOfId: string | null;
  employeeId: string;
  ccEmails: string | null;
  onBehalfEmail: string | null;
  onBehalfEmployeeCode: string | null;
  departmentId: string;
  departmentName: string | null;
  paymentModeId: string;
  paymentModeName: string | null;
  assignedL1ApproverId: string;
  assignedL2ApproverId: string | null;
  submittedAt: string;
  hodActionAt: string | null;
  financeActionAt: string | null;
  rejectionReason: string | null;
  isResubmissionAllowed: boolean;
  createdAt: string;
  updatedAt: string;
  submitterName: string | null;
  submitterEmail: string | null;
  beneficiaryName: string | null;
  beneficiaryEmail: string | null;
  pettyCashBalance: number | null;
  l1ApproverName: string | null;
  l1ApproverEmail: string | null;
  l2ApproverName: string | null;
  l2ApproverEmail: string | null;
  expenseBillNo: string | null;
  expenseTransactionId: string | null;
  expensePurpose: string | null;
  expenseCategoryId: string | null;
  expenseCategoryName: string | null;
  expenseProductId: string | null;
  expenseProductName: string | null;
  expenseLocationId: string | null;
  expenseLocationName: string | null;
  expenseLocationType: string | null;
  expenseLocationDetails: string | null;
  expenseIsGstApplicable: boolean | null;
  expenseGstNumber: string | null;
  expenseTransactionDate: string | null;
  expenseBasicAmount: number | null;
  expenseCgstAmount: number | null;
  expenseSgstAmount: number | null;
  expenseIgstAmount: number | null;
  expenseTotalAmount: number | null;
  expenseCurrencyCode: string | null;
  expenseVendorName: string | null;
  expensePeopleInvolved: string | null;
  expenseRemarks: string | null;
  expenseReceiptFilePath: string | null;
  expenseBankStatementFilePath: string | null;
  advanceRequestedAmount: number | null;
  advanceBudgetMonth: number | null;
  advanceBudgetYear: number | null;
  advanceExpectedUsageDate: string | null;
  advancePurpose: string | null;
  advanceProductId: string | null;
  advanceProductName: string | null;
  advanceLocationId: string | null;
  advanceLocationName: string | null;
  advanceRemarks: string | null;
  advanceSupportingDocumentPath: string | null;
};

export type MyClaimRecord = {
  id: string;
  employeeId: string;
  onBehalfEmail: string | null;
  departmentName: string | null;
  paymentModeName: string;
  submissionType: ClaimSubmissionType;
  status: DbClaimStatus;
  submittedAt: string;
  expenseTotalAmount: number | null;
  advanceRequestedAmount: number | null;
};

export type MyClaimDTO = {
  id: string;
  claimId: string;
  employee: string;
  department: string;
  paymentMode: string;
  submissionType: ClaimSubmissionType;
  totalAmount: number;
  status: ClaimStatus;
  submittedOn: string;
};

export type CursorPaginationInput = {
  cursor: string | null;
  limit: number;
};

export type CursorPaginatedResult<T> = {
  data: T[];
  nextCursor: string | null;
  hasNextPage: boolean;
  totalCount?: number;
};

export type MyClaimListRecord = {
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
  detailType: ClaimDetailType;
  submissionType: ClaimSubmissionType;
  submitterEmail: string | null;
  hodEmail: string | null;
  financeEmail: string | null;
};

export type ClaimAuditActionType =
  | "SUBMITTED"
  | "L1_APPROVED"
  | "L1_REJECTED"
  | "L2_APPROVED"
  | "L2_REJECTED"
  | "L2_MARK_PAID";

export type ClaimAuditLogRecord = {
  id: string;
  claimId: string;
  actorId: string;
  actorName: string | null;
  actorEmail: string | null;
  actionType: ClaimAuditActionType;
  assignedToId: string | null;
  assignedToName: string | null;
  assignedToEmail: string | null;
  remarks: string | null;
  createdAt: string;
};

export type PendingApprovalListRecord = {
  id: string;
  employeeId: string;
  submitter: string;
  departmentName: string | null;
  paymentModeName: string;
  detailType: ClaimDetailType;
  submissionType: ClaimSubmissionType;
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
};

export type ClaimListDetail = {
  detailType: ClaimDetailType;
  submissionType: ClaimSubmissionType;
  onBehalfEmail: string | null;
  submitter: string;
  categoryName: string;
  purpose: string | null;
  expenseReceiptFilePath: string | null;
  expenseBankStatementFilePath: string | null;
  advanceSupportingDocumentPath: string | null;
};

export type ApprovalViewerContext = {
  isHod: boolean;
  isFounder: boolean;
  isFinance: boolean;
};

export type ClaimRepository = {
  getActivePaymentModes(): Promise<{ data: ClaimPaymentMode[]; errorMessage: string | null }>;
  getActiveDepartments(): Promise<{ data: ClaimDropdownOption[]; errorMessage: string | null }>;
  getActiveExpenseCategories(): Promise<{
    data: ClaimDropdownOption[];
    errorMessage: string | null;
  }>;
  getActiveProducts(): Promise<{ data: ClaimDropdownOption[]; errorMessage: string | null }>;
  getActiveLocations(): Promise<{ data: ClaimDropdownOption[]; errorMessage: string | null }>;
  getUserSummary(userId: string): Promise<{
    data: { id: string; email: string; fullName: string | null } | null;
    errorMessage: string | null;
  }>;
  existsExpenseByCompositeKey(input: {
    billNo: string;
    transactionDate: string;
    basicAmount: number;
    totalAmount: number;
  }): Promise<{
    exists: boolean;
    errorMessage: string | null;
  }>;
  getPaymentModeById(
    paymentModeId: string,
  ): Promise<{ data: ClaimPaymentMode | null; errorMessage: string | null }>;
  getDepartmentApprovers(departmentId: string): Promise<{
    data: ClaimDepartmentApprovers | null;
    errorMessage: string | null;
  }>;
  getActiveUserIdByEmail(
    email: string,
  ): Promise<{ data: string | null; errorMessage: string | null }>;
  isUserApprover1InAnyDepartment(userId: string): Promise<{
    isApprover1: boolean;
    errorMessage: string | null;
  }>;
  createClaimWithDetail(
    payload: Record<string, unknown>,
  ): Promise<{ claimId: string | null; errorMessage: string | null }>;
  createClaimAuditLog(input: {
    claimId: string;
    actorId: string;
    actionType: ClaimAuditActionType;
    assignedToId: string | null;
    remarks: string | null;
  }): Promise<{ errorMessage: string | null }>;
  getClaimAuditLogs(claimId: string): Promise<{
    data: ClaimAuditLogRecord[];
    errorMessage: string | null;
  }>;
  getClaimForFinanceEdit(claimId: string): Promise<{
    data: ClaimFinanceEditSnapshot | null;
    errorMessage: string | null;
  }>;
  updateClaimDetailsByFinance(
    claimId: string,
    payload: FinanceClaimEditPayload,
  ): Promise<{ errorMessage: string | null }>;
  getMyClaims(
    userId: string,
    filters?: GetMyClaimsFilters,
  ): Promise<{ data: MyClaimRecord[]; errorMessage: string | null }>;
  getMyClaimsPaginated(
    userId: string,
    page: number,
    limit: number,
    filters?: GetMyClaimsFilters,
  ): Promise<{ data: MyClaimListRecord[]; totalCount: number; errorMessage: string | null }>;
  getApprovalViewerContext(userId: string): Promise<{
    data: ApprovalViewerContext;
    errorMessage: string | null;
  }>;
  getPendingApprovalsForL1(
    userId: string,
    cursor: string | null,
    limit: number,
    filters?: GetMyClaimsFilters,
  ): Promise<CursorPaginatedResult<PendingApprovalListRecord> & { errorMessage: string | null }>;
  getPendingApprovalsForFinance(
    userId: string,
    cursor: string | null,
    limit: number,
    filters?: GetMyClaimsFilters,
  ): Promise<CursorPaginatedResult<PendingApprovalListRecord> & { errorMessage: string | null }>;
  getClaimsForExport(input: {
    userId: string;
    fetchScope: ClaimsExportFetchScope;
    filters?: GetMyClaimsFilters;
    limit: number;
    offset: number;
  }): Promise<{ data: ClaimExportRecord[]; errorMessage: string | null }>;
  getClaimEvidenceSignedUrl(input: {
    filePath: string;
    expiresInSeconds: number;
  }): Promise<{ data: string | null; errorMessage: string | null }>;
  getClaimListDetails(
    claimIds: string[],
  ): Promise<{ data: Record<string, ClaimListDetail>; errorMessage: string | null }>;
};

export type ClaimDomainLogger = {
  info(event: string, payload?: Record<string, unknown>): void;
  warn(event: string, payload?: Record<string, unknown>): void;
  error(event: string, payload?: Record<string, unknown>): void;
};

// ----------------------------------------------------------------
// Department Viewer (POC) types
// ----------------------------------------------------------------

export type DepartmentViewerClaimRecord = {
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
  departmentId: string | null;
};

export type DepartmentViewerFilters = {
  status?: DbClaimStatus[];
  departmentId?: string;
  searchQuery?: string;
  searchField?: "claim_id" | "employee_name" | "employee_id" | "employee_email";
  submissionType?: "Self" | "On Behalf";
  paymentModeId?: string;
  locationId?: string;
  productId?: string;
  expenseCategoryId?: string;
  dateTarget?: "submitted" | "hod_action" | "finance_closed";
  dateFrom?: string;
  dateTo?: string;
};

export type DepartmentViewerPaginationInput = {
  cursor: string | null;
  limit: number;
};

export type DepartmentViewerPaginatedResult<T> = {
  data: T[];
  nextCursor: string | null;
  hasNextPage: boolean;
};

export type DepartmentViewerDepartment = {
  id: string;
  name: string;
};

export interface DepartmentViewerRepository {
  getViewerDepartments(
    userId: string,
  ): Promise<{ data: DepartmentViewerDepartment[]; errorMessage: string | null }>;

  getClaims(
    departmentIds: string[],
    filters: DepartmentViewerFilters,
    pagination: DepartmentViewerPaginationInput,
  ): Promise<{
    data: DepartmentViewerPaginatedResult<DepartmentViewerClaimRecord> | null;
    errorMessage: string | null;
  }>;
}
