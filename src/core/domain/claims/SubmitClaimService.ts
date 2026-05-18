import { randomUUID } from "node:crypto";

import type {
  ClaimDetailType,
  ClaimDomainLogger,
  ClaimRepository,
  PreparedClaimSubmission,
  ClaimSubmissionInput,
} from "@/core/domain/claims/contracts";
import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";

type SubmitClaimServiceDependencies = {
  repository: ClaimRepository;
  logger: ClaimDomainLogger;
};

const EXPENSE_MODE_NAMES = new Set([
  "reimbursement",
  "corporate card",
  "happay",
  "forex",
  "petty cash",
]);
const ADVANCE_MODE_NAMES = new Set(["petty cash request", "bulk petty cash request"]);
const EMPLOYEE_ADVANCE_PAYMENT_MODE_NAME = "petty cash request";

class ClaimIntegrityError extends Error {
  readonly code: string;

  constructor(message: string, code = "DATA_INTEGRITY_FAILURE") {
    super(message);
    this.name = "ClaimIntegrityError";
    this.code = code;
  }
}

function assertNonNegativeMoney(value: number, field: string): void {
  if (value < 0) {
    throw new ClaimIntegrityError(`Data integrity failure: Negative monetary value in ${field}`);
  }
}

function calculateExpenseTotalAmount(input: {
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

function validateExpenseIntegrity(input: ClaimSubmissionInput): void {
  if (!input.expense) {
    throw new ClaimIntegrityError("Data integrity failure: Missing expense payload");
  }

  assertNonNegativeMoney(input.expense.basicAmount, "expense.basic_amount");
  assertNonNegativeMoney(input.expense.cgstAmount, "expense.cgst_amount");
  assertNonNegativeMoney(input.expense.sgstAmount, "expense.sgst_amount");
  assertNonNegativeMoney(input.expense.igstAmount, "expense.igst_amount");
}

function validateAdvanceIntegrity(input: ClaimSubmissionInput): void {
  if (!input.advance) {
    throw new ClaimIntegrityError("Data integrity failure: Missing advance payload");
  }

  assertNonNegativeMoney(input.advance.totalAmount, "advance.total_amount");
}

function normalizeModeName(name: string): string {
  return name.trim().toLowerCase();
}

function resolveExpectedDetailType(paymentModeName: string): ClaimDetailType | null {
  const normalized = normalizeModeName(paymentModeName);

  if (EXPENSE_MODE_NAMES.has(normalized)) {
    return "expense";
  }

  if (ADVANCE_MODE_NAMES.has(normalized)) {
    return "advance";
  }

  return null;
}

function formatClaimDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function sanitizeEmployeeId(employeeId: string): string {
  const normalized = employeeId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return normalized.length > 0 ? normalized : "UNKNOWN";
}

function resolveClaimIdEmployeeSegment(
  input: Pick<ClaimSubmissionInput, "submissionType" | "employeeId" | "onBehalfEmployeeCode">,
): string {
  if (input.submissionType === "On Behalf" && input.onBehalfEmployeeCode) {
    return input.onBehalfEmployeeCode;
  }

  return input.employeeId;
}

function generateClaimId(employeeId: string, paymentModeName: string): string {
  const datePart = formatClaimDate(new Date());
  const employeePart = sanitizeEmployeeId(employeeId);
  const suffix = randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase();
  const normalizedModeName = normalizeModeName(paymentModeName);
  const prefix = normalizedModeName === EMPLOYEE_ADVANCE_PAYMENT_MODE_NAME ? "EA" : "CLAIM";
  return `${prefix}-${employeePart}-${datePart}-${suffix}`;
}

export class SubmitClaimService {
  private readonly repository: ClaimRepository;
  private readonly logger: ClaimDomainLogger;

  constructor(deps: SubmitClaimServiceDependencies) {
    this.repository = deps.repository;
    this.logger = deps.logger;
  }

  async prepareSubmission(input: ClaimSubmissionInput): Promise<{
    preparedSubmission: PreparedClaimSubmission | null;
    errorCode: string | null;
    errorMessage: string | null;
  }> {
    try {
      if (
        input.submissionType === "On Behalf" &&
        (!input.onBehalfEmail || !input.onBehalfEmployeeCode)
      ) {
        return {
          preparedSubmission: null,
          errorCode: "ON_BEHALF_DETAILS_REQUIRED",
          errorMessage: "On Behalf submissions require both email and employee ID.",
        };
      }

      if (input.detailType === "expense") {
        validateExpenseIntegrity(input);
      }

      if (input.detailType === "advance") {
        validateAdvanceIntegrity(input);
      }

      const paymentModeResult = await this.repository.getPaymentModeById(input.paymentModeId);
      if (
        paymentModeResult.errorMessage ||
        !paymentModeResult.data ||
        !paymentModeResult.data.isActive
      ) {
        return {
          preparedSubmission: null,
          errorCode: "INVALID_PAYMENT_MODE",
          errorMessage: paymentModeResult.errorMessage ?? "Payment mode not found or inactive.",
        };
      }

      const expectedDetailType = resolveExpectedDetailType(paymentModeResult.data.name);
      if (!expectedDetailType) {
        return {
          preparedSubmission: null,
          errorCode: "PAYMENT_MODE_NOT_SUPPORTED",
          errorMessage: `Payment mode ${paymentModeResult.data.name} is not supported in claim submission.`,
        };
      }

      if (expectedDetailType !== input.detailType) {
        throw new ClaimIntegrityError(
          "Data integrity failure: Payment mode and claim detail type mismatch",
          "DETAIL_TYPE_MISMATCH",
        );
      }

      const beneficiaryResolutionResult = await this.resolveEffectiveUserId(input);
      if (beneficiaryResolutionResult.errorCode || !beneficiaryResolutionResult.effectiveUserId) {
        return {
          preparedSubmission: null,
          errorCode: beneficiaryResolutionResult.errorCode ?? "BENEFICIARY_RESOLUTION_FAILED",
          errorMessage:
            beneficiaryResolutionResult.errorMessage ?? "Failed to resolve the beneficiary user.",
        };
      }

      const actualBeneficiaryId = beneficiaryResolutionResult.effectiveUserId;

      const departmentApproversResult = await this.repository.getDepartmentApprovers(
        input.departmentId,
      );
      if (departmentApproversResult.errorMessage) {
        return {
          preparedSubmission: null,
          errorCode: "DEPARTMENT_ROUTING_RESOLUTION_FAILED",
          errorMessage: departmentApproversResult.errorMessage,
        };
      }

      if (!departmentApproversResult.data) {
        return {
          preparedSubmission: null,
          errorCode: "DEPARTMENT_ROUTING_MISSING",
          errorMessage: "Department approver routing is not configured.",
        };
      }

      const departmentApprover1Id = departmentApproversResult.data.approver1Id;
      const departmentApprover2Id = departmentApproversResult.data.approver2Id;
      const isBeneficiaryDepartmentApprover1 = actualBeneficiaryId === departmentApprover1Id;
      const isBeneficiaryDepartmentApprover2 = actualBeneficiaryId === departmentApprover2Id;

      // Check if beneficiary is a HOD (approver1) in any department (including cross-department)
      let isBeneficiaryApprover1InAnyDept = isBeneficiaryDepartmentApprover1;
      if (!isBeneficiaryApprover1InAnyDept && input.submissionType === "On Behalf") {
        const approver1CheckResult =
          await this.repository.isUserApprover1InAnyDepartment(actualBeneficiaryId);
        if (!approver1CheckResult.errorMessage && approver1CheckResult.isApprover1) {
          isBeneficiaryApprover1InAnyDept = true;
        }
      }

      // Route to approver 2 if beneficiary is an HOD in any department OR if beneficiary is approver 2
      const assignedL1ApproverId =
        isBeneficiaryApprover1InAnyDept || isBeneficiaryDepartmentApprover2
          ? departmentApprover2Id
          : departmentApprover1Id;

      if (!assignedL1ApproverId) {
        return {
          preparedSubmission: null,
          errorCode: "DEPARTMENT_ROUTING_MISSING",
          errorMessage:
            isBeneficiaryApprover1InAnyDept || isBeneficiaryDepartmentApprover2
              ? "Escalation approver (Founder) is not configured for this department."
              : "Department approver routing is not configured.",
        };
      }

      const claimId = generateClaimId(
        resolveClaimIdEmployeeSegment(input),
        paymentModeResult.data.name,
      );
      const expenseRequestedTotalAmount =
        input.detailType === "expense" && input.expense
          ? calculateExpenseTotalAmount({
              basicAmount: input.expense.basicAmount,
              cgstAmount: input.expense.cgstAmount,
              sgstAmount: input.expense.sgstAmount,
              igstAmount: input.expense.igstAmount,
            })
          : null;

      return {
        preparedSubmission: {
          claim: {
            id: claimId,
            status: DB_CLAIM_STATUSES[0],
            submissionType: input.submissionType,
            detailType: input.detailType,
            submittedBy: input.submittedBy,
            onBehalfOfId: actualBeneficiaryId,
            employeeId: input.employeeId,
            ccEmails: input.ccEmails,
            onBehalfEmail: input.onBehalfEmail,
            onBehalfEmployeeCode: input.onBehalfEmployeeCode,
            departmentId: input.departmentId,
            paymentModeId: input.paymentModeId,
            assignedL1ApproverId,
            assignedL2ApproverId: input.assignedL2ApproverId,
          },
          expense:
            input.detailType === "expense" && input.expense
              ? {
                  claimId,
                  billNo: input.expense.billNo,
                  transactionId: input.expense.transactionId,
                  purpose: input.expense.purpose,
                  expenseCategoryId: input.expense.expenseCategoryId,
                  productId: input.expense.productId,
                  locationId: input.expense.locationId,
                  locationType: input.expense.locationType,
                  locationDetails: input.expense.locationDetails,
                  isGstApplicable: input.expense.isGstApplicable,
                  gstNumber: input.expense.gstNumber,
                  cgstAmount: input.expense.cgstAmount,
                  sgstAmount: input.expense.sgstAmount,
                  igstAmount: input.expense.igstAmount,
                  transactionDate: input.expense.transactionDate,
                  basicAmount: input.expense.basicAmount,
                  totalAmount: expenseRequestedTotalAmount ?? 0,
                  currencyCode: input.expense.currencyCode,
                  vendorName: input.expense.vendorName,
                  receiptFilePath: input.expense.receiptFilePath,
                  bankStatementFilePath: input.expense.bankStatementFilePath,
                  peopleInvolved: input.expense.peopleInvolved,
                  remarks: input.expense.remarks,
                  aiMetadata: input.expense.aiMetadata,
                }
              : undefined,
          advance:
            input.detailType === "advance" && input.advance
              ? {
                  claimId,
                  totalAmount: input.advance.totalAmount,
                  budgetMonth: input.advance.budgetMonth,
                  budgetYear: input.advance.budgetYear,
                  expectedUsageDate: input.advance.expectedUsageDate,
                  purpose: input.advance.purpose,
                  supportingDocumentPath: input.advance.supportingDocumentPath,
                  productId: input.advance.productId,
                  locationId: input.advance.locationId,
                  remarks: input.advance.remarks,
                }
              : undefined,
        },
        errorCode: null,
        errorMessage: null,
      };
    } catch (error) {
      if (error instanceof ClaimIntegrityError) {
        this.logger.warn("claims.submit.integrity_failed", {
          submittedBy: input.submittedBy,
          detailType: input.detailType,
          errorCode: error.code,
          errorMessage: error.message,
        });

        return {
          preparedSubmission: null,
          errorCode: error.code,
          errorMessage: error.message,
        };
      }

      throw error;
    }
  }

  async execute(input: ClaimSubmissionInput): Promise<{
    claimId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  }> {
    const preparedResult = await this.prepareSubmission(input);
    if (preparedResult.errorCode || !preparedResult.preparedSubmission) {
      return {
        claimId: null,
        errorCode: preparedResult.errorCode,
        errorMessage: preparedResult.errorMessage,
      };
    }

    const createResult = await this.repository.createClaimWithDetail(
      this.buildCreateClaimPayload(preparedResult.preparedSubmission),
    );
    if (createResult.errorMessage || !createResult.claimId) {
      this.logger.error("claims.submit.failed", {
        paymentModeId: input.paymentModeId,
        detailType: input.detailType,
        errorMessage: createResult.errorMessage,
      });

      return {
        claimId: null,
        errorCode: "CLAIM_SUBMISSION_FAILED",
        errorMessage: createResult.errorMessage ?? "Failed to submit claim.",
      };
    }

    this.logger.info("claims.submit.success", {
      claimId: createResult.claimId,
      submittedBy: input.submittedBy,
      detailType: input.detailType,
    });

    return {
      claimId: createResult.claimId,
      errorCode: null,
      errorMessage: null,
    };
  }

  private buildCreateClaimPayload(
    preparedSubmission: PreparedClaimSubmission,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      claim_id: preparedSubmission.claim.id,
      initial_status: preparedSubmission.claim.status,
      submission_type: preparedSubmission.claim.submissionType,
      detail_type: preparedSubmission.claim.detailType,
      submitted_by: preparedSubmission.claim.submittedBy,
      on_behalf_of_id: preparedSubmission.claim.onBehalfOfId,
      employee_id: preparedSubmission.claim.employeeId,
      cc_emails: preparedSubmission.claim.ccEmails,
      on_behalf_email: preparedSubmission.claim.onBehalfEmail,
      on_behalf_employee_code: preparedSubmission.claim.onBehalfEmployeeCode,
      department_id: preparedSubmission.claim.departmentId,
      payment_mode_id: preparedSubmission.claim.paymentModeId,
      assigned_l1_approver_id: preparedSubmission.claim.assignedL1ApproverId,
      assigned_l2_approver_id: preparedSubmission.claim.assignedL2ApproverId,
    };

    if (preparedSubmission.expense) {
      payload.expense = {
        bill_no: preparedSubmission.expense.billNo,
        transaction_id: preparedSubmission.expense.transactionId,
        purpose: preparedSubmission.expense.purpose,
        expense_category_id: preparedSubmission.expense.expenseCategoryId,
        product_id: preparedSubmission.expense.productId,
        location_id: preparedSubmission.expense.locationId,
        location_type: preparedSubmission.expense.locationType,
        location_details: preparedSubmission.expense.locationDetails,
        is_gst_applicable: preparedSubmission.expense.isGstApplicable,
        gst_number: preparedSubmission.expense.gstNumber,
        cgst_amount: preparedSubmission.expense.cgstAmount,
        sgst_amount: preparedSubmission.expense.sgstAmount,
        igst_amount: preparedSubmission.expense.igstAmount,
        transaction_date: preparedSubmission.expense.transactionDate,
        basic_amount: preparedSubmission.expense.basicAmount,
        total_amount: preparedSubmission.expense.totalAmount,
        currency_code: preparedSubmission.expense.currencyCode,
        vendor_name: preparedSubmission.expense.vendorName,
        receipt_file_path: preparedSubmission.expense.receiptFilePath,
        bank_statement_file_path: preparedSubmission.expense.bankStatementFilePath,
        people_involved: preparedSubmission.expense.peopleInvolved,
        remarks: preparedSubmission.expense.remarks,
        ai_metadata: preparedSubmission.expense.aiMetadata,
      };
    }

    if (preparedSubmission.advance) {
      payload.advance = {
        total_amount: preparedSubmission.advance.totalAmount,
        budget_month: preparedSubmission.advance.budgetMonth,
        budget_year: preparedSubmission.advance.budgetYear,
        expected_usage_date: preparedSubmission.advance.expectedUsageDate,
        purpose: preparedSubmission.advance.purpose,
        supporting_document_path: preparedSubmission.advance.supportingDocumentPath,
        product_id: preparedSubmission.advance.productId,
        location_id: preparedSubmission.advance.locationId,
        remarks: preparedSubmission.advance.remarks,
      };
    }

    return payload;
  }

  private async resolveEffectiveUserId(input: ClaimSubmissionInput): Promise<{
    effectiveUserId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  }> {
    if (input.onBehalfOfId) {
      return {
        effectiveUserId: input.onBehalfOfId,
        errorCode: null,
        errorMessage: null,
      };
    }

    if (input.submissionType === "Self") {
      return {
        effectiveUserId: input.submittedBy,
        errorCode: null,
        errorMessage: null,
      };
    }

    if (!input.onBehalfEmail) {
      return {
        effectiveUserId: null,
        errorCode: "ON_BEHALF_DETAILS_REQUIRED",
        errorMessage: "On Behalf submissions require both email and employee ID.",
      };
    }

    const beneficiaryResult = await this.repository.getActiveUserIdByEmail(input.onBehalfEmail);
    if (beneficiaryResult.errorMessage) {
      return {
        effectiveUserId: null,
        errorCode: "BENEFICIARY_RESOLUTION_FAILED",
        errorMessage: beneficiaryResult.errorMessage,
      };
    }

    if (!beneficiaryResult.data) {
      return {
        effectiveUserId: null,
        errorCode: "BENEFICIARY_RESOLUTION_FAILED",
        errorMessage: "Unable to resolve or provision on-behalf beneficiary.",
      };
    }

    return {
      effectiveUserId: beneficiaryResult.data,
      errorCode: null,
      errorMessage: null,
    };
  }
}
