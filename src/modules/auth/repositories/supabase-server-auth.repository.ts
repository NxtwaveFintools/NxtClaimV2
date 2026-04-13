import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type {
  AuthRepository,
  AuthSessionTokens,
  OAuthProvider,
} from "@/core/domain/auth/contracts";
import { serverEnv } from "@/core/config/server-env";
import {
  applySupabaseAuthCookies,
  clearSupabaseAuthTokenCookies,
} from "@/core/infra/supabase/supabase-auth-cookie-utils";
import { isSupabaseTerminalSessionError } from "@/core/infra/supabase/auth-error-utils";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export class SupabaseServerAuthRepository implements AuthRepository {
  async signInWithEmail(
    _email: string,
    _password: string,
  ): Promise<{
    user: { id: string; email: string | null } | null;
    session: AuthSessionTokens | null;
    errorMessage: string | null;
  }> {
    void _email;
    void _password;
    return {
      user: null,
      session: null,
      errorMessage: "signInWithEmail is not available in server route guards",
    };
  }

  async signInWithOAuth(
    _provider: OAuthProvider,
    _redirectTo: string,
  ): Promise<{ errorMessage: string | null }> {
    void _provider;
    void _redirectTo;
    return {
      errorMessage: "signInWithOAuth is not available in server route guards",
    };
  }

  async setSession(_tokens: AuthSessionTokens): Promise<{ errorMessage: string | null }> {
    void _tokens;
    return {
      errorMessage: "setSession is not available in server route guards",
    };
  }

  async signOut(): Promise<{ errorMessage: string | null }> {
    const { client, cookieStore } = await this.getClientContext();
    const { error } = await client.auth.signOut();
    this.clearAuthCookies(cookieStore);
    return { errorMessage: error?.message ?? null };
  }

  async getCurrentUser(): Promise<{
    user: { id: string; email: string | null } | null;
    errorMessage: string | null;
  }> {
    const { client, cookieStore } = await this.getClientContext();
    const { data, error } = await client.auth.getUser();

    if (error) {
      if (isSupabaseTerminalSessionError(error)) {
        this.clearAuthCookies(cookieStore);
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
    const { client, cookieStore } = await this.getClientContext();
    const {
      data: { session },
      error,
    } = await client.auth.getSession();

    if (error) {
      if (isSupabaseTerminalSessionError(error)) {
        this.clearAuthCookies(cookieStore);
      }

      return null;
    }

    return session?.access_token ?? null;
  }

  private async getClientContext() {
    const cookieStore = await cookies();
    const client = createServerClient(
      serverEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              applySupabaseAuthCookies({
                existingCookies: cookieStore.getAll(),
                cookiesToSet,
                setCookie: (name, value, options) => {
                  cookieStore.set(name, value, options);
                },
              });
            } catch {
              cookiesToSet.forEach(({ name, value, options }) => {
                try {
                  cookieStore.set(name, value, options);
                } catch {
                  // Server components may disallow setting cookies; route handlers/actions should handle writes.
                }
              });
            }
          },
        },
      },
    );

    return {
      client,
      cookieStore,
    };
  }

  private clearAuthCookies(cookieStore: CookieStore): void {
    try {
      clearSupabaseAuthTokenCookies({
        existingCookies: cookieStore.getAll(),
        setCookie: (name, value, options) => {
          cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]);
        },
      });
    } catch {
      // Best effort cookie cleanup for terminal session failures.
    }
  }
}
