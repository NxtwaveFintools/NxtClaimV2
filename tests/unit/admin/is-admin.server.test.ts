/** @jest-environment node */

export {};

const mockGetCachedRequestAuthUser = jest.fn();
const mockGetServiceRoleSupabaseClient = jest.fn();
const mockServiceRoleFrom = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerDebug = jest.fn();

jest.mock("@/modules/auth/server/get-request-auth-user", () => ({
  getCachedRequestAuthUser: (...args: unknown[]) => mockGetCachedRequestAuthUser(...args),
}));

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: (...args: unknown[]) => mockGetServiceRoleSupabaseClient(...args),
}));

jest.mock("@/core/infra/logging/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: jest.fn(),
    debug: (...args: unknown[]) => mockLoggerDebug(...args),
    maskEmail: jest.fn((value: string | null) => value),
  },
}));

jest.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args),
  revalidateTag: jest.fn(),
}));

jest.mock("@/modules/auth/server/user-role-cache", () => ({
  getUserRoleCacheTag: (userId: string) => `user-role:${userId}`,
  USER_ROLE_CACHE_TAG: "user-role",
}));

describe("isAdmin", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockServiceRoleFrom,
    });
  });

  test("returns false when auth user is unavailable", async () => {
    mockGetCachedRequestAuthUser.mockResolvedValue({
      user: null,
      errorMessage: "invalid token",
    });

    const { isAdmin } = await import("@/modules/admin/server/is-admin");
    await expect(isAdmin()).resolves.toBe(false);
  });

  test("returns false and logs warning when admins table query fails", async () => {
    mockGetCachedRequestAuthUser.mockResolvedValue({
      user: { id: "user-1", app_metadata: {} },
      errorMessage: null,
    });

    const query = {
      eq: jest.fn(async () => ({ count: null, error: { message: "query failed", code: "500" } })),
    };
    mockServiceRoleFrom.mockReturnValue({
      select: jest.fn(() => query),
    });

    const { isAdmin } = await import("@/modules/admin/server/is-admin");
    await expect(isAdmin()).resolves.toBe(false);

    expect(mockLoggerWarn).toHaveBeenCalledWith("admin.is_admin.query_failed", {
      userId: "user-1",
      error: "query failed",
      code: "500",
    });
  });

  test("returns true when admin count is positive", async () => {
    mockGetCachedRequestAuthUser.mockResolvedValue({
      user: { id: "user-1", app_metadata: {} },
      errorMessage: null,
    });

    const query = {
      eq: jest.fn(async () => ({ count: 1, error: null })),
    };
    mockServiceRoleFrom.mockReturnValue({
      select: jest.fn(() => query),
    });

    const { isAdmin } = await import("@/modules/admin/server/is-admin");
    await expect(isAdmin()).resolves.toBe(true);
    // The "check_complete" debug log was intentionally removed in commit 6be1351
    // (feat: remove debug logging from various services and components).
  });

  test("returns false when an unexpected exception occurs", async () => {
    mockGetCachedRequestAuthUser.mockRejectedValueOnce(new Error("headers unavailable"));

    const { isAdmin } = await import("@/modules/admin/server/is-admin");
    await expect(isAdmin()).resolves.toBe(false);
  });
});
