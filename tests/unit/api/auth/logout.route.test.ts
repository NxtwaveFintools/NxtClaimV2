/** @jest-environment node */

const mockCreateServerClient = jest.fn();
const mockCookies = jest.fn();

jest.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

jest.mock("next/headers", () => ({
  cookies: (...args: unknown[]) => mockCookies(...args),
}));

jest.mock("@/core/config/server-env", () => ({
  serverEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

function createLogoutRequest(correlationId = "cid-logout"): Request {
  return new Request("http://localhost/api/auth/logout", {
    method: "POST",
    headers: {
      "x-correlation-id": correlationId,
    },
  });
}

function getSetCookieHeader(response: Response): string {
  const headersWithGetSetCookie = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headersWithGetSetCookie.getSetCookie === "function") {
    return headersWithGetSetCookie.getSetCookie().join("\n");
  }

  return response.headers.get("set-cookie") ?? "";
}

describe("POST /api/auth/logout", () => {
  const cookieStore = {
    getAll: jest.fn(() => []),
    set: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    cookieStore.getAll.mockReturnValue([]);
    mockCookies.mockResolvedValue(cookieStore);
  });

  test("returns 200 loggedOut=true and preserves provided correlation id on successful signOut", async () => {
    const signOut = jest.fn().mockResolvedValue({ error: null });
    mockCreateServerClient.mockReturnValue({
      auth: { signOut },
    });

    const { POST } = await import("@/app/api/auth/logout/route");

    const response = await POST(createLogoutRequest("cid-logout-success") as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.loggedOut).toBe(true);
    expect(body.meta.correlationId).toBe("cid-logout-success");
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test.each([
    {
      label: "signOut throws",
      createSignOut: () => jest.fn().mockRejectedValue(new Error("network error")),
    },
    {
      label: "signOut resolves with error",
      createSignOut: () => jest.fn().mockResolvedValue({ error: { message: "invalid token" } }),
    },
  ])("still returns success when $label", async ({ createSignOut }) => {
    const signOut = createSignOut();
    mockCreateServerClient.mockReturnValue({
      auth: { signOut },
    });

    const { POST } = await import("@/app/api/auth/logout/route");
    const response = await POST(createLogoutRequest("cid-logout-failure") as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.loggedOut).toBe(true);
    expect(body.meta.correlationId).toBe("cid-logout-failure");
  });

  test("clears Supabase auth cookies by setting expired sb-* auth-token cookies", async () => {
    cookieStore.getAll.mockReturnValue([
      { name: "sb-project-auth-token", value: "token" },
      { name: "sb-project-auth-token.0", value: "token.0" },
      { name: "session", value: "keep-me" },
    ] as never);

    mockCreateServerClient.mockReturnValue({
      auth: { signOut: jest.fn().mockResolvedValue({ error: null }) },
    });

    const { POST } = await import("@/app/api/auth/logout/route");
    const response = await POST(createLogoutRequest("cid-logout-cookies") as never);

    expect(response.status).toBe(200);
    const setCookieHeader = getSetCookieHeader(response);

    expect(setCookieHeader).toMatch(/sb-project-auth-token=/i);
    expect(setCookieHeader).toMatch(/sb-project-auth-token\.0=/i);
    expect(setCookieHeader).toMatch(/max-age=0/i);
  });
});
