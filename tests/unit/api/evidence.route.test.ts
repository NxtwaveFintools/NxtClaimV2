/** @jest-environment node */

const mockGetCachedRequestAuthUser = jest.fn();
const mockMaybeSingle = jest.fn();
const mockCreateSignedUrl = jest.fn();

jest.mock("@/modules/auth/server/get-request-auth-user", () => ({
  getCachedRequestAuthUser: () => mockGetCachedRequestAuthUser(),
}));

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => mockMaybeSingle(),
          }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        createSignedUrl: (...args: unknown[]) => mockCreateSignedUrl(...args),
      }),
    },
  }),
}));

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/evidence/[id]", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetCachedRequestAuthUser.mockReset();
    mockMaybeSingle.mockReset();
    mockCreateSignedUrl.mockReset();
  });

  test("redirects unauthenticated users to login", async () => {
    mockGetCachedRequestAuthUser.mockResolvedValue({ user: null, errorMessage: null });
    const { GET } = await import("@/app/api/evidence/[id]/route");

    const response = await GET(
      new Request("https://nxtclaim.example.com/api/evidence/CLAIM-1?type=bill") as never,
      context("CLAIM-1"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://nxtclaim.example.com/auth/login");
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  test("redirects authenticated users to a short-lived signed bill URL", async () => {
    mockGetCachedRequestAuthUser.mockResolvedValue({
      user: { id: "user-1", email: "finance@nxtwave.co.in" },
      errorMessage: null,
    });
    mockMaybeSingle.mockResolvedValue({
      data: { receipt_file_path: "receipts/inv.pdf", bank_statement_file_path: "bank/stmt.pdf" },
      error: null,
    });
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example.com/signed" },
      error: null,
    });
    const { GET } = await import("@/app/api/evidence/[id]/route");

    const response = await GET(
      new Request("https://nxtclaim.example.com/api/evidence/CLAIM-1?type=bill") as never,
      context("CLAIM-1"),
    );

    expect(mockCreateSignedUrl).toHaveBeenCalledWith("receipts/inv.pdf", 60);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://storage.example.com/signed");
  });

  test("returns 404 when requested evidence path is missing", async () => {
    mockGetCachedRequestAuthUser.mockResolvedValue({
      user: { id: "user-1", email: "finance@nxtwave.co.in" },
      errorMessage: null,
    });
    mockMaybeSingle.mockResolvedValue({
      data: { receipt_file_path: null, bank_statement_file_path: null },
      error: null,
    });
    const { GET } = await import("@/app/api/evidence/[id]/route");

    const response = await GET(
      new Request("https://nxtclaim.example.com/api/evidence/CLAIM-1?type=bank_statement") as never,
      context("CLAIM-1"),
    );

    expect(response.status).toBe(404);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  test("returns 400 for invalid evidence type", async () => {
    mockGetCachedRequestAuthUser.mockResolvedValue({
      user: { id: "user-1", email: "finance@nxtwave.co.in" },
      errorMessage: null,
    });
    const { GET } = await import("@/app/api/evidence/[id]/route");

    const response = await GET(
      new Request("https://nxtclaim.example.com/api/evidence/CLAIM-1?type=receipt") as never,
      context("CLAIM-1"),
    );

    expect(response.status).toBe(400);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });
});
