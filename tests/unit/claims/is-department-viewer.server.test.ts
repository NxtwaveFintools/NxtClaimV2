/** @jest-environment node */

export {};

const mockCookies = jest.fn();
const mockCreateServerClient = jest.fn();
const mockGetCachedRequestAuthUser = jest.fn();
const mockFrom = jest.fn();
const mockGetServiceRoleSupabaseClient = jest.fn();
const mockServiceRoleFrom = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock("next/headers", () => ({
  cookies: (...args: unknown[]) => mockCookies(...args),
}));

jest.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}));

jest.mock("@/modules/auth/server/get-request-auth-user", () => ({
  getCachedRequestAuthUser: (...args: unknown[]) => mockGetCachedRequestAuthUser(...args),
}));

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: (...args: unknown[]) => mockGetServiceRoleSupabaseClient(...args),
}));

jest.mock("@/core/config/server-env", () => ({
  serverEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

jest.mock("@/core/infra/logging/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: jest.fn(),
    debug: jest.fn(),
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

function createTwoEqSelect(finalResult: unknown) {
  const secondEq = jest.fn(async () => finalResult);
  const firstEq = jest.fn(() => ({ eq: secondEq }));
  const select = jest.fn(() => ({ eq: firstEq }));

  return { select, firstEq, secondEq };
}

describe("department viewer server helpers", () => {
  const cookieStore = {
    getAll: jest.fn(() => []),
    set: jest.fn(),
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    mockCookies.mockResolvedValue(cookieStore);
    mockCreateServerClient.mockReturnValue({
      from: mockFrom,
    });
    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockServiceRoleFrom,
    });
  });

  test("isDepartmentViewer returns false when auth user is missing", async () => {
    mockGetCachedRequestAuthUser.mockResolvedValue({ user: null, errorMessage: null });

    const { isDepartmentViewer } = await import("@/modules/claims/server/is-department-viewer");
    await expect(isDepartmentViewer()).resolves.toBe(false);
  });

  test("isDepartmentViewer returns true when assignment count is positive", async () => {
    mockGetCachedRequestAuthUser.mockResolvedValue({
      user: { id: "user-1", app_metadata: {} },
      errorMessage: null,
    });

    const query = createTwoEqSelect({ count: 2, error: null });
    mockServiceRoleFrom.mockReturnValue({ select: query.select });

    const { isDepartmentViewer } = await import("@/modules/claims/server/is-department-viewer");
    await expect(isDepartmentViewer()).resolves.toBe(true);

    expect(query.firstEq).toHaveBeenCalledWith("user_id", "user-1");
    expect(query.secondEq).toHaveBeenCalledWith("is_active", true);
  });

  test("isDepartmentViewer returns false and logs when query fails", async () => {
    mockGetCachedRequestAuthUser.mockResolvedValue({
      user: { id: "user-1", app_metadata: {} },
      errorMessage: null,
    });

    const query = createTwoEqSelect({
      count: null,
      error: { message: "lookup failed", code: "500" },
    });
    mockServiceRoleFrom.mockReturnValue({ select: query.select });

    const { isDepartmentViewer } = await import("@/modules/claims/server/is-department-viewer");
    await expect(isDepartmentViewer()).resolves.toBe(false);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "department_viewer.is_department_viewer.query_failed",
      {
        userId: "user-1",
        error: "lookup failed",
        code: "500",
      },
    );
  });

  test("getViewerDepartmentIds returns empty array when user mismatch", async () => {
    mockGetCachedRequestAuthUser.mockResolvedValue({
      user: { id: "different-user" },
      errorMessage: null,
    });

    const { getViewerDepartmentIds } = await import("@/modules/claims/server/is-department-viewer");
    await expect(getViewerDepartmentIds("user-1")).resolves.toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("getViewerDepartmentIds maps department ids and handles query errors", async () => {
    mockGetCachedRequestAuthUser.mockResolvedValue({
      user: { id: "user-1" },
      errorMessage: null,
    });

    const successQuery = createTwoEqSelect({
      data: [{ department_id: "dep-1" }, { department_id: "dep-2" }],
      error: null,
    });
    const errorQuery = createTwoEqSelect({
      data: null,
      error: { message: "dept lookup failed", code: "500" },
    });

    mockFrom
      .mockImplementationOnce(() => ({ select: successQuery.select }))
      .mockImplementationOnce(() => ({
        select: errorQuery.select,
      }));

    const { getViewerDepartmentIds } = await import("@/modules/claims/server/is-department-viewer");

    await expect(getViewerDepartmentIds("user-1")).resolves.toEqual(["dep-1", "dep-2"]);
    await expect(getViewerDepartmentIds("user-1")).resolves.toEqual([]);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      "department_viewer.get_viewer_department_ids.query_failed",
      {
        userId: "user-1",
        error: "dept lookup failed",
        code: "500",
      },
    );
  });
});
