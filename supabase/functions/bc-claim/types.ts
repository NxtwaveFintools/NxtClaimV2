// Fixed-value constants for the BC payload — exported so the payload builder
// and tests can assert against them without hardcoding strings.
export const BcDocumentType = { Invoice: "Invoice" } as const;
export type BcDocumentType = (typeof BcDocumentType)[keyof typeof BcDocumentType];

export const BcType = { GLAccount: "G/L Account" } as const;
export type BcType = (typeof BcType)[keyof typeof BcType];

export const BcGstCredit = { NonAvailment: "Non-Availment" } as const;
export type BcGstCredit = (typeof BcGstCredit)[keyof typeof BcGstCredit];

export const BcGstSubcategory = { Ineligible4344: "Ineligible-43/44" } as const;
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
  gstSubcategory: "Ineligible-43/44";
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
  //   Ammount    = foreign-currency amount. Vendor → foreign_basic_amount;
  //                non-vendor → foreign_total_amount, falling back to total_amount when foreign is 0.
  ammountLCY: number;
  Ammount: number;
  // Vendor-only — OMIT ENTIRELY (do not send null/empty) for non-vendor claims.
  currencyCode?: string;
  vendorInvoiceNo?: string;
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
  | { code: "BC_FETCH_FAILED"; status: number; body: unknown }
  | { code: "RPC_FAILED_AFTER_BC_SUCCESS"; bcClaimDetailsId: string; detail: string };
