/** @jest-environment node */

import { AUTH_ERROR_CODES } from "@/core/constants/auth";

const mockIsAllowedEmailDomain = jest.fn();
const mockSignInWithPassword = jest.fn();

jest.mock("@/core/config/allowed-domains", () => ({
  isAllowedEmailDomain: (...args: unknown[]) => mockIsAllowedEmailDomain(...args),
}));

jest.mock("@/core/infra/supabase/server-client", () => ({
  getPublicServerSupabaseClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
    },
  }),
}));

jest.mock("@/core/infra/logging/logger", () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    maskEmail: jest.fn((value: string | null) => value),
  },
}));

function buildRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/email-login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-correlation-id": "cid-1" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/email-login", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAllowedEmailDomain.mockReturnValue(true);
  });

  test("returns 400 for invalid payload", async () => {
    const { POST } = await import("@/app/api/auth/email-login/route");

    const response = await POST(buildRequest({ email: "bad", password: "123" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe(AUTH_ERROR_CODES.validationError);
  });

  test("returns 403 for blocked email domain", async () => {
    mockIsAllowedEmailDomain.mockReturnValue(false);
    const { POST } = await import("@/app/api/auth/email-login/route");

    const response = await POST(
      buildRequest({ email: "user@blocked.com", password: "password123" }),
    );

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe(AUTH_ERROR_CODES.domainNotAllowed);
  });

  test("returns 401 when Supabase sign in fails", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "invalid" },
    });

    const { POST } = await import("@/app/api/auth/email-login/route");
    const response = await POST(
      buildRequest({ email: "user@nxtwave.co.in", password: "password123" }),
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe(AUTH_ERROR_CODES.authFailed);
  });

  test("returns 200 with user and session tokens on success", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: {
        user: { id: "user-1", email: "user@nxtwave.co.in" },
        session: { access_token: "acc", refresh_token: "ref" },
      },
      error: null,
    });

    const { POST } = await import("@/app/api/auth/email-login/route");
    const response = await POST(
      buildRequest({ email: "user@nxtwave.co.in", password: "password123" }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.user).toEqual({ id: "user-1", email: "user@nxtwave.co.in" });
    expect(body.data.session).toEqual({ accessToken: "acc", refreshToken: "ref" });
    expect(body.meta.correlationId).toBe("cid-1");
  });
});
