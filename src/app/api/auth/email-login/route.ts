import { NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedEmailDomainInDb } from "@/core/infra/auth/allowed-auth-domains";
import { AUTH_ERROR_CODES, AUTH_ERROR_MESSAGES } from "@/core/constants/auth";
import { logger } from "@/core/infra/logging/logger";
import { getPublicServerSupabaseClient } from "@/core/infra/supabase/server-client";
import { createErrorResponse, createSuccessResponse } from "@/types/api";
import { getUserFriendlyErrorMessage } from "@/core/errors/user-facing-errors";

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
        parsed.error.issues[0]?.message ?? "Please enter a valid email and password.",
        correlationId,
      ),
      { status: 400 },
    );
  }

  const domainResult = await isAllowedEmailDomainInDb(parsed.data.email);

  if (domainResult.errorMessage) {
    logger.error("auth.email_login.domain_lookup_failed", {
      correlationId,
      maskedEmail: logger.maskEmail(parsed.data.email),
    });
    return NextResponse.json(
      createErrorResponse(
        AUTH_ERROR_CODES.authFailed,
        AUTH_ERROR_MESSAGES.domainValidationFailed,
        correlationId,
      ),
      { status: 500 },
    );
  }

  if (!domainResult.isAllowed) {
    logger.warn("auth.email_login.blocked_domain", {
      correlationId,
      maskedEmail: logger.maskEmail(parsed.data.email),
    });
    return NextResponse.json(
      createErrorResponse(
        AUTH_ERROR_CODES.domainNotAllowed,
        AUTH_ERROR_MESSAGES.domainNotAllowed,
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
        getUserFriendlyErrorMessage(error ?? "Invalid login credentials", "auth"),
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
