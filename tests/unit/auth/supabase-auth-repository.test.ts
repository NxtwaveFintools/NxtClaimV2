import { SupabaseAuthRepository } from "@/modules/auth/repositories/supabase-auth.repository";

const mockGetBrowserSupabaseClient = jest.fn();

jest.mock("@/core/infra/supabase/browser-client", () => ({
  getBrowserSupabaseClient: () => mockGetBrowserSupabaseClient(),
}));

type AuthClient = {
  auth: {
    signInWithPassword: jest.Mock;
    signInWithOAuth: jest.Mock;
    setSession: jest.Mock;
    signOut: jest.Mock;
    getUser: jest.Mock;
    getSession: jest.Mock;
  };
};

function createAuthClient(): AuthClient {
  return {
    auth: {
      signInWithPassword: jest.fn(),
      signInWithOAuth: jest.fn(),
      setSession: jest.fn(),
      signOut: jest.fn(),
      getUser: jest.fn(),
      getSession: jest.fn(),
    },
  };
}

describe("SupabaseAuthRepository", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
  });

  test("signInWithEmail returns auth error from Supabase", async () => {
    const client = createAuthClient();
    client.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid credentials" },
    });
    mockGetBrowserSupabaseClient.mockReturnValue(client);

    const repository = new SupabaseAuthRepository();
    const result = await repository.signInWithEmail("user@nxtwave.co.in", "bad-password");

    expect(result).toEqual({
      user: null,
      session: null,
      errorMessage: "Invalid credentials",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("signInWithEmail establishes app session and maps tokens", async () => {
    const client = createAuthClient();
    client.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: "user-1", email: "user@nxtwave.co.in" },
        session: { access_token: "access-1", refresh_token: "refresh-1" },
      },
      error: null,
    });
    mockGetBrowserSupabaseClient.mockReturnValue(client);

    mockFetch.mockResolvedValue({ ok: true });

    const repository = new SupabaseAuthRepository();
    const result = await repository.signInWithEmail("user@nxtwave.co.in", "password123");

    expect(mockFetch).toHaveBeenCalledWith("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "access-1", refreshToken: "refresh-1" }),
    });
    expect(result).toEqual({
      user: { id: "user-1", email: "user@nxtwave.co.in" },
      session: { accessToken: "access-1", refreshToken: "refresh-1" },
      errorMessage: null,
    });
  });

  test("signInWithEmail returns API session error payload when session bootstrap fails", async () => {
    const client = createAuthClient();
    client.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: "user-1", email: "user@nxtwave.co.in" },
        session: { access_token: "access-1", refresh_token: "refresh-1" },
      },
      error: null,
    });
    mockGetBrowserSupabaseClient.mockReturnValue(client);

    mockFetch.mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({
        error: { message: "Unable to persist browser session" },
      }),
    });

    const repository = new SupabaseAuthRepository();
    const result = await repository.signInWithEmail("user@nxtwave.co.in", "password123");

    expect(result).toEqual({
      user: null,
      session: null,
      errorMessage: "Unable to persist browser session",
    });
  });

  test("signInWithEmail falls back to default message when session bootstrap payload is invalid", async () => {
    const client = createAuthClient();
    client.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: "user-1", email: "user@nxtwave.co.in" },
        session: { access_token: "access-1", refresh_token: "refresh-1" },
      },
      error: null,
    });
    mockGetBrowserSupabaseClient.mockReturnValue(client);

    mockFetch.mockResolvedValue({
      ok: false,
      json: jest.fn().mockRejectedValue(new Error("invalid json")),
    });

    const repository = new SupabaseAuthRepository();
    const result = await repository.signInWithEmail("user@nxtwave.co.in", "password123");

    expect(result.errorMessage).toBe("Unable to establish authenticated session.");
  });

  test("signInWithEmail returns user without API bootstrap when session is missing", async () => {
    const client = createAuthClient();
    client.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: "user-2", email: null },
        session: null,
      },
      error: null,
    });
    mockGetBrowserSupabaseClient.mockReturnValue(client);

    const repository = new SupabaseAuthRepository();
    const result = await repository.signInWithEmail("user@nxtwave.co.in", "password123");

    expect(result).toEqual({
      user: { id: "user-2", email: null },
      session: null,
      errorMessage: null,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("signInWithOAuth returns error message passthrough", async () => {
    const client = createAuthClient();
    client.auth.signInWithOAuth.mockResolvedValue({ error: { message: "oauth failed" } });
    mockGetBrowserSupabaseClient.mockReturnValue(client);

    const repository = new SupabaseAuthRepository();
    const result = await repository.signInWithOAuth("google", "http://localhost/auth/callback");

    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost/auth/callback" },
    });
    expect(result).toEqual({ errorMessage: "oauth failed" });
  });

  test("setSession and signOut return Supabase errors", async () => {
    const client = createAuthClient();
    client.auth.setSession.mockResolvedValue({ error: { message: "set failed" } });
    client.auth.signOut.mockResolvedValue({ error: { message: "logout failed" } });
    mockGetBrowserSupabaseClient.mockReturnValue(client);

    const repository = new SupabaseAuthRepository();

    await expect(repository.setSession({ accessToken: "a", refreshToken: "r" })).resolves.toEqual({
      errorMessage: "set failed",
    });
    await expect(repository.signOut()).resolves.toEqual({ errorMessage: "logout failed" });
  });

  test("setSession performs cleanup for terminal session errors", async () => {
    const client = createAuthClient();
    client.auth.setSession.mockResolvedValue({
      error: {
        message: "Invalid Refresh Token: Refresh Token Not Found",
        code: "refresh_token_not_found",
      },
    });
    client.auth.signOut.mockResolvedValue({ error: null });
    mockGetBrowserSupabaseClient.mockReturnValue(client);

    mockFetch.mockResolvedValue({ ok: true });

    const repository = new SupabaseAuthRepository();
    const result = await repository.setSession({ accessToken: "a", refreshToken: "r" });

    expect(result).toEqual({ errorMessage: "Your session has expired. Please sign in again." });
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
    });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  test("getCurrentUser treats missing-session errors as anonymous", async () => {
    const client = createAuthClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "Auth Session Missing" },
    });
    client.auth.signOut.mockResolvedValue({ error: null });
    mockGetBrowserSupabaseClient.mockReturnValue(client);
    mockFetch.mockResolvedValue({ ok: true });

    const repository = new SupabaseAuthRepository();
    const result = await repository.getCurrentUser();

    expect(result).toEqual({ user: null, errorMessage: null });
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
    });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  test("getCurrentUser treats refresh_token_not_found as anonymous and cleans up", async () => {
    const client = createAuthClient();
    client.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: {
        message: "Invalid Refresh Token: Refresh Token Not Found",
        code: "refresh_token_not_found",
      },
    });
    client.auth.signOut.mockResolvedValue({ error: null });
    mockGetBrowserSupabaseClient.mockReturnValue(client);
    mockFetch.mockResolvedValue({ ok: true });

    const repository = new SupabaseAuthRepository();
    const result = await repository.getCurrentUser();

    expect(result).toEqual({ user: null, errorMessage: null });
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
    });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  test("getCurrentUser returns non-session errors and maps successful user", async () => {
    const client = createAuthClient();
    client.auth.getUser
      .mockResolvedValueOnce({
        data: { user: null },
        error: { message: "network failed" },
      })
      .mockResolvedValueOnce({
        data: { user: { id: "user-3", email: "member@nxtwave.co.in" } },
        error: null,
      });
    mockGetBrowserSupabaseClient.mockReturnValue(client);

    const repository = new SupabaseAuthRepository();

    await expect(repository.getCurrentUser()).resolves.toEqual({
      user: null,
      errorMessage: "network failed",
    });

    await expect(repository.getCurrentUser()).resolves.toEqual({
      user: { id: "user-3", email: "member@nxtwave.co.in" },
      errorMessage: null,
    });
  });

  test("getAccessToken returns current access token or null", async () => {
    const client = createAuthClient();
    client.auth.getSession
      .mockResolvedValueOnce({ data: { session: { access_token: "token-123" } } })
      .mockResolvedValueOnce({ data: { session: null } });
    mockGetBrowserSupabaseClient.mockReturnValue(client);

    const repository = new SupabaseAuthRepository();

    await expect(repository.getAccessToken()).resolves.toBe("token-123");
    await expect(repository.getAccessToken()).resolves.toBeNull();
  });

  test("getAccessToken cleans up on terminal session errors", async () => {
    const client = createAuthClient();
    client.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: {
        message: "Invalid Refresh Token: Refresh Token Not Found",
        code: "refresh_token_not_found",
      },
    });
    client.auth.signOut.mockResolvedValue({ error: null });
    mockGetBrowserSupabaseClient.mockReturnValue(client);
    mockFetch.mockResolvedValue({ ok: true });

    const repository = new SupabaseAuthRepository();
    const token = await repository.getAccessToken();

    expect(token).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
    });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
