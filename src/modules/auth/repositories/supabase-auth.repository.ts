"use client";

import type {
  AuthRepository,
  AuthSessionTokens,
  OAuthProvider,
} from "@/core/domain/auth/contracts";
import { getBrowserSupabaseClient } from "@/core/infra/supabase/browser-client";

export class SupabaseAuthRepository implements AuthRepository {
  private isMissingSessionError(message: string | null | undefined): boolean {
    if (!message) return false;

    return message.toLowerCase().includes("auth session missing");
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
      const sessionResponse = await fetch("/api/auth/session", {
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

    return { errorMessage: error?.message ?? null };
  }

  async signOut(): Promise<{ errorMessage: string | null }> {
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
      if (this.isMissingSessionError(error.message)) {
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
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }
}
