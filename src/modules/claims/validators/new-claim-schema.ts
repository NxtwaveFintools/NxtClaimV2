import { z } from "zod";
import { LOCATION_TYPES } from "@/core/constants/location-types";

const uuidSchema = z.uuid("Invalid UUID value");
const emailSchema = z.email("Enter a valid on-behalf email");

const optionalTextToNA = z.preprocess(
  (value) => (value === null ? undefined : value),
  z
    .string()
    .optional()
    .transform((val) => (!val || val.trim() === "" ? "N/A" : val.trim())),
);

const baseSubmissionSchema = z.object({
  employeeName: z.string().trim().min(1, "Employee Name is required"),
  employeeId: z.string().trim().min(1, "Employee ID is required"),
  ccEmails: optionalTextToNA,
  hodName: z.string().trim().min(1, "Head of Department is required"),
  hodEmail: z.string().trim().min(1, "HOD Email is required").email("Enter a valid HOD email"),
  submissionType: z.enum(["Self", "On Behalf"]),
  onBehalfEmail: optionalTextToNA,
  onBehalfEmployeeCode: optionalTextToNA,
  departmentId: uuidSchema,
  paymentModeId: uuidSchema,
});

const expenseDetailSchema = z.object({
  detailType: z.literal("expense"),
  expense: z.object({
    billNo: z.string().trim().min(1, "Bill number is required"),
    transactionId: z
      .string()
      .trim()
      .optional()
      .or(z.literal(""))
      .transform((val) => (!val || val.trim() === "" ? "N/A" : val.trim())),
    purpose: z.string().trim().min(1, "Purpose is required"),
    expenseCategoryId: uuidSchema,
    productId: uuidSchema,
    locationId: uuidSchema,
    locationType: z.preprocess(
      (v) => (v === null || v === undefined || v === "" ? null : v),
      z.string().nullable(),
    ),
    locationDetails: z.preprocess(
      (v) => (v === null || v === undefined || v === "" ? null : v),
      z.string().nullable(),
    ),
    isGstApplicable: z.boolean(),
    gstNumber: optionalTextToNA,
    cgstAmount: z.number().min(0, "CGST amount cannot be negative"),
    sgstAmount: z.number().min(0, "SGST amount cannot be negative"),
    igstAmount: z.number().min(0, "IGST amount cannot be negative"),
    transactionDate: z.iso.date("Transaction date is required"),
    basicAmount: z.number().min(0, "Basic amount cannot be negative"),
    totalAmount: z.number().min(0, "Total amount cannot be negative").optional(),
    currencyCode: z.string().trim().min(1).default("INR"),
    vendorName: optionalTextToNA,
    receiptFileName: optionalTextToNA,
    receiptFileType: optionalTextToNA,
    receiptFileBase64: optionalTextToNA,
    bankStatementFileName: optionalTextToNA,
    bankStatementFileType: optionalTextToNA,
    bankStatementFileBase64: optionalTextToNA,
    peopleInvolved: optionalTextToNA,
    remarks: optionalTextToNA,
  }),
  advance: z.object({}).passthrough().optional(),
});

const advanceDetailSchema = z.object({
  detailType: z.literal("advance"),
  advance: z.object({
    requestedAmount: z.coerce.number().min(0, "Requested amount cannot be negative"),
    budgetMonth: z.coerce
      .number()
      .int("Budget month is required")
      .min(1, "Budget month must be between 1 and 12")
      .max(12, "Budget month must be between 1 and 12"),
    budgetYear: z.coerce
      .number()
      .int("Budget year is required")
      .min(2000, "Budget year must be valid")
      .max(2200, "Budget year must be valid"),
    expectedUsageDate: z.preprocess((value) => {
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }

      return value ?? null;
    }, z.iso.date("Expected usage date must be a valid date").nullable().optional()),
    purpose: z.string().trim().min(1, "Purpose is required"),
    receiptFileBase64: optionalTextToNA,
    receiptFileName: optionalTextToNA,
    productId: uuidSchema.nullable(),
    locationId: uuidSchema.nullable(),
    remarks: optionalTextToNA,
  }),
  expense: z.object({}).passthrough().optional(),
});

export const newClaimSubmitSchema = z
  .discriminatedUnion("detailType", [
    baseSubmissionSchema.merge(expenseDetailSchema),
    baseSubmissionSchema.merge(advanceDetailSchema),
  ])
  .superRefine((value, context) => {
    const onBehalfEmailIsNA = value.onBehalfEmail === "N/A";
    const onBehalfEmployeeCodeIsNA = value.onBehalfEmployeeCode === "N/A";

    if (value.submissionType === "On Behalf") {
      if (onBehalfEmailIsNA) {
        context.addIssue({
          code: "custom",
          message: "On-behalf email is required.",
          path: ["onBehalfEmail"],
        });
      } else if (!emailSchema.safeParse(value.onBehalfEmail).success) {
        context.addIssue({
          code: "custom",
          message: "Enter a valid on-behalf email.",
          path: ["onBehalfEmail"],
        });
      }

      if (onBehalfEmployeeCodeIsNA) {
        context.addIssue({
          code: "custom",
          message: "On-behalf employee ID is required.",
          path: ["onBehalfEmployeeCode"],
        });
      }
    }

    if (value.submissionType === "Self") {
      if (!onBehalfEmailIsNA || !onBehalfEmployeeCodeIsNA) {
        context.addIssue({
          code: "custom",
          message: "On-behalf fields must be empty for Self submissions.",
          path: ["submissionType"],
        });
      }
    }

    if (value.detailType === "expense") {
      if (!value.expense) {
        context.addIssue({
          code: "custom",
          message: "Expense details are required.",
          path: ["expense"],
        });
        return;
      }

      if (
        !value.expense.isGstApplicable &&
        (value.expense.cgstAmount !== 0 ||
          value.expense.sgstAmount !== 0 ||
          value.expense.igstAmount !== 0)
      ) {
        context.addIssue({
          code: "custom",
          message: "CGST, SGST, and IGST must be 0 when GST is not applicable.",
          path: ["expense", "cgstAmount"],
        });
      }

      const hasGstNumber = value.expense.gstNumber !== "N/A";

      if (!value.expense.isGstApplicable && hasGstNumber) {
        context.addIssue({
          code: "custom",
          message: "GST number must be empty when GST is not applicable.",
          path: ["expense", "gstNumber"],
        });
      }

      const hasAnyBankStatementField =
        value.expense.bankStatementFileName !== "N/A" ||
        value.expense.bankStatementFileType !== "N/A" ||
        value.expense.bankStatementFileBase64 !== "N/A";

      if (hasAnyBankStatementField) {
        if (value.expense.bankStatementFileName === "N/A") {
          context.addIssue({
            code: "custom",
            message: "Bank statement file name is required when bank statement is attached.",
            path: ["expense", "bankStatementFileName"],
          });
        }

        if (value.expense.bankStatementFileType === "N/A") {
          context.addIssue({
            code: "custom",
            message: "Bank statement file type is required when bank statement is attached.",
            path: ["expense", "bankStatementFileType"],
          });
        }
      }

      if (
        value.expense.locationType === LOCATION_TYPES.OUT_STATION &&
        !value.expense.locationDetails
      ) {
        context.addIssue({
          code: "custom",
          message: "Location details are required when location type is Out Station.",
          path: ["expense", "locationDetails"],
        });
      }
    }

    if (value.detailType === "advance" && !value.advance) {
      context.addIssue({
        code: "custom",
        message: "Advance details are required.",
        path: ["advance"],
      });
    }
  });

export type NewClaimSubmitValues = z.infer<typeof newClaimSubmitSchema>;
