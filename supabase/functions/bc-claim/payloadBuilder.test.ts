import { assertEquals, assert, assertThrows } from "std/assert/mod.ts";
import { buildBcClaimLineItem, buildRemarks, type BuildInputs } from "./payloadBuilder.ts";
import type { BcClaimPayloadFromDb } from "./types.ts";

const baseDb: BcClaimPayloadFromDb = {
  claim_id: "CLM-000145",
  payment_mode_name: "Reimbursement",
  submission_type: "Self",
  employee_id: "NW0001234",
  on_behalf_employee_code: null,
  employee_name: "Arjun Chander",
  program_code: "COMMON",
  sub_product_code: "COMMON",
  responsible_department_code: "GENAI",
  beneficiary_department_code: "GENAI",
  region_code: "TELUGU",
  bill_no: "INV-2026-001",
  transaction_date: "2026-05-10",
  purpose: "Software subscription",
  receipt_file_path: "https://xyz.supabase.co/storage/v1/object/public/receipts/inv.pdf",
  bank_statement_file_path: null,
  bc_code: "503063",
  basic_amount: 1000,
  total_amount: 1180,
  foreign_basic_amount: 12,
  foreign_total_amount: 14,
};

const vendorInputs: BuildInputs = {
  db: baseDb,
  isVendorPayment: true,
  vendor: {
    code: "V0001",
    name: "Twilio Inc",
    currencyCode: "INR",
    gstGroupCode: "GST18",
    hsnSacCode: "998314",
  },
};

const nonVendorInputs: BuildInputs = {
  db: baseDb,
  isVendorPayment: false,
};

Deno.test("vendor payload has all 28 fields with vendor-only keys present", () => {
  const line = buildBcClaimLineItem(vendorInputs);
  assertEquals(line.documentType, "Invoice");
  assertEquals(line.locationCode, "HBT");
  assertEquals(line.type, "G/L Account");
  assertEquals(line.quantity, 1);
  assertEquals(line.gstCredit, "Non-Availment");
  assertEquals(line.gstSubcategory, "Ineligible-43/44");
  assertEquals(line.employeeTransactionType, "Advance");
  assertEquals(line.documentDate, "2026-05-10");
  assertEquals(line.glCode, "503063");
  assertEquals(line.employeeId, "NW0001234");
  assertEquals(line.employeeName, "Arjun Chander");
  assertEquals(line.claimNo, "CLM-000145");
  assertEquals(line.programCode, "COMMON");
  assertEquals(line.subproductCode, "COMMON");
  assertEquals(line.responsibleDepartment, "GENAI");
  assertEquals(line.beneficiaryDepartment, "GENAI");
  assertEquals(line.regionCode, "TELUGU");
  assertEquals(line.invoiceRequired, true);
  assertEquals(line.paymentRequired, true);
  assertEquals(line.ammountLCY, 1000);
  assertEquals(line.Ammount, 12);
  assertEquals(line.currencyCode, "INR");
  assertEquals(line.vendorInvoiceNo, "INV-2026-001");
  assertEquals(line.vendorCode, "V0001");
  assertEquals(line.vendorName, "Twilio Inc");
  assertEquals(line.gstGroupCode, "GST18");
  assertEquals(line.hsnSacCode, "998314");
  assertEquals(Object.keys(line).length, 28);
});

Deno.test("non-vendor payload omits vendor-only keys but always sends currencyCode=INR", () => {
  const line = buildBcClaimLineItem(nonVendorInputs);
  for (const key of [
    "vendorInvoiceNo",
    "vendorCode",
    "vendorName",
    "gstGroupCode",
    "hsnSacCode",
  ] as const) {
    assert(!(key in line), `${key} should be absent for non-vendor payload`);
  }
  assertEquals(line.currencyCode, "INR");
  assertEquals(line.invoiceRequired, false);
  assertEquals(line.paymentRequired, true);
  assertEquals(Object.keys(line).length, 23);
});

Deno.test("vendor payload uses vendor's currencyCode (overrides INR default)", () => {
  const line = buildBcClaimLineItem({
    db: baseDb,
    isVendorPayment: true,
    vendor: { ...vendorInputs.vendor!, currencyCode: "USD" },
  });
  assertEquals(line.currencyCode, "USD");
});

Deno.test("On Behalf submission uses on_behalf_employee_code for employeeId", () => {
  const line = buildBcClaimLineItem({
    db: {
      ...baseDb,
      submission_type: "On Behalf",
      employee_id: "NW0001234",
      on_behalf_employee_code: "NW0009999",
      employee_name: "Ravi Kumar",
    },
    isVendorPayment: false,
  });
  assertEquals(line.employeeId, "NW0009999");
  assertEquals(line.employeeName, "Ravi Kumar");
});

Deno.test("Self submission uses employee_id even if on_behalf_employee_code is set", () => {
  const line = buildBcClaimLineItem({
    db: {
      ...baseDb,
      submission_type: "Self",
      employee_id: "NW0001234",
      on_behalf_employee_code: "NW9999999",
    },
    isVendorPayment: false,
  });
  assertEquals(line.employeeId, "NW0001234");
});

Deno.test("paymentRequired is false when payment_mode_name is not Reimbursement", () => {
  const line = buildBcClaimLineItem({
    db: { ...baseDb, payment_mode_name: "Vendor Direct" },
    isVendorPayment: true,
    vendor: vendorInputs.vendor,
  });
  assertEquals(line.paymentRequired, false);
});

Deno.test("vendor payload throws when vendor inputs are missing", () => {
  assertThrows(
    () => buildBcClaimLineItem({ db: baseDb, isVendorPayment: true }),
    Error,
    "vendor inputs required",
  );
});

Deno.test("claimNo passes through in full (any length — BC rejects loudly if too long)", () => {
  const line = buildBcClaimLineItem({
    db: {
      ...baseDb,
      claim_id: "CLAIM-EMPSUBMIT17791073235641779107326937-20260518-1D00",
    },
    isVendorPayment: false,
  });
  assertEquals(line.claimNo, "CLAIM-EMPSUBMIT17791073235641779107326937-20260518-1D00");
  assertEquals(line.claimNo.length, 55);
});

Deno.test("employeeId passes through in full (any length — BC rejects loudly if too long)", () => {
  const line = buildBcClaimLineItem({
    db: { ...baseDb, employee_id: "EMP-SUBMIT-1779107323564-1779107326937" },
    isVendorPayment: false,
  });
  assertEquals(line.employeeId, "EMP-SUBMIT-1779107323564-1779107326937");
  assertEquals(line.employeeId.length, 38);
});

Deno.test("vendorInvoiceNo defaults to empty string when bill_no is null", () => {
  const line = buildBcClaimLineItem({
    db: { ...baseDb, bill_no: null },
    isVendorPayment: true,
    vendor: vendorInputs.vendor,
  });
  assertEquals(line.vendorInvoiceNo, "");
});

Deno.test("vendor amounts: ammountLCY=basic_amount, Ammount=foreign_basic_amount", () => {
  const line = buildBcClaimLineItem({
    db: {
      ...baseDb,
      basic_amount: 5000,
      total_amount: 5900,
      foreign_basic_amount: 60,
      foreign_total_amount: 71,
    },
    isVendorPayment: true,
    vendor: vendorInputs.vendor,
  });
  assertEquals(line.ammountLCY, 5000);
  assertEquals(line.Ammount, 60);
});

Deno.test("non-vendor amounts: ammountLCY=total_amount, Ammount=foreign_total_amount", () => {
  const line = buildBcClaimLineItem({
    db: {
      ...baseDb,
      basic_amount: 5000,
      total_amount: 5900,
      foreign_basic_amount: 60,
      foreign_total_amount: 71,
    },
    isVendorPayment: false,
  });
  assertEquals(line.ammountLCY, 5900);
  assertEquals(line.Ammount, 71);
});

Deno.test("non-vendor Ammount falls back to total_amount when foreign_total_amount is 0", () => {
  const line = buildBcClaimLineItem({
    db: {
      ...baseDb,
      basic_amount: 5000,
      total_amount: 5900,
      foreign_basic_amount: 0,
      foreign_total_amount: 0,
    },
    isVendorPayment: false,
  });
  assertEquals(line.ammountLCY, 5900);
  assertEquals(line.Ammount, 5900);
});

Deno.test("buildRemarks — short claim_id + short purpose, no URLs", () => {
  const r = buildRemarks({ ...baseDb, claim_id: "CLM-100", purpose: "Software" }, {});
  assertEquals(r, "CLM-100 - Software");
});

Deno.test("buildRemarks — appends bill URL when provided", () => {
  const r = buildRemarks(
    { ...baseDb, claim_id: "CLM-100", purpose: "Software" },
    { billUrl: "https://x.co/r.pdf?t=abc" },
  );
  assertEquals(r, "CLM-100 - Software\nbill - https://x.co/r.pdf?t=abc");
});

Deno.test("buildRemarks — appends bank statement URL when provided", () => {
  const r = buildRemarks(
    { ...baseDb, claim_id: "CLM-100", purpose: "Software" },
    { bankStatementUrl: "https://x.co/b.jpg?t=xyz" },
  );
  assertEquals(r, "CLM-100 - Software\nbank statement - https://x.co/b.jpg?t=xyz");
});

Deno.test("buildRemarks — appends both URLs in fixed order (bill then bank statement)", () => {
  const r = buildRemarks(
    { ...baseDb, claim_id: "CLM-100", purpose: "Software" },
    {
      billUrl: "https://x.co/r.pdf?t=abc",
      bankStatementUrl: "https://x.co/b.jpg?t=xyz",
    },
  );
  assertEquals(
    r,
    "CLM-100 - Software\nbill - https://x.co/r.pdf?t=abc\nbank statement - https://x.co/b.jpg?t=xyz",
  );
});

Deno.test(
  "buildRemarks — long claim_id + long purpose pass through in full (BC widened remarks)",
  () => {
    const r = buildRemarks(
      {
        ...baseDb,
        claim_id: "CLAIM-NW3341311-20260516-B324",
        purpose: "Lorem ipsum dolor sit amet consectetur adipiscing elit",
      },
      {},
    );
    assertEquals(
      r,
      "CLAIM-NW3341311-20260516-B324 - Lorem ipsum dolor sit amet consectetur adipiscing elit",
    );
  },
);

Deno.test("buildRemarks — empty purpose falls back to '{claim_id} - '", () => {
  const r = buildRemarks({ ...baseDb, claim_id: "CLM-100", purpose: "" }, {});
  assertEquals(r, "CLM-100 - ");
});

Deno.test("buildBcClaimLineItem — remarks include bill + bank statement URLs when supplied", () => {
  const line = buildBcClaimLineItem({
    db: baseDb,
    isVendorPayment: false,
    fileUrls: {
      billUrl: "https://x.co/r.pdf?t=abc",
      bankStatementUrl: "https://x.co/b.jpg?t=xyz",
    },
  });
  assertEquals(
    line.remarks,
    "CLM-000145 - Software subscription\nbill - https://x.co/r.pdf?t=abc\nbank statement - https://x.co/b.jpg?t=xyz",
  );
});

Deno.test("buildBcClaimLineItem — vendor path also includes URLs in remarks", () => {
  const line = buildBcClaimLineItem({
    db: baseDb,
    isVendorPayment: true,
    vendor: vendorInputs.vendor,
    fileUrls: { billUrl: "https://x.co/r.pdf?t=abc" },
  });
  assertEquals(line.remarks, "CLM-000145 - Software subscription\nbill - https://x.co/r.pdf?t=abc");
});

Deno.test("On Behalf submission sends beneficiary employee_id, not submitter's", () => {
  const line = buildBcClaimLineItem({
    db: {
      ...baseDb,
      submission_type: "On Behalf",
      employee_id: "NW0001234", // submitter
      on_behalf_employee_code: "NW0009999", // beneficiary
      employee_name: "Beneficiary Person",
    },
    isVendorPayment: false,
  });
  assertEquals(line.employeeId, "NW0009999");
  assertEquals(line.employeeName, "Beneficiary Person");
});

Deno.test("paymentRequired is true when payment_mode_name has mixed case and whitespace", () => {
  const line = buildBcClaimLineItem({
    db: { ...baseDb, payment_mode_name: "  ReimBursement " },
    isVendorPayment: false,
  });
  assertEquals(line.paymentRequired, true);
});

Deno.test("vendor Ammount falls back to basic_amount when foreign_basic_amount is 0", () => {
  const line = buildBcClaimLineItem({
    db: {
      ...baseDb,
      basic_amount: 500,
      total_amount: 590,
      foreign_basic_amount: 0,
      foreign_total_amount: 0,
    },
    isVendorPayment: true,
    vendor: vendorInputs.vendor,
  });
  assertEquals(line.Ammount, 500);
});

Deno.test("vendor Ammount uses foreign_basic_amount when it is > 0", () => {
  const line = buildBcClaimLineItem({
    db: {
      ...baseDb,
      basic_amount: 500,
      total_amount: 590,
      foreign_basic_amount: 80,
      foreign_total_amount: 95,
    },
    isVendorPayment: true,
    vendor: vendorInputs.vendor,
  });
  assertEquals(line.Ammount, 80);
});
