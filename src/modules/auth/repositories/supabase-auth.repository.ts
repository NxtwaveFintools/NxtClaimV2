"use client";

import type {
  AuthRepository,
  AuthSessionTokens,
  OAuthProvider,
} from "@/core/domain/auth/contracts";
import { getBrowserSupabaseClient } from "@/core/infra/supabase/browser-client";
import {
  isSupabaseAuthSessionMissingError,
  isSupabaseTerminalSessionError,
} from "@/core/infra/supabase/auth-error-utils";
import { ROUTES } from "@/core/config/route-registry";

export class SupabaseAuthRepository implements AuthRepository {
  private sessionCleanupInFlight: Promise<void> | null = null;

  private async cleanupBrokenSession(): Promise<void> {
    if (this.sessionCleanupInFlight) {
      return this.sessionCleanupInFlight;
    }

    const supabase = getBrowserSupabaseClient();

    this.sessionCleanupInFlight = (async () => {
      await fetch(ROUTES.authApi.logout, {
        method: "POST",
      }).catch(() => null);

      await supabase.auth.signOut({ scope: "local" }).catch(() => null);
    })().finally(() => {
      this.sessionCleanupInFlight = null;
    });

    return this.sessionCleanupInFlight;
  }

  async signInWithEmail(
    email: string,
    password: string,
  ): Promise<{
    user: { id: string; email: string | null } | null;
    session: AuthSessionTokens | null;
    errorMessage: string | null;
  }> {
    const supabase = getBrowserSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return { user: null, session: null, errorMessage: error.message };
    }

    if (data.session) {
      const sessionResponse = await fetch(ROUTES.authApi.session, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        }),
      });

      if (!sessionResponse.ok) {
        const payload = (await sessionResponse.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;

        return {
          user: null,
          session: null,
          errorMessage: payload?.error?.message ?? "Unable to establish authenticated session.",
        };
      }
    }

    const user = data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
    const session = data.session
      ? {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        }
      : null;

    return { user, session, errorMessage: null };
  }

  async signInWithOAuth(
    provider: OAuthProvider,
    redirectTo: string,
  ): Promise<{ errorMessage: string | null }> {
    const supabase = getBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
      },
    });

    return { errorMessage: error?.message ?? null };
  }

  async setSession(tokens: AuthSessionTokens): Promise<{ errorMessage: string | null }> {
    const supabase = getBrowserSupabaseClient();
    const { error } = await supabase.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });

    if (error && isSupabaseTerminalSessionError(error)) {
      await this.cleanupBrokenSession();
      return { errorMessage: "Your session has expired. Please sign in again." };
    }

    return { errorMessage: error?.message ?? null };
  }

  async signOut(): Promise<{ errorMessage: string | null }> {
    await fetch("/api/auth/logout", {
      method: "POST",
    }).catch(() => null);

    const supabase = getBrowserSupabaseClient();
    const { error } = await supabase.auth.signOut();
    return { errorMessage: error?.message ?? null };
  }

  async getCurrentUser(): Promise<{
    user: { id: string; email: string | null } | null;
    errorMessage: string | null;
  }> {
    const supabase = getBrowserSupabaseClient();
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      if (isSupabaseAuthSessionMissingError(error) || isSupabaseTerminalSessionError(error)) {
        await this.cleanupBrokenSession();
        return { user: null, errorMessage: null };
      }

      return { user: null, errorMessage: error.message };
    }

    if (!data.user) {
      return { user: null, errorMessage: null };
    }

    return {
      user: {
        id: data.user.id,
        email: data.user.email ?? null,
      },
      errorMessage: null,
    };
  }

  async getAccessToken(): Promise<string | null> {
    const supabase = getBrowserSupabaseClient();
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      if (isSupabaseAuthSessionMissingError(error) || isSupabaseTerminalSessionError(error)) {
        await this.cleanupBrokenSession();
      }

      return null;
    }

    return data.session?.access_token ?? null;
  }
}
