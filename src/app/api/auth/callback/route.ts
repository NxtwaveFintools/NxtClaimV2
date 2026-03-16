import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/core/config/server-env";
import { isAllowedEmailDomain } from "@/core/config/allowed-domains";
import { ROUTES } from "@/core/config/route-registry";
import { logger } from "@/core/infra/logging/logger";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const origin = requestUrl.origin;
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  const successRedirectUrl = new URL(ROUTES.dashboard, origin);
  const failureRedirectUrl = new URL(ROUTES.login, origin);
  failureRedirectUrl.searchParams.set("error", "unauthorized_domain");

  const response = NextResponse.redirect(successRedirectUrl);
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
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logger.warn("auth.oauth.callback.exchange_failed", { correlationId });
      return NextResponse.redirect(failureRedirectUrl);
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !isAllowedEmailDomain(user.email)) {
    await supabase.auth.signOut();
    logger.warn("auth.oauth.callback.domain_blocked", {
      correlationId,
      userId: user?.id,
      maskedEmail: logger.maskEmail(user?.email ?? null),
    });
    return NextResponse.redirect(failureRedirectUrl);
  }

  logger.info("auth.oauth.callback.success", {
    correlationId,
    userId: user.id,
    domain: user.email.split("@")[1],
  });

  return response;
}
