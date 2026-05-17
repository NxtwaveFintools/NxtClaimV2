import type { BcClaimLineItem, BcClaimPayloadFromDb, PayloadBuilderInput } from "./types.ts";
import { BcAccountType, BcBalAccountType, BcEmployeeTransactionType } from "./types.ts";

export function buildBcLineItems(
  db: BcClaimPayloadFromDb,
  input: PayloadBuilderInput,
): BcClaimLineItem[] {
  if (input.isVendorPayment && (!input.bcVendorId || !input.bcVendorName)) {
    throw new Error("MISSING_VENDOR_SELECTION");
  }
  if (!input.isVendorPayment && (db.bc_code === null || db.bc_code === "")) {
    throw new Error(`MISSING_BC_CODE: expense_category_id=${db.expense_category_id}`);
  }

  const postingDate = todayIso();
  const description = buildDescription(db);

  const common = {
    postingDate,
    description,
    balAccountType: BcBalAccountType.GLAccount,
    claimNo: db.claim_id,
    nwProgramCode: db.program_code,
    subProductCode: db.sub_product_code,
    responsibleDepartment: db.responsible_department_code,
    beneficiaryDepartment: db.beneficiary_department_code,
    regionCode: db.region_code,
  } as const;

  const employeeLine: BcClaimLineItem = {
    ...common,
    accountType: BcAccountType.Employee,
    accountNo: db.employee_id,
    employeeTransactionType: BcEmployeeTransactionType.Advance,
    amount: -db.approved_amount,
    balAccountNo: input.isVendorPayment ? "" : (db.bc_code as string),
  };

  if (!input.isVendorPayment) return [employeeLine];

  const vendorLine: BcClaimLineItem = {
    ...common,
    accountType: BcAccountType.Vendor,
    accountNo: input.bcVendorId as string,
    employeeTransactionType: "",
    amount: db.approved_amount,
    balAccountNo: "",
  };

  return [employeeLine, vendorLine];
}

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildDescription(db: BcClaimPayloadFromDb): string {
  const lines: string[] = [`${db.claim_id} - ${db.purpose}`];
  if (db.receipt_file_path && db.receipt_file_path.trim().length > 0) {
    lines.push(`bill - ${db.receipt_file_path}`);
  }
  if (db.bank_statement_file_path && db.bank_statement_file_path.trim().length > 0) {
    lines.push(`bank statement - ${db.bank_statement_file_path}`);
  }
  return lines.join("\n");
}
