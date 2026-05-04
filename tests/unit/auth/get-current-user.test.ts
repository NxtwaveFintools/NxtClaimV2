export {};

const mockGetCachedRequestAuthUser = jest.fn();

jest.mock("@/modules/auth/server/get-request-auth-user", () => ({
  getCachedRequestAuthUser: (...args: unknown[]) => mockGetCachedRequestAuthUser(...args),
}));

describe("getCachedCurrentUser", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test("delegates to repository and returns current user payload", async () => {
    mockGetCachedRequestAuthUser.mockResolvedValue({
      user: { id: "user-1", email: "user@nxtwave.co.in" },
      errorMessage: null,
    });

    const { getCachedCurrentUser } = await import("@/modules/auth/server/get-current-user");

    const result = await getCachedCurrentUser();

    expect(result).toEqual({
      user: { id: "user-1", email: "user@nxtwave.co.in" },
      errorMessage: null,
    });
    expect(mockGetCachedRequestAuthUser).toHaveBeenCalled();
  });
});
