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

export type ClaimExpenseAiOriginalValue = string | number | boolean | null;

export type ClaimExpenseAiMetadata = {
  edited_fields: Record<string, { original: ClaimExpenseAiOriginalValue }>;
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
    foreignCurrencyCode?: "INR" | "USD" | "EUR" | "CHF" | null;
    foreignBasicAmount?: number | null;
    foreignGstAmount?: number | null;
    foreignTotalAmount?: number | null;
    vendorName: string | null;
    receiptFilePath: string | null;
    bankStatementFilePath: string | null;
    peopleInvolved: string | null;
    remarks: string | null;
    aiMetadata?: ClaimExpenseAiMetadata | null;
  };
  advance?: {
    totalAmount: number;
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

// Invariant: expense_details.currency_code is always 'INR' (the local_currency_code
// enum only permits 'INR'). Non-INR settlements are encoded via foreign_currency_code
// + foreign_basic_amount + foreign_gst_amount. The INR-side amounts (basic_amount,
// cgst/sgst/igst_amount, total_amount) represent the INR settlement, which is 0 for
// a foreign-only invoice until reconciled from a bank statement.
export type PreparedClaimSubmission = {
  claim: {
    id: string;
    status: DbClaimStatus;
    submissionType: ClaimSubmissionType;
    detailType: ClaimDetailType;
    submittedBy: string;
    onBehalfOfId: string;
    employeeId: string;
    ccEmails: string | null;
    onBehalfEmail: string | null;
    onBehalfEmployeeCode: string | null;
    departmentId: string;
    paymentModeId: string;
    assignedL1ApproverId: string;
    assignedL2ApproverId: string | null;
  };
  expense?: {
    claimId: string;
    billNo: string;
    transactionId: string;
    purpose: string;
    expenseCategoryId: string;
    productId: string | null;
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
    totalAmount: number;
    currencyCode: string;
    foreignCurrencyCode?: "INR" | "USD" | "EUR" | "CHF" | null;
    foreignBasicAmount?: number | null;
    foreignGstAmount?: number | null;
    foreignTotalAmount?: number | null;
    vendorName: string | null;
    receiptFilePath: string | null;
    bankStatementFilePath: string | null;
    peopleInvolved: string | null;
    remarks: string | null;
    aiMetadata?: ClaimExpenseAiMetadata | null;
  };
  advance?: {
    claimId: string;
    totalAmount: number;
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
  detailId: string;
  editReason: string;
  paymentModeId: string;
  billNo?: string;
  expenseCategoryId?: string;
  productId?: string | null;
  locationId?: string;
  locationType?: string | null;
  locationDetails?: string | null;
  transactionDate?: string;
  purpose?: string;
  isGstApplicable?: boolean;
  gstNumber?: string | null;
  vendorName?: string | null;
  peopleInvolved?: string | null;
  remarks?: string | null;
  receiptFilePath?: string;
  bankStatementFilePath?: string;
  basicAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  foreignCurrencyCode?: "INR" | "USD" | "EUR" | "CHF" | null;
  foreignBasicAmount?: number | null;
  foreignGstAmount?: number | null;
  foreignTotalAmount?: number | null;
};

export type FinanceAdvanceEditPayload = {
  detailType: "advance";
  detailId: string;
  editReason: string;
  paymentModeId: string;
  purpose?: string;
  expectedUsageDate?: string;
  productId?: string | null;
  locationId?: string | null;
  remarks?: string | null;
  supportingDocumentPath?: string;
  totalAmount: number;
};

export type FinanceClaimEditPayload = FinanceExpenseEditPayload | FinanceAdvanceEditPayload;

export type OwnExpenseEditPayload = {
  detailType: "expense";
  detailId: string;
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
  foreignCurrencyCode?: "INR" | "USD" | "EUR" | "CHF" | null;
  foreignBasicAmount?: number | null;
  foreignGstAmount?: number | null;
  foreignTotalAmount?: number | null;
  purpose: string;
  productId: string | null;
  peopleInvolved: string | null;
  remarks: string | null;
  receiptFilePath: string | null;
  bankStatementFilePath: string | null;
};

export type OwnAdvanceEditPayload = {
  detailType: "advance";
  detailId: string;
  purpose: string;
  totalAmount: number;
  expectedUsageDate: string;
  productId: string | null;
  locationId: string | null;
  remarks: string | null;
  supportingDocumentPath: string | null;
};

export type OwnClaimEditPayload = OwnExpenseEditPayload | OwnAdvanceEditPayload;

export type ClaimFinanceEditSnapshot = {
  id: string;
  detailType: ClaimDetailType;
  status: DbClaimStatus;
  submittedBy: string;
  assignedL1ApproverId: string;
  paymentModeId: string;
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
  | "finance_hod_pending_observability"
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
  bcClaimDetailsId: string | null;
  isVendorPayment: boolean;
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
  bcClaimDetailsId: string | null;
  isVendorPayment: boolean;
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
  totalAmount: number | null;
  expenseCurrencyCode: string | null;
  expenseVendorName: string | null;
  expensePeopleInvolved: string | null;
  expenseRemarks: string | null;
  expenseReceiptFilePath: string | null;
  expenseBankStatementFilePath: string | null;
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
  bcClaimDetailsId: string | null;
  isVendorPayment: boolean;
  submissionType: ClaimSubmissionType;
  status: DbClaimStatus;
  submittedAt: string;
  expenseTotalAmount: number | null;
  advanceRequestedTotalAmount: number | null;
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
  bcClaimDetailsId: string | null;
  isVendorPayment: boolean;
  detailType: ClaimDetailType;
  submissionType: ClaimSubmissionType;
  onBehalfEmail?: string | null;
  onBehalfEmployeeCode?: string | null;
  submitterEmail: string | null;
  hodEmail: string | null;
  financeEmail: string | null;
};

export type ClaimAuditActionType =
  | "SUBMITTED"
  | "UPDATED"
  | "L1_APPROVED"
  | "L1_REJECTED"
  | "L2_APPROVED"
  | "L2_REJECTED"
  | "L2_MARK_PAID"
  | "FINANCE_EDITED"
  | "ADMIN_SOFT_DELETED"
  | "ADMIN_PAYMENT_MODE_OVERRIDDEN";

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
  submitterEmail?: string | null;
  departmentName: string | null;
  paymentModeName: string;
  detailType: ClaimDetailType;
  submissionType: ClaimSubmissionType;
  bcClaimDetailsId: string | null;
  isVendorPayment: boolean;
  onBehalfEmail: string | null;
  onBehalfEmployeeCode?: string | null;
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
  bcClaimDetailsId: string | null;
  isVendorPayment: boolean;
  onBehalfEmail: string | null;
  submitter: string;
  categoryName: string;
  purpose: string | null;
  expenseReceiptFilePath: string | null;
  expenseBankStatementFilePath: string | null;
  advanceSupportingDocumentPath: string | null;
};

export type ApprovalViewerContext = {
  isApprover1: boolean;
  isApprover2: boolean;
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
    totalAmount: number;
    foreignCurrencyCode?: string | null;
    foreignBasicAmount?: number | null;
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
  createClaimDraft(
    prepared: PreparedClaimSubmission,
  ): Promise<{ claimId: string | null; errorMessage: string | null }>;
  createExpenseDetailDraft(
    prepared: PreparedClaimSubmission,
  ): Promise<{ detailId: string | null; errorMessage: string | null }>;
  createAdvanceDetailDraft(
    prepared: PreparedClaimSubmission,
  ): Promise<{ detailId: string | null; errorMessage: string | null }>;
  updateExpenseDetailEvidencePaths(input: {
    claimId: string;
    receiptFilePath: string | null;
    bankStatementFilePath: string | null;
  }): Promise<{ errorMessage: string | null }>;
  updateAdvanceDetailEvidencePath(input: {
    claimId: string;
    supportingDocumentPath: string | null;
  }): Promise<{ errorMessage: string | null }>;
  rollbackClaimSubmissionDraft(input: {
    claimId: string;
    actorUserId: string;
  }): Promise<{ errorMessage: string | null }>;
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
  getClaimForSubmitterDelete(claimId: string): Promise<{
    data: {
      id: string;
      status: DbClaimStatus;
      submittedBy: string;
    } | null;
    errorMessage: string | null;
  }>;
  softDeleteClaimBySubmitter(
    claimId: string,
    actorUserId: string,
  ): Promise<{ success: boolean; errorMessage: string | null }>;
  updateClaimDetailsByFinance(
    claimId: string,
    actorUserId: string,
    payload: FinanceClaimEditPayload,
  ): Promise<{ errorMessage: string | null }>;
  updateClaimDetailsBySubmitter(
    claimId: string,
    actorUserId: string,
    payload: OwnClaimEditPayload,
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
  ): Promise<{
    data: MyClaimListRecord[];
    totalCount: number;
    nextCursor: string | null;
    hasNextPage: boolean;
    errorMessage: string | null;
  }>;
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
  bcClaimDetailsId: string | null;
  isVendorPayment: boolean;
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
