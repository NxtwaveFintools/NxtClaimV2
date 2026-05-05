/** @jest-environment node */
export {};

const mockCookies = jest.fn();
const mockSetSession = jest.fn();
const mockGetUser = jest.fn();
const mockSignOut = jest.fn();
const mockIsAllowedEmailDomainInDb = jest.fn();

jest.mock("next/headers", () => ({
  cookies: (...args: unknown[]) => mockCookies(...args),
}));

jest.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      setSession: mockSetSession,
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
  }),
}));

jest.mock("@/core/infra/auth/allowed-auth-domains", () => ({
  isAllowedEmailDomainInDb: (...args: unknown[]) => mockIsAllowedEmailDomainInDb(...args),
}));

jest.mock("@/core/http/with-auth", () => ({
  withAuth: (
    handler: (
      request: Request,
      context: { correlationId: string; userId: string; email: string },
    ) => Promise<Response>,
  ) => {
    return (request: Request) =>
      handler(request, {
        correlationId: "cid-1",
        userId: "user-1",
        email: "user@nxtwave.co.in",
      });
  },
}));

jest.mock("@/core/config/server-env", () => ({
  serverEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

describe("/api/auth/session", () => {
  const cookieStore = {
    getAll: jest.fn(() => []),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCookies.mockResolvedValue(cookieStore);
    mockSetSession.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "user@nxtwave.co.in" } },
      error: null,
    });
    mockSignOut.mockResolvedValue({ error: null });
    mockIsAllowedEmailDomainInDb.mockResolvedValue({
      isAllowed: true,
      errorMessage: null,
    });
  });

  test("returns authenticated user payload", async () => {
    const { GET } = await import("@/app/api/auth/session/route");

    const response = await GET(new Request("http://localhost/api/auth/session") as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.user).toEqual({ id: "user-1", email: "user@nxtwave.co.in" });
    expect(body.meta.correlationId).toBe("cid-1");
  });

  test("POST rejects blocked domains before keeping the session", async () => {
    mockIsAllowedEmailDomainInDb.mockResolvedValue({
      isAllowed: false,
      errorMessage: null,
    });

    const { POST } = await import("@/app/api/auth/session/route");
    const response = await POST(
      new Request("http://localhost/api/auth/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "cid-2",
        },
        body: JSON.stringify({ accessToken: "acc", refreshToken: "ref" }),
      }) as never,
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("DOMAIN_NOT_ALLOWED");
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
