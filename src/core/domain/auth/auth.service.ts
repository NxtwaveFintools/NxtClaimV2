import { AUTH_ERROR_CODES } from "@/core/constants/auth";
import { isAllowedEmailDomain } from "@/core/config/allowed-domains";
import type { AuthRepository, DomainLogger, OAuthProvider } from "@/core/domain/auth/contracts";

type AuthServiceDependencies = {
  repository: AuthRepository;
  logger: DomainLogger;
};

export class AuthService {
  private readonly repository: AuthRepository;
  private readonly logger: DomainLogger;

  constructor(deps: AuthServiceDependencies) {
    this.repository = deps.repository;
    this.logger = deps.logger;
  }

  async loginWithEmail(
    email: string,
    password: string,
  ): Promise<{ errorCode: string | null; errorMessage: string | null }> {
    const result = await this.repository.signInWithEmail(email, password);

    if (result.errorMessage || !result.user || !result.session) {
      this.logger.warn("auth.email_login.failed", {
        maskedEmail: this.logger.maskEmail(email),
      });
      return {
        errorCode: AUTH_ERROR_CODES.authFailed,
        errorMessage: result.errorMessage ?? "Unable to sign in",
      };
    }

    if (!result.user.email || !isAllowedEmailDomain(result.user.email)) {
      await this.repository.signOut();
      this.logger.warn("auth.email_login.domain_blocked", {
        maskedEmail: this.logger.maskEmail(result.user.email),
      });
      return {
        errorCode: AUTH_ERROR_CODES.domainNotAllowed,
        errorMessage: "Your email domain is not authorized for this workspace.",
      };
    }

    const setSessionResult = await this.repository.setSession(result.session);
    if (setSessionResult.errorMessage) {
      this.logger.error("auth.email_login.session_set_failed", {
        maskedEmail: this.logger.maskEmail(result.user.email),
      });
      return {
        errorCode: AUTH_ERROR_CODES.authFailed,
        errorMessage: "Unable to persist your session.",
      };
    }

    this.logger.info("auth.email_login.success", {
      userId: result.user.id,
      domain: result.user.email.split("@")[1],
    });

    return { errorCode: null, errorMessage: null };
  }

  async loginWithOAuth(
    provider: OAuthProvider,
    redirectTo: string,
  ): Promise<{ errorCode: string | null; errorMessage: string | null }> {
    const result = await this.repository.signInWithOAuth(provider, redirectTo);

    if (result.errorMessage) {
      this.logger.warn("auth.oauth.start_failed", { provider });
      return {
        errorCode: AUTH_ERROR_CODES.authFailed,
        errorMessage: result.errorMessage,
      };
    }

    this.logger.info("auth.oauth.started", { provider });
    return { errorCode: null, errorMessage: null };
  }

  async logout(): Promise<{ errorCode: string | null; errorMessage: string | null }> {
    const result = await this.repository.signOut();

    if (result.errorMessage) {
      this.logger.warn("auth.logout.failed");
      return {
        errorCode: AUTH_ERROR_CODES.authFailed,
        errorMessage: result.errorMessage,
      };
    }

    this.logger.info("auth.logout.success");
    return { errorCode: null, errorMessage: null };
  }

  async enforceDomainOnCurrentSession(): Promise<{
    valid: boolean;
    hasUser: boolean;
    errorCode: string | null;
    errorMessage: string | null;
  }> {
    const result = await this.repository.getCurrentUser();

    if (result.errorMessage) {
      return {
        valid: false,
        hasUser: false,
        errorCode: AUTH_ERROR_CODES.authFailed,
        errorMessage: result.errorMessage,
      };
    }

    if (!result.user || !result.user.email) {
      return { valid: true, hasUser: false, errorCode: null, errorMessage: null };
    }

    if (!isAllowedEmailDomain(result.user.email)) {
      await this.repository.signOut();
      this.logger.warn("auth.session.domain_blocked", {
        maskedEmail: this.logger.maskEmail(result.user.email),
      });
      return {
        valid: false,
        hasUser: true,
        errorCode: AUTH_ERROR_CODES.domainNotAllowed,
        errorMessage: "Your email domain is not authorized for this workspace.",
      };
    }

    return { valid: true, hasUser: true, errorCode: null, errorMessage: null };
  }

  async getAccessToken(): Promise<string | null> {
    return this.repository.getAccessToken();
  }

  async getCurrentUser(): Promise<{
    user: { id: string; email: string | null } | null;
    errorMessage: string | null;
  }> {
    return this.repository.getCurrentUser();
  }
}
