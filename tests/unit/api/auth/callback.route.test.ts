/** @jest-environment node */

const mockExchangeCodeForSession = jest.fn();
const mockGetUser = jest.fn();
const mockSignOut = jest.fn();
const mockIsAllowedEmailDomain = jest.fn();

const mockCookieStore = {
  getAll: jest.fn(() => []),
};

jest.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: mockExchangeCodeForSession,
      getUser: mockGetUser,
      signOut: mockSignOut,
    },
  }),
}));

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => mockCookieStore),
}));

jest.mock("@/core/config/allowed-domains", () => ({
  isAllowedEmailDomain: (...args: unknown[]) => mockIsAllowedEmailDomain(...args),
}));

jest.mock("@/core/infra/logging/logger", () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    maskEmail: jest.fn((value: string | null) => value),
  },
}));

describe("GET /api/auth/callback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    mockIsAllowedEmailDomain.mockReturnValue(true);
    mockExchangeCodeForSession.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "user@nxtwave.co.in",
        },
      },
    });
    mockSignOut.mockResolvedValue({ error: null });
  });

  test("redirects to login when code exchange fails", async () => {
    mockExchangeCodeForSession.mockResolvedValueOnce({ error: { message: "exchange failed" } });
    const { GET } = await import("@/app/api/auth/callback/route");

    const response = await GET(
      new Request("http://localhost/api/auth/callback?code=abc", {
        headers: { "x-correlation-id": "cid-1" },
      }) as never,
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/auth/login?error=unauthorized_domain");
  });

  test("redirects to login and signs out when domain is blocked", async () => {
    mockIsAllowedEmailDomain.mockReturnValue(false);
    const { GET } = await import("@/app/api/auth/callback/route");

    const response = await GET(new Request("http://localhost/api/auth/callback?code=abc") as never);

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toContain("/auth/login?error=unauthorized_domain");
  });

  test("redirects to dashboard on successful callback", async () => {
    const { GET } = await import("@/app/api/auth/callback/route");

    const response = await GET(new Request("http://localhost/api/auth/callback?code=abc") as never);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/dashboard");
  });
});
