import { z } from "zod";
import { LOCATION_TYPES } from "@/core/constants/location-types";

const uuidSchema = z.uuid("Invalid UUID value");

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Use YYYY-MM-DD");

const editReasonSchema = z.string().trim().min(5, "An edit reason is required for the audit log.");
const optionalFilePathSchema = z.string().trim().min(1).optional();

const normalizedNullableText = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.string().nullable());

const locationTypeSchema = z.preprocess(
  (value) => (value === null || value === undefined || value === "" ? null : value),
  z.enum([LOCATION_TYPES.BASE, LOCATION_TYPES.OUT_STATION]).nullable(),
);

export const financeExpenseEditSchema = z
  .object({
    detailType: z.literal("expense"),
    detailId: uuidSchema,
    editReason: editReasonSchema,
    paymentModeId: uuidSchema,
    billNo: z.string().trim().min(1, "Bill number is required"),
    expenseCategoryId: uuidSchema,
    productId: uuidSchema.nullable(),
    locationId: uuidSchema,
    locationType: locationTypeSchema,
    locationDetails: normalizedNullableText,
    transactionDate: isoDateSchema,
    purpose: z.string().trim().min(1, "Purpose is required"),
    isGstApplicable: z.boolean(),
    gstNumber: normalizedNullableText,
    vendorName: normalizedNullableText,
    peopleInvolved: normalizedNullableText,
    remarks: normalizedNullableText,
    receiptFilePath: optionalFilePathSchema,
    bankStatementFilePath: optionalFilePathSchema,
    basicAmount: z.number().min(0, "Basic amount cannot be negative"),
    cgstAmount: z.number().min(0, "CGST amount cannot be negative"),
    sgstAmount: z.number().min(0, "SGST amount cannot be negative"),
    igstAmount: z.number().min(0, "IGST amount cannot be negative"),
    totalAmount: z.number().min(0, "Total amount cannot be negative"),
    foreignCurrencyCode: z.enum(["INR", "USD", "EUR", "CHF"]).default("INR"),
    foreignBasicAmount: z.preprocess(
      (v) =>
        v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v,
      z.number().min(0).nullable().optional(),
    ),
    foreignGstAmount: z.preprocess(
      (v) =>
        v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v,
      z.number().min(0).nullable().optional(),
    ),
    foreignTotalAmount: z.preprocess(
      (v) =>
        v === "" || v === null || v === undefined ? null : typeof v === "string" ? Number(v) : v,
      z.number().min(0).nullable().optional(),
    ),
  })
  .superRefine((value, context) => {
    if (value.locationType === LOCATION_TYPES.OUT_STATION && !value.locationDetails) {
      context.addIssue({
        code: "custom",
        message: "Location details are required when location type is Out Station.",
        path: ["locationDetails"],
      });
    }

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

export const financeAdvanceEditSchema = z
  .object({
    detailType: z.literal("advance"),
    detailId: uuidSchema,
    editReason: editReasonSchema,
    paymentModeId: uuidSchema,
    purpose: z.string().trim().min(1, "Purpose is required"),
    expectedUsageDate: isoDateSchema,
    productId: uuidSchema.nullable(),
    locationId: uuidSchema.nullable(),
    remarks: normalizedNullableText,
    supportingDocumentPath: optionalFilePathSchema,
    totalAmount: z.number().min(0, "Approved amount cannot be negative"),
  })
  .strict();

export const financeEditSchema = z.discriminatedUnion("detailType", [
  financeExpenseEditSchema,
  financeAdvanceEditSchema,
]);

export type FinanceEditValues = z.infer<typeof financeEditSchema>;
