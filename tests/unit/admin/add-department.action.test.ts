/** @jest-environment node */

const mockRevalidatePath = jest.fn();
const mockIsAdmin = jest.fn();
const mockGetCurrentUser = jest.fn();
const mockCreateDepartment = jest.fn();

jest.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

jest.mock("@/modules/admin/server/is-admin", () => ({
  isAdmin: (...args: unknown[]) => mockIsAdmin(...args),
}));

jest.mock("@/modules/auth/repositories/supabase-server-auth.repository", () => ({
  SupabaseServerAuthRepository: jest.fn().mockImplementation(() => ({
    getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
  })),
}));

jest.mock("@/core/domain/admin/CreateDepartmentService", () => ({
  CreateDepartmentService: jest.fn().mockImplementation(() => ({
    createDepartment: (...args: unknown[]) => mockCreateDepartment(...args),
  })),
}));

jest.mock("@/modules/admin/repositories/SupabaseAdminRepository", () => ({
  SupabaseAdminRepository: jest.fn().mockImplementation(() => ({})),
}));

import { addDepartmentAction } from "@/modules/admin/actions/add-department";

describe("addDepartmentAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockIsAdmin.mockResolvedValue(true);
    mockGetCurrentUser.mockResolvedValue({
      user: { id: "admin-user-1", email: "admin@nxtwave.co.in" },
      errorMessage: null,
    });
    mockCreateDepartment.mockResolvedValue({
      data: {
        id: "dept-1",
        name: "Engineering",
        hodUserId: "hod-1",
        founderUserId: "founder-1",
        isActive: true,
      },
      errorCode: null,
      errorMessage: null,
    });
  });

  test("returns forbidden when requester is not an admin", async () => {
    mockIsAdmin.mockResolvedValue(false);

    const result = await addDepartmentAction({
      name: "Engineering",
      hod_email: "hod@nxtwave.co.in",
      founder_email: "founder@nxtwave.co.in",
    });

    expect(result).toEqual({ ok: false, message: "Forbidden: admin access required." });
    expect(mockCreateDepartment).not.toHaveBeenCalled();
  });

  test("validates payload", async () => {
    const invalidName = await addDepartmentAction({
      name: "  ",
      hod_email: "hod@nxtwave.co.in",
      founder_email: "founder@nxtwave.co.in",
    });

    const invalidHod = await addDepartmentAction({
      name: "Engineering",
      hod_email: "bad",
      founder_email: "founder@nxtwave.co.in",
    });

    expect(invalidName.ok).toBe(false);
    expect(invalidName.message).toBe("Department name is required.");
    expect(invalidHod.ok).toBe(false);
    expect(invalidHod.message).toBe("A valid HOD email is required.");
    expect(mockCreateDepartment).not.toHaveBeenCalled();
  });

  test("propagates service error", async () => {
    mockCreateDepartment.mockResolvedValueOnce({
      data: null,
      errorCode: "CREATE_FAILED",
      errorMessage: "duplicate key value",
    });

    const result = await addDepartmentAction({
      name: "Engineering",
      hod_email: "hod@nxtwave.co.in",
      founder_email: "founder@nxtwave.co.in",
    });

    expect(result).toEqual({ ok: false, message: "duplicate key value" });
  });

  test("calls service and revalidates on success", async () => {
    const result = await addDepartmentAction({
      name: "  Engineering  ",
      hod_email: "HOD@Nxtwave.co.in",
      founder_email: "Founder@Nxtwave.co.in",
    });

    expect(result).toEqual({ ok: true });
    expect(mockCreateDepartment).toHaveBeenCalledWith({
      name: "Engineering",
      hodEmail: "HOD@Nxtwave.co.in",
      founderEmail: "Founder@Nxtwave.co.in",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/admin/settings");
  });
});
