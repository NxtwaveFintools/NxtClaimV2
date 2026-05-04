import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_ERROR_CODES } from "@/core/constants/auth";
import { isAllowedEmailDomainInDb } from "@/core/infra/auth/allowed-auth-domains";
import { logger } from "@/core/infra/logging/logger";
import { getPublicServerSupabaseClient } from "@/core/infra/supabase/server-client";
import { createErrorResponse } from "@/types/api";

export type AuthenticatedContext = {
  correlationId: string;
  userId: string;
  email: string;
  accessToken: string;
};

export type AuthenticatedHandler = (
  request: NextRequest,
  context: AuthenticatedContext,
) => Promise<NextResponse>;

function unauthorizedResponse(correlationId: string, message = "Unauthorized"): NextResponse {
  return NextResponse.json(
    createErrorResponse(AUTH_ERROR_CODES.unauthorized, message, correlationId),
    {
      status: 401,
    },
  );
}

export function withAuth(handler: AuthenticatedHandler) {
  return async function wrappedHandler(request: NextRequest): Promise<NextResponse> {
    const correlationId = request.headers.get("x-correlation-id") ?? randomUUID();
    const authHeader = request.headers.get("authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      logger.warn("auth.with_auth.missing_token", { correlationId });
      return unauthorizedResponse(correlationId);
    }

    const accessToken = authHeader.replace("Bearer ", "").trim();
    if (!accessToken) {
      logger.warn("auth.with_auth.empty_token", { correlationId });
      return unauthorizedResponse(correlationId);
    }

    const supabase = getPublicServerSupabaseClient();
    const { data, error } = await supabase.auth.getUser(accessToken);

    if (error || !data.user || !data.user.email) {
      logger.warn("auth.with_auth.invalid_token", { correlationId });
      return unauthorizedResponse(correlationId);
    }

    const domainResult = await isAllowedEmailDomainInDb(data.user.email);

    if (domainResult.errorMessage) {
      logger.error("auth.with_auth.domain_lookup_failed", {
        correlationId,
        userId: data.user.id,
        maskedEmail: logger.maskEmail(data.user.email),
      });

      return NextResponse.json(
        createErrorResponse(
          AUTH_ERROR_CODES.authFailed,
          "Unable to validate your email domain.",
          correlationId,
        ),
        { status: 500 },
      );
    }

    if (!domainResult.isAllowed) {
      logger.warn("auth.with_auth.domain_blocked", {
        correlationId,
        userId: data.user.id,
        maskedEmail: logger.maskEmail(data.user.email),
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

    return handler(request, {
      correlationId,
      userId: data.user.id,
      email: data.user.email,
      accessToken,
    });
  };
}
