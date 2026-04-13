import { NextResponse, type NextRequest } from "next/server";
import { ROUTES } from "@/core/config/route-registry";

/**
 * Compatibility redirect: keep legacy callback URL working while routing all
 * OAuth code exchange logic through the canonical /auth/callback handler.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const redirectUrl = new URL(ROUTES.auth.callback, request.url);
  redirectUrl.search = request.nextUrl.search;

  return NextResponse.redirect(redirectUrl, { status: 307 });
}
