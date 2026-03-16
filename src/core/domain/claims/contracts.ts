import type { ClaimStatus, DbClaimStatus } from "@/core/constants/statuses";

export type ClaimDetailType = "expense" | "advance";

export type ClaimSubmissionType = "Self" | "On Behalf";

export type MyClaimsDateType = "claim_date";

export type ClaimSearchField = "claim_id" | "employee_name" | "employee_id";

export type ClaimDateTarget = "submitted" | "finance_closed";

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
    isGstApplicable: boolean;
    gstNumber: string | null;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    transactionDate: string;
    basicAmount: number;
    totalAmount: number;
    currencyCode: string;
    vendorName: string | null;
    receiptFileHash: string;
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
    supportingDocumentHash: string | null;
    productId: string | null;
    locationId: string | null;
    remarks: string | null;
  };
};

export type FinanceExpenseEditPayload = {
  detailType: "expense";
  billNo: string;
  vendorName: string | null;
  basicAmount: number;
  totalAmount: number;
  purpose: string;
  productId: string | null;
  remarks: string | null;
  receiptFilePath: string | null;
  receiptFileHash: string | null;
};

export type FinanceAdvanceEditPayload = {
  detailType: "advance";
  purpose: string;
  productId: string | null;
  remarks: string | null;
  supportingDocumentPath: string | null;
  supportingDocumentHash: string | null;
};

export type FinanceClaimEditPayload = FinanceExpenseEditPayload | FinanceAdvanceEditPayload;

export type ClaimFinanceEditSnapshot = {
  id: string;
  detailType: ClaimDetailType;
  submittedBy: string;
  expenseReceiptFilePath: string | null;
  expenseReceiptFileHash: string | null;
  advanceSupportingDocumentPath: string | null;
  advanceSupportingDocumentHash: string | null;
};

export type GetMyClaimsFilters = {
  paymentModeId?: string;
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
};

export type ClaimsExportFetchScope = "submissions" | "l1_approvals" | "finance_approvals";

export type ClaimExportRecord = {
  claimId: string;
  employeeName: string;
  employeeId: string;
  departmentName: string | null;
  paymentModeName: string;
  submittedAt: string;
  amount: number;
  status: DbClaimStatus;
  billNo: string | null;
  purpose: string | null;
  remarks: string | null;
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
};

export type MyClaimListRecord = {
  id: string;
  employeeId: string;
  submitter: string;
  departmentName: string | null;
  paymentModeName: string;
  totalAmount: number;
  status: DbClaimStatus;
  submittedAt: string;
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
  existsExpenseByReceiptFileHash(receiptFileHash: string): Promise<{
    exists: boolean;
    errorMessage: string | null;
  }>;
  existsExpenseByCompositeKey(input: {
    billNo: string;
    transactionDate: string;
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
    cursor: string | null,
    limit: number,
    filters?: GetMyClaimsFilters,
  ): Promise<CursorPaginatedResult<MyClaimListRecord> & { errorMessage: string | null }>;
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
};

export type ClaimDomainLogger = {
  info(event: string, payload?: Record<string, unknown>): void;
  warn(event: string, payload?: Record<string, unknown>): void;
  error(event: string, payload?: Record<string, unknown>): void;
};
