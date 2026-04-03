/** @jest-environment node */

const mockRevalidatePath = jest.fn();
const mockIsAdmin = jest.fn();
const mockGetCurrentUser = jest.fn();
const mockGetActivePolicy = jest.fn();
const mockAcceptPolicy = jest.fn();
const mockPublishNewPolicy = jest.fn();
const mockUpload = jest.fn();
const mockGetPublicUrl = jest.fn();
const mockRemove = jest.fn();
const mockStorageFrom = jest.fn();
const mockGetServiceRoleSupabaseClient = jest.fn();

jest.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

jest.mock("@/modules/admin/server/is-admin", () => ({
  isAdmin: (...args: unknown[]) => mockIsAdmin(...args),
}));

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: (...args: unknown[]) => mockGetServiceRoleSupabaseClient(...args),
}));

jest.mock("@/modules/auth/repositories/supabase-server-auth.repository", () => ({
  SupabaseServerAuthRepository: jest.fn().mockImplementation(() => ({
    getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
  })),
}));

jest.mock("@/modules/policies/repositories/SupabasePolicyRepository", () => ({
  SupabasePolicyRepository: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@/core/domain/policies/PolicyService", () => ({
  PolicyService: jest.fn().mockImplementation(() => ({
    getActivePolicy: (...args: unknown[]) => mockGetActivePolicy(...args),
    acceptPolicy: (...args: unknown[]) => mockAcceptPolicy(...args),
    publishNewPolicy: (...args: unknown[]) => mockPublishNewPolicy(...args),
  })),
}));

import {
  acceptPolicyAction,
  getActivePolicyStateAction,
  publishNewPolicyAction,
} from "@/modules/policies/actions";

function createPolicyFormData(options?: { versionName?: string; file?: File | null }): FormData {
  const formData = new FormData();
  formData.append("versionName", options?.versionName ?? "FIN-POL-002 v1.2");

  if (options?.file !== null) {
    formData.append(
      "policyFile",
      options?.file ?? new File(["%PDF-1.4"], "policy.pdf", { type: "application/pdf" }),
    );
  }

  return formData;
}

describe("policies actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockStorageFrom.mockReturnValue({
      upload: (...args: unknown[]) => mockUpload(...args),
      getPublicUrl: (...args: unknown[]) => mockGetPublicUrl(...args),
      remove: (...args: unknown[]) => mockRemove(...args),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      storage: {
        from: (...args: unknown[]) => mockStorageFrom(...args),
      },
    });

    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: "https://cdn.nxtclaim.dev/policies/policy.pdf" },
    });
    mockRemove.mockResolvedValue({ error: null });

    mockGetCurrentUser.mockResolvedValue({
      user: { id: "user-1", email: "user@nxtwave.tech" },
      errorMessage: null,
    });

    mockIsAdmin.mockResolvedValue(true);

    mockGetActivePolicy.mockResolvedValue({
      data: {
        policy: {
          id: "11111111-1111-4111-8111-111111111111",
          versionName: "FIN-POL-002 v1.1",
          fileUrl: "https://cdn.nxtclaim.dev/policies/v1-1.pdf",
          createdAt: "2026-04-03T00:00:00.000Z",
        },
        accepted: true,
        acceptedAt: "2026-04-03T10:20:00.000Z",
      },
      errorCode: null,
      errorMessage: null,
    });

    mockAcceptPolicy.mockResolvedValue({
      data: { acceptedAt: "2026-04-03T10:20:00.000Z" },
      errorCode: null,
      errorMessage: null,
    });

    mockPublishNewPolicy.mockResolvedValue({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        versionName: "FIN-POL-002 v1.2",
        fileUrl: "https://cdn.nxtclaim.dev/policies/v1-2.pdf",
        isActive: true,
        createdAt: "2026-04-03T00:00:00.000Z",
      },
      errorCode: null,
      errorMessage: null,
    });
  });

  test("getActivePolicyStateAction returns unauthorized when no authenticated user", async () => {
    mockGetCurrentUser.mockResolvedValueOnce({ user: null, errorMessage: "unauthorized" });

    const result = await getActivePolicyStateAction();

    expect(result).toEqual({ ok: false, message: "Unauthorized." });
    expect(mockGetActivePolicy).not.toHaveBeenCalled();
  });

  test("getActivePolicyStateAction returns null policy payload when active policy is missing", async () => {
    mockGetActivePolicy.mockResolvedValueOnce({
      data: null,
      errorCode: "POLICY_NOT_FOUND",
      errorMessage: "No active company policy was found.",
    });

    const result = await getActivePolicyStateAction();

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      policy: null,
      accepted: false,
      acceptedAt: null,
    });
  });

  test("acceptPolicyAction validates policy id", async () => {
    const result = await acceptPolicyAction("invalid-policy-id");

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Invalid policy ID.");
    expect(mockAcceptPolicy).not.toHaveBeenCalled();
  });

  test("acceptPolicyAction records acceptance and revalidates dashboard paths", async () => {
    const result = await acceptPolicyAction("11111111-1111-4111-8111-111111111111");

    expect(result).toEqual({
      ok: true,
      acceptedAt: "2026-04-03T10:20:00.000Z",
    });
    expect(mockAcceptPolicy).toHaveBeenCalledWith("user-1", "11111111-1111-4111-8111-111111111111");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/my-claims");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/claims/new");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/analytics");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/admin/settings");
  });

  test("publishNewPolicyAction enforces admin guard", async () => {
    mockIsAdmin.mockResolvedValueOnce(false);

    const result = await publishNewPolicyAction(createPolicyFormData());

    expect(result).toEqual({ ok: false, message: "Forbidden: admin access required." });
    expect(mockPublishNewPolicy).not.toHaveBeenCalled();
    expect(mockGetServiceRoleSupabaseClient).not.toHaveBeenCalled();
  });

  test("publishNewPolicyAction validates version", async () => {
    const result = await publishNewPolicyAction(
      createPolicyFormData({
        versionName: "   ",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Version name is required.");
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockPublishNewPolicy).not.toHaveBeenCalled();
  });

  test("publishNewPolicyAction validates policy file", async () => {
    const missingFileResult = await publishNewPolicyAction(createPolicyFormData({ file: null }));

    expect(missingFileResult.ok).toBe(false);
    expect(missingFileResult.message).toBe("Policy PDF file is required.");
    expect(mockUpload).not.toHaveBeenCalled();

    const invalidFileResult = await publishNewPolicyAction(
      createPolicyFormData({
        file: new File(["plain text"], "policy.txt", { type: "text/plain" }),
      }),
    );

    expect(invalidFileResult.ok).toBe(false);
    expect(invalidFileResult.message).toBe("Only PDF files are supported.");
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockPublishNewPolicy).not.toHaveBeenCalled();
  });

  test("publishNewPolicyAction uploads policy and revalidates routes", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1712102400000);

    const result = await publishNewPolicyAction(
      createPolicyFormData({
        versionName: "FIN-POL-002 v1.2",
        file: new File(["%PDF-1.4"], "Policy Final.pdf", {
          type: "application/pdf",
        }),
      }),
    );

    nowSpy.mockRestore();

    expect(result).toEqual({ ok: true });
    expect(mockStorageFrom).toHaveBeenCalledWith("policies");
    expect(mockUpload).toHaveBeenCalledWith(
      "user-1/1712102400000_policy_final.pdf",
      expect.any(Buffer),
      {
        cacheControl: "3600",
        upsert: false,
        contentType: "application/pdf",
      },
    );
    expect(mockGetPublicUrl).toHaveBeenCalledWith("user-1/1712102400000_policy_final.pdf");
    expect(mockPublishNewPolicy).toHaveBeenCalledWith(
      "https://cdn.nxtclaim.dev/policies/policy.pdf",
      "FIN-POL-002 v1.2",
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/my-claims");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/claims/new");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/analytics");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/dashboard/admin/settings");
  });

  test("publishNewPolicyAction removes uploaded file when publish fails", async () => {
    mockPublishNewPolicy.mockResolvedValueOnce({
      data: null,
      errorCode: "PUBLISH_FAILED",
      errorMessage: "Policy version already exists. Use a new version name.",
    });

    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1712102401234);

    const result = await publishNewPolicyAction(createPolicyFormData());

    nowSpy.mockRestore();

    expect(result).toEqual({
      ok: false,
      message: "Policy version already exists. Use a new version name.",
    });
    expect(mockRemove).toHaveBeenCalledWith(["user-1/1712102401234_policy.pdf"]);
  });
});
