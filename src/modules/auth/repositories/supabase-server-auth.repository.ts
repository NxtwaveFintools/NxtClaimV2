import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type {
  AuthRepository,
  AuthSessionTokens,
  OAuthProvider,
} from "@/core/domain/auth/contracts";
import { serverEnv } from "@/core/config/server-env";

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
    const client = await this.getClient();
    const { error } = await client.auth.signOut();
    return { errorMessage: error?.message ?? null };
  }

  async getCurrentUser(): Promise<{
    user: { id: string; email: string | null } | null;
    errorMessage: string | null;
  }> {
    const client = await this.getClient();
    const { data, error } = await client.auth.getUser();

    if (error) {
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
    const client = await this.getClient();
    const {
      data: { session },
    } = await client.auth.getSession();

    return session?.access_token ?? null;
  }

  private async getClient() {
    const cookieStore = await cookies();

    return createServerClient(
      serverEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              try {
                cookieStore.set(name, value, options);
              } catch {
                // Server components may disallow setting cookies; route handlers/actions should handle writes.
              }
            });
          },
        },
      },
    );
  }
}
