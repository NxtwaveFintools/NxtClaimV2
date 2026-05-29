// Fixed-value constants for the BC payload — exported so the payload builder
// and tests can assert against them without hardcoding strings.
export const BcDocumentType = { Invoice: "Invoice" } as const;
export type BcDocumentType = (typeof BcDocumentType)[keyof typeof BcDocumentType];

export const BcType = { GLAccount: "G/L Account" } as const;
export type BcType = (typeof BcType)[keyof typeof BcType];

export const BcGstCredit = { NonAvailment: "Non-Availment" } as const;
export type BcGstCredit = (typeof BcGstCredit)[keyof typeof BcGstCredit];

export const BcGstSubcategory = {
  Blank: "_x0020_",
  Ineligible4344: "Ineligible_x0020__x002D__x0020_43_x002F_44",
  Ineligible175: "Ineligible_x0020__x002D__x0020_17_x0028_5_x0029_",
  IneligiblePos: "Ineligible_x0020__x002D__x0020_POS",
  NA: "N_x002F_A",
} as const;
export type BcGstSubcategory = (typeof BcGstSubcategory)[keyof typeof BcGstSubcategory];

export const BcEmployeeTransactionType = { Advance: "Advance" } as const;
export type BcEmployeeTransactionType =
  (typeof BcEmployeeTransactionType)[keyof typeof BcEmployeeTransactionType];

export const BcQuantity = 1 as const;
export const BcLocationCode = "HBT" as const;

/**
 * Flat payload posted to BC's Custom Claims API (one object per claim).
 * Vendor-only fields are spread-omitted (not null) for non-vendor claims —
 * see payloadBuilder.ts.
 */
export interface BcClaimLineItem {
  // Fixed values — always hardcoded.
  documentType: "Invoice";
  locationCode: "HBT";
  type: "G/L Account";
  quantity: 1;
  gstCredit: "Non-Availment";
  gstSubcategory: BcGstSubcategory;
  employeeTransactionType: "Advance";
  // Per-claim.
  documentDate: string;
  glCode: string;
  employeeId: string;
  employeeName: string;
  claimNo: string;
  remarks: string;
  programCode: string;
  subproductCode: string;
  responsibleDepartment: string;
  beneficiaryDepartment: string;
  regionCode: string;
  invoiceRequired: boolean;
  paymentRequired: boolean;
  // BC's exact JSON property names (typos and casing match BC's spec):
  //   ammountLCY = local-currency amount. Vendor → basic_amount; non-vendor → total_amount.
  //   Ammount    = foreign-currency amount. Vendor → foreign_basic_amount (falls back to
  //                basic_amount when foreign_basic_amount is 0); non-vendor → foreign_total_amount,
  //                falling back to total_amount when foreign is 0.
  ammountLCY: number;
  Ammount: number;
  // Vendor-only — OMIT ENTIRELY (do not send null/empty) for non-vendor claims.
  currencyCode?: string;
  vendorInvoiceNo?: string;
  // `vendorCode` is the authoritative identifier — BC resolves the vendor by
  // this No on the server. `vendorName` is display-only (BC echoes its own
  // canonical name in the API response), kept here so logs/audit show what
  // the user picked in the UI.
  vendorCode?: string;
  vendorName?: string;
  gstGroupCode?: string;
  hsnSacCode?: string;
}

/**
 * Return shape of public.get_bc_claim_payload(p_claim_id).
 * See spec §3.3 and migration 20260517090100_bc_claim_functions.sql.
 */
export interface BcClaimPayloadFromDb {
  claim_id: string;
  payment_mode_name: string;
  submission_type: "Self" | "On Behalf";
  employee_id: string;
  on_behalf_employee_code: string | null;
  employee_name: string;
  program_code: string;
  sub_product_code: string;
  responsible_department_code: string;
  beneficiary_department_code: string;
  region_code: string;
  bill_no: string | null;
  transaction_date: string;
  purpose: string;
  receipt_file_path: string | null;
  bank_statement_file_path: string | null;
  bc_code: string;
  basic_amount: number;
  total_amount: number;
  foreign_basic_amount: number;
  foreign_total_amount: number;
}

/** Structured errors returned to the modal. */
export type BcClaimError =
  | { code: "UNAUTHENTICATED" }
  | { code: "FORBIDDEN" }
  | { code: "INVALID_BODY"; details: string[] }
  | { code: "CLAIM_NOT_FOUND"; claimId: string }
  | { code: "ALREADY_SUBMITTED"; bcClaimDetailsId: string | null }
  | { code: "ALREADY_IN_FLIGHT" }
  | { code: "MISSING_MAPPING"; detail?: string }
  | { code: "INVALID_CLAIM_STATE"; detail?: string }
  | { code: "INTERNAL_ERROR"; detail?: string }
  | { code: "BC_FETCH_FAILED"; status: number; body: unknown }
  | { code: "RPC_FAILED_AFTER_BC_SUCCESS"; bcClaimDetailsId: string; detail: string };
