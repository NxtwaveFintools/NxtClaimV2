import { z } from "zod";

const uuidSchema = z.uuid("Invalid UUID value");

const editReasonSchema = z.string().trim().min(5, "An edit reason is required for the audit log.");

export const financeExpenseEditSchema = z
  .object({
    detailType: z.literal("expense"),
    detailId: uuidSchema,
    editReason: editReasonSchema,
    paymentModeId: uuidSchema.nullable().optional(),
    approvedAmount: z.number().min(0, "Approved amount cannot be negative"),
  })
  .strict();

export const financeAdvanceEditSchema = z
  .object({
    detailType: z.literal("advance"),
    detailId: uuidSchema,
    editReason: editReasonSchema,
    paymentModeId: uuidSchema.nullable().optional(),
    approvedAmount: z.number().min(0, "Approved amount cannot be negative"),
  })
  .strict();

export const financeEditSchema = z.discriminatedUnion("detailType", [
  financeExpenseEditSchema,
  financeAdvanceEditSchema,
]);

export type FinanceEditValues = z.infer<typeof financeEditSchema>;
