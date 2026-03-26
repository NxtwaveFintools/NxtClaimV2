import type { DbClaimStatus } from "@/core/constants/statuses";

export type ClaimActionRole = "HOD" | "Finance";

type AvailableClaimActions = {
  canApprove: boolean;
  canReject: boolean;
  canMarkPaid: boolean;
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
