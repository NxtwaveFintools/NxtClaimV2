/** @jest-environment node */

const mockRequestAuthCreateServerClient = jest.fn();
const mockRequestAuthCookies = jest.fn();

jest.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => mockRequestAuthCreateServerClient(...args),
}));

jest.mock("next/headers", () => ({
  cookies: (...args: unknown[]) => mockRequestAuthCookies(...args),
}));

jest.mock("@/core/config/server-env", () => ({
  serverEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

describe("getCachedRequestAuthUser", () => {
  const cookieStore = {
    getAll: jest.fn(() => []),
    set: jest.fn(),
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    cookieStore.getAll.mockReturnValue([]);
    mockRequestAuthCookies.mockResolvedValue(cookieStore);
  });

  test("swallows thrown refresh_token_not_found errors and clears auth cookies", async () => {
    cookieStore.getAll.mockReturnValueOnce([
      { name: "sb-project-auth-token", value: "token" },
      { name: "sb-project-auth-token.0", value: "token.0" },
    ] as never);

    const getUser = jest.fn().mockRejectedValue({
      message: "Refresh Token Not Found",
      code: "refresh_token_not_found",
      status: 400,
    });

    mockRequestAuthCreateServerClient.mockReturnValue({ auth: { getUser } });

    const { getCachedRequestAuthUser } =
      await import("@/modules/auth/server/get-request-auth-user");
    const result = await getCachedRequestAuthUser();

    expect(result).toEqual({
      user: null,
      errorMessage: null,
    });
    expect(cookieStore.set).toHaveBeenCalled();
  });

  test("returns message for thrown non-terminal errors", async () => {
    const getUser = jest.fn().mockRejectedValue(new Error("request failed"));

    mockRequestAuthCreateServerClient.mockReturnValue({ auth: { getUser } });

    const { getCachedRequestAuthUser } =
      await import("@/modules/auth/server/get-request-auth-user");
    const result = await getCachedRequestAuthUser();

    expect(result).toEqual({
      user: null,
      errorMessage: "request failed",
    });
  });

  test("returns user payload when Supabase getUser succeeds", async () => {
    const getUser = jest.fn().mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "user@nxtwave.co.in",
          app_metadata: {},
          user_metadata: {},
          aud: "authenticated",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      },
      error: null,
    });

    mockRequestAuthCreateServerClient.mockReturnValue({ auth: { getUser } });

    const { getCachedRequestAuthUser } =
      await import("@/modules/auth/server/get-request-auth-user");
    const result = await getCachedRequestAuthUser();

    expect(result.errorMessage).toBeNull();
    expect(result.user?.id).toBe("user-1");
    expect(result.user?.email).toBe("user@nxtwave.co.in");
  });
});
