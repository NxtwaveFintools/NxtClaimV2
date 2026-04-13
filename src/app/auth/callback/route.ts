import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/core/config/server-env";
import { isAllowedEmailDomain } from "@/core/config/allowed-domains";
import { ROUTES } from "@/core/config/route-registry";
import { logger } from "@/core/infra/logging/logger";
import {
  applySupabaseAuthCookies,
  clearSupabaseAuthTokenCookies,
} from "@/core/infra/supabase/supabase-auth-cookie-utils";
import {
  isSupabaseRefreshTokenNotFoundError,
  isSupabaseTerminalSessionError,
} from "@/core/infra/supabase/auth-error-utils";

function clearAuthCookiesOnResponse(
  response: NextResponse,
  existingCookies: { name: string }[],
): void {
  clearSupabaseAuthTokenCookies({
    existingCookies,
    setCookie: (name, value, options) => {
      response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
    },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  const successRedirectUrl = new URL(ROUTES.dashboard, request.url);
  const failureRedirectUrl = new URL(ROUTES.login, request.url);
  failureRedirectUrl.searchParams.set("error", "sso_failed");

  const cookieStore = await cookies();

  if (!code) {
    const missingCodeResponse = NextResponse.redirect(failureRedirectUrl);
    clearAuthCookiesOnResponse(missingCodeResponse, cookieStore.getAll());
    return missingCodeResponse;
  }

  const response = NextResponse.redirect(successRedirectUrl);

  const supabase = createServerClient(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          applySupabaseAuthCookies({
            existingCookies: cookieStore.getAll(),
            cookiesToSet,
            setCookie: (name, value, options) => {
              response.cookies.set(name, value, options);
            },
          });
        },
      },
    },
  );

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    const failedRedirectUrl = new URL(failureRedirectUrl);

    if (
      isSupabaseRefreshTokenNotFoundError(exchangeError) ||
      isSupabaseTerminalSessionError(exchangeError)
    ) {
      failedRedirectUrl.searchParams.set("error", "session_expired");
    }

    logger.warn("auth.oauth.callback.exchange_failed", {
      correlationId,
      code: exchangeError.code,
      status: exchangeError.status,
    });

    const failedResponse = NextResponse.redirect(failedRedirectUrl);
    clearAuthCookiesOnResponse(failedResponse, cookieStore.getAll());
    return failedResponse;
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    logger.warn("auth.oauth.callback.user_fetch_failed", {
      correlationId,
      code: userError.code,
      status: userError.status,
    });

    const failedRedirectUrl = new URL(failureRedirectUrl);
    if (isSupabaseTerminalSessionError(userError)) {
      failedRedirectUrl.searchParams.set("error", "session_expired");
    }

    const failedResponse = NextResponse.redirect(failedRedirectUrl);
    clearAuthCookiesOnResponse(failedResponse, cookieStore.getAll());
    return failedResponse;
  }

  if (!user?.email || !isAllowedEmailDomain(user.email)) {
    await supabase.auth.signOut();

    logger.warn("auth.oauth.callback.domain_blocked", {
      correlationId,
      userId: user?.id,
      maskedEmail: logger.maskEmail(user?.email ?? null),
    });

    const failedRedirectUrl = new URL(ROUTES.login, request.url);
    failedRedirectUrl.searchParams.set("error", "unauthorized_domain");
    const failedResponse = NextResponse.redirect(failedRedirectUrl);
    clearAuthCookiesOnResponse(failedResponse, cookieStore.getAll());
    return failedResponse;
  }

  logger.info("auth.oauth.callback.success", {
    correlationId,
    userId: user.id,
    domain: user.email.split("@")[1],
  });

  return response;
}
