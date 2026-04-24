"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";
import { logger } from "@/core/infra/logging/logger";
import { ROUTES } from "@/core/config/route-registry";
import {
  DB_CLAIM_STATUSES,
  DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  type DbClaimStatus,
} from "@/core/constants/statuses";
import {
  isAdvancePaymentModeName,
  isCorporateCardPaymentModeName,
  isExpensePaymentModeName,
} from "@/core/constants/payment-modes";
import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import { SubmitClaimService } from "@/core/domain/claims/SubmitClaimService";
import { ProcessL1ClaimDecisionService } from "@/core/domain/claims/ProcessL1ClaimDecisionService";
import { ProcessL2ClaimDecisionService } from "@/core/domain/claims/ProcessL2ClaimDecisionService";
import { BulkProcessClaimsService } from "@/core/domain/claims/BulkProcessClaimsService";
import { UpdateClaimByFinanceService } from "@/core/domain/claims/UpdateClaimByFinanceService";
import { UpdateOwnClaimService } from "@/core/domain/claims/UpdateOwnClaimService";
import { DeleteOwnClaimService } from "@/core/domain/claims/DeleteOwnClaimService";
import type {
  ClaimDetailType,
  ClaimDropdownOption,
  ClaimExpenseAiMetadata,
  FinanceClaimEditPayload,
  GetMyClaimsFilters,
  OwnClaimEditPayload,
} from "@/core/domain/claims/contracts";
import { GetActiveDepartmentsService } from "@/core/domain/departments/GetActiveDepartmentsService";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";
import { SupabaseDepartmentRepository } from "@/modules/departments/repositories/SupabaseDepartmentRepository";
import { newClaimSubmitSchema } from "@/modules/claims/validators/new-claim-schema";
import { financeEditSchema } from "@/modules/claims/validators/finance-edit-schema";
import { ownEditSchema } from "@/modules/claims/validators/own-edit-schema";
import { sanitizeDashboardReturnToPath } from "@/lib/pagination-helpers";
import { z } from "zod";

const repository = new SupabaseClaimRepository();
const authRepository = new SupabaseServerAuthRepository();
const departmentRepository = new SupabaseDepartmentRepository();
const activeDepartmentsService = new GetActiveDepartmentsService({
  repository: departmentRepository,
  logger,
});
const submitClaimService = new SubmitClaimService({ repository, logger });
const processL1ClaimDecisionService = new ProcessL1ClaimDecisionService({ repository, logger });
const processL2ClaimDecisionService = new ProcessL2ClaimDecisionService({ repository, logger });
const bulkProcessClaimsService = new BulkProcessClaimsService({ repository, logger });
const updateClaimByFinanceService = new UpdateClaimByFinanceService({ repository, logger });
const updateOwnClaimService = new UpdateOwnClaimService({ repository, logger });
const deleteOwnClaimService = new DeleteOwnClaimService({ repository, logger });

const claimsStorageBucket = "claims";
type ClaimStorageFolder = "expenses" | "petty_cash_requests";
const claimIdSchema = z.string().trim().min(1, "Claim ID is required");
const claimDecisionSchema = z.object({
  claimId: claimIdSchema,
  redirectToApprovalsView: z.boolean().optional(),
  returnTo: z.string().trim().optional(),
  rejectionReason: z.string().trim().min(5).optional(),
  allowResubmission: z.boolean().optional(),
});
const financeEditClaimIdSchema = z.object({
  claimId: claimIdSchema,
});
const bulkFiltersSchema = z
  .object({
    paymentModeId: z.string().trim().optional(),
    departmentId: z.string().trim().optional(),
    locationId: z.string().trim().optional(),
    productId: z.string().trim().optional(),
    expenseCategoryId: z.string().trim().optional(),
    submissionType: z.enum(["Self", "On Behalf"]).optional(),
    status: z.array(z.enum(DB_CLAIM_STATUSES)).optional(),
    dateTarget: z.enum(["submitted", "finance_closed"]).optional(),
    dateFrom: z.string().trim().optional(),
    dateTo: z.string().trim().optional(),
    searchField: z.enum(["claim_id", "employee_name", "employee_id", "employee_email"]).optional(),
    searchQuery: z.string().trim().optional(),
  })
  .optional();
const bulkActionInputSchema = z.object({
  claimIds: z.array(claimIdSchema).default([]),
  isGlobalSelect: z.boolean(),
  filters: bulkFiltersSchema,
});
const bulkRejectInputSchema = bulkActionInputSchema.extend({
  rejectionReason: z.string().trim().min(5, "Rejection reason is required."),
  allowResubmission: z.boolean().optional(),
});
const MAX_UPLOAD_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const BULK_L1_CURSOR_PAGE_SIZE = 200;
const BULK_L1_PROCESS_CHUNK_SIZE = 10;
const UNIQUE_VIOLATION_CODE = "23505";
const DUPLICATE_ACTIVE_EXPENSE_BILL_CONSTRAINT = "uq_expense_details_active_bill";
const DUPLICATE_ACTIVE_EXPENSE_BILL_MESSAGE =
  "A claim with this exact Bill Number, Date, and Amount already exists in the system. Please change the Bill Number slightly (e.g., add '-FIX') to make it unique before saving.";
const PRE_HOD_EDITABLE_STATUSES: readonly DbClaimStatus[] = [
  DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS,
  DB_REJECTED_RESUBMISSION_ALLOWED_STATUS,
];
const APPROVALS_VIEW_REDIRECT_PATH = `${ROUTES.claims.myClaims}?view=approvals`;

function resolveClaimDecisionRedirectPath(input: {
  returnTo?: string;
  redirectToApprovalsView?: boolean;
}): string | null {
  const safeReturnTo = sanitizeDashboardReturnToPath(input.returnTo);

  if (safeReturnTo) {
    return safeReturnTo;
  }

  if (input.redirectToApprovalsView) {
    return APPROVALS_VIEW_REDIRECT_PATH;
  }

  return null;
}

class DuplicateTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateTransactionError";
  }
}

type PostgresErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  constraint?: unknown;
};

export type PaymentModeOption = {
  id: string;
  name: string;
  detailType: ClaimDetailType;
};

export type ClaimFormOptions = {
  departments: ClaimDropdownOption[];
  departmentRouting: {
    id: string;
    name: string;
    hod: {
      id: string;
      email: string;
      fullName: string | null;
    };
    founder: {
      id: string;
      email: string;
      fullName: string | null;
    };
  }[];
  paymentModes: PaymentModeOption[];
  expenseCategories: ClaimDropdownOption[];
  products: ClaimDropdownOption[];
  locations: ClaimDropdownOption[];
};

export type CurrentUserHydration = {
  id: string;
  email: string;
  name: string;
  isGlobalHod: boolean;
};

function classifyDetailType(modeName: string): ClaimDetailType | null {
  if (isExpensePaymentModeName(modeName)) {
    return "expense";
  }

  if (isAdvancePaymentModeName(modeName)) {
    return "advance";
  }

  return null;
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function validateUploadFileSize(file: File, fieldLabel: string): string | null {
  if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
    return `${fieldLabel} exceeds 25MB.`;
  }

  return null;
}

function buildStoragePath(folder: ClaimStorageFolder, userId: string, fileName: string): string {
  return `${folder}/${userId}/${Date.now()}_${sanitizeFilename(fileName)}`;
}

async function uploadClaimFile(input: {
  folder: ClaimStorageFolder;
  userId: string;
  fileName: string;
  fileType: string;
  fileBuffer: Buffer;
}): Promise<{ path: string | null; errorMessage: string | null }> {
  const client = getServiceRoleSupabaseClient();
  const path = buildStoragePath(input.folder, input.userId, input.fileName);

  const uploadResult = await client.storage
    .from(claimsStorageBucket)
    .upload(path, input.fileBuffer, {
      contentType: input.fileType,
      upsert: false,
    });

  if (uploadResult.error) {
    return {
      path: null,
      errorMessage: uploadResult.error.message,
    };
  }

  return { path, errorMessage: null };
}

async function removeClaimFile(path: string): Promise<void> {
  const client = getServiceRoleSupabaseClient();
  await client.storage.from(claimsStorageBucket).remove([path]);
}

function getFormDataString(input: FormData, key: string): string {
  const value = input.get(key);
  return typeof value === "string" ? value : "";
}

function getFormDataNullableString(input: FormData, key: string): string | null {
  const value = getFormDataString(input, key).trim();
  return value.length > 0 ? value : null;
}

function nullIfNASentinel(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.trim() === "N/A" ? null : value;
}

function getFormDataNumber(input: FormData, key: string): number {
  const raw = getFormDataString(input, key);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeExpenseTotalAmount(input: {
  basicAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
}): number {
  return (
    Math.round((input.basicAmount + input.cgstAmount + input.sgstAmount + input.igstAmount) * 100) /
    100
  );
}

function getFormDataBoolean(input: FormData, key: string): boolean {
  const value = getFormDataString(input, key);
  return value === "true";
}

function getFormDataJsonObject(input: FormData, key: string): Record<string, unknown> | null {
  const raw = getFormDataString(input, key).trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isPreHodEditableStatus(status: DbClaimStatus): boolean {
  return PRE_HOD_EDITABLE_STATUSES.some((candidate) => candidate === status);
}

function canActorEditClaim(input: {
  status: DbClaimStatus;
  actorUserId: string;
  submittedBy: string;
  assignedL1ApproverId: string;
  isFinanceActor: boolean;
}): boolean {
  if (input.status === DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS) {
    return input.isFinanceActor;
  }

  if (isPreHodEditableStatus(input.status)) {
    return (
      input.actorUserId === input.submittedBy || input.actorUserId === input.assignedL1ApproverId
    );
  }

  return false;
}

function hasRoutingFieldMutationAttempt(
  formData: FormData,
  options?: { allowPaymentModeMutation?: boolean },
): boolean {
  const immutableRoutingFields = [
    "departmentId",
    "onBehalfOfId",
    "onBehalfEmail",
    "onBehalfEmployeeCode",
  ] as const;

  if (!options?.allowPaymentModeMutation) {
    return ["paymentModeId", ...immutableRoutingFields].some((key) => {
      const value = formData.get(key);
      return typeof value === "string" && value.trim().length > 0;
    });
  }

  return immutableRoutingFields.some((key) => {
    const value = formData.get(key);
    return typeof value === "string" && value.trim().length > 0;
  });
}

function includesDuplicateExpenseBillConstraint(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.toLowerCase().includes(DUPLICATE_ACTIVE_EXPENSE_BILL_CONSTRAINT)
  );
}

function isDuplicateExpenseBillUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as PostgresErrorLike;

  if (candidate.code !== UNIQUE_VIOLATION_CODE) {
    return false;
  }

  return [candidate.message, candidate.details, candidate.hint, candidate.constraint].some(
    (segment) => includesDuplicateExpenseBillConstraint(segment),
  );
}

function buildDuplicateActiveExpenseBillMessage(duplicateClaimId?: string | null): string {
  if (!duplicateClaimId) {
    return DUPLICATE_ACTIVE_EXPENSE_BILL_MESSAGE;
  }

  return `${DUPLICATE_ACTIVE_EXPENSE_BILL_MESSAGE} Duplicate Claim ID: ${duplicateClaimId}.`;
}

function extractSubmissionInput(input: unknown): {
  payload: unknown;
  receiptFile: File | null;
  bankStatementFile: File | null;
  advanceReceiptFile: File | null;
} {
  if (!(input instanceof FormData)) {
    return {
      payload: input,
      receiptFile: null,
      bankStatementFile: null,
      advanceReceiptFile: null,
    };
  }

  const receiptFileEntry = input.get("receiptFile");
  const bankStatementFileEntry = input.get("bankStatementFile");
  const advanceReceiptFileEntry = input.get("advanceReceiptFile");
  const receiptFile =
    receiptFileEntry instanceof File && receiptFileEntry.size > 0 ? receiptFileEntry : null;
  const bankStatementFile =
    bankStatementFileEntry instanceof File && bankStatementFileEntry.size > 0
      ? bankStatementFileEntry
      : null;
  const advanceReceiptFile =
    advanceReceiptFileEntry instanceof File && advanceReceiptFileEntry.size > 0
      ? advanceReceiptFileEntry
      : null;

  const detailType = getFormDataString(input, "detailType") as "expense" | "advance";
  const submissionType = getFormDataString(input, "submissionType") as "Self" | "On Behalf";

  const payload = {
    employeeName: getFormDataString(input, "employeeName"),
    employeeId: getFormDataString(input, "employeeId"),
    ccEmails: getFormDataNullableString(input, "ccEmails") ?? undefined,
    hodName: getFormDataString(input, "hodName"),
    hodEmail: getFormDataString(input, "hodEmail"),
    submissionType,
    onBehalfEmail: getFormDataNullableString(input, "onBehalfEmail"),
    onBehalfEmployeeCode: getFormDataNullableString(input, "onBehalfEmployeeCode"),
    departmentId: getFormDataString(input, "departmentId"),
    paymentModeId: getFormDataString(input, "paymentModeId"),
    detailType,
    expense: {
      billNo: getFormDataString(input, "expense.billNo"),
      transactionId: getFormDataString(input, "expense.transactionId"),
      purpose: getFormDataString(input, "expense.purpose"),
      expenseCategoryId: getFormDataString(input, "expense.expenseCategoryId"),
      productId: getFormDataString(input, "expense.productId"),
      locationId: getFormDataString(input, "expense.locationId"),
      locationType: getFormDataNullableString(input, "expense.locationType"),
      locationDetails: getFormDataNullableString(input, "expense.locationDetails"),
      isGstApplicable: getFormDataBoolean(input, "expense.isGstApplicable"),
      gstNumber: getFormDataNullableString(input, "expense.gstNumber"),
      cgstAmount: getFormDataNumber(input, "expense.cgstAmount"),
      sgstAmount: getFormDataNumber(input, "expense.sgstAmount"),
      igstAmount: getFormDataNumber(input, "expense.igstAmount"),
      transactionDate: getFormDataString(input, "expense.transactionDate"),
      basicAmount: getFormDataNumber(input, "expense.basicAmount"),
      currencyCode: getFormDataString(input, "expense.currencyCode"),
      vendorName: getFormDataNullableString(input, "expense.vendorName"),
      receiptFileName: getFormDataNullableString(input, "expense.receiptFileName"),
      receiptFileType: getFormDataNullableString(input, "expense.receiptFileType"),
      receiptFileBase64: getFormDataNullableString(input, "expense.receiptFileBase64"),
      bankStatementFileName: getFormDataNullableString(input, "expense.bankStatementFileName"),
      bankStatementFileType: getFormDataNullableString(input, "expense.bankStatementFileType"),
      bankStatementFileBase64: getFormDataNullableString(input, "expense.bankStatementFileBase64"),
      peopleInvolved: getFormDataNullableString(input, "expense.peopleInvolved"),
      remarks: getFormDataNullableString(input, "expense.remarks"),
      aiMetadata: getFormDataJsonObject(input, "expense.aiMetadata"),
    },
    advance: {
      requestedAmount: getFormDataNumber(input, "advance.requestedAmount"),
      budgetMonth: getFormDataNumber(input, "advance.budgetMonth"),
      budgetYear: getFormDataNumber(input, "advance.budgetYear"),
      expectedUsageDate: getFormDataNullableString(input, "advance.expectedUsageDate"),
      purpose: getFormDataString(input, "advance.purpose"),
      receiptFileName: getFormDataNullableString(input, "advance.receiptFileName"),
      receiptFileBase64: getFormDataNullableString(input, "advance.receiptFileBase64"),
      productId: getFormDataNullableString(input, "advance.productId"),
      locationId: getFormDataNullableString(input, "advance.locationId"),
      remarks: getFormDataNullableString(input, "advance.remarks"),
    },
  };

  return {
    payload,
    receiptFile,
    bankStatementFile,
    advanceReceiptFile,
  };
}

export async function getClaimFormHydrationAction(): Promise<{
  data: { currentUser: CurrentUserHydration; options: ClaimFormOptions } | null;
  errorMessage: string | null;
}> {
  const currentUserResult = await authRepository.getCurrentUser();
  if (
    currentUserResult.errorMessage ||
    !currentUserResult.user?.id ||
    !currentUserResult.user.email
  ) {
    return {
      data: null,
      errorMessage: currentUserResult.errorMessage ?? "Unauthorized session.",
    };
  }

  const [
    userSummaryResult,
    globalHodResult,
    departmentsResult,
    paymentModesResult,
    expenseCategoriesResult,
    productsResult,
    locationsResult,
  ] = await Promise.all([
    repository.getUserSummary(currentUserResult.user.id),
    repository.isUserApprover1InAnyDepartment(currentUserResult.user.id),
    activeDepartmentsService.execute(),
    repository.getActivePaymentModes(),
    repository.getActiveExpenseCategories(),
    repository.getActiveProducts(),
    repository.getActiveLocations(),
  ]);

  if (userSummaryResult.errorMessage) {
    return {
      data: null,
      errorMessage: userSummaryResult.errorMessage,
    };
  }

  const resolvedCurrentUser =
    userSummaryResult.data ??
    ({
      id: currentUserResult.user.id,
      email: currentUserResult.user.email,
      fullName: null,
    } as const);

  if (globalHodResult.errorMessage) {
    return {
      data: null,
      errorMessage: globalHodResult.errorMessage,
    };
  }

  const firstError =
    departmentsResult.errorMessage ??
    paymentModesResult.errorMessage ??
    expenseCategoriesResult.errorMessage ??
    productsResult.errorMessage ??
    locationsResult.errorMessage;

  if (firstError) {
    return { data: null, errorMessage: firstError };
  }

  const departmentRouting = departmentsResult.departments.map((department) => ({
    id: department.id,
    name: department.name,
    hod: {
      id: department.hod.id,
      email: department.hod.email,
      fullName: department.hod.fullName,
    },
    founder: {
      id: department.founder.id,
      email: department.founder.email,
      fullName: department.founder.fullName,
    },
  }));

  const paymentModes = paymentModesResult.data
    .map((mode) => {
      const detailType = classifyDetailType(mode.name);
      if (!detailType) {
        return null;
      }

      return {
        id: mode.id,
        name: mode.name,
        detailType,
      };
    })
    .filter((mode): mode is PaymentModeOption => mode !== null);

  return {
    data: {
      currentUser: {
        id: resolvedCurrentUser.id,
        email: resolvedCurrentUser.email,
        name: resolvedCurrentUser.fullName ?? resolvedCurrentUser.email,
        isGlobalHod: globalHodResult.isApprover1,
      },
      options: {
        departments: departmentRouting.map((department) => ({
          id: department.id,
          name: department.name,
        })),
        departmentRouting,
        paymentModes,
        expenseCategories: expenseCategoriesResult.data,
        products: productsResult.data,
        locations: locationsResult.data,
      },
    },
    errorMessage: null,
  };
}

export async function submitClaimAction(input: unknown): Promise<{
  ok: boolean;
  claimId?: string;
  message?: string;
  errorCode?: "DUPLICATE_TRANSACTION";
  fieldErrors?: Record<string, string[]>;
}> {
  const { payload, receiptFile, bankStatementFile, advanceReceiptFile } =
    extractSubmissionInput(input);
  const parseResult = newClaimSubmitSchema.safeParse(payload);

  if (!parseResult.success) {
    return {
      ok: false,
      message: "Validation failed.",
      fieldErrors: parseResult.error.flatten().fieldErrors,
    };
  }

  if (receiptFile) {
    const fileSizeError = validateUploadFileSize(receiptFile, "Invoice/Bill file");
    if (fileSizeError) {
      return {
        ok: false,
        message: fileSizeError,
      };
    }
  }

  if (bankStatementFile) {
    const fileSizeError = validateUploadFileSize(bankStatementFile, "Bank statement file");
    if (fileSizeError) {
      return {
        ok: false,
        message: fileSizeError,
      };
    }
  }

  if (advanceReceiptFile) {
    const fileSizeError = validateUploadFileSize(advanceReceiptFile, "Supporting document file");
    if (fileSizeError) {
      return {
        ok: false,
        message: fileSizeError,
      };
    }
  }

  const currentUserResult = await authRepository.getCurrentUser();
  if (
    currentUserResult.errorMessage ||
    !currentUserResult.user?.id ||
    !currentUserResult.user.email
  ) {
    return {
      ok: false,
      message: currentUserResult.errorMessage ?? "Unauthorized session.",
    };
  }

  const departmentsResult = await activeDepartmentsService.execute();
  if (departmentsResult.errorMessage) {
    return {
      ok: false,
      message: departmentsResult.errorMessage,
    };
  }

  const selectedDepartment = departmentsResult.departments.find(
    (department) => department.id === parseResult.data.departmentId,
  );

  if (!selectedDepartment) {
    return {
      ok: false,
      message: "Selected department is invalid or inactive.",
    };
  }

  let onBehalfOfId: string | null = null;
  if (parseResult.data.submissionType === "On Behalf" && parseResult.data.onBehalfEmail) {
    const beneficiaryLookup = await repository.getActiveUserIdByEmail(
      parseResult.data.onBehalfEmail,
    );
    if (beneficiaryLookup.errorMessage) {
      return {
        ok: false,
        message: beneficiaryLookup.errorMessage,
      };
    }

    if (!beneficiaryLookup.data) {
      return {
        ok: false,
        message: "Unable to resolve or provision on-behalf beneficiary.",
      };
    }

    onBehalfOfId = beneficiaryLookup.data;
  }

  let uploadedReceiptFilePath: string | null = null;
  let uploadedBankStatementFilePath: string | null = null;
  let uploadedAdvanceSupportingFilePath: string | null = null;

  try {
    if (parseResult.data.detailType === "expense") {
      let receiptFileName = nullIfNASentinel(parseResult.data.expense.receiptFileName);
      let receiptFileType = nullIfNASentinel(parseResult.data.expense.receiptFileType);
      const receiptFileBase64 = nullIfNASentinel(parseResult.data.expense.receiptFileBase64);
      let receiptFileBuffer: Buffer | null = null;

      if (receiptFile) {
        receiptFileName = receiptFile.name;
        receiptFileType = receiptFile.type;
        receiptFileBuffer = Buffer.from(await receiptFile.arrayBuffer());
      } else if (receiptFileBase64) {
        receiptFileBuffer = Buffer.from(receiptFileBase64, "base64");
      }

      if (!receiptFileName || !receiptFileType || !receiptFileBuffer) {
        return {
          ok: false,
          message: "Invoice/Bill upload is required.",
        };
      }

      const duplicateTransactionResult = await repository.existsExpenseByCompositeKey({
        billNo: parseResult.data.expense.billNo,
        transactionDate: parseResult.data.expense.transactionDate,
        basicAmount: parseResult.data.expense.basicAmount,
        totalAmount: computeExpenseTotalAmount({
          basicAmount: parseResult.data.expense.basicAmount,
          cgstAmount: parseResult.data.expense.cgstAmount,
          sgstAmount: parseResult.data.expense.sgstAmount,
          igstAmount: parseResult.data.expense.igstAmount,
        }),
      });

      if (duplicateTransactionResult.errorMessage) {
        return {
          ok: false,
          message: duplicateTransactionResult.errorMessage,
        };
      }

      if (duplicateTransactionResult.exists) {
        throw new DuplicateTransactionError(
          "A claim with this exact Bill No, Date, and Amount already exists.",
        );
      }

      const receiptUploadResult = await uploadClaimFile({
        folder: "expenses",
        userId: currentUserResult.user.id,
        fileName: receiptFileName,
        fileType: receiptFileType,
        fileBuffer: receiptFileBuffer,
      });

      if (receiptUploadResult.errorMessage || !receiptUploadResult.path) {
        return {
          ok: false,
          message: receiptUploadResult.errorMessage ?? "Receipt upload failed.",
        };
      }

      uploadedReceiptFilePath = receiptUploadResult.path;

      let bankStatementFileName = nullIfNASentinel(parseResult.data.expense.bankStatementFileName);
      let bankStatementFileType = nullIfNASentinel(parseResult.data.expense.bankStatementFileType);
      const bankStatementFileBase64 = nullIfNASentinel(
        parseResult.data.expense.bankStatementFileBase64,
      );
      let bankStatementFileBuffer: Buffer | null = null;

      if (bankStatementFile) {
        bankStatementFileName = bankStatementFile.name;
        bankStatementFileType = bankStatementFile.type;
        bankStatementFileBuffer = Buffer.from(await bankStatementFile.arrayBuffer());
      } else if (bankStatementFileBase64) {
        bankStatementFileBuffer = Buffer.from(bankStatementFileBase64, "base64");
      }

      if (bankStatementFileBuffer && bankStatementFileName && bankStatementFileType) {
        const bankUploadResult = await uploadClaimFile({
          folder: "expenses",
          userId: currentUserResult.user.id,
          fileName: bankStatementFileName,
          fileType: bankStatementFileType,
          fileBuffer: bankStatementFileBuffer,
        });

        if (bankUploadResult.errorMessage || !bankUploadResult.path) {
          return {
            ok: false,
            message: bankUploadResult.errorMessage ?? "Bank statement upload failed.",
          };
        }

        uploadedBankStatementFilePath = bankUploadResult.path;
      }
    } else {
      let advanceReceiptFileName = nullIfNASentinel(parseResult.data.advance.receiptFileName);
      const advanceReceiptFileBase64 = nullIfNASentinel(parseResult.data.advance.receiptFileBase64);
      let advanceReceiptFileBuffer: Buffer | null = null;

      if (advanceReceiptFile) {
        advanceReceiptFileName = advanceReceiptFile.name;
        advanceReceiptFileBuffer = Buffer.from(await advanceReceiptFile.arrayBuffer());
      } else if (advanceReceiptFileBase64) {
        advanceReceiptFileBuffer = Buffer.from(advanceReceiptFileBase64, "base64");
      }

      if (advanceReceiptFileBuffer && advanceReceiptFileName) {
        const advanceUploadResult = await uploadClaimFile({
          folder: "petty_cash_requests",
          userId: currentUserResult.user.id,
          fileName: advanceReceiptFileName,
          fileType: advanceReceiptFile?.type || "application/octet-stream",
          fileBuffer: advanceReceiptFileBuffer,
        });

        if (advanceUploadResult.errorMessage || !advanceUploadResult.path) {
          return {
            ok: false,
            message: advanceUploadResult.errorMessage ?? "Supporting document upload failed.",
          };
        }

        uploadedAdvanceSupportingFilePath = advanceUploadResult.path;
      }
    }
  } catch (error) {
    if (error instanceof DuplicateTransactionError) {
      return {
        ok: false,
        errorCode: "DUPLICATE_TRANSACTION",
        message: error.message,
      };
    }

    return {
      ok: false,
      message: error instanceof Error ? error.message : "Failed to process claim submission files.",
    };
  }

  const submissionInput = {
    submissionType: parseResult.data.submissionType,
    detailType: parseResult.data.detailType,
    submittedBy: currentUserResult.user.id,
    onBehalfOfId,
    employeeId: parseResult.data.employeeId,
    ccEmails: parseResult.data.ccEmails ?? null,
    onBehalfEmail:
      parseResult.data.submissionType === "On Behalf" ? parseResult.data.onBehalfEmail : null,
    onBehalfEmployeeCode:
      parseResult.data.submissionType === "On Behalf"
        ? parseResult.data.onBehalfEmployeeCode
        : null,
    departmentId: parseResult.data.departmentId,
    paymentModeId: parseResult.data.paymentModeId,
    assignedL2ApproverId: null,
    expense:
      parseResult.data.detailType === "expense"
        ? {
            billNo: parseResult.data.expense.billNo,
            transactionId: parseResult.data.expense.transactionId,
            purpose: parseResult.data.expense.purpose,
            expenseCategoryId: parseResult.data.expense.expenseCategoryId,
            productId: parseResult.data.expense.productId,
            locationId: parseResult.data.expense.locationId,
            locationType: parseResult.data.expense.locationType,
            locationDetails: parseResult.data.expense.locationDetails,
            isGstApplicable: parseResult.data.expense.isGstApplicable,
            gstNumber: parseResult.data.expense.gstNumber,
            cgstAmount: parseResult.data.expense.cgstAmount,
            sgstAmount: parseResult.data.expense.sgstAmount,
            igstAmount: parseResult.data.expense.igstAmount,
            transactionDate: parseResult.data.expense.transactionDate,
            basicAmount: parseResult.data.expense.basicAmount,
            currencyCode: parseResult.data.expense.currencyCode,
            vendorName: parseResult.data.expense.vendorName,
            receiptFilePath: uploadedReceiptFilePath,
            bankStatementFilePath: uploadedBankStatementFilePath,
            peopleInvolved: parseResult.data.expense.peopleInvolved,
            remarks: parseResult.data.expense.remarks,
            aiMetadata: parseResult.data.expense.aiMetadata as ClaimExpenseAiMetadata | null,
          }
        : undefined,
    advance:
      parseResult.data.detailType === "advance"
        ? {
            requestedAmount: parseResult.data.advance.requestedAmount,
            budgetMonth: parseResult.data.advance.budgetMonth,
            budgetYear: parseResult.data.advance.budgetYear,
            expectedUsageDate: parseResult.data.advance.expectedUsageDate ?? null,
            purpose: parseResult.data.advance.purpose,
            supportingDocumentPath: uploadedAdvanceSupportingFilePath,
            productId: parseResult.data.advance.productId,
            locationId: parseResult.data.advance.locationId,
            remarks: parseResult.data.advance.remarks,
          }
        : undefined,
  };

  const result = await submitClaimService.execute(submissionInput);

  if (result.errorCode || !result.claimId) {
    const errorMessage = result.errorMessage ?? "Failed to submit claim.";

    if (
      parseResult.data.detailType === "advance" &&
      /expected_usage_date/i.test(errorMessage) &&
      /not-null|null value/i.test(errorMessage)
    ) {
      return {
        ok: false,
        message:
          "Expected Usage Date is optional in the app, but your database schema is still enforcing it as required. Please apply migration 20260315000100_advance_supporting_documents_and_strict_validation.sql.",
      };
    }

    return {
      ok: false,
      message: errorMessage,
    };
  }

  return {
    ok: true,
    claimId: result.claimId,
  };
}

function buildFinanceEditPayload(formData: FormData): unknown {
  const detailType = getFormDataString(formData, "detailType");
  const detailId = getFormDataString(formData, "detailId");
  const editReason = getFormDataString(formData, "editReason");
  const paymentModeId = getFormDataNullableString(formData, "paymentModeId");
  const productId = getFormDataNullableString(formData, "productId");
  const locationId = getFormDataNullableString(formData, "locationId");
  const receiptFileEntry = formData.get("receiptFile");
  const receiptFile =
    receiptFileEntry instanceof File && receiptFileEntry.size > 0 ? receiptFileEntry : null;
  const bankStatementFileEntry = formData.get("bankStatementFile");
  const bankStatementFile =
    bankStatementFileEntry instanceof File && bankStatementFileEntry.size > 0
      ? bankStatementFileEntry
      : null;

  if (detailType === "expense") {
    return {
      detailType,
      detailId,
      editReason,
      paymentModeId,
      billNo: getFormDataString(formData, "billNo"),
      expenseCategoryId: getFormDataString(formData, "expenseCategoryId"),
      locationId: getFormDataString(formData, "locationId"),
      transactionDate: getFormDataString(formData, "transactionDate"),
      isGstApplicable: getFormDataBoolean(formData, "isGstApplicable"),
      gstNumber: getFormDataNullableString(formData, "gstNumber"),
      vendorName: getFormDataNullableString(formData, "vendorName"),
      basicAmount: getFormDataNumber(formData, "basicAmount"),
      cgstAmount: getFormDataNumber(formData, "cgstAmount"),
      sgstAmount: getFormDataNumber(formData, "sgstAmount"),
      igstAmount: getFormDataNumber(formData, "igstAmount"),
      totalAmount: getFormDataNumber(formData, "totalAmount"),
      purpose: getFormDataString(formData, "purpose"),
      productId,
      peopleInvolved: getFormDataNullableString(formData, "peopleInvolved"),
      remarks: getFormDataNullableString(formData, "remarks"),
      receiptFile,
      bankStatementFile,
    };
  }

  return {
    detailType,
    detailId,
    editReason,
    paymentModeId,
    purpose: getFormDataString(formData, "purpose"),
    requestedAmount: getFormDataNumber(formData, "requestedAmount"),
    expectedUsageDate: getFormDataString(formData, "expectedUsageDate"),
    productId,
    locationId,
    remarks: getFormDataNullableString(formData, "remarks"),
    receiptFile,
  };
}

function buildOwnEditPayload(formData: FormData): unknown {
  const detailType = getFormDataString(formData, "detailType");
  const detailId = getFormDataString(formData, "detailId");
  const productId = getFormDataNullableString(formData, "productId");
  const locationId = getFormDataNullableString(formData, "locationId");
  const receiptFileEntry = formData.get("receiptFile");
  const receiptFile =
    receiptFileEntry instanceof File && receiptFileEntry.size > 0 ? receiptFileEntry : null;
  const bankStatementFileEntry = formData.get("bankStatementFile");
  const bankStatementFile =
    bankStatementFileEntry instanceof File && bankStatementFileEntry.size > 0
      ? bankStatementFileEntry
      : null;

  if (detailType === "expense") {
    return {
      detailType,
      detailId,
      billNo: getFormDataString(formData, "billNo"),
      expenseCategoryId: getFormDataString(formData, "expenseCategoryId"),
      locationId: getFormDataString(formData, "locationId"),
      transactionDate: getFormDataString(formData, "transactionDate"),
      isGstApplicable: getFormDataBoolean(formData, "isGstApplicable"),
      gstNumber: getFormDataNullableString(formData, "gstNumber"),
      vendorName: getFormDataNullableString(formData, "vendorName"),
      basicAmount: getFormDataNumber(formData, "basicAmount"),
      cgstAmount: getFormDataNumber(formData, "cgstAmount"),
      sgstAmount: getFormDataNumber(formData, "sgstAmount"),
      igstAmount: getFormDataNumber(formData, "igstAmount"),
      totalAmount: getFormDataNumber(formData, "totalAmount"),
      purpose: getFormDataString(formData, "purpose"),
      productId,
      peopleInvolved: getFormDataNullableString(formData, "peopleInvolved"),
      remarks: getFormDataNullableString(formData, "remarks"),
      receiptFile,
      bankStatementFile,
    };
  }

  return {
    detailType,
    detailId,
    purpose: getFormDataString(formData, "purpose"),
    requestedAmount: getFormDataNumber(formData, "requestedAmount"),
    expectedUsageDate: getFormDataString(formData, "expectedUsageDate"),
    productId,
    locationId,
    remarks: getFormDataNullableString(formData, "remarks"),
    receiptFile,
  };
}

export async function updateClaimByFinanceAction(input: {
  claimId: string;
  formData: FormData;
}): Promise<{ ok: boolean; message?: string }> {
  const claimIdParse = financeEditClaimIdSchema.safeParse({ claimId: input.claimId });

  if (!claimIdParse.success) {
    return {
      ok: false,
      message: "Invalid claim identifier.",
    };
  }

  const currentUserResult = await authRepository.getCurrentUser();

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return {
      ok: false,
      message: currentUserResult.errorMessage ?? "Unauthorized session.",
    };
  }

  const [claimSnapshotResult, approvalContextResult] = await Promise.all([
    repository.getClaimForFinanceEdit(claimIdParse.data.claimId),
    repository.getApprovalViewerContext(currentUserResult.user.id),
  ]);

  if (claimSnapshotResult.errorMessage || !claimSnapshotResult.data) {
    return {
      ok: false,
      message: claimSnapshotResult.errorMessage ?? "Claim not found.",
    };
  }

  if (approvalContextResult.errorMessage) {
    return {
      ok: false,
      message: approvalContextResult.errorMessage,
    };
  }

  const canEditPaymentMode =
    claimSnapshotResult.data.status === DB_HOD_APPROVED_AWAITING_FINANCE_APPROVAL_STATUS &&
    approvalContextResult.data.isFinance;

  if (
    hasRoutingFieldMutationAttempt(input.formData, {
      allowPaymentModeMutation: canEditPaymentMode,
    })
  ) {
    return {
      ok: false,
      message: "Routing context fields cannot be edited for an existing claim.",
    };
  }

  if (
    !canActorEditClaim({
      status: claimSnapshotResult.data.status,
      actorUserId: currentUserResult.user.id,
      submittedBy: claimSnapshotResult.data.submittedBy,
      assignedL1ApproverId: claimSnapshotResult.data.assignedL1ApproverId,
      isFinanceActor: approvalContextResult.data.isFinance,
    })
  ) {
    return {
      ok: false,
      message: "You are not authorized to edit this claim.",
    };
  }

  const parseResult = financeEditSchema.safeParse(buildFinanceEditPayload(input.formData));

  if (!parseResult.success) {
    return {
      ok: false,
      message: "Validation failed for claim edit payload.",
    };
  }

  if (parseResult.data.detailType !== claimSnapshotResult.data.detailType) {
    return {
      ok: false,
      message: "Claim detail type mismatch.",
    };
  }

  if (parseResult.data.paymentModeId) {
    if (!canEditPaymentMode) {
      return {
        ok: false,
        message: "Routing context fields cannot be edited for an existing claim.",
      };
    }

    const paymentModeResult = await repository.getPaymentModeById(parseResult.data.paymentModeId);

    if (paymentModeResult.errorMessage) {
      return {
        ok: false,
        message: paymentModeResult.errorMessage,
      };
    }

    if (!paymentModeResult.data || !paymentModeResult.data.isActive) {
      return {
        ok: false,
        message: "Selected payment mode is invalid or inactive.",
      };
    }

    if (isCorporateCardPaymentModeName(paymentModeResult.data.name)) {
      return {
        ok: false,
        message: "Corporate Card is not allowed for finance-stage payment mode correction.",
      };
    }
  }

  let nextExpenseReceiptPath = claimSnapshotResult.data.expenseReceiptFilePath;
  let nextExpenseBankStatementPath = claimSnapshotResult.data.expenseBankStatementFilePath;
  let nextAdvanceDocumentPath = claimSnapshotResult.data.advanceSupportingDocumentPath;

  if (parseResult.data.receiptFile && parseResult.data.receiptFile.size > 0) {
    const receiptSizeError = validateUploadFileSize(parseResult.data.receiptFile, "Receipt file");

    if (receiptSizeError) {
      return {
        ok: false,
        message: receiptSizeError,
      };
    }

    const fileBuffer = Buffer.from(await parseResult.data.receiptFile.arrayBuffer());

    const uploadResult = await uploadClaimFile({
      folder: "expenses",
      userId: claimSnapshotResult.data.submittedBy,
      fileName: parseResult.data.receiptFile.name,
      fileType: parseResult.data.receiptFile.type || "application/octet-stream",
      fileBuffer,
    });

    if (uploadResult.errorMessage || !uploadResult.path) {
      return {
        ok: false,
        message: uploadResult.errorMessage ?? "Failed to upload replacement receipt.",
      };
    }

    const previousPath =
      parseResult.data.detailType === "expense"
        ? claimSnapshotResult.data.expenseReceiptFilePath
        : claimSnapshotResult.data.advanceSupportingDocumentPath;

    if (previousPath && previousPath !== uploadResult.path) {
      await removeClaimFile(previousPath);
    }

    if (parseResult.data.detailType === "expense") {
      nextExpenseReceiptPath = uploadResult.path;
    } else {
      nextAdvanceDocumentPath = uploadResult.path;
    }
  }

  if (
    parseResult.data.detailType === "expense" &&
    parseResult.data.bankStatementFile &&
    parseResult.data.bankStatementFile.size > 0
  ) {
    const bankStatementSizeError = validateUploadFileSize(
      parseResult.data.bankStatementFile,
      "Bank statement file",
    );

    if (bankStatementSizeError) {
      return {
        ok: false,
        message: bankStatementSizeError,
      };
    }

    const fileBuffer = Buffer.from(await parseResult.data.bankStatementFile.arrayBuffer());

    const uploadResult = await uploadClaimFile({
      folder: "expenses",
      userId: claimSnapshotResult.data.submittedBy,
      fileName: parseResult.data.bankStatementFile.name,
      fileType: parseResult.data.bankStatementFile.type || "application/octet-stream",
      fileBuffer,
    });

    if (uploadResult.errorMessage || !uploadResult.path) {
      return {
        ok: false,
        message: uploadResult.errorMessage ?? "Failed to upload replacement bank statement.",
      };
    }

    const previousBankStatementPath = claimSnapshotResult.data.expenseBankStatementFilePath;

    if (previousBankStatementPath && previousBankStatementPath !== uploadResult.path) {
      await removeClaimFile(previousBankStatementPath);
    }

    nextExpenseBankStatementPath = uploadResult.path;
  }

  let financeEditPayload: FinanceClaimEditPayload;

  if (parseResult.data.detailType === "expense") {
    financeEditPayload = {
      detailType: "expense",
      detailId: parseResult.data.detailId,
      editReason: parseResult.data.editReason,
      paymentModeId: parseResult.data.paymentModeId ?? null,
      billNo: parseResult.data.billNo,
      expenseCategoryId: parseResult.data.expenseCategoryId,
      locationId: parseResult.data.locationId,
      transactionDate: parseResult.data.transactionDate,
      isGstApplicable: parseResult.data.isGstApplicable,
      gstNumber: parseResult.data.gstNumber,
      vendorName: parseResult.data.vendorName,
      basicAmount: parseResult.data.basicAmount,
      cgstAmount: parseResult.data.cgstAmount,
      sgstAmount: parseResult.data.sgstAmount,
      igstAmount: parseResult.data.igstAmount,
      totalAmount: parseResult.data.totalAmount,
      purpose: parseResult.data.purpose,
      productId: parseResult.data.productId,
      peopleInvolved: parseResult.data.peopleInvolved,
      remarks: parseResult.data.remarks,
      receiptFilePath: nextExpenseReceiptPath,
      bankStatementFilePath: nextExpenseBankStatementPath,
    };
  } else {
    financeEditPayload = {
      detailType: "advance",
      detailId: parseResult.data.detailId,
      editReason: parseResult.data.editReason,
      paymentModeId: parseResult.data.paymentModeId ?? null,
      purpose: parseResult.data.purpose,
      requestedAmount: parseResult.data.requestedAmount,
      expectedUsageDate: parseResult.data.expectedUsageDate,
      productId: parseResult.data.productId,
      locationId: parseResult.data.locationId,
      remarks: parseResult.data.remarks,
      supportingDocumentPath: nextAdvanceDocumentPath,
    };
  }

  try {
    const result = await updateClaimByFinanceService.execute({
      claimId: claimIdParse.data.claimId,
      actorUserId: currentUserResult.user.id,
      payload: financeEditPayload,
    });

    if (!result.ok) {
      return {
        ok: false,
        message: result.errorMessage ?? "Failed to update claim details.",
      };
    }
  } catch (error) {
    if (isDuplicateExpenseBillUniqueViolation(error)) {
      let duplicateClaimId: string | null = null;

      if (approvalContextResult.data.isFinance && financeEditPayload.detailType === "expense") {
        const duplicateLookupResult =
          await repository.findActiveExpenseDuplicateClaimIdByCompositeKey({
            billNo: financeEditPayload.billNo,
            transactionDate: financeEditPayload.transactionDate,
            basicAmount: financeEditPayload.basicAmount,
            excludeClaimId: claimIdParse.data.claimId,
          });

        if (duplicateLookupResult.errorMessage) {
          logger.warn("claims.finance_edit.duplicate_lookup_failed", {
            claimId: claimIdParse.data.claimId,
            actorUserId: currentUserResult.user.id,
            errorMessage: duplicateLookupResult.errorMessage,
          });
        } else {
          duplicateClaimId = duplicateLookupResult.claimId;
        }
      }

      return {
        ok: false,
        message: buildDuplicateActiveExpenseBillMessage(duplicateClaimId),
      };
    }

    logger.error("claims.finance_edit.unhandled_exception", {
      claimId: claimIdParse.data.claimId,
      actorUserId: currentUserResult.user.id,
      errorMessage: error instanceof Error ? error.message : "Unknown finance edit error",
    });
    throw error;
  }

  revalidatePath(ROUTES.claims.myClaims);
  revalidatePath(ROUTES.claims.dashboardList);
  revalidatePath(`${ROUTES.claims.dashboardList}/${claimIdParse.data.claimId}`, "page");

  return {
    ok: true,
    message: "Claim details updated.",
  };
}

export async function updateOwnClaimAction(input: {
  claimId: string;
  formData: FormData;
}): Promise<{ ok: boolean; message?: string }> {
  const claimIdParse = financeEditClaimIdSchema.safeParse({ claimId: input.claimId });

  if (!claimIdParse.success) {
    return {
      ok: false,
      message: "Invalid claim identifier.",
    };
  }

  const currentUserResult = await authRepository.getCurrentUser();

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return {
      ok: false,
      message: currentUserResult.errorMessage ?? "Unauthorized session.",
    };
  }

  const claimSnapshotResult = await repository.getClaimForFinanceEdit(claimIdParse.data.claimId);

  if (claimSnapshotResult.errorMessage || !claimSnapshotResult.data) {
    return {
      ok: false,
      message: claimSnapshotResult.errorMessage ?? "Claim not found.",
    };
  }

  if (hasRoutingFieldMutationAttempt(input.formData, { allowPaymentModeMutation: false })) {
    return {
      ok: false,
      message: "Routing context fields cannot be edited for an existing claim.",
    };
  }

  if (
    !canActorEditClaim({
      status: claimSnapshotResult.data.status,
      actorUserId: currentUserResult.user.id,
      submittedBy: claimSnapshotResult.data.submittedBy,
      assignedL1ApproverId: claimSnapshotResult.data.assignedL1ApproverId,
      isFinanceActor: false,
    })
  ) {
    return {
      ok: false,
      message: "You are not authorized to edit this claim.",
    };
  }

  const parseResult = ownEditSchema.safeParse(buildOwnEditPayload(input.formData));

  if (!parseResult.success) {
    return {
      ok: false,
      message: "Validation failed for claim edit payload.",
    };
  }

  if (parseResult.data.detailType !== claimSnapshotResult.data.detailType) {
    return {
      ok: false,
      message: "Claim detail type mismatch.",
    };
  }

  let nextExpenseReceiptPath = claimSnapshotResult.data.expenseReceiptFilePath;
  let nextExpenseBankStatementPath = claimSnapshotResult.data.expenseBankStatementFilePath;
  let nextAdvanceDocumentPath = claimSnapshotResult.data.advanceSupportingDocumentPath;

  if (parseResult.data.receiptFile && parseResult.data.receiptFile.size > 0) {
    const receiptSizeError = validateUploadFileSize(parseResult.data.receiptFile, "Receipt file");

    if (receiptSizeError) {
      return {
        ok: false,
        message: receiptSizeError,
      };
    }

    const fileBuffer = Buffer.from(await parseResult.data.receiptFile.arrayBuffer());

    const uploadResult = await uploadClaimFile({
      folder: "expenses",
      userId: claimSnapshotResult.data.submittedBy,
      fileName: parseResult.data.receiptFile.name,
      fileType: parseResult.data.receiptFile.type || "application/octet-stream",
      fileBuffer,
    });

    if (uploadResult.errorMessage || !uploadResult.path) {
      return {
        ok: false,
        message: uploadResult.errorMessage ?? "Failed to upload replacement receipt.",
      };
    }

    const previousPath =
      parseResult.data.detailType === "expense"
        ? claimSnapshotResult.data.expenseReceiptFilePath
        : claimSnapshotResult.data.advanceSupportingDocumentPath;

    if (previousPath && previousPath !== uploadResult.path) {
      await removeClaimFile(previousPath);
    }

    if (parseResult.data.detailType === "expense") {
      nextExpenseReceiptPath = uploadResult.path;
    } else {
      nextAdvanceDocumentPath = uploadResult.path;
    }
  }

  if (
    parseResult.data.detailType === "expense" &&
    parseResult.data.bankStatementFile &&
    parseResult.data.bankStatementFile.size > 0
  ) {
    const bankStatementSizeError = validateUploadFileSize(
      parseResult.data.bankStatementFile,
      "Bank statement file",
    );

    if (bankStatementSizeError) {
      return {
        ok: false,
        message: bankStatementSizeError,
      };
    }

    const fileBuffer = Buffer.from(await parseResult.data.bankStatementFile.arrayBuffer());

    const uploadResult = await uploadClaimFile({
      folder: "expenses",
      userId: claimSnapshotResult.data.submittedBy,
      fileName: parseResult.data.bankStatementFile.name,
      fileType: parseResult.data.bankStatementFile.type || "application/octet-stream",
      fileBuffer,
    });

    if (uploadResult.errorMessage || !uploadResult.path) {
      return {
        ok: false,
        message: uploadResult.errorMessage ?? "Failed to upload replacement bank statement.",
      };
    }

    const previousBankStatementPath = claimSnapshotResult.data.expenseBankStatementFilePath;

    if (previousBankStatementPath && previousBankStatementPath !== uploadResult.path) {
      await removeClaimFile(previousBankStatementPath);
    }

    nextExpenseBankStatementPath = uploadResult.path;
  }

  let ownEditPayload: OwnClaimEditPayload;

  if (parseResult.data.detailType === "expense") {
    ownEditPayload = {
      detailType: "expense",
      detailId: parseResult.data.detailId,
      billNo: parseResult.data.billNo,
      expenseCategoryId: parseResult.data.expenseCategoryId,
      locationId: parseResult.data.locationId,
      transactionDate: parseResult.data.transactionDate,
      isGstApplicable: parseResult.data.isGstApplicable,
      gstNumber: parseResult.data.gstNumber,
      vendorName: parseResult.data.vendorName,
      basicAmount: parseResult.data.basicAmount,
      cgstAmount: parseResult.data.cgstAmount,
      sgstAmount: parseResult.data.sgstAmount,
      igstAmount: parseResult.data.igstAmount,
      totalAmount: parseResult.data.totalAmount,
      purpose: parseResult.data.purpose,
      productId: parseResult.data.productId,
      peopleInvolved: parseResult.data.peopleInvolved,
      remarks: parseResult.data.remarks,
      receiptFilePath: nextExpenseReceiptPath,
      bankStatementFilePath: nextExpenseBankStatementPath,
    };
  } else {
    ownEditPayload = {
      detailType: "advance",
      detailId: parseResult.data.detailId,
      purpose: parseResult.data.purpose,
      requestedAmount: parseResult.data.requestedAmount,
      expectedUsageDate: parseResult.data.expectedUsageDate,
      productId: parseResult.data.productId,
      locationId: parseResult.data.locationId,
      remarks: parseResult.data.remarks,
      supportingDocumentPath: nextAdvanceDocumentPath,
    };
  }

  try {
    const result = await updateOwnClaimService.execute({
      claimId: claimIdParse.data.claimId,
      actorUserId: currentUserResult.user.id,
      payload: ownEditPayload,
    });

    if (!result.ok) {
      return {
        ok: false,
        message: result.errorMessage ?? "Failed to update claim details.",
      };
    }
  } catch (error) {
    if (isDuplicateExpenseBillUniqueViolation(error)) {
      return {
        ok: false,
        message: buildDuplicateActiveExpenseBillMessage(),
      };
    }

    logger.error("claims.own_edit.unhandled_exception", {
      claimId: claimIdParse.data.claimId,
      actorUserId: currentUserResult.user.id,
      errorMessage: error instanceof Error ? error.message : "Unknown own-edit error",
    });
    throw error;
  }

  revalidatePath(ROUTES.claims.myClaims);
  revalidatePath(ROUTES.claims.dashboardList);
  revalidatePath(`${ROUTES.claims.dashboardList}/${claimIdParse.data.claimId}`, "page");

  return {
    ok: true,
    message: "Claim details updated.",
  };
}

export async function deleteClaimAction(
  claimId: string,
): Promise<{ ok: boolean; message?: string }> {
  const parseResult = claimIdSchema.safeParse(claimId);

  if (!parseResult.success) {
    return {
      ok: false,
      message: "Invalid claim delete request.",
    };
  }

  const currentUserResult = await authRepository.getCurrentUser();
  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return {
      ok: false,
      message: currentUserResult.errorMessage ?? "Unauthorized session.",
    };
  }

  const result = await deleteOwnClaimService.execute({
    claimId: parseResult.data,
    actorUserId: currentUserResult.user.id,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.errorMessage ?? "Failed to delete claim.",
    };
  }

  revalidatePath(ROUTES.claims.myClaims);
  revalidatePath(ROUTES.claims.dashboardList);
  revalidatePath(ROUTES.claims.detail(parseResult.data));

  return { ok: true };
}

async function processL1ClaimDecisionAction(input: {
  claimId: string;
  decision: "approve" | "reject";
  redirectToApprovalsView?: boolean;
  returnTo?: string;
  rejectionReason?: string;
  allowResubmission?: boolean;
}): Promise<{ ok: boolean; message?: string }> {
  const parseResult = claimDecisionSchema.safeParse({
    claimId: input.claimId,
    redirectToApprovalsView: input.redirectToApprovalsView,
    returnTo: input.returnTo,
    rejectionReason: input.rejectionReason,
    allowResubmission: input.allowResubmission,
  });

  if (!parseResult.success) {
    return {
      ok: false,
      message: "Invalid claim decision request.",
    };
  }

  const currentUserResult = await authRepository.getCurrentUser();
  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return {
      ok: false,
      message: currentUserResult.errorMessage ?? "Unauthorized session.",
    };
  }

  const result = await processL1ClaimDecisionService.execute({
    claimId: parseResult.data.claimId,
    actorUserId: currentUserResult.user.id,
    decision: input.decision,
    rejectionReason: parseResult.data.rejectionReason,
    allowResubmission: parseResult.data.allowResubmission,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.errorMessage ?? "Failed to process claim decision.",
    };
  }

  revalidatePath(ROUTES.claims.myClaims);
  revalidatePath(`${ROUTES.claims.dashboardList}/${parseResult.data.claimId}`);

  const redirectPath = resolveClaimDecisionRedirectPath({
    returnTo: parseResult.data.returnTo,
    redirectToApprovalsView: parseResult.data.redirectToApprovalsView,
  });

  if (redirectPath) {
    redirect(redirectPath);
  }

  return { ok: true };
}

async function processL2ClaimDecisionAction(input: {
  claimId: string;
  decision: "approve" | "reject" | "mark-paid";
  redirectToApprovalsView?: boolean;
  returnTo?: string;
  rejectionReason?: string;
  allowResubmission?: boolean;
}): Promise<{ ok: boolean; message?: string }> {
  const parseResult = claimDecisionSchema.safeParse({
    claimId: input.claimId,
    redirectToApprovalsView: input.redirectToApprovalsView,
    returnTo: input.returnTo,
    rejectionReason: input.rejectionReason,
    allowResubmission: input.allowResubmission,
  });

  if (!parseResult.success) {
    return {
      ok: false,
      message: "Invalid claim decision request.",
    };
  }

  const currentUserResult = await authRepository.getCurrentUser();
  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return {
      ok: false,
      message: currentUserResult.errorMessage ?? "Unauthorized session.",
    };
  }

  const result = await processL2ClaimDecisionService.execute({
    claimId: parseResult.data.claimId,
    actorUserId: currentUserResult.user.id,
    decision: input.decision,
    rejectionReason: parseResult.data.rejectionReason,
    allowResubmission: parseResult.data.allowResubmission,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.errorMessage ?? "Failed to process claim decision.",
    };
  }

  revalidatePath(ROUTES.claims.myClaims);
  revalidatePath(`${ROUTES.claims.dashboardList}/${parseResult.data.claimId}`);

  const redirectPath = resolveClaimDecisionRedirectPath({
    returnTo: parseResult.data.returnTo,
    redirectToApprovalsView: parseResult.data.redirectToApprovalsView,
  });

  if (redirectPath) {
    redirect(redirectPath);
  }

  return { ok: true };
}

export async function approveClaimAction(input: {
  claimId: string;
  redirectToApprovalsView?: boolean;
  returnTo?: string;
}): Promise<{ ok: boolean; message?: string }> {
  return processL1ClaimDecisionAction({
    claimId: input.claimId,
    decision: "approve",
    redirectToApprovalsView: input.redirectToApprovalsView,
    returnTo: input.returnTo,
  });
}

export async function rejectClaimAction(input: {
  claimId: string;
  redirectToApprovalsView?: boolean;
  returnTo?: string;
  rejectionReason: string;
  allowResubmission: boolean;
}): Promise<{ ok: boolean; message?: string }> {
  return processL1ClaimDecisionAction({
    claimId: input.claimId,
    decision: "reject",
    redirectToApprovalsView: input.redirectToApprovalsView,
    returnTo: input.returnTo,
    rejectionReason: input.rejectionReason,
    allowResubmission: input.allowResubmission,
  });
}

export async function approveFinanceAction(input: {
  claimId: string;
  redirectToApprovalsView?: boolean;
  returnTo?: string;
}): Promise<{ ok: boolean; message?: string }> {
  return processL2ClaimDecisionAction({
    claimId: input.claimId,
    decision: "approve",
    redirectToApprovalsView: input.redirectToApprovalsView,
    returnTo: input.returnTo,
  });
}

export async function rejectFinanceAction(input: {
  claimId: string;
  redirectToApprovalsView?: boolean;
  returnTo?: string;
  rejectionReason: string;
  allowResubmission: boolean;
}): Promise<{ ok: boolean; message?: string }> {
  return processL2ClaimDecisionAction({
    claimId: input.claimId,
    decision: "reject",
    redirectToApprovalsView: input.redirectToApprovalsView,
    returnTo: input.returnTo,
    rejectionReason: input.rejectionReason,
    allowResubmission: input.allowResubmission,
  });
}

export async function markPaymentDoneAction(input: {
  claimId: string;
  redirectToApprovalsView?: boolean;
  returnTo?: string;
}): Promise<{ ok: boolean; message?: string }> {
  return processL2ClaimDecisionAction({
    claimId: input.claimId,
    decision: "mark-paid",
    redirectToApprovalsView: input.redirectToApprovalsView,
    returnTo: input.returnTo,
  });
}

function normalizeClaimIds(claimIds: string[]): string[] {
  return Array.from(new Set(claimIds.map((claimId) => claimId.trim()).filter(Boolean)));
}

async function collectGlobalL1ClaimIds(
  actorUserId: string,
  filters?: GetMyClaimsFilters,
): Promise<{ data: string[]; errorMessage: string | null }> {
  const collectedIds: string[] = [];
  let cursor: string | null = null;

  while (true) {
    const pageResult = await repository.getPendingApprovalsForL1(
      actorUserId,
      cursor,
      BULK_L1_CURSOR_PAGE_SIZE,
      filters,
    );

    if (pageResult.errorMessage) {
      return { data: [], errorMessage: pageResult.errorMessage };
    }

    collectedIds.push(...pageResult.data.map((claim) => claim.id));

    if (!pageResult.hasNextPage || !pageResult.nextCursor) {
      break;
    }

    cursor = pageResult.nextCursor;
  }

  return {
    data: normalizeClaimIds(collectedIds),
    errorMessage: null,
  };
}

async function processBulkL1Decision(input: {
  actorUserId: string;
  claimIds: string[];
  decision: "approve" | "reject";
  rejectionReason?: string;
  allowResubmission?: boolean;
}): Promise<{ processedCount: number; failedCount: number; firstFailureMessage: string | null }> {
  let processedCount = 0;
  let failedCount = 0;
  let firstFailureMessage: string | null = null;

  for (let offset = 0; offset < input.claimIds.length; offset += BULK_L1_PROCESS_CHUNK_SIZE) {
    const chunkClaimIds = input.claimIds.slice(offset, offset + BULK_L1_PROCESS_CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunkClaimIds.map((claimId) =>
        processL1ClaimDecisionService.execute({
          claimId,
          actorUserId: input.actorUserId,
          decision: input.decision,
          rejectionReason: input.rejectionReason,
          allowResubmission: input.allowResubmission,
        }),
      ),
    );

    chunkResults.forEach((result, index) => {
      if (result.ok) {
        processedCount += 1;
        return;
      }

      failedCount += 1;
      firstFailureMessage ??=
        result.errorMessage ?? "Unable to process one or more selected claims.";

      logger.warn("claims.bulk_l1_decision.claim_skipped", {
        claimId: chunkClaimIds[index],
        decision: input.decision,
        reason: result.errorMessage ?? "unknown",
      });
    });
  }

  return { processedCount, failedCount, firstFailureMessage };
}

export async function bulkApproveL1(input: {
  claimIds: string[];
  isGlobalSelect: boolean;
  filters?: GetMyClaimsFilters;
}): Promise<{ ok: boolean; message: string; processedCount: number }> {
  const parseResult = bulkActionInputSchema.safeParse(input);
  if (!parseResult.success) {
    return { ok: false, message: "Invalid bulk approve request.", processedCount: 0 };
  }

  const currentUserResult = await authRepository.getCurrentUser();
  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return {
      ok: false,
      message: currentUserResult.errorMessage ?? "Unauthorized session.",
      processedCount: 0,
    };
  }

  const claimIdsResult = parseResult.data.isGlobalSelect
    ? await collectGlobalL1ClaimIds(currentUserResult.user.id, parseResult.data.filters)
    : {
        data: normalizeClaimIds(parseResult.data.claimIds),
        errorMessage: null,
      };

  if (claimIdsResult.errorMessage) {
    return {
      ok: false,
      message: claimIdsResult.errorMessage,
      processedCount: 0,
    };
  }

  if (claimIdsResult.data.length === 0) {
    return {
      ok: false,
      message: "No actionable claims selected.",
      processedCount: 0,
    };
  }

  const decisionResult = await processBulkL1Decision({
    actorUserId: currentUserResult.user.id,
    claimIds: claimIdsResult.data,
    decision: "approve",
  });

  if (decisionResult.processedCount === 0) {
    return {
      ok: false,
      message:
        decisionResult.firstFailureMessage ??
        "No claims were approved. They may already be processed or unavailable.",
      processedCount: 0,
    };
  }

  revalidatePath(ROUTES.claims.myClaims);

  return {
    ok: true,
    message:
      decisionResult.failedCount > 0
        ? `${decisionResult.processedCount} claim(s) approved. ${decisionResult.failedCount} claim(s) skipped.`
        : `${decisionResult.processedCount} claim(s) approved.`,
    processedCount: decisionResult.processedCount,
  };
}

export async function bulkRejectL1(input: {
  claimIds: string[];
  isGlobalSelect: boolean;
  filters?: GetMyClaimsFilters;
  rejectionReason: string;
  allowResubmission?: boolean;
}): Promise<{ ok: boolean; message: string; processedCount: number }> {
  const parseResult = bulkRejectInputSchema.safeParse(input);
  if (!parseResult.success) {
    return { ok: false, message: "Invalid bulk reject request.", processedCount: 0 };
  }

  const currentUserResult = await authRepository.getCurrentUser();
  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return {
      ok: false,
      message: currentUserResult.errorMessage ?? "Unauthorized session.",
      processedCount: 0,
    };
  }

  const claimIdsResult = parseResult.data.isGlobalSelect
    ? await collectGlobalL1ClaimIds(currentUserResult.user.id, parseResult.data.filters)
    : {
        data: normalizeClaimIds(parseResult.data.claimIds),
        errorMessage: null,
      };

  if (claimIdsResult.errorMessage) {
    return {
      ok: false,
      message: claimIdsResult.errorMessage,
      processedCount: 0,
    };
  }

  if (claimIdsResult.data.length === 0) {
    return {
      ok: false,
      message: "No actionable claims selected.",
      processedCount: 0,
    };
  }

  const decisionResult = await processBulkL1Decision({
    actorUserId: currentUserResult.user.id,
    claimIds: claimIdsResult.data,
    decision: "reject",
    rejectionReason: parseResult.data.rejectionReason,
    allowResubmission: parseResult.data.allowResubmission === true,
  });

  if (decisionResult.processedCount === 0) {
    return {
      ok: false,
      message:
        decisionResult.firstFailureMessage ??
        "No claims were rejected. They may already be processed or unavailable.",
      processedCount: 0,
    };
  }

  revalidatePath(ROUTES.claims.myClaims);

  return {
    ok: true,
    message:
      decisionResult.failedCount > 0
        ? `${decisionResult.processedCount} claim(s) rejected. ${decisionResult.failedCount} claim(s) skipped.`
        : `${decisionResult.processedCount} claim(s) rejected.`,
    processedCount: decisionResult.processedCount,
  };
}

export async function bulkApprove(input: {
  claimIds: string[];
  isGlobalSelect: boolean;
  filters?: GetMyClaimsFilters;
}): Promise<{ ok: boolean; message: string; processedCount: number }> {
  const parseResult = bulkActionInputSchema.safeParse(input);
  if (!parseResult.success) {
    return { ok: false, message: "Invalid bulk approve request.", processedCount: 0 };
  }

  const currentUserResult = await authRepository.getCurrentUser();
  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return {
      ok: false,
      message: currentUserResult.errorMessage ?? "Unauthorized session.",
      processedCount: 0,
    };
  }

  const result = await bulkProcessClaimsService.execute({
    actorUserId: currentUserResult.user.id,
    action: "L2_APPROVE",
    claimIds: parseResult.data.claimIds,
    isGlobalSelect: parseResult.data.isGlobalSelect,
    filters: parseResult.data.filters,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.errorMessage ?? "Failed to bulk approve claims.",
      processedCount: 0,
    };
  }

  revalidatePath(ROUTES.claims.myClaims);

  return {
    ok: true,
    message: `${result.processedCount} claim(s) approved.`,
    processedCount: result.processedCount,
  };
}

export async function bulkReject(input: {
  claimIds: string[];
  isGlobalSelect: boolean;
  filters?: GetMyClaimsFilters;
  rejectionReason: string;
  allowResubmission?: boolean;
}): Promise<{ ok: boolean; message: string; processedCount: number }> {
  const parseResult = bulkRejectInputSchema.safeParse(input);
  if (!parseResult.success) {
    return { ok: false, message: "Invalid bulk reject request.", processedCount: 0 };
  }

  const currentUserResult = await authRepository.getCurrentUser();
  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return {
      ok: false,
      message: currentUserResult.errorMessage ?? "Unauthorized session.",
      processedCount: 0,
    };
  }

  const result = await bulkProcessClaimsService.execute({
    actorUserId: currentUserResult.user.id,
    action: "L2_REJECT",
    claimIds: parseResult.data.claimIds,
    isGlobalSelect: parseResult.data.isGlobalSelect,
    filters: parseResult.data.filters,
    reason: parseResult.data.rejectionReason,
    allowResubmission: parseResult.data.allowResubmission === true,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.errorMessage ?? "Failed to bulk reject claims.",
      processedCount: 0,
    };
  }

  revalidatePath(ROUTES.claims.myClaims);

  return {
    ok: true,
    message: `${result.processedCount} claim(s) rejected.`,
    processedCount: result.processedCount,
  };
}

export async function bulkMarkPaid(input: {
  claimIds: string[];
  isGlobalSelect: boolean;
  filters?: GetMyClaimsFilters;
}): Promise<{ ok: boolean; message: string; processedCount: number }> {
  const parseResult = bulkActionInputSchema.safeParse(input);
  if (!parseResult.success) {
    return { ok: false, message: "Invalid bulk mark-paid request.", processedCount: 0 };
  }

  const currentUserResult = await authRepository.getCurrentUser();
  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return {
      ok: false,
      message: currentUserResult.errorMessage ?? "Unauthorized session.",
      processedCount: 0,
    };
  }

  const result = await bulkProcessClaimsService.execute({
    actorUserId: currentUserResult.user.id,
    action: "MARK_PAID",
    claimIds: parseResult.data.claimIds,
    isGlobalSelect: parseResult.data.isGlobalSelect,
    filters: parseResult.data.filters,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.errorMessage ?? "Failed to bulk mark claims as paid.",
      processedCount: 0,
    };
  }

  revalidatePath(ROUTES.claims.myClaims);

  return {
    ok: true,
    message: `${result.processedCount} claim(s) marked as paid.`,
    processedCount: result.processedCount,
  };
}
