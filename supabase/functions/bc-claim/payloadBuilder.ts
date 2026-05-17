import {
  BcDocumentType,
  BcEmployeeTransactionType,
  BcGstCredit,
  BcGstSubcategory,
  BcLocationCode,
  BcQuantity,
  BcType,
} from "./types.ts";
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
 *
 * TODO: BC developer has agreed to extend `remarks` past 50 chars. Once the
 * new BC schema is live, re-add the bill / bank-statement URL lines:
 *     lines.push(`bill - ${receipt_file_path}`);
 *     lines.push(`bank statement - ${bank_statement_file_path}`);
 * and bump BC_REMARKS_MAX (or drop the cap entirely if BC moves to TEXT).
 */
const BC_REMARKS_MAX = 50;

/**
 * BC's "No." columns (the standard Code-style fields like claimNo, employeeId)
 * are a fixed 20 characters wide by default. Our claim IDs (29 chars) and some
 * test/audit employee IDs (e.g. "EMP-AUDIT-1778736715128", 23 chars) exceed
 * this. For testing we truncate to the first 20 chars; the untruncated values
 * remain in our own DB (`claims.id`, `users.employee_id`) for audit and
 * lookup.
 *
 * TODO: BC developer is widening the No. columns. Once widened, drop the
 * truncation and send the full values.
 */
const BC_NO_MAX = 20;
function truncBcNo(s: string): string {
  return s.slice(0, BC_NO_MAX);
}

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

  const rawEmployeeId =
    db.submission_type === "On_behalf" && db.on_behalf_employee_code
      ? db.on_behalf_employee_code
      : db.employee_id;
  const employeeId = truncBcNo(rawEmployeeId);

  const base: BcClaimLineItem = {
    documentType: BcDocumentType.Invoice,
    locationCode: BcLocationCode,
    type: BcType.GLAccount,
    quantity: BcQuantity,
    gstCredit: BcGstCredit.NonAvailment,
    gstSubcategory: BcGstSubcategory.Ineligible4344,
    employeeTransactionType: BcEmployeeTransactionType.Advance,
    documentDate: db.transaction_date,
    glCode: db.bc_code,
    employeeId,
    employeeName: db.employee_name,
    claimNo: truncBcNo(db.claim_id),
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
