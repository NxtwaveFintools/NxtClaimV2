export const BcAccountType = { Employee: "Employee", Vendor: "Vendor" } as const;
export type BcAccountType = (typeof BcAccountType)[keyof typeof BcAccountType];

export const BcEmployeeTransactionType = { Advance: "ADVANCE" } as const;
export type BcEmployeeTransactionType =
  (typeof BcEmployeeTransactionType)[keyof typeof BcEmployeeTransactionType];

export const BcBalAccountType = { GLAccount: "G/L Account" } as const;
export type BcBalAccountType = (typeof BcBalAccountType)[keyof typeof BcBalAccountType];

export interface BcClaimLineItem {
  postingDate: string; // ISO YYYY-MM-DD
  accountType: BcAccountType;
  accountNo: string;
  employeeTransactionType: BcEmployeeTransactionType | "";
  amount: number;
  description: string;
  balAccountType: BcBalAccountType;
  balAccountNo: string;
  claimNo: string;
  nwProgramCode: string;
  subProductCode: string;
  responsibleDepartment: string;
  beneficiaryDepartment: string;
  regionCode: string;
}

export interface BcClaimPayloadFromDb {
  claim_id: string;
  employee_id: string;
  bc_payments_flag: boolean;
  approved_amount: number;
  purpose: string;
  receipt_file_path: string | null;
  bank_statement_file_path: string | null;
  expense_category_id: string;
  bc_code: string | null;
  program_code: string;
  sub_product_code: string;
  responsible_department_code: string;
  beneficiary_department_code: string;
  region_code: string;
}

export interface PayloadBuilderInput {
  isVendorPayment: boolean;
  bcVendorId?: string | null;
  bcVendorName?: string | null;
}

export type BcPaymentError =
  | { code: "UNAUTHORIZED" }
  | { code: "ALREADY_SENT"; claimId: string }
  | { code: "NOT_EXPENSE_MODE"; paymentMode: string }
  | { code: "CLAIM_NOT_FOUND"; claimId: string }
  | { code: "EXPENSE_DETAILS_MISSING"; claimId: string }
  | { code: "MISSING_MAPPING"; field: string; detail?: string }
  | { code: "MISSING_VENDOR_SELECTION" }
  | { code: "MISSING_BC_CODE"; expenseCategoryId: string }
  | { code: "BC_API_ERROR"; status: number; body: unknown }
  | { code: "DB_UPDATE_FAILED"; claimId: string; auditLogId: string | null }
  | { code: "INVALID_INPUT"; issues: unknown };

export interface BcPaymentSuccess {
  ok: true;
  claimId: string;
  bcResponses: unknown[];
  auditLogId: string;
}

export interface BcPaymentDryRunResult {
  ok: true;
  dryRun: true;
  claimId: string;
  wouldSend: BcClaimLineItem[];
  wouldAuditLog: { status: "PENDING"; payload_json: BcClaimLineItem[] };
}
