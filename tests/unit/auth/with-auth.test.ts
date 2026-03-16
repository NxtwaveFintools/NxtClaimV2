/** @jest-environment node */

import { NextResponse } from "next/server";
import { AUTH_ERROR_CODES } from "@/core/constants/auth";

const mockGetUser = jest.fn();
const mockIsAllowedEmailDomain = jest.fn();

jest.mock("@/core/infra/supabase/server-client", () => ({
  getPublicServerSupabaseClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

jest.mock("@/core/config/allowed-domains", () => ({
  isAllowedEmailDomain: (...args: unknown[]) => mockIsAllowedEmailDomain(...args),
}));

jest.mock("@/core/infra/logging/logger", () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    maskEmail: jest.fn((value: string | null) => value),
  },
}));

describe("withAuth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAllowedEmailDomain.mockReturnValue(true);
  });

  test("returns 401 when authorization header is missing", async () => {
    const { withAuth } = await import("@/core/http/with-auth");

    const wrapped = withAuth(async () => NextResponse.json({ ok: true }, { status: 200 }));
    const response = await wrapped(new Request("http://localhost/api/test") as never);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe(AUTH_ERROR_CODES.unauthorized);
  });

  test("returns 401 when token is invalid", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });
    const { withAuth } = await import("@/core/http/with-auth");

    const wrapped = withAuth(async () => NextResponse.json({ ok: true }, { status: 200 }));
    const response = await wrapped(
      new Request("http://localhost/api/test", {
        headers: { authorization: "Bearer invalid-token" },
      }) as never,
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe(AUTH_ERROR_CODES.unauthorized);
  });

  test("returns 403 when email domain is not allowed", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "user@blocked.com" } },
      error: null,
    });
    mockIsAllowedEmailDomain.mockReturnValue(false);

    const { withAuth } = await import("@/core/http/with-auth");
    const wrapped = withAuth(async () => NextResponse.json({ ok: true }, { status: 200 }));
    const response = await wrapped(
      new Request("http://localhost/api/test", {
        headers: { authorization: "Bearer valid-token" },
      }) as never,
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe(AUTH_ERROR_CODES.domainNotAllowed);
  });

  test("calls protected handler with authenticated context", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "user@nxtwave.co.in" } },
      error: null,
    });

    const { withAuth } = await import("@/core/http/with-auth");
    const wrapped = withAuth(async (_request, context) => {
      return NextResponse.json(
        {
          ok: true,
          userId: context.userId,
          email: context.email,
          accessToken: context.accessToken,
          correlationId: context.correlationId,
        },
        { status: 200 },
      );
    });

    const response = await wrapped(
      new Request("http://localhost/api/test", {
        headers: {
          authorization: "Bearer good-token",
          "x-correlation-id": "cid-1",
        },
      }) as never,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      userId: "user-1",
      email: "user@nxtwave.co.in",
      accessToken: "good-token",
      correlationId: "cid-1",
    });
  });
});
