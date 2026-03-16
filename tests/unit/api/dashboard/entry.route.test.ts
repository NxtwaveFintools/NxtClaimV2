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
        correlationId: "cid-dashboard",
        userId: "dashboard-user",
        email: "dashboard@nxtwave.co.in",
      });
  },
}));

describe("GET /api/dashboard/entry", () => {
  test("returns dashboard access verification response", async () => {
    const { GET } = await import("@/app/api/dashboard/entry/route");

    const response = await GET(new Request("http://localhost/api/dashboard/entry") as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.message).toBe("Dashboard access verified");
    expect(body.data.user).toEqual({ id: "dashboard-user", email: "dashboard@nxtwave.co.in" });
    expect(body.meta.correlationId).toBe("cid-dashboard");
  });
});
