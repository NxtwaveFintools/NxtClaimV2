"use client";

import { AuthService } from "@/core/domain/auth/auth.service";
import { AUTH_PROVIDERS } from "@/core/constants/auth";
import { ROUTES } from "@/core/config/route-registry";
import { logger } from "@/core/infra/logging/logger";
import { SupabaseAuthRepository } from "@/modules/auth/repositories/supabase-auth.repository";
import type { LoginFormValues } from "@/modules/auth/validators/login-schema";

const repository = new SupabaseAuthRepository();
const authService = new AuthService({ repository, logger });

export async function loginWithEmailAction(
  values: LoginFormValues,
): Promise<{ ok: boolean; message?: string }> {
  const result = await authService.loginWithEmail(values.email, values.password);

  if (result.errorCode) {
    return {
      ok: false,
      message: result.errorMessage ?? "Unable to sign in",
    };
  }

  return { ok: true };
}

export async function loginWithMicrosoftAction(): Promise<{ ok: boolean; message?: string }> {
  const redirectTo = `${window.location.origin}${ROUTES.auth.callback}`;
  const result = await authService.loginWithOAuth(AUTH_PROVIDERS.microsoft, redirectTo);

  if (result.errorCode) {
    return { ok: false, message: result.errorMessage ?? "Unable to continue with Microsoft" };
  }

  return { ok: true };
}

export async function loginWithGoogleAction(): Promise<{ ok: boolean; message?: string }> {
  const redirectTo = `${window.location.origin}${ROUTES.auth.callback}`;
  const result = await authService.loginWithOAuth(AUTH_PROVIDERS.google, redirectTo);

  if (result.errorCode) {
    return { ok: false, message: result.errorMessage ?? "Unable to continue with Google" };
  }

  return { ok: true };
}

export async function enforceSessionDomainAction(): Promise<{
  valid: boolean;
  hasUser: boolean;
  message?: string;
}> {
  const result = await authService.enforceDomainOnCurrentSession();
  if (!result.valid) {
    return {
      valid: false,
      hasUser: false,
      message: result.errorMessage ?? "Unauthorized domain",
    };
  }

  return { valid: true, hasUser: result.hasUser };
}

export async function logoutAction(): Promise<void> {
  await authService.logout();
}

export async function getAccessTokenAction(): Promise<string | null> {
  return authService.getAccessToken();
}

export async function getCurrentUserAction(): Promise<{ id: string; email: string | null } | null> {
  const result = await authService.getCurrentUser();
  return result.user;
}
