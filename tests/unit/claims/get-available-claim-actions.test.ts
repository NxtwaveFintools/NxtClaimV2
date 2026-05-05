import {
  getAvailableClaimActions,
  getClaimDetailActionPermissions,
} from "@/modules/claims/utils/get-available-claim-actions";
import { DB_CLAIM_STATUSES } from "@/core/constants/statuses";

describe("getAvailableClaimActions", () => {
  test("allows HOD approve/reject only in L1 pending status", () => {
    const allowed = getAvailableClaimActions(DB_CLAIM_STATUSES[0], "HOD");
    expect(allowed).toEqual({ canApprove: true, canReject: true, canMarkPaid: false });

    const blocked = getAvailableClaimActions(DB_CLAIM_STATUSES[1], "HOD");
    expect(blocked).toEqual({ canApprove: false, canReject: false, canMarkPaid: false });
  });

  test("allows Finance approve/reject only in L2 pending status", () => {
    const allowed = getAvailableClaimActions(DB_CLAIM_STATUSES[1], "Finance");
    expect(allowed).toEqual({ canApprove: true, canReject: true, canMarkPaid: false });

    const blocked = getAvailableClaimActions(DB_CLAIM_STATUSES[0], "Finance");
    expect(blocked).toEqual({ canApprove: false, canReject: false, canMarkPaid: false });
  });

  test("allows Finance mark-paid only in payment-under-process status", () => {
    const allowed = getAvailableClaimActions(DB_CLAIM_STATUSES[2], "Finance");
    expect(allowed).toEqual({ canApprove: false, canReject: false, canMarkPaid: true });

    const blockedHardRejected = getAvailableClaimActions(DB_CLAIM_STATUSES[4], "Finance");
    expect(blockedHardRejected).toEqual({
      canApprove: false,
      canReject: false,
      canMarkPaid: false,
    });

    const blockedSoftRejected = getAvailableClaimActions(DB_CLAIM_STATUSES[5], "Finance");
    expect(blockedSoftRejected).toEqual({
      canApprove: false,
      canReject: false,
      canMarkPaid: false,
    });
  });

  test("allows the assigned L1 approver to take the detail-page decision", () => {
    const permissions = getClaimDetailActionPermissions({
      status: DB_CLAIM_STATUSES[0],
      currentUserId: "approver-1",
      submittedBy: "submitter-1",
      assignedL1ApproverId: "approver-1",
      isFinanceActor: false,
    });

    expect(permissions).toEqual({
      canTakeL1Decision: true,
      canTakeFinanceAuthorizationDecision: false,
      canTakeFinanceExecutionDecision: false,
    });
  });

  test("allows an active finance approver to take the detail-page finance decision", () => {
    const permissions = getClaimDetailActionPermissions({
      status: DB_CLAIM_STATUSES[1],
      currentUserId: "finance-1",
      submittedBy: "submitter-1",
      assignedL1ApproverId: "approver-1",
      isFinanceActor: true,
    });

    expect(permissions).toEqual({
      canTakeL1Decision: false,
      canTakeFinanceAuthorizationDecision: true,
      canTakeFinanceExecutionDecision: false,
    });
  });

  test("blocks the submitter from L1 decisions on the detail page", () => {
    const permissions = getClaimDetailActionPermissions({
      status: DB_CLAIM_STATUSES[0],
      currentUserId: "submitter-1",
      submittedBy: "submitter-1",
      assignedL1ApproverId: "submitter-1",
      isFinanceActor: false,
    });

    expect(permissions).toEqual({
      canTakeL1Decision: false,
      canTakeFinanceAuthorizationDecision: false,
      canTakeFinanceExecutionDecision: false,
    });
  });

  test("blocks the submitter from finance decisions even if finance-scoped", () => {
    const permissions = getClaimDetailActionPermissions({
      status: DB_CLAIM_STATUSES[1],
      currentUserId: "submitter-1",
      submittedBy: "submitter-1",
      assignedL1ApproverId: "approver-1",
      isFinanceActor: true,
    });

    expect(permissions).toEqual({
      canTakeL1Decision: false,
      canTakeFinanceAuthorizationDecision: false,
      canTakeFinanceExecutionDecision: false,
    });
  });

  test("blocks unrelated viewers from claim detail decisions", () => {
    const permissions = getClaimDetailActionPermissions({
      status: DB_CLAIM_STATUSES[0],
      currentUserId: "viewer-1",
      submittedBy: "submitter-1",
      assignedL1ApproverId: "approver-1",
      isFinanceActor: false,
    });

    expect(permissions).toEqual({
      canTakeL1Decision: false,
      canTakeFinanceAuthorizationDecision: false,
      canTakeFinanceExecutionDecision: false,
    });
  });
});
