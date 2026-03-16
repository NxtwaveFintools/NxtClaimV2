import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedEmailDomain } from "@/core/config/allowed-domains";
import { AUTH_ERROR_CODES } from "@/core/constants/auth";
import { logger } from "@/core/infra/logging/logger";
import { getPublicServerSupabaseClient } from "@/core/infra/supabase/server-client";
import { createErrorResponse, createSuccessResponse } from "@/types/api";

const loginSchema = z.object({
  email: z.email("Enter a valid work email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(request: Request): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const payload = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      createErrorResponse(
        AUTH_ERROR_CODES.validationError,
        parsed.error.issues[0]?.message ?? "Invalid payload",
        correlationId,
      ),
      { status: 400 },
    );
  }

  if (!isAllowedEmailDomain(parsed.data.email)) {
    logger.warn("auth.email_login.blocked_domain", {
      correlationId,
      maskedEmail: logger.maskEmail(parsed.data.email),
    });
    return NextResponse.json(
      createErrorResponse(
        AUTH_ERROR_CODES.domainNotAllowed,
        "Your email domain is not authorized for this workspace.",
        correlationId,
      ),
      { status: 403 },
    );
  }

  const supabase = getPublicServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user || !data.session) {
    logger.warn("auth.email_login.failed", {
      correlationId,
      maskedEmail: logger.maskEmail(parsed.data.email),
    });
    return NextResponse.json(
      createErrorResponse(
        AUTH_ERROR_CODES.authFailed,
        error?.message ?? "Unable to sign in",
        correlationId,
      ),
      { status: 401 },
    );
  }

  logger.info("auth.email_login.success", {
    correlationId,
    userId: data.user.id,
    domain: parsed.data.email.split("@")[1],
  });

  return NextResponse.json(
    createSuccessResponse(
      {
        user: {
          id: data.user.id,
          email: data.user.email,
        },
        session: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        },
      },
      correlationId,
    ),
    { status: 200 },
  );
}
