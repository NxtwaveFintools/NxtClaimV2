const mockLoginWithEmail = jest.fn();
const mockLoginWithOAuth = jest.fn();
const mockEnforceDomain = jest.fn();
const mockLogout = jest.fn();
const mockGetAccessToken = jest.fn();
const mockGetCurrentUser = jest.fn();

jest.mock("@/core/domain/auth/auth.service", () => ({
  AuthService: jest.fn().mockImplementation(() => ({
    loginWithEmail: (...args: unknown[]) => mockLoginWithEmail(...args),
    loginWithOAuth: (...args: unknown[]) => mockLoginWithOAuth(...args),
    enforceDomainOnCurrentSession: (...args: unknown[]) => mockEnforceDomain(...args),
    logout: (...args: unknown[]) => mockLogout(...args),
    getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
    getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
  })),
}));

jest.mock("@/modules/auth/repositories/supabase-auth.repository", () => ({
  SupabaseAuthRepository: jest.fn().mockImplementation(() => ({})),
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
  enforceSessionDomainAction,
  getAccessTokenAction,
  getCurrentUserAction,
  loginWithEmailAction,
  loginWithGoogleAction,
  loginWithMicrosoftAction,
  logoutAction,
} from "@/modules/auth/actions";

describe("auth actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockLoginWithEmail.mockResolvedValue({ errorCode: null, errorMessage: null });
    mockLoginWithOAuth.mockResolvedValue({ errorCode: null, errorMessage: null });
    mockEnforceDomain.mockResolvedValue({ valid: true, hasUser: true, errorMessage: null });
    mockLogout.mockResolvedValue({ errorCode: null, errorMessage: null });
    mockGetAccessToken.mockResolvedValue("access-token");
    mockGetCurrentUser.mockResolvedValue({
      user: { id: "user-1", email: "user@nxtwave.co.in" },
      errorMessage: null,
    });
  });

  test("loginWithEmailAction returns ok true on successful login", async () => {
    const result = await loginWithEmailAction({
      email: "user@nxtwave.co.in",
      password: "password123",
    });

    expect(mockLoginWithEmail).toHaveBeenCalledWith("user@nxtwave.co.in", "password123");
    expect(result).toEqual({ ok: true });
  });

  test("loginWithEmailAction returns fallback message on failure", async () => {
    mockLoginWithEmail.mockResolvedValueOnce({
      errorCode: "AUTH_FAILED",
      errorMessage: null,
    });

    const result = await loginWithEmailAction({
      email: "user@nxtwave.co.in",
      password: "bad-password",
    });

    expect(result).toEqual({
      ok: false,
      message: "We couldn't sign you in. Please try again.",
    });
  });

  test("loginWithMicrosoftAction passes azure provider and callback URL", async () => {
    const result = await loginWithMicrosoftAction();

    expect(result).toEqual({ ok: true });
    expect(mockLoginWithOAuth).toHaveBeenCalledWith(
      "azure",
      `${window.location.origin}/auth/callback`,
    );
  });

  test("loginWithGoogleAction returns provider-specific fallback error", async () => {
    mockLoginWithOAuth.mockResolvedValueOnce({
      errorCode: "AUTH_FAILED",
      errorMessage: null,
    });

    const result = await loginWithGoogleAction();

    expect(result).toEqual({
      ok: false,
      message: "We couldn't complete sign-in with this provider. Please try again.",
    });
    expect(mockLoginWithOAuth).toHaveBeenCalledWith(
      "google",
      `${window.location.origin}/auth/callback`,
    );
  });

  test("enforceSessionDomainAction normalizes invalid session response", async () => {
    mockEnforceDomain.mockResolvedValueOnce({
      valid: false,
      hasUser: true,
      errorMessage: null,
    });

    const result = await enforceSessionDomainAction();

    expect(result).toEqual({
      valid: false,
      hasUser: false,
      message: "We couldn't sign you in. Please try again.",
    });
  });

  test("enforceSessionDomainAction forwards valid state", async () => {
    mockEnforceDomain.mockResolvedValueOnce({
      valid: true,
      hasUser: false,
      errorMessage: null,
    });

    const result = await enforceSessionDomainAction();

    expect(result).toEqual({ valid: true, hasUser: false });
  });

  test("logoutAction delegates to AuthService", async () => {
    await logoutAction();
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  test("getAccessTokenAction and getCurrentUserAction delegate and map data", async () => {
    await expect(getAccessTokenAction()).resolves.toBe("access-token");
    await expect(getCurrentUserAction()).resolves.toEqual({
      id: "user-1",
      email: "user@nxtwave.co.in",
    });

    expect(mockGetAccessToken).toHaveBeenCalledTimes(1);
    expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
  });
});
