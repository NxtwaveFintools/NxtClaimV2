import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { z } from "zod";
import { withAuth } from "@/core/http/with-auth";
import { serverEnv } from "@/core/config/server-env";
import { AUTH_ERROR_CODES } from "@/core/constants/auth";
import {
  applySupabaseAuthCookies,
  clearSupabaseAuthTokenCookies,
} from "@/core/infra/supabase/supabase-auth-cookie-utils";
import { isSupabaseTerminalSessionError } from "@/core/infra/supabase/auth-error-utils";
import { createErrorResponse, createSuccessResponse } from "@/types/api";

const sessionSchema = z.object({
  accessToken: z.string().min(1, "Missing access token"),
  refreshToken: z.string().min(1, "Missing refresh token"),
});

const getSessionHandler = async (
  _request: NextRequest,
  context: { correlationId: string; userId: string; email: string },
) => {
  return NextResponse.json(
    createSuccessResponse(
      {
        user: {
          id: context.userId,
          email: context.email,
        },
      },
      context.correlationId,
    ),
    { status: 200 },
  );
};

export const GET = withAuth(getSessionHandler);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const payload = await request.json().catch(() => null);
  const parsed = sessionSchema.safeParse(payload);

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

  const response = NextResponse.json(createSuccessResponse({ established: true }, correlationId), {
    status: 200,
  });

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

  const { error } = await supabase.auth.setSession({
    access_token: parsed.data.accessToken,
    refresh_token: parsed.data.refreshToken,
  });

  if (error) {
    if (isSupabaseTerminalSessionError(error)) {
      clearSupabaseAuthTokenCookies({
        existingCookies: cookieStore.getAll(),
        setCookie: (name, value, options) => {
          response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
        },
      });

      return NextResponse.json(
        createErrorResponse(
          AUTH_ERROR_CODES.sessionExpired,
          "Session expired. Please sign in again.",
          correlationId,
        ),
        { status: 401 },
      );
    }

    return NextResponse.json(
      createErrorResponse(AUTH_ERROR_CODES.authFailed, error.message, correlationId),
      { status: 401 },
    );
  }

  return response;
}
