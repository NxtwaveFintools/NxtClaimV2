import type { BcClaimLineItem, BcClaimPayloadFromDb } from "./types.ts";

/**
 * Inputs to the payload builder.
 *   - db: result of public.get_bc_claim_payload(p_claim_id).
 *   - isVendorPayment: Finance toggle from the modal.
 *   - vendor: present iff isVendorPayment is true. Code/name come from
 *     bc-vendor-search; currencyCode / gstGroupCode / hsnSacCode from
 *     the three bc-reference dropdowns.
 */
export interface BuildInputs {
  db: BcClaimPayloadFromDb;
  isVendorPayment: boolean;
  vendor?: {
    code: string;
    name: string;
    currencyCode: string;
    gstGroupCode: string;
    hsnSacCode: string;
  };
}

/**
 * BC's `remarks` column is capped at 50 characters. We send `{claim_id} - {purpose}`
 * truncated to fit. The original spec also crammed receipt + bank-statement URLs
 * here, but BC rejects anything longer than 50 chars with
 * Application_StringExceededLength — and the URLs are recoverable from
 * `expense_details.receipt_file_path` / `bank_statement_file_path` for audit.
 *
 * Priority order inside the 50-char budget:
 *   1. The full claim id (BC's reconciliation key — never truncated unless the
 *      claim id itself is > 50 chars, which would be a separate data bug).
 *   2. A " - " separator.
 *   3. As much of `purpose` as fits.
 */
const BC_REMARKS_MAX = 50;

export function buildRemarks(db: BcClaimPayloadFromDb): string {
  if (db.claim_id.length >= BC_REMARKS_MAX) {
    return db.claim_id.slice(0, BC_REMARKS_MAX);
  }
  const prefix = `${db.claim_id} - `;
  const room = BC_REMARKS_MAX - prefix.length;
  if (!db.purpose || room <= 0) return prefix.slice(0, BC_REMARKS_MAX);
  return (prefix + db.purpose).slice(0, BC_REMARKS_MAX);
}

/**
 * Builds the single flat BcClaimLineItem object posted to BC.
 * Vendor-only fields are spread-omitted (NOT null/empty) when isVendorPayment is false.
 *
 * employeeId / employeeName resolution:
 *   - On_behalf → on_behalf_employee_code + on_behalf_of_id's full_name
 *   - Self      → employee_id + submitted_by's full_name
 *   Both resolved server-side by get_bc_claim_payload; we just trust db.
 */
export function buildBcClaimLineItem(inputs: BuildInputs): BcClaimLineItem {
  const { db, isVendorPayment, vendor } = inputs;

  const employeeId =
    db.submission_type === "On_behalf" && db.on_behalf_employee_code
      ? db.on_behalf_employee_code
      : db.employee_id;

  const base: BcClaimLineItem = {
    documentType: "Invoice",
    locationCode: "HBT",
    type: "G/L Account",
    quantity: 1,
    gstCredit: "Non-Availment",
    gstSubcategory: "Ineligible-43/44",
    employeeTransactionType: "Advance",
    documentDate: db.transaction_date,
    glCode: db.bc_code,
    employeeId,
    employeeName: db.employee_name,
    claimNo: db.claim_id,
    remarks: buildRemarks(db),
    programCode: db.program_code,
    subproductCode: db.sub_product_code,
    responsibleDepartment: db.responsible_department_code,
    beneficiaryDepartment: db.beneficiary_department_code,
    regionCode: db.region_code,
    invoiceRequired: isVendorPayment,
    paymentRequired: db.payment_mode_name === "Reimbursement",
  };

  if (!isVendorPayment) {
    return base;
  }

  if (!vendor) {
    throw new Error("vendor inputs required when isVendorPayment is true");
  }

  return {
    ...base,
    currencyCode: vendor.currencyCode,
    vendorInvoiceNo: db.bill_no ?? "",
    vendorCode: vendor.code,
    vendorName: vendor.name,
    gstGroupCode: vendor.gstGroupCode,
    hsnSacCode: vendor.hsnSacCode,
  };
}
