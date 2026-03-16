import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type QueryBuilder = {
  or: jest.Mock;
  eq: jest.Mock;
  in: jest.Mock;
  gte: jest.Mock;
  lte: jest.Mock;
  order: jest.Mock;
  then: (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

const mockFrom = jest.fn();
const mockGetServiceRoleSupabaseClient = jest.fn();

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: () => mockGetServiceRoleSupabaseClient(),
}));

function createQueryBuilder(result: QueryResult): QueryBuilder {
  const builder: QueryBuilder = {
    or: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    gte: jest.fn(() => builder),
    lte: jest.fn(() => builder),
    order: jest.fn(() => builder),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  return builder;
}

describe("SupabaseClaimRepository.getMyClaims", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("normalizes relational join shapes (array/object/null) into flat records", async () => {
    const queryBuilder = createQueryBuilder({
      data: [
        {
          id: "claim-1",
          employee_id: "EMP-100",
          on_behalf_email: null,
          submission_type: "Self",
          status: "Submitted - Awaiting HOD approval",
          submitted_at: "2026-03-14T10:00:00.000Z",
          master_departments: [{ name: "Finance" }],
          master_payment_modes: { name: "Reimbursement" },
          expense_details: { total_amount: "118.25" },
          advance_details: null,
        },
        {
          id: "claim-2",
          employee_id: "EMP-200",
          on_behalf_email: "delegate@nxtwave.co.in",
          submission_type: "On Behalf",
          status: "HOD approved - Awaiting finance approval",
          submitted_at: "2026-03-13T10:00:00.000Z",
          master_departments: null,
          master_payment_modes: [{ name: "Petty Cash Request" }],
          expense_details: null,
          advance_details: [{ requested_amount: 500 }],
        },
      ],
      error: null,
    });

    mockFrom.mockReturnValue({
      select: jest.fn(() => queryBuilder),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseClaimRepository();
    const result = await repository.getMyClaims("user-1");

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual([
      {
        id: "claim-1",
        employeeId: "EMP-100",
        onBehalfEmail: null,
        departmentName: "Finance",
        paymentModeName: "Reimbursement",
        submissionType: "Self",
        status: "Submitted - Awaiting HOD approval",
        submittedAt: "2026-03-14T10:00:00.000Z",
        expenseTotalAmount: 118.25,
        advanceRequestedAmount: null,
      },
      {
        id: "claim-2",
        employeeId: "EMP-200",
        onBehalfEmail: "delegate@nxtwave.co.in",
        departmentName: null,
        paymentModeName: "Petty Cash Request",
        submissionType: "On Behalf",
        status: "HOD approved - Awaiting finance approval",
        submittedAt: "2026-03-13T10:00:00.000Z",
        expenseTotalAmount: null,
        advanceRequestedAmount: 500,
      },
    ]);
  });

  test("maps canonical status filters to raw DB statuses", async () => {
    const queryBuilder = createQueryBuilder({
      data: [],
      error: null,
    });

    mockFrom.mockReturnValue({
      select: jest.fn(() => queryBuilder),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseClaimRepository();
    await repository.getMyClaims("user-1", {
      status: "Approved",
    });

    expect(queryBuilder.in).toHaveBeenCalledWith("status", [
      "Finance Approved - Payment under process",
      "Payment Done - Closed",
    ]);
  });
});
