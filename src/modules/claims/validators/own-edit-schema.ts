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

const toNullableNumber = (v: unknown) =>
  v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v;

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

export const ownExpenseEditSchema = z
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
    purpose: z.string().trim().min(1, "Purpose is required"),
    productId: uuidSchema.nullable(),
    peopleInvolved: normalizedNullableText,
    remarks: normalizedNullableText,
    foreignCurrencyCode: z.enum(["INR", "USD", "EUR", "CHF"]).default("INR"),
    foreignBasicAmount: z.preprocess(
      toNullableNumber,
      z.number().min(0, "Foreign basic amount cannot be negative").nullable().optional(),
    ),
    foreignGstAmount: z.preprocess(
      toNullableNumber,
      z.number().min(0, "Foreign GST amount cannot be negative").nullable().optional(),
    ),
    foreignTotalAmount: z.preprocess(
      toNullableNumber,
      z.number().min(0, "Foreign total amount cannot be negative").nullable().optional(),
    ),
    receiptFile: optionalReceiptFileSchema,
    bankStatementFile: optionalBankStatementFileSchema,
  })
  .superRefine((value, context) => {
    if (value.foreignCurrencyCode !== "INR" && value.foreignCurrencyCode != null) {
      if (!value.foreignBasicAmount || value.foreignBasicAmount <= 0) {
        context.addIssue({
          code: "custom",
          message: "Foreign basic amount is required for non-INR currencies.",
          path: ["foreignBasicAmount"],
        });
      }
    }
  })
  .strict();

export const ownAdvanceEditSchema = z
  .object({
    detailType: z.literal("advance"),
    detailId: uuidSchema,
    purpose: z.string().trim().min(1, "Purpose is required"),
    expectedUsageDate: isoDateSchema,
    productId: uuidSchema.nullable(),
    locationId: uuidSchema.nullable(),
    remarks: normalizedNullableText,
    receiptFile: optionalReceiptFileSchema,
  })
  .strict();

export const ownEditSchema = z.discriminatedUnion("detailType", [
  ownExpenseEditSchema,
  ownAdvanceEditSchema,
]);

export type OwnEditValues = z.infer<typeof ownEditSchema>;
