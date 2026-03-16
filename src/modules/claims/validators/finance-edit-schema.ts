import { z } from "zod";

const uuidSchema = z.uuid("Invalid UUID value");

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

export const financeExpenseEditSchema = z
  .object({
    detailType: z.literal("expense"),
    billNo: z.string().trim().min(1, "Bill number is required"),
    vendorName: normalizedNullableText,
    basicAmount: z.number().positive("Basic amount must be greater than zero"),
    totalAmount: z.number().min(0, "Total amount cannot be negative"),
    purpose: z.string().trim().min(1, "Purpose is required"),
    productId: uuidSchema.nullable(),
    remarks: normalizedNullableText,
    receiptFile: optionalReceiptFileSchema,
  })
  .strict();

export const financeAdvanceEditSchema = z
  .object({
    detailType: z.literal("advance"),
    purpose: z.string().trim().min(1, "Purpose is required"),
    productId: uuidSchema.nullable(),
    remarks: normalizedNullableText,
    receiptFile: optionalReceiptFileSchema,
  })
  .strict();

export const financeEditSchema = z.discriminatedUnion("detailType", [
  financeExpenseEditSchema,
  financeAdvanceEditSchema,
]);

export type FinanceEditValues = z.infer<typeof financeEditSchema>;
