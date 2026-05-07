import type { DbClaimStatus } from "@/core/constants/statuses";

export type ClaimActionRole = "HOD" | "Finance";

type AvailableClaimActions = {
  canApprove: boolean;
  canReject: boolean;
  canMarkPaid: boolean;
};

type ClaimDetailActionPermissions = {
  canTakeL1Decision: boolean;
  canTakeFinanceAuthorizationDecision: boolean;
  canTakeFinanceExecutionDecision: boolean;
};

type ClaimDetailActionPermissionsInput = {
  status: DbClaimStatus;
  currentUserId: string;
  beneficiaryUserId: string | null;
  assignedL1ApproverId: string;
  isFinanceActor: boolean;
};

const NO_DETAIL_ACTION_PERMISSIONS: ClaimDetailActionPermissions = {
  canTakeL1Decision: false,
  canTakeFinanceAuthorizationDecision: false,
  canTakeFinanceExecutionDecision: false,
};

export function getAvailableClaimActions(
  status: DbClaimStatus,
  userRole: ClaimActionRole,
): AvailableClaimActions {
  const canApproveOrReject =
    (userRole === "HOD" && status === "Submitted - Awaiting HOD approval") ||
    (userRole === "Finance" && status === "HOD approved - Awaiting finance approval");

  const canMarkPaid =
    userRole === "Finance" && status === "Finance Approved - Payment under process";

  return {
    canApprove: canApproveOrReject,
    canReject: canApproveOrReject,
    canMarkPaid,
  };
}

export function getClaimDetailActionPermissions(
  input: ClaimDetailActionPermissionsInput,
): ClaimDetailActionPermissions {
  if (input.currentUserId === input.beneficiaryUserId) {
    return NO_DETAIL_ACTION_PERMISSIONS;
  }

  if (input.currentUserId === input.assignedL1ApproverId) {
    const l1Actions = getAvailableClaimActions(input.status, "HOD");

    if (l1Actions.canApprove && l1Actions.canReject) {
      return {
        canTakeL1Decision: true,
        canTakeFinanceAuthorizationDecision: false,
        canTakeFinanceExecutionDecision: false,
      };
    }
  }

  if (!input.isFinanceActor) {
    return NO_DETAIL_ACTION_PERMISSIONS;
  }

  const financeActions = getAvailableClaimActions(input.status, "Finance");

  return {
    canTakeL1Decision: false,
    canTakeFinanceAuthorizationDecision: financeActions.canApprove && financeActions.canReject,
    canTakeFinanceExecutionDecision: financeActions.canMarkPaid,
  };
}
