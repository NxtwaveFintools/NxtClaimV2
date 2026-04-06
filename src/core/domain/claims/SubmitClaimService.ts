import { randomUUID } from "node:crypto";

import type {
  ClaimDetailType,
  ClaimDomainLogger,
  ClaimRepository,
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

  assertNonNegativeMoney(input.advance.requestedAmount, "advance.requested_amount");
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

function generateClaimId(employeeId: string): string {
  const datePart = formatClaimDate(new Date());
  const employeePart = sanitizeEmployeeId(employeeId);
  const suffix = randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase();
  return `CLAIM-${employeePart}-${datePart}-${suffix}`;
}

export class SubmitClaimService {
  private readonly repository: ClaimRepository;
  private readonly logger: ClaimDomainLogger;

  constructor(deps: SubmitClaimServiceDependencies) {
    this.repository = deps.repository;
    this.logger = deps.logger;
  }

  async execute(input: ClaimSubmissionInput): Promise<{
    claimId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  }> {
    try {
      if (
        input.submissionType === "On Behalf" &&
        (!input.onBehalfEmail || !input.onBehalfEmployeeCode)
      ) {
        return {
          claimId: null,
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
          claimId: null,
          errorCode: "INVALID_PAYMENT_MODE",
          errorMessage: paymentModeResult.errorMessage ?? "Payment mode not found or inactive.",
        };
      }

      const expectedDetailType = resolveExpectedDetailType(paymentModeResult.data.name);
      if (!expectedDetailType) {
        return {
          claimId: null,
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

      const effectiveUserIdResult = await this.resolveEffectiveUserId(input);
      if (effectiveUserIdResult.errorCode || !effectiveUserIdResult.effectiveUserId) {
        return {
          claimId: null,
          errorCode: effectiveUserIdResult.errorCode ?? "BENEFICIARY_RESOLUTION_FAILED",
          errorMessage:
            effectiveUserIdResult.errorMessage ?? "Failed to resolve the beneficiary user.",
        };
      }

      const effectiveUserId = effectiveUserIdResult.effectiveUserId;
      const isProxySubmission = input.submittedBy !== effectiveUserId;

      const departmentApproversResult = await this.repository.getDepartmentApprovers(
        input.departmentId,
      );
      if (departmentApproversResult.errorMessage) {
        return {
          claimId: null,
          errorCode: "DEPARTMENT_ROUTING_RESOLUTION_FAILED",
          errorMessage: departmentApproversResult.errorMessage,
        };
      }

      if (!departmentApproversResult.data) {
        return {
          claimId: null,
          errorCode: "DEPARTMENT_ROUTING_MISSING",
          errorMessage: "Department approver routing is not configured.",
        };
      }

      const beneficiaryRoleResult =
        await this.repository.isUserApprover1InAnyDepartment(effectiveUserId);
      if (beneficiaryRoleResult.errorMessage) {
        return {
          claimId: null,
          errorCode: "DEPARTMENT_ROUTING_RESOLUTION_FAILED",
          errorMessage: beneficiaryRoleResult.errorMessage,
        };
      }

      const isBeneficiaryAnHod = beneficiaryRoleResult.isApprover1;
      const departmentApprover1Id = departmentApproversResult.data.approver1Id;
      const departmentApprover2Id = departmentApproversResult.data.approver2Id;
      const isBeneficiaryDepartmentApprover1 = effectiveUserId === departmentApprover1Id;
      const isBeneficiaryDepartmentApprover2 = effectiveUserId === departmentApprover2Id;

      // Beneficiary-centric routing:
      // - Proxy for department approver_1 routes to approver_1 for self-approval review.
      // - Proxy for department approver_2 routes to approver_2 (senior approver path).
      // - Self submission by any HOD/approver_1 leapfrogs to approver_2.
      // - All other submissions route to approver_1.
      const isGlobalHodSelfSubmission = isBeneficiaryAnHod && !isProxySubmission;

      const assignedL1ApproverId = isProxySubmission
        ? isBeneficiaryDepartmentApprover1
          ? effectiveUserId
          : isBeneficiaryDepartmentApprover2
            ? departmentApprover2Id
            : departmentApprover1Id
        : isGlobalHodSelfSubmission
          ? departmentApprover2Id
          : departmentApprover1Id;

      if (!assignedL1ApproverId) {
        return {
          claimId: null,
          errorCode: "DEPARTMENT_ROUTING_MISSING",
          errorMessage: isGlobalHodSelfSubmission
            ? "Escalation approver is not configured for this department."
            : "Department approver routing is not configured.",
        };
      }

      const claimId = generateClaimId(input.employeeId);

      const payload: Record<string, unknown> = {
        claim_id: claimId,
        // Status integrity: leapfrog changes assignee, never status. Finance visibility remains gated.
        initial_status: DB_CLAIM_STATUSES[0],
        submission_type: input.submissionType,
        detail_type: input.detailType,
        submitted_by: input.submittedBy,
        on_behalf_of_id: effectiveUserId,
        employee_id: input.employeeId,
        cc_emails: input.ccEmails,
        on_behalf_email: input.onBehalfEmail,
        on_behalf_employee_code: input.onBehalfEmployeeCode,
        department_id: input.departmentId,
        payment_mode_id: input.paymentModeId,
        assigned_l1_approver_id: assignedL1ApproverId,
        assigned_l2_approver_id: input.assignedL2ApproverId,
      };

      if (input.detailType === "expense" && input.expense) {
        payload.expense = {
          bill_no: input.expense.billNo,
          transaction_id: input.expense.transactionId,
          purpose: input.expense.purpose,
          expense_category_id: input.expense.expenseCategoryId,
          product_id: input.expense.productId,
          location_id: input.expense.locationId,
          location_type: input.expense.locationType,
          location_details: input.expense.locationDetails,
          is_gst_applicable: input.expense.isGstApplicable,
          gst_number: input.expense.gstNumber,
          cgst_amount: input.expense.cgstAmount,
          sgst_amount: input.expense.sgstAmount,
          igst_amount: input.expense.igstAmount,
          transaction_date: input.expense.transactionDate,
          basic_amount: input.expense.basicAmount,
          currency_code: input.expense.currencyCode,
          vendor_name: input.expense.vendorName,
          receipt_file_path: input.expense.receiptFilePath,
          bank_statement_file_path: input.expense.bankStatementFilePath,
          people_involved: input.expense.peopleInvolved,
          remarks: input.expense.remarks,
        };
      }

      if (input.detailType === "advance" && input.advance) {
        payload.advance = {
          requested_amount: input.advance.requestedAmount,
          budget_month: input.advance.budgetMonth,
          budget_year: input.advance.budgetYear,
          expected_usage_date: input.advance.expectedUsageDate,
          purpose: input.advance.purpose,
          supporting_document_path: input.advance.supportingDocumentPath,
          product_id: input.advance.productId,
          location_id: input.advance.locationId,
          remarks: input.advance.remarks,
        };
      }

      const createResult = await this.repository.createClaimWithDetail(payload);
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
    } catch (error) {
      if (error instanceof ClaimIntegrityError) {
        this.logger.warn("claims.submit.integrity_failed", {
          submittedBy: input.submittedBy,
          detailType: input.detailType,
          errorCode: error.code,
          errorMessage: error.message,
        });

        return {
          claimId: null,
          errorCode: error.code,
          errorMessage: error.message,
        };
      }

      throw error;
    }
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
