/** @jest-environment node */

const mockRevalidatePath = jest.fn();
const mockRevalidateTag = jest.fn();
const mockIsAdmin = jest.fn();
const mockGetCurrentUser = jest.fn();
const mockUpdateUserRole = jest.fn();

const mockSoftDeleteExecute = jest.fn();
const mockCreateMasterDataItem = jest.fn();
const mockUpdateMasterDataItem = jest.fn();
const mockUpdateDepartmentActors = jest.fn();
const mockUpdateDepartmentActorsByEmail = jest.fn();
const mockCreateFinanceApprover = jest.fn();
const mockAddFinanceApproverByEmail = jest.fn();
const mockUpdateFinanceApprover = jest.fn();
const mockAddAdminByEmail = jest.fn();
const mockRemoveAdmin = jest.fn();
const mockAddViewerByEmail = jest.fn();
const mockRemoveViewer = jest.fn();

jest.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));

jest.mock("@/modules/admin/server/is-admin", () => ({
  isAdmin: (...args: unknown[]) => mockIsAdmin(...args),
}));

jest.mock("@/modules/auth/repositories/supabase-server-auth.repository", () => ({
  SupabaseServerAuthRepository: jest.fn().mockImplementation(() => ({
    getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
  })),
}));

jest.mock("@/modules/admin/repositories/SupabaseAdminRepository", () => ({
  SupabaseAdminRepository: jest.fn().mockImplementation(() => ({
    updateUserRole: (...args: unknown[]) => mockUpdateUserRole(...args),
  })),
}));

jest.mock("@/core/domain/admin/AdminSoftDeleteClaimService", () => ({
  AdminSoftDeleteClaimService: jest.fn().mockImplementation(() => ({
    execute: (...args: unknown[]) => mockSoftDeleteExecute(...args),
  })),
}));

jest.mock("@/core/domain/admin/ManageMasterDataService", () => ({
  ManageMasterDataService: jest.fn().mockImplementation(() => ({
    createItem: (...args: unknown[]) => mockCreateMasterDataItem(...args),
    updateItem: (...args: unknown[]) => mockUpdateMasterDataItem(...args),
  })),
}));

jest.mock("@/core/domain/admin/ManageActorsService", () => ({
  ManageActorsService: jest.fn().mockImplementation(() => ({
    updateDepartmentActors: (...args: unknown[]) => mockUpdateDepartmentActors(...args),
    updateDepartmentActorsByEmail: (...args: unknown[]) =>
      mockUpdateDepartmentActorsByEmail(...args),
    createFinanceApprover: (...args: unknown[]) => mockCreateFinanceApprover(...args),
    addFinanceApproverByEmail: (...args: unknown[]) => mockAddFinanceApproverByEmail(...args),
    updateFinanceApprover: (...args: unknown[]) => mockUpdateFinanceApprover(...args),
  })),
}));

jest.mock("@/core/domain/admin/ManageAdminsService", () => ({
  ManageAdminsService: jest.fn().mockImplementation(() => ({
    addAdminByEmail: (...args: unknown[]) => mockAddAdminByEmail(...args),
    removeAdmin: (...args: unknown[]) => mockRemoveAdmin(...args),
  })),
}));

jest.mock("@/core/domain/admin/ManageDepartmentViewersService", () => ({
  ManageDepartmentViewersService: jest.fn().mockImplementation(() => ({
    addViewerByEmail: (...args: unknown[]) => mockAddViewerByEmail(...args),
    removeViewer: (...args: unknown[]) => mockRemoveViewer(...args),
  })),
}));

jest.mock("@/core/infra/logging/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    maskEmail: jest.fn((value: string | null) => value),
  },
}));

import {
  addAdminAction,
  addDepartmentViewerAction,
  addFinanceApproverByEmailAction,
  createFinanceApproverAction,
  createMasterDataItemAction,
  removeAdminAction,
  removeDepartmentViewerAction,
  softDeleteClaimAction,
  updateDepartmentActorsAction,
  updateDepartmentActorsByEmailAction,
  updateFinanceApproverAction,
  updateMasterDataItemAction,
  updateUserRoleAction,
} from "@/modules/admin/actions";

describe("admin actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockIsAdmin.mockResolvedValue(true);
    mockGetCurrentUser.mockResolvedValue({
      user: { id: "admin-user-1", email: "admin@nxtwave.co.in" },
      errorMessage: null,
    });

    mockSoftDeleteExecute.mockResolvedValue({ success: true, errorMessage: null });
    mockCreateMasterDataItem.mockResolvedValue({ data: { id: "x" }, errorMessage: null });
    mockUpdateMasterDataItem.mockResolvedValue({ data: { id: "x" }, errorMessage: null });
    mockUpdateDepartmentActors.mockResolvedValue({ success: true, errorMessage: null });
    mockUpdateDepartmentActorsByEmail.mockResolvedValue({ success: true, errorMessage: null });
    mockCreateFinanceApprover.mockResolvedValue({ data: { id: "x" }, errorMessage: null });
    mockAddFinanceApproverByEmail.mockResolvedValue({ data: { id: "x" }, errorMessage: null });
    mockUpdateFinanceApprover.mockResolvedValue({ data: { id: "x" }, errorMessage: null });
    mockUpdateUserRole.mockResolvedValue({ success: true, errorMessage: null });
    mockAddAdminByEmail.mockResolvedValue({ data: { id: "x" }, errorMessage: null });
    mockRemoveAdmin.mockResolvedValue({ success: true, errorMessage: null });
    mockAddViewerByEmail.mockResolvedValue({ data: { id: "x" }, errorMessage: null });
    mockRemoveViewer.mockResolvedValue({ success: true, errorMessage: null });
  });

  test("softDeleteClaimAction returns forbidden for non-admin", async () => {
    mockIsAdmin.mockResolvedValue(false);

    const result = await softDeleteClaimAction("claim-1");

    expect(result).toEqual({ ok: false, message: "Forbidden: admin access required." });
    expect(mockSoftDeleteExecute).not.toHaveBeenCalled();
  });

  test("softDeleteClaimAction validates id and revalidates on success", async () => {
    const invalid = await softDeleteClaimAction(" ");
    expect(invalid).toEqual({ ok: false, message: "ID is required" });

    const result = await softDeleteClaimAction("claim-123");
    expect(result).toEqual({ ok: true });
    expect(mockSoftDeleteExecute).toHaveBeenCalledWith({
      claimId: "claim-123",
      actorId: "admin-user-1",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/my-claims");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/claims/claim-123");
  });

  test("createMasterDataItemAction validates table and creates item", async () => {
    const invalidTable = await createMasterDataItemAction("invalid" as never, "Item");
    expect(invalidTable).toEqual({ ok: false, message: "Invalid master data table." });

    const success = await createMasterDataItemAction("master_products", "  Laptop  ");
    expect(success).toEqual({ ok: true });
    expect(mockCreateMasterDataItem).toHaveBeenCalledWith({
      tableName: "master_products",
      name: "Laptop",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/admin/settings");
  });

  test("updateMasterDataItemAction validates payload and updates item", async () => {
    const invalidPayload = await updateMasterDataItemAction("master_locations", "item-1", {});
    expect(invalidPayload).toEqual({
      ok: false,
      message: "At least one field to update is required.",
    });

    const success = await updateMasterDataItemAction("master_locations", "item-1", {
      name: "  Hyderabad  ",
      isActive: false,
    });

    expect(success).toEqual({ ok: true });
    expect(mockUpdateMasterDataItem).toHaveBeenCalledWith({
      tableName: "master_locations",
      id: "item-1",
      payload: { name: "Hyderabad", isActive: false },
    });
  });

  test("updateDepartmentActorsAction handles validation and service failures", async () => {
    const invalid = await updateDepartmentActorsAction("", "hod-1", "founder-1");
    expect(invalid).toEqual({ ok: false, message: "ID is required" });

    mockUpdateDepartmentActors.mockResolvedValueOnce({
      success: false,
      errorMessage: "cannot update",
    });
    const failed = await updateDepartmentActorsAction("dep-1", "hod-1", "founder-1");
    expect(failed).toEqual({ ok: false, message: "cannot update" });

    const success = await updateDepartmentActorsAction("dep-1", "hod-1", "founder-1");
    expect(success).toEqual({ ok: true });
    expect(mockUpdateDepartmentActors).toHaveBeenCalledWith({
      departmentId: "dep-1",
      hodUserId: "hod-1",
      founderUserId: "founder-1",
    });
  });

  test("updateDepartmentActorsByEmailAction validates and updates", async () => {
    const invalid = await updateDepartmentActorsByEmailAction("dep-1", "bad", "ok@example.com");
    expect(invalid.ok).toBe(false);

    const success = await updateDepartmentActorsByEmailAction(
      "dep-1",
      "Hod@Nxtwave.co.in  ",
      "Founder@nxtwave.co.in",
    );

    expect(success).toEqual({ ok: true });
    expect(mockUpdateDepartmentActorsByEmail).toHaveBeenCalledWith({
      departmentId: "dep-1",
      hodEmail: "Hod@Nxtwave.co.in",
      founderEmail: "Founder@nxtwave.co.in",
    });
  });

  test("createFinanceApproverAction validates id and creates approver", async () => {
    const invalid = await createFinanceApproverAction(" ");
    expect(invalid).toEqual({ ok: false, message: "Invalid user ID." });

    const success = await createFinanceApproverAction("user-1");
    expect(success).toEqual({ ok: true });
    expect(mockCreateFinanceApprover).toHaveBeenCalledWith({ userId: "user-1" });
  });

  test("addFinanceApproverByEmailAction validates email and creates approver", async () => {
    const invalid = await addFinanceApproverByEmailAction("not-an-email");
    expect(invalid).toEqual({ ok: false, message: "Invalid email address." });

    const success = await addFinanceApproverByEmailAction("finance@nxtwave.co.in");
    expect(success).toEqual({ ok: true });
    expect(mockAddFinanceApproverByEmail).toHaveBeenCalledWith({
      email: "finance@nxtwave.co.in",
    });
  });

  test("updateFinanceApproverAction validates payload and updates approver", async () => {
    const invalid = await updateFinanceApproverAction("approver-1", {});
    expect(invalid).toEqual({
      ok: false,
      message: "At least one field to update is required.",
    });

    const success = await updateFinanceApproverAction("approver-1", {
      isActive: true,
      isPrimary: true,
    });

    expect(success).toEqual({ ok: true });
    expect(mockUpdateFinanceApprover).toHaveBeenCalledWith({
      id: "approver-1",
      payload: { isActive: true, isPrimary: true },
    });
  });

  test("updateUserRoleAction validates role and handles repository failure", async () => {
    const invalidRole = await updateUserRoleAction("user-1", "random");
    expect(invalidRole).toEqual({ ok: false, message: "Invalid role value." });

    mockUpdateUserRole.mockResolvedValueOnce({
      success: false,
      errorMessage: "failed role update",
    });
    const failed = await updateUserRoleAction("user-1", "finance");
    expect(failed).toEqual({ ok: false, message: "failed role update" });

    const success = await updateUserRoleAction("user-1", "finance");
    expect(success).toEqual({ ok: true });
    expect(mockUpdateUserRole).toHaveBeenCalledWith("user-1", "finance");
  });

  test("addAdminAction validates email and adds admin", async () => {
    const invalid = await addAdminAction("bad");
    expect(invalid).toEqual({ ok: false, message: "Invalid email address." });

    const success = await addAdminAction("admin2@nxtwave.co.in");
    expect(success).toEqual({ ok: true });
    expect(mockAddAdminByEmail).toHaveBeenCalledWith("admin2@nxtwave.co.in");
  });

  test("removeAdminAction validates id and removes admin", async () => {
    const invalid = await removeAdminAction(" ");
    expect(invalid).toEqual({ ok: false, message: "Invalid admin record ID." });

    const success = await removeAdminAction("admin-record-1");
    expect(success).toEqual({ ok: true });
    expect(mockRemoveAdmin).toHaveBeenCalledWith("admin-record-1");
  });

  test("addDepartmentViewerAction validates input and adds viewer", async () => {
    const invalidDept = await addDepartmentViewerAction("", "user@nxtwave.co.in");
    expect(invalidDept).toEqual({ ok: false, message: "Invalid department ID." });

    const invalidEmail = await addDepartmentViewerAction("dep-1", "invalid");
    expect(invalidEmail).toEqual({ ok: false, message: "Invalid email address." });

    const success = await addDepartmentViewerAction("dep-1", "viewer@nxtwave.co.in");
    expect(success).toEqual({ ok: true });
    expect(mockAddViewerByEmail).toHaveBeenCalledWith("dep-1", "viewer@nxtwave.co.in");
  });

  test("removeDepartmentViewerAction validates input and handles service errors", async () => {
    const invalid = await removeDepartmentViewerAction(" ");
    expect(invalid).toEqual({ ok: false, message: "Invalid viewer record ID." });

    mockRemoveViewer.mockResolvedValueOnce({ success: false, errorMessage: "remove failed" });
    const failed = await removeDepartmentViewerAction("viewer-1");
    expect(failed).toEqual({ ok: false, message: "remove failed" });

    const success = await removeDepartmentViewerAction("viewer-1");
    expect(success).toEqual({ ok: true });
    expect(mockRemoveViewer).toHaveBeenCalledWith("viewer-1");
  });
});
