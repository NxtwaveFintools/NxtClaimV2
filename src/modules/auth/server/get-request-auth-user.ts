import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { serverEnv } from "@/core/config/server-env";
import {
  applySupabaseAuthCookies,
  clearSupabaseAuthTokenCookies,
} from "@/core/infra/supabase/supabase-auth-cookie-utils";
import {
  getSupabaseAuthErrorMessage,
  isSupabaseTerminalSessionError,
} from "@/core/infra/supabase/auth-error-utils";

type RequestAuthUserState = {
  user: User | null;
  errorMessage: string | null;
};

function clearAuthCookies(cookieStore: Awaited<ReturnType<typeof cookies>>): void {
  try {
    clearSupabaseAuthTokenCookies({
      existingCookies: cookieStore.getAll(),
      setCookie: (name, value, options) => {
        cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]);
      },
    });
  } catch {
    // Best effort cookie cleanup in SSR contexts where writes may be restricted.
  }
}

export const getCachedRequestAuthUser = cache(async (): Promise<RequestAuthUserState> => {
  const cookieStore = await cookies();

  const supabase = createServerClient(
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

  let user: User | null = null;
  let error: unknown = null;

  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    error = result.error;
  } catch (caughtError) {
    error = caughtError;
  }

  if (error) {
    if (isSupabaseTerminalSessionError(error)) {
      clearAuthCookies(cookieStore);
      return {
        user: null,
        errorMessage: null,
      };
    }

    const errorMessage = getSupabaseAuthErrorMessage(error);

    return {
      user: null,
      errorMessage:
        errorMessage.length > 0
          ? errorMessage
          : error instanceof Error
            ? error.message
            : "Unable to authenticate current request.",
    };
  }

  return {
    user: user ?? null,
    errorMessage: null,
  };
});
