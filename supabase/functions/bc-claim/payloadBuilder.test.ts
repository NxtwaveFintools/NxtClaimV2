import { assertEquals, assertThrows } from "std/assert/mod.ts";
import { buildBcLineItems } from "./payloadBuilder.ts";
import type { BcClaimPayloadFromDb } from "./types.ts";

const baseDbPayload: BcClaimPayloadFromDb = {
  claim_id: "CLAIM-NW0002053-20260424-462F",
  employee_id: "NW0002053",
  bc_payments_flag: false,
  approved_amount: 573,
  purpose: "Food bill for Production team - Video shoot",
  receipt_file_path: "https://storage.example.com/receipts/abc.jpg",
  bank_statement_file_path: "https://storage.example.com/bank/def.pdf",
  expense_category_id: "11111111-1111-1111-1111-111111111111",
  bc_code: "503063",
  program_code: "COMMON",
  sub_product_code: "COMMON",
  responsible_department_code: "GENAI SOCIAL MEDIA",
  beneficiary_department_code: "GENAI SOCIAL MEDIA",
  region_code: "TELUGU",
};

Deno.test("non-vendor: returns one Employee line with negative amount + bc_code", () => {
  const lines = buildBcLineItems(baseDbPayload, { isVendorPayment: false });
  assertEquals(lines.length, 1);
  const [l] = lines;
  assertEquals(l.accountType, "Employee");
  assertEquals(l.accountNo, "NW0002053");
  assertEquals(l.employeeTransactionType, "ADVANCE");
  assertEquals(l.amount, -573);
  assertEquals(l.balAccountType, "G/L Account");
  assertEquals(l.balAccountNo, "503063");
  assertEquals(l.claimNo, baseDbPayload.claim_id);
  assertEquals(l.nwProgramCode, "COMMON");
  assertEquals(l.subProductCode, "COMMON");
  assertEquals(l.responsibleDepartment, "GENAI SOCIAL MEDIA");
  assertEquals(l.beneficiaryDepartment, "GENAI SOCIAL MEDIA");
  assertEquals(l.regionCode, "TELUGU");
});

Deno.test("description: 3 lines when both files present", () => {
  const [l] = buildBcLineItems(baseDbPayload, { isVendorPayment: false });
  assertEquals(
    l.description,
    "CLAIM-NW0002053-20260424-462F - Food bill for Production team - Video shoot\n" +
      "bill - https://storage.example.com/receipts/abc.jpg\n" +
      "bank statement - https://storage.example.com/bank/def.pdf",
  );
});

Deno.test("description: only line 1 when files are null", () => {
  const [l] = buildBcLineItems(
    { ...baseDbPayload, receipt_file_path: null, bank_statement_file_path: null },
    { isVendorPayment: false },
  );
  assertEquals(
    l.description,
    "CLAIM-NW0002053-20260424-462F - Food bill for Production team - Video shoot",
  );
});

Deno.test("description: skips empty-string file paths", () => {
  const [l] = buildBcLineItems(
    { ...baseDbPayload, receipt_file_path: "", bank_statement_file_path: "" },
    { isVendorPayment: false },
  );
  assertEquals(l.description.split("\n").length, 1);
});

Deno.test("vendor: returns 2 lines, both balAccountNo empty", () => {
  const lines = buildBcLineItems(baseDbPayload, {
    isVendorPayment: true,
    bcVendorId: "VEN/0008992",
    bcVendorName: "ABC Software Pvt Ltd",
  });
  assertEquals(lines.length, 2);
  const [emp, vendor] = lines;
  assertEquals(emp.accountType, "Employee");
  assertEquals(emp.amount, -573);
  assertEquals(emp.balAccountNo, "");
  assertEquals(emp.employeeTransactionType, "ADVANCE");
  assertEquals(vendor.accountType, "Vendor");
  assertEquals(vendor.accountNo, "VEN/0008992");
  assertEquals(vendor.amount, 573);
  assertEquals(vendor.balAccountNo, "");
  assertEquals(vendor.employeeTransactionType, "");
  assertEquals(vendor.description, emp.description);
});

Deno.test("postingDate is ISO YYYY-MM-DD", () => {
  const [l] = buildBcLineItems(baseDbPayload, { isVendorPayment: false });
  assertEquals(/^\d{4}-\d{2}-\d{2}$/.test(l.postingDate), true);
});

Deno.test("throws if non-vendor and bc_code is null", () => {
  assertThrows(
    () => buildBcLineItems({ ...baseDbPayload, bc_code: null }, { isVendorPayment: false }),
    Error,
    "MISSING_BC_CODE",
  );
});

Deno.test("throws if vendor flag but no vendor id/name", () => {
  assertThrows(
    () => buildBcLineItems(baseDbPayload, { isVendorPayment: true }),
    Error,
    "MISSING_VENDOR_SELECTION",
  );
});

Deno.test("amount handles fractional approved_amount as-is", () => {
  const [l] = buildBcLineItems(
    { ...baseDbPayload, approved_amount: 573.5 },
    { isVendorPayment: false },
  );
  assertEquals(l.amount, -573.5);
});
