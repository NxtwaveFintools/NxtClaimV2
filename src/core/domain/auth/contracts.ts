export type OAuthProvider = "google" | "azure";

export type AuthenticatedUser = {
  id: string;
  email: string | null;
};

export type AuthSessionTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthRepository = {
  signInWithEmail(
    email: string,
    password: string,
  ): Promise<{
    user: AuthenticatedUser | null;
    session: AuthSessionTokens | null;
    errorMessage: string | null;
  }>;
  signInWithOAuth(
    provider: OAuthProvider,
    redirectTo: string,
  ): Promise<{ errorMessage: string | null }>;
  setSession(tokens: AuthSessionTokens): Promise<{ errorMessage: string | null }>;
  signOut(): Promise<{ errorMessage: string | null }>;
  getCurrentUser(): Promise<{ user: AuthenticatedUser | null; errorMessage: string | null }>;
  getAccessToken(): Promise<string | null>;
};

export type DomainLogger = {
  info(event: string, payload?: Record<string, unknown>): void;
  warn(event: string, payload?: Record<string, unknown>): void;
  error(event: string, payload?: Record<string, unknown>): void;
  maskEmail(email?: string | null): string | null;
};
