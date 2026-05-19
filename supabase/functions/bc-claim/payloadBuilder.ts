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

export function buildRemarks(db: BcClaimPayloadFromDb): string {
  if (!db.purpose) return `${db.claim_id} - `;
  return `${db.claim_id} - ${db.purpose}`;
}

/**
 * Builds the single flat BcClaimLineItem object posted to BC.
 * Vendor-only fields are spread-omitted (NOT null/empty) when isVendorPayment is false.
 *
 * Amount fields:
 *   vendor     → amountLc = basic_amount,  amount = foreign_basic_amount
 *   non-vendor → amountLc = total_amount,  amount = foreign_total_amount
 *                (falls back to total_amount when foreign_total_amount is 0,
 *                 since most non-vendor claims have no foreign amount entered)
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

  const amountLc = isVendorPayment ? db.basic_amount : db.total_amount;
  const amount = isVendorPayment
    ? db.foreign_basic_amount
    : db.foreign_total_amount > 0
      ? db.foreign_total_amount
      : db.total_amount;

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
    claimNo: db.claim_id,
    remarks: buildRemarks(db),
    programCode: db.program_code,
    subproductCode: db.sub_product_code,
    responsibleDepartment: db.responsible_department_code,
    beneficiaryDepartment: db.beneficiary_department_code,
    regionCode: db.region_code,
    invoiceRequired: isVendorPayment,
    paymentRequired: db.payment_mode_name === "Reimbursement",
    amountLc,
    amount,
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
