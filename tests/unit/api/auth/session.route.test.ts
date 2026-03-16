/** @jest-environment node */

jest.mock("@/core/http/with-auth", () => ({
  withAuth: (
    handler: (
      request: Request,
      context: { correlationId: string; userId: string; email: string },
    ) => Promise<Response>,
  ) => {
    return (request: Request) =>
      handler(request, {
        correlationId: "cid-1",
        userId: "user-1",
        email: "user@nxtwave.co.in",
      });
  },
}));

jest.mock("@/core/config/server-env", () => ({
  serverEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

describe("GET /api/auth/session", () => {
  test("returns authenticated user payload", async () => {
    const { GET } = await import("@/app/api/auth/session/route");

    const response = await GET(new Request("http://localhost/api/auth/session") as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.user).toEqual({ id: "user-1", email: "user@nxtwave.co.in" });
    expect(body.meta.correlationId).toBe("cid-1");
  });
});
