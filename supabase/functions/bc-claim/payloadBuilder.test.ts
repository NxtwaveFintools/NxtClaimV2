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

Deno.test("vendor payload has all 26 fields with vendor-only keys present", () => {
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
  assertEquals(line.currencyCode, "INR");
  assertEquals(line.vendorInvoiceNo, "INV-2026-001");
  assertEquals(line.vendorCode, "V0001");
  assertEquals(line.vendorName, "Twilio Inc");
  assertEquals(line.gstGroupCode, "GST18");
  assertEquals(line.hsnSacCode, "998314");
  assertEquals(Object.keys(line).length, 26);
});

Deno.test("non-vendor payload omits vendor-only keys entirely", () => {
  const line = buildBcClaimLineItem(nonVendorInputs);
  for (const key of [
    "currencyCode",
    "vendorInvoiceNo",
    "vendorCode",
    "vendorName",
    "gstGroupCode",
    "hsnSacCode",
  ] as const) {
    assert(!(key in line), `${key} should be absent for non-vendor payload`);
  }
  assertEquals(line.invoiceRequired, false);
  assertEquals(line.paymentRequired, true);
  assertEquals(Object.keys(line).length, 20);
});

Deno.test("On_behalf submission uses on_behalf_employee_code for employeeId", () => {
  const line = buildBcClaimLineItem({
    db: {
      ...baseDb,
      submission_type: "On_behalf",
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

Deno.test("vendorInvoiceNo defaults to empty string when bill_no is null", () => {
  const line = buildBcClaimLineItem({
    db: { ...baseDb, bill_no: null },
    isVendorPayment: true,
    vendor: vendorInputs.vendor,
  });
  assertEquals(line.vendorInvoiceNo, "");
});

Deno.test("buildRemarks — short claim_id + short purpose fits within 50 chars", () => {
  const r = buildRemarks({ ...baseDb, claim_id: "CLM-100", purpose: "Software" });
  assertEquals(r, "CLM-100 - Software");
  assert(r.length <= 50);
});

Deno.test("buildRemarks — long purpose is truncated to 50 chars total", () => {
  const r = buildRemarks({
    ...baseDb,
    claim_id: "CLAIM-NW3341311-20260516-B324",
    purpose: "Lorem ipsum dolor sit amet consectetur adipiscing elit",
  });
  // 29-char claim id + " - " leaves 18 chars for purpose. Length must equal 50.
  assertEquals(r.length, 50);
  assertEquals(r, "CLAIM-NW3341311-20260516-B324 - Lorem ipsum dolor ");
});

Deno.test(
  "buildRemarks — file paths are ignored (BC remarks is 50 chars, too short for URLs)",
  () => {
    const r = buildRemarks({
      ...baseDb,
      claim_id: "CLM-100",
      purpose: "Software",
      receipt_file_path: "https://x.co/very/long/url/that/will/not/fit/r.pdf",
      bank_statement_file_path: "https://x.co/very/long/url/that/will/not/fit/s.pdf",
    });
    assertEquals(r, "CLM-100 - Software");
    assert(!r.includes("bill"));
    assert(!r.includes("bank statement"));
  },
);

Deno.test("buildRemarks — empty purpose falls back to '{claim_id} - '", () => {
  const r = buildRemarks({ ...baseDb, claim_id: "CLM-100", purpose: "" });
  assertEquals(r, "CLM-100 - ");
});
