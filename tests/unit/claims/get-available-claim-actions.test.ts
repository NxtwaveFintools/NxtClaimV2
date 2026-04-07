import { getAvailableClaimActions } from "@/modules/claims/utils/get-available-claim-actions";
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
});
