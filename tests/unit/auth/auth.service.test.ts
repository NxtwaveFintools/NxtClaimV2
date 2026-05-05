import { AUTH_ERROR_CODES } from "@/core/constants/auth";
import { AuthService } from "@/core/domain/auth/auth.service";
import type { AuthRepository, DomainLogger } from "@/core/domain/auth/contracts";

function createRepository(): jest.Mocked<AuthRepository> {
  return {
    signInWithEmail: jest.fn(),
    signInWithOAuth: jest.fn(),
    setSession: jest.fn(),
    signOut: jest.fn(),
    getCurrentUser: jest.fn(),
    getAccessToken: jest.fn(),
  };
}

function createLogger(): jest.Mocked<DomainLogger> {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    maskEmail: jest.fn((email?: string | null) => email ?? null),
  };
}

describe("AuthService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("loginWithEmail returns auth failure when sign in fails", async () => {
    const repository = createRepository();
    const logger = createLogger();
    repository.signInWithEmail.mockResolvedValue({
      user: null,
      session: null,
      errorCode: AUTH_ERROR_CODES.authFailed,
      errorMessage: "bad credentials",
    });

    const service = new AuthService({ repository, logger });
    const result = await service.loginWithEmail("user@nxtwave.co.in", "password123");

    expect(result).toEqual({
      errorCode: AUTH_ERROR_CODES.authFailed,
      errorMessage: "bad credentials",
    });
    expect(logger.warn).toHaveBeenCalledWith("auth.email_login.failed", {
      maskedEmail: "user@nxtwave.co.in",
    });
  });

  test("loginWithEmail blocks unauthorized domain", async () => {
    const repository = createRepository();
    const logger = createLogger();
    repository.signInWithEmail.mockResolvedValue({
      user: null,
      session: null,
      errorCode: AUTH_ERROR_CODES.domainNotAllowed,
      errorMessage: "Your email domain is not authorized for this workspace.",
    });

    const service = new AuthService({ repository, logger });
    const result = await service.loginWithEmail("user@blocked.com", "password123");

    expect(result).toEqual({
      errorCode: AUTH_ERROR_CODES.domainNotAllowed,
      errorMessage: "Your email domain is not authorized for this workspace.",
    });
    expect(logger.warn).toHaveBeenCalledWith("auth.email_login.domain_blocked", {
      maskedEmail: "user@blocked.com",
    });
  });

  test("loginWithEmail returns auth failure when setSession fails", async () => {
    const repository = createRepository();
    const logger = createLogger();
    repository.signInWithEmail.mockResolvedValue({
      user: { id: "u1", email: "user@nxtwave.co.in" },
      session: { accessToken: "a", refreshToken: "r" },
      errorCode: null,
      errorMessage: null,
    });
    repository.setSession.mockResolvedValue({ errorMessage: "persist failed" });

    const service = new AuthService({ repository, logger });
    const result = await service.loginWithEmail("user@nxtwave.co.in", "password123");

    expect(result).toEqual({
      errorCode: AUTH_ERROR_CODES.authFailed,
      errorMessage: "Unable to persist your session.",
    });
    expect(logger.error).toHaveBeenCalledWith("auth.email_login.session_set_failed", {
      maskedEmail: "user@nxtwave.co.in",
    });
  });

  test("loginWithEmail succeeds for allowed domain", async () => {
    const repository = createRepository();
    const logger = createLogger();
    repository.signInWithEmail.mockResolvedValue({
      user: { id: "u1", email: "user@nxtwave.co.in" },
      session: { accessToken: "a", refreshToken: "r" },
      errorCode: null,
      errorMessage: null,
    });
    repository.setSession.mockResolvedValue({ errorMessage: null });

    const service = new AuthService({ repository, logger });
    const result = await service.loginWithEmail("user@nxtwave.co.in", "password123");

    expect(result).toEqual({ errorCode: null, errorMessage: null });
    expect(logger.info).toHaveBeenCalledWith("auth.email_login.success", {
      userId: "u1",
      domain: "nxtwave.co.in",
    });
  });

  test("loginWithOAuth handles failure and success", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const service = new AuthService({ repository, logger });

    repository.signInWithOAuth.mockResolvedValueOnce({ errorMessage: "oauth failed" });
    const failed = await service.loginWithOAuth("google", "http://localhost/callback");

    expect(failed).toEqual({
      errorCode: AUTH_ERROR_CODES.authFailed,
      errorMessage: "oauth failed",
    });

    repository.signInWithOAuth.mockResolvedValueOnce({ errorMessage: null });
    const ok = await service.loginWithOAuth("azure", "http://localhost/callback");

    expect(ok).toEqual({ errorCode: null, errorMessage: null });
    expect(logger.info).toHaveBeenCalledWith("auth.oauth.started", { provider: "azure" });
  });

  test("logout handles failure and success", async () => {
    const repository = createRepository();
    const logger = createLogger();
    const service = new AuthService({ repository, logger });

    repository.signOut.mockResolvedValueOnce({ errorMessage: "no session" });
    const failed = await service.logout();
    expect(failed).toEqual({
      errorCode: AUTH_ERROR_CODES.authFailed,
      errorMessage: "no session",
    });

    repository.signOut.mockResolvedValueOnce({ errorMessage: null });
    const ok = await service.logout();
    expect(ok).toEqual({ errorCode: null, errorMessage: null });
    expect(logger.info).toHaveBeenCalledWith("auth.logout.success");
  });

  test("enforceDomainOnCurrentSession handles repo errors", async () => {
    const repository = createRepository();
    const logger = createLogger();
    repository.getCurrentUser.mockResolvedValue({ user: null, errorMessage: "failed" });

    const service = new AuthService({ repository, logger });
    const result = await service.enforceDomainOnCurrentSession();

    expect(result).toEqual({
      valid: false,
      hasUser: false,
      errorCode: AUTH_ERROR_CODES.authFailed,
      errorMessage: "failed",
    });
  });

  test("enforceDomainOnCurrentSession handles missing user", async () => {
    const repository = createRepository();
    const logger = createLogger();
    repository.getCurrentUser.mockResolvedValue({ user: null, errorMessage: null });

    const service = new AuthService({ repository, logger });
    const result = await service.enforceDomainOnCurrentSession();

    expect(result).toEqual({
      valid: true,
      hasUser: false,
      errorCode: null,
      errorMessage: null,
    });
  });

  test("enforceDomainOnCurrentSession treats repository-blocked session as anonymous", async () => {
    const repository = createRepository();
    const logger = createLogger();
    repository.getCurrentUser.mockResolvedValue({
      user: null,
      errorMessage: null,
    });

    const service = new AuthService({ repository, logger });
    const result = await service.enforceDomainOnCurrentSession();

    expect(result).toEqual({
      valid: true,
      hasUser: false,
      errorCode: null,
      errorMessage: null,
    });
  });

  test("enforceDomainOnCurrentSession allows approved domain", async () => {
    const repository = createRepository();
    const logger = createLogger();
    repository.getCurrentUser.mockResolvedValue({
      user: { id: "u1", email: "user@nxtwave.co.in" },
      errorMessage: null,
    });

    const service = new AuthService({ repository, logger });
    const result = await service.enforceDomainOnCurrentSession();

    expect(result).toEqual({
      valid: true,
      hasUser: true,
      errorCode: null,
      errorMessage: null,
    });
  });

  test("getAccessToken and getCurrentUser are pass-through methods", async () => {
    const repository = createRepository();
    const logger = createLogger();
    repository.getAccessToken.mockResolvedValue("access-token");
    repository.getCurrentUser.mockResolvedValue({
      user: { id: "u1", email: "user@nxtwave.co.in" },
      errorMessage: null,
    });

    const service = new AuthService({ repository, logger });

    await expect(service.getAccessToken()).resolves.toBe("access-token");
    await expect(service.getCurrentUser()).resolves.toEqual({
      user: { id: "u1", email: "user@nxtwave.co.in" },
      errorMessage: null,
    });
  });
});
