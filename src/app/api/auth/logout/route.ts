import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/core/config/server-env";
import { clearSupabaseAuthTokenCookies } from "@/core/infra/supabase/supabase-auth-cookie-utils";
import { createSuccessResponse } from "@/types/api";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  const response = NextResponse.json(createSuccessResponse({ loggedOut: true }, correlationId), {
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
          for (const cookie of cookiesToSet) {
            response.cookies.set(cookie.name, cookie.value, cookie.options);
          }
        },
      },
    },
  );

  try {
    await supabase.auth.signOut();
  } catch {
    // Logout is intentionally idempotent and best-effort.
  }

  clearSupabaseAuthTokenCookies({
    existingCookies: cookieStore.getAll(),
    setCookie: (name, value, options) => {
      response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
    },
  });

  return response;
}
