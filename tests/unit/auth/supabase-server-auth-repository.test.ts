/** @jest-environment node */

import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";

const mockCreateServerClient = jest.fn();
const mockCookies = jest.fn();

jest.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

jest.mock("next/headers", () => ({
  cookies: (...args: unknown[]) => mockCookies(...args),
}));

jest.mock("@/core/config/server-env", () => ({
  serverEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

describe("SupabaseServerAuthRepository", () => {
  const cookieStore = {
    getAll: jest.fn(() => []),
    set: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCookies.mockResolvedValue(cookieStore);
  });

  test("returns unsupported messages for signInWithEmail/signInWithOAuth/setSession", async () => {
    const repository = new SupabaseServerAuthRepository();

    await expect(repository.signInWithEmail("user@nxtwave.co.in", "password123")).resolves.toEqual({
      user: null,
      session: null,
      errorMessage: "signInWithEmail is not available in server route guards",
    });

    await expect(repository.signInWithOAuth("google", "http://localhost")).resolves.toEqual({
      errorMessage: "signInWithOAuth is not available in server route guards",
    });

    await expect(
      repository.setSession({ accessToken: "acc", refreshToken: "ref" }),
    ).resolves.toEqual({
      errorMessage: "setSession is not available in server route guards",
    });
  });

  test("signOut returns null errorMessage on success", async () => {
    const signOut = jest.fn().mockResolvedValue({ error: null });

    mockCreateServerClient.mockReturnValue({
      auth: {
        signOut,
      },
    });

    const repository = new SupabaseServerAuthRepository();
    const result = await repository.signOut();

    expect(result).toEqual({ errorMessage: null });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(mockCreateServerClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
  });

  test("signOut returns error message on failure", async () => {
    const signOut = jest.fn().mockResolvedValue({ error: { message: "logout failed" } });

    mockCreateServerClient.mockReturnValue({ auth: { signOut } });

    const repository = new SupabaseServerAuthRepository();
    const result = await repository.signOut();

    expect(result).toEqual({ errorMessage: "logout failed" });
  });

  test("getCurrentUser handles error and missing user", async () => {
    const getUser = jest
      .fn()
      .mockResolvedValueOnce({ data: { user: null }, error: { message: "bad token" } })
      .mockResolvedValueOnce({ data: { user: null }, error: null });

    mockCreateServerClient.mockReturnValue({ auth: { getUser } });

    const repository = new SupabaseServerAuthRepository();

    await expect(repository.getCurrentUser()).resolves.toEqual({
      user: null,
      errorMessage: "bad token",
    });

    await expect(repository.getCurrentUser()).resolves.toEqual({
      user: null,
      errorMessage: null,
    });
  });

  test("getCurrentUser clears cookies on terminal session errors", async () => {
    cookieStore.getAll.mockReturnValueOnce([
      { name: "sb-project-auth-token", value: "token" },
      { name: "sb-project-auth-token.0", value: "token.0" },
    ] as never);

    const getUser = jest.fn().mockResolvedValue({
      data: { user: null },
      error: {
        message: "Invalid Refresh Token: Refresh Token Not Found",
        code: "refresh_token_not_found",
      },
    });

    mockCreateServerClient.mockReturnValue({ auth: { getUser } });

    const repository = new SupabaseServerAuthRepository();
    const result = await repository.getCurrentUser();

    expect(result).toEqual({
      user: null,
      errorMessage: null,
    });
    expect(cookieStore.set).toHaveBeenCalled();
  });

  test("getCurrentUser maps user payload", async () => {
    const getUser = jest.fn().mockResolvedValue({
      data: { user: { id: "user-1", email: "user@nxtwave.co.in" } },
      error: null,
    });

    mockCreateServerClient.mockReturnValue({ auth: { getUser } });

    const repository = new SupabaseServerAuthRepository();
    const result = await repository.getCurrentUser();

    expect(result).toEqual({
      user: { id: "user-1", email: "user@nxtwave.co.in" },
      errorMessage: null,
    });
  });

  test("getAccessToken returns current access token or null", async () => {
    const getSession = jest
      .fn()
      .mockResolvedValueOnce({ data: { session: { access_token: "token-1" } } })
      .mockResolvedValueOnce({ data: { session: null } });

    mockCreateServerClient.mockReturnValue({ auth: { getSession } });

    const repository = new SupabaseServerAuthRepository();

    await expect(repository.getAccessToken()).resolves.toBe("token-1");
    await expect(repository.getAccessToken()).resolves.toBeNull();
  });

  test("getAccessToken returns null and clears cookies on terminal session errors", async () => {
    cookieStore.getAll.mockReturnValueOnce([
      { name: "sb-project-auth-token", value: "token" },
    ] as never);

    const getSession = jest.fn().mockResolvedValue({
      data: { session: null },
      error: {
        message: "Invalid Refresh Token: Refresh Token Not Found",
        code: "refresh_token_not_found",
      },
    });

    mockCreateServerClient.mockReturnValue({ auth: { getSession } });

    const repository = new SupabaseServerAuthRepository();
    const result = await repository.getAccessToken();

    expect(result).toBeNull();
    expect(cookieStore.set).toHaveBeenCalled();
  });
});
