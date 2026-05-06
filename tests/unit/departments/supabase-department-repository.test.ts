import { SupabaseDepartmentRepository } from "@/modules/departments/repositories/SupabaseDepartmentRepository";

const mockGetServiceRoleSupabaseClient = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: () => mockGetServiceRoleSupabaseClient(),
}));

type DepartmentQueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type UsersQueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type DepartmentBuilder = {
  select: jest.Mock<DepartmentBuilder, unknown[]>;
  eq: jest.Mock<DepartmentBuilder, unknown[]>;
  order: jest.Mock<Promise<DepartmentQueryResult>, unknown[]>;
};

type UsersBuilder = {
  select: jest.Mock<UsersBuilder, unknown[]>;
  in: jest.Mock<Promise<UsersQueryResult>, unknown[]>;
};

function createDepartmentBuilder(result: DepartmentQueryResult) {
  const builder = {} as DepartmentBuilder;

  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.order = jest.fn(async () => result);

  return builder;
}

function createUsersBuilder(result: UsersQueryResult) {
  const builder = {} as UsersBuilder;

  builder.select = jest.fn(() => builder);
  builder.in = jest.fn(async () => result);

  return builder;
}

describe("SupabaseDepartmentRepository", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns error when departments fetch fails", async () => {
    const departmentBuilder = createDepartmentBuilder({
      data: null,
      error: { message: "departments failed" },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "master_departments") {
        return departmentBuilder;
      }
      return createUsersBuilder({ data: [], error: null });
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseDepartmentRepository();
    const result = await repository.getActiveDepartmentsWithApprovers();

    expect(result).toEqual({
      data: [],
      errorMessage: "departments failed",
    });
  });

  test("returns empty data when no approver IDs exist", async () => {
    const departmentBuilder = createDepartmentBuilder({
      data: [
        {
          id: "dep-1",
          name: "Engineering",
          is_active: true,
          approver1_id: null,
          approver2_id: null,
        },
      ],
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "master_departments") {
        return departmentBuilder;
      }
      return createUsersBuilder({ data: [], error: null });
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseDepartmentRepository();
    const result = await repository.getActiveDepartmentsWithApprovers();

    expect(result).toEqual({
      data: [],
      errorMessage: null,
    });
  });

  test("returns error when user lookup fails", async () => {
    const departmentBuilder = createDepartmentBuilder({
      data: [
        {
          id: "dep-1",
          name: "Engineering",
          is_active: true,
          approver1_id: "u-approver-1",
          approver2_id: "u-approver-2",
        },
      ],
      error: null,
    });

    const usersBuilder = createUsersBuilder({
      data: null,
      error: { message: "users failed" },
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "master_departments") {
        return departmentBuilder;
      }
      return usersBuilder;
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseDepartmentRepository();
    const result = await repository.getActiveDepartmentsWithApprovers();

    expect(result).toEqual({
      data: [],
      errorMessage: "users failed",
    });
  });

  test("maps only departments with both hod and founder users", async () => {
    const departmentBuilder = createDepartmentBuilder({
      data: [
        {
          id: "dep-1",
          name: "Engineering",
          is_active: true,
          approver1_id: "u-approver-1",
          approver2_id: "u-approver-2",
        },
        {
          id: "dep-2",
          name: "Marketing",
          is_active: true,
          approver1_id: "u-approver-3",
          approver2_id: "u-approver-4",
        },
      ],
      error: null,
    });

    const usersBuilder = createUsersBuilder({
      data: [
        {
          id: "u-approver-1",
          email: "approver1@nxtwave.co.in",
          full_name: "Approver One",
          is_active: true,
        },
        {
          id: "u-approver-2",
          email: "approver2@nxtwave.co.in",
          full_name: "Approver Two",
          is_active: true,
        },
      ],
      error: null,
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "master_departments") {
        return departmentBuilder;
      }
      return usersBuilder;
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseDepartmentRepository();
    const result = await repository.getActiveDepartmentsWithApprovers();

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual([
      {
        id: "dep-1",
        name: "Engineering",
        isActive: true,
        approver1: {
          id: "u-approver-1",
          email: "approver1@nxtwave.co.in",
          fullName: "Approver One",
          isActive: true,
        },
        approver2: {
          id: "u-approver-2",
          email: "approver2@nxtwave.co.in",
          fullName: "Approver Two",
          isActive: true,
        },
      },
    ]);
  });
});
