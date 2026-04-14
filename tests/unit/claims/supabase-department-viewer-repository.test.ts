import { SupabaseDepartmentViewerRepository } from "@/modules/claims/repositories/SupabaseDepartmentViewerRepository";

const mockGetServiceRoleSupabaseClient = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: () => mockGetServiceRoleSupabaseClient(),
}));

type ChainResult = {
  data: unknown;
  error: { message: string } | null;
};

type QueryChain = {
  data: unknown;
  error: { message: string } | null;
  select: jest.Mock<QueryChain, unknown[]>;
  eq: jest.Mock<QueryChain, unknown[]>;
  in: jest.Mock<QueryChain, unknown[]>;
  order: jest.Mock<QueryChain, unknown[]>;
  limit: jest.Mock<QueryChain, unknown[]>;
  ilike: jest.Mock<QueryChain, unknown[]>;
  or: jest.Mock<QueryChain, unknown[]>;
  not: jest.Mock<QueryChain, unknown[]>;
  gte: jest.Mock<QueryChain, unknown[]>;
  lte: jest.Mock<QueryChain, unknown[]>;
  lt: jest.Mock<QueryChain, unknown[]>;
};

function createChain(result: ChainResult) {
  const chain = {} as QueryChain;

  chain.data = result.data;
  chain.error = result.error;
  chain.select = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.ilike = jest.fn(() => chain);
  chain.or = jest.fn(() => chain);
  chain.not = jest.fn(() => chain);
  chain.gte = jest.fn(() => chain);
  chain.lte = jest.fn(() => chain);
  chain.lt = jest.fn(() => chain);

  return chain;
}

describe("SupabaseDepartmentViewerRepository", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("getViewerDepartments returns error when query fails", async () => {
    const chain = createChain({ data: null, error: { message: "viewer fetch failed" } });

    mockFrom.mockReturnValue(chain);
    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseDepartmentViewerRepository();
    const result = await repository.getViewerDepartments("user-1");

    expect(result).toEqual({ data: [], errorMessage: "viewer fetch failed" });
  });

  test("getViewerDepartments normalizes relation shape and sorts by department name", async () => {
    const chain = createChain({
      data: [
        {
          department_id: "dep-2",
          master_departments: { name: "Zeta" },
        },
        {
          department_id: "dep-1",
          master_departments: [{ name: "Alpha" }],
        },
      ],
      error: null,
    });

    mockFrom.mockReturnValue(chain);
    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseDepartmentViewerRepository();
    const result = await repository.getViewerDepartments("user-1");

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual([
      { id: "dep-1", name: "Alpha" },
      { id: "dep-2", name: "Zeta" },
    ]);
  });

  test("getClaims short-circuits when departmentIds is empty", async () => {
    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseDepartmentViewerRepository();
    const result = await repository.getClaims([], {}, { cursor: null, limit: 10 });

    expect(result).toEqual({
      data: {
        data: [],
        nextCursor: null,
        hasNextPage: false,
      },
      errorMessage: null,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("getClaims returns error when query fails", async () => {
    const chain = createChain({ data: null, error: { message: "claims fetch failed" } });

    mockFrom.mockReturnValue(chain);
    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseDepartmentViewerRepository();
    const result = await repository.getClaims(["dep-1"], {}, { cursor: null, limit: 10 });

    expect(result).toEqual({ data: null, errorMessage: "claims fetch failed" });
  });

  test("getClaims maps rows, parses amount, and returns cursor pagination", async () => {
    const chain = createChain({
      data: [
        {
          claim_id: "claim-2",
          employee_name: "Bob",
          employee_id: "EMP-2",
          department_name: "Engineering",
          type_of_claim: "Expense",
          amount: "120.5",
          status: "Submitted - Awaiting HOD approval",
          submitted_on: "2026-03-20T10:00:00.000Z",
          hod_action_date: null,
          finance_action_date: null,
          detail_type: "expense",
          submission_type: "Self",
          department_id: "dep-1",
        },
        {
          claim_id: "claim-1",
          employee_name: "Alice",
          employee_id: "EMP-1",
          department_name: "Engineering",
          type_of_claim: "Expense",
          amount: 99,
          status: "Submitted - Awaiting HOD approval",
          submitted_on: "2026-03-19T10:00:00.000Z",
          hod_action_date: null,
          finance_action_date: null,
          detail_type: "expense",
          submission_type: "On Behalf",
          department_id: "dep-1",
        },
      ],
      error: null,
    });

    mockFrom.mockReturnValue(chain);
    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseDepartmentViewerRepository();
    const result = await repository.getClaims(
      ["dep-1"],
      {
        status: ["Submitted - Awaiting HOD approval"],
        searchField: "employee_name",
        searchQuery: "Bo",
        submissionType: "Self",
        dateTarget: "submitted",
        dateFrom: "2026-03-01",
        dateTo: "2026-03-31",
      },
      { cursor: null, limit: 1 },
    );

    expect(result.errorMessage).toBeNull();
    expect(result.data?.hasNextPage).toBe(true);
    expect(result.data?.nextCursor).toBe("2026-03-20T10:00:00.000Z");
    expect(result.data?.data).toEqual([
      {
        claimId: "claim-2",
        employeeName: "Bob",
        employeeId: "EMP-2",
        departmentName: "Engineering",
        typeOfClaim: "Expense",
        amount: 120.5,
        status: "Submitted - Awaiting HOD approval",
        submittedOn: "2026-03-20T10:00:00.000Z",
        hodActionDate: null,
        financeActionDate: null,
        detailType: "expense",
        submissionType: "Self",
        departmentId: "dep-1",
      },
    ]);
    expect(chain.in).toHaveBeenCalledWith("department_id", ["dep-1"]);
    expect(chain.ilike).toHaveBeenCalledWith("employee_name", "%Bo%");
    expect(chain.eq).toHaveBeenCalledWith("submission_type", "Self");
    expect(chain.gte).toHaveBeenCalledWith("submitted_on", "2026-03-01T00:00:00.000Z");
    expect(chain.lte).toHaveBeenCalledWith("submitted_on", "2026-03-31T23:59:59.999Z");
  });

  test("getClaims uses raw employee identity OR filter for employee_id search", async () => {
    const chain = createChain({ data: [], error: null });

    mockFrom.mockReturnValue(chain);
    mockGetServiceRoleSupabaseClient.mockReturnValue({ from: mockFrom });

    const repository = new SupabaseDepartmentViewerRepository();
    await repository.getClaims(
      ["dep-1"],
      {
        searchField: "employee_id",
        searchQuery: "EMP-009",
      },
      { cursor: null, limit: 10 },
    );

    expect(chain.or).toHaveBeenCalledWith(
      "claim_employee_id_raw.ilike.%EMP-009%,on_behalf_employee_code_raw.ilike.%EMP-009%,submitter_email.ilike.%EMP-009%,on_behalf_email.ilike.%EMP-009%",
    );
    expect(chain.ilike).not.toHaveBeenCalledWith("employee_id", "%EMP-009%");
  });
});
