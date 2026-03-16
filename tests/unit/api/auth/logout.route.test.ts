/** @jest-environment node */

jest.mock("@/core/http/with-auth", () => ({
  withAuth: (
    handler: (request: Request, context: { correlationId: string }) => Promise<Response>,
  ) => {
    return (request: Request) =>
      handler(request, {
        correlationId: "cid-logout",
      });
  },
}));

describe("POST /api/auth/logout", () => {
  test("returns loggedOut=true", async () => {
    const { POST } = await import("@/app/api/auth/logout/route");

    const response = await POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
      }) as never,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.loggedOut).toBe(true);
    expect(body.meta.correlationId).toBe("cid-logout");
  });
});
