import { z } from "zod";

const uuidSchema = z.uuid("Invalid UUID value");
const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Use YYYY-MM-DD");

const normalizedNullableText = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.string().nullable());

const optionalReceiptFileSchema = z
  .custom<File | null>((value) => {
    if (value === null || value === undefined) {
      return true;
    }

    if (typeof File === "undefined") {
      return false;
    }

    return value instanceof File;
  }, "Invalid receipt file")
  .nullable()
  .optional();

const optionalBankStatementFileSchema = z
  .custom<File | null>((value) => {
    if (value === null || value === undefined) {
      return true;
    }

    if (typeof File === "undefined") {
      return false;
    }

    return value instanceof File;
  }, "Invalid bank statement file")
  .nullable()
  .optional();

const optionalTaxAmountSchema = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) {
      return 0;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }

    return value;
  },
  z.number().min(0, "Tax amount cannot be negative"),
);

export const financeExpenseEditSchema = z
  .object({
    detailType: z.literal("expense"),
    detailId: uuidSchema,
    billNo: z.string().trim().min(1, "Bill number is required"),
    expenseCategoryId: uuidSchema,
    locationId: uuidSchema,
    transactionDate: isoDateSchema,
    isGstApplicable: z.boolean(),
    gstNumber: normalizedNullableText,
    vendorName: normalizedNullableText,
    basicAmount: z.number().positive("Basic amount must be greater than zero"),
    cgstAmount: optionalTaxAmountSchema,
    sgstAmount: optionalTaxAmountSchema,
    igstAmount: optionalTaxAmountSchema,
    totalAmount: z.number().positive("Total amount must be greater than zero"),
    purpose: z.string().trim().min(1, "Purpose is required"),
    productId: uuidSchema.nullable(),
    peopleInvolved: normalizedNullableText,
    remarks: normalizedNullableText,
    receiptFile: optionalReceiptFileSchema,
    bankStatementFile: optionalBankStatementFileSchema,
  })
  .strict();

export const financeAdvanceEditSchema = z
  .object({
    detailType: z.literal("advance"),
    detailId: uuidSchema,
    purpose: z.string().trim().min(1, "Purpose is required"),
    requestedAmount: z.number().positive("Requested amount must be greater than zero"),
    expectedUsageDate: isoDateSchema,
    productId: uuidSchema.nullable(),
    locationId: uuidSchema.nullable(),
    remarks: normalizedNullableText,
    receiptFile: optionalReceiptFileSchema,
  })
  .strict();

export const financeEditSchema = z.discriminatedUnion("detailType", [
  financeExpenseEditSchema,
  financeAdvanceEditSchema,
]);

export type FinanceEditValues = z.infer<typeof financeEditSchema>;
