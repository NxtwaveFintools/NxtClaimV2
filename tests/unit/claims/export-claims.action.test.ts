/** @jest-environment node */

export {};

const mockGetCurrentUser = jest.fn();
const mockExecute = jest.fn();

jest.mock("@/modules/auth/repositories/supabase-server-auth.repository", () => ({
  SupabaseServerAuthRepository: jest.fn().mockImplementation(() => ({
    getCurrentUser: mockGetCurrentUser,
  })),
}));

jest.mock("@/modules/claims/repositories/SupabaseClaimRepository", () => ({
  SupabaseClaimRepository: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("@/core/domain/claims/ExportClaimsService", () => ({
  ExportClaimsService: jest.fn().mockImplementation(() => ({
    execute: mockExecute,
  })),
}));

describe("exportClaimsCsvAction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns structured validation error for invalid payload", async () => {
    const { exportClaimsCsvAction } = await import("@/modules/claims/actions/export-claims");

    const result = await exportClaimsCsvAction({
      // @ts-expect-error intentional invalid value
      scope: "invalid",
      searchParams: "",
    });

    expect(result.data).toBeNull();
    expect(result.error?.code).toBe("INVALID_EXPORT_INPUT");
    expect(typeof result.meta.correlationId).toBe("string");
  });

  it("returns xlsx payload metadata on successful export", async () => {
    mockGetCurrentUser.mockResolvedValue({
      user: { id: "user-1", email: "finance@nxtwave.co.in" },
      errorMessage: null,
    });
    mockExecute.mockResolvedValue({
      rows: [{ claimId: "CLAIM-1" }],
      fileName: "claims_export_20260324.xlsx",
      rowCount: 1,
      errorMessage: null,
    });

    const { exportClaimsCsvAction } = await import("@/modules/claims/actions/export-claims");

    const result = await exportClaimsCsvAction({
      scope: "submissions",
      searchParams: "from=2026-03-01&to=2026-03-24",
    });

    expect(result.error).toBeNull();
    expect(result.data?.fileName).toBe("claims_export_20260324.xlsx");
    expect(result.data?.rowCount).toBe(1);
    expect(result.data).not.toHaveProperty("csvData");
  });
});
