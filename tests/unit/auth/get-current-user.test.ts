export {};

const mockGetCurrentUser = jest.fn();
const mockRepositoryConstructor = jest.fn();

jest.mock("@/modules/auth/repositories/supabase-server-auth.repository", () => ({
  SupabaseServerAuthRepository: jest.fn().mockImplementation(() => {
    mockRepositoryConstructor();
    return {
      getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
    };
  }),
}));

describe("getCachedCurrentUser", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test("delegates to repository and returns current user payload", async () => {
    mockGetCurrentUser.mockResolvedValue({
      user: { id: "user-1", email: "user@nxtwave.co.in" },
      errorMessage: null,
    });

    const { getCachedCurrentUser } = await import("@/modules/auth/server/get-current-user");

    const result = await getCachedCurrentUser();

    expect(result).toEqual({
      user: { id: "user-1", email: "user@nxtwave.co.in" },
      errorMessage: null,
    });
    expect(mockRepositoryConstructor).toHaveBeenCalled();
    expect(mockGetCurrentUser).toHaveBeenCalled();
  });
});
