/** @jest-environment node */

export {};

const mockCookies = jest.fn();
const mockCreateServerClient = jest.fn();
const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockGetServiceRoleSupabaseClient = jest.fn();
const mockServiceRoleFrom = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerDebug = jest.fn();

jest.mock("next/headers", () => ({
  cookies: (...args: unknown[]) => mockCookies(...args),
}));

jest.mock("@supabase/ssr", () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
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

describe("isAdmin", () => {
  const cookieStore = {
    getAll: jest.fn(() => []),
    set: jest.fn(),
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    mockCookies.mockResolvedValue(cookieStore);
    mockCreateServerClient.mockReturnValue({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    });
    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockServiceRoleFrom,
    });
  });

  test("returns false when auth user is unavailable", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid token" },
    });

    const { isAdmin } = await import("@/modules/admin/server/is-admin");
    await expect(isAdmin()).resolves.toBe(false);
  });

  test("returns false and logs warning when admins table query fails", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
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
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });

    const query = {
      eq: jest.fn(async () => ({ count: 1, error: null })),
    };
    mockServiceRoleFrom.mockReturnValue({
      select: jest.fn(() => query),
    });

    const { isAdmin } = await import("@/modules/admin/server/is-admin");
    await expect(isAdmin()).resolves.toBe(true);

    expect(mockLoggerDebug).toHaveBeenCalledWith("admin.is_admin.check_complete", {
      userId: "user-1",
      count: 1,
      result: true,
    });
  });

  test("returns false when an unexpected exception occurs", async () => {
    mockCookies.mockRejectedValueOnce(new Error("headers unavailable"));

    const { isAdmin } = await import("@/modules/admin/server/is-admin");
    await expect(isAdmin()).resolves.toBe(false);
  });
});
