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
 * Builds the `remarks` string per spec §3.2:
 *   "{claimId} - {purpose}"
 *   "bill - {url}"            (only if receipt_file_path non-empty)
 *   "bank statement - {url}"  (only if bank_statement_file_path non-empty)
 */
export function buildRemarks(db: BcClaimPayloadFromDb): string {
  const lines = [`${db.claim_id} - ${db.purpose}`];
  if (db.receipt_file_path && db.receipt_file_path.length > 0) {
    lines.push(`bill - ${db.receipt_file_path}`);
  }
  if (db.bank_statement_file_path && db.bank_statement_file_path.length > 0) {
    lines.push(`bank statement - ${db.bank_statement_file_path}`);
  }
  return lines.join("\n");
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
