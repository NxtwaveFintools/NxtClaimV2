import { SupabaseDashboardRepository } from "@/modules/dashboard/repositories/SupabaseDashboardRepository";

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type QueryBuilder = {
  eq: jest.Mock;
  in: jest.Mock;
  single: jest.Mock;
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
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    single: jest.fn(async () => result),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  return builder;
}

function createDynamicClaimsBuilder(selectedColumns: string): QueryBuilder {
  const filters = new Map<string, string>();

  const builder: QueryBuilder = {
    eq: jest.fn((key: string, value: string) => {
      filters.set(key, value);
      return builder;
    }),
    in: jest.fn(() => builder),
    single: jest.fn(async () => ({ data: null, error: null })),
    then: (onFulfilled, onRejected) => {
      let data: unknown = [];

      const submissionType = filters.get("submission_type");
      const paymentModeId = filters.get("payment_mode_id");

      if (selectedColumns.includes("advance_details")) {
        data =
          submissionType === "Self"
            ? [{ advance_details: { requested_amount: 100 } }]
            : [{ advance_details: { requested_amount: 50 } }];
      }

      if (selectedColumns.includes("expense_details")) {
        if (paymentModeId === "pm-pc") {
          data =
            submissionType === "Self"
              ? [{ expense_details: { total_amount: 40 } }]
              : [{ expense_details: { total_amount: 10 } }];
        } else {
          data =
            submissionType === "Self"
              ? [{ expense_details: { total_amount: 30 } }]
              : [{ expense_details: { total_amount: 20 } }];
        }
      }

      return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
    },
  };

  return builder;
}

describe("SupabaseDashboardRepository.getClosedWalletBaseTotals", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("retries once when a transient fetch failed error occurs", async () => {
    let modeAttempts = 0;

    mockFrom.mockImplementation((table: string) => ({
      select: jest.fn((columns: string) => {
        if (table === "master_payment_modes") {
          const builder = createQueryBuilder({
            data: [],
            error: null,
          });

          builder.in = jest.fn(() => ({
            then: (
              onFulfilled: (value: QueryResult) => unknown,
              onRejected?: (reason: unknown) => unknown,
            ) => {
              modeAttempts += 1;

              if (modeAttempts === 1) {
                return Promise.resolve({
                  data: null,
                  error: { message: "TypeError: fetch failed" },
                }).then(onFulfilled, onRejected);
              }

              return Promise.resolve({
                data: [
                  { id: "pm-pcr", name: "Petty Cash Request" },
                  { id: "pm-pc", name: "Petty Cash" },
                  { id: "pm-reim", name: "Reimbursement" },
                ],
                error: null,
              }).then(onFulfilled, onRejected);
            },
          })) as unknown as jest.Mock;

          return builder;
        }

        if (table === "users") {
          return createQueryBuilder({
            data: { email: "user@nxtwave.co.in" },
            error: null,
          });
        }

        if (table === "claims") {
          return createDynamicClaimsBuilder(columns);
        }

        throw new Error(`Unexpected table mock request: ${table}`);
      }),
    }));

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseDashboardRepository();
    const result = await repository.getClosedWalletBaseTotals(
      "11111111-1111-1111-1111-111111111111",
    );

    expect(modeAttempts).toBe(2);
    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      totalPettyCashReceived: 150,
      totalPettyCashSpent: 50,
      totalReimbursements: 50,
    });
  });

  test("includes self and on-behalf closed claims for beneficiary wallet totals", async () => {
    mockFrom.mockImplementation((table: string) => ({
      select: jest.fn((columns: string) => {
        if (table === "master_payment_modes") {
          return createQueryBuilder({
            data: [
              { id: "pm-pcr", name: "Petty Cash Request" },
              { id: "pm-pc", name: "Petty Cash" },
              { id: "pm-reim", name: "Reimbursement" },
            ],
            error: null,
          });
        }

        if (table === "users") {
          return createQueryBuilder({
            data: { email: "user@nxtwave.co.in" },
            error: null,
          });
        }

        if (table === "claims") {
          return createDynamicClaimsBuilder(columns);
        }

        throw new Error(`Unexpected table mock request: ${table}`);
      }),
    }));

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseDashboardRepository();
    const result = await repository.getClosedWalletBaseTotals(
      "11111111-1111-1111-1111-111111111111",
    );

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      totalPettyCashReceived: 150,
      totalPettyCashSpent: 50,
      totalReimbursements: 50,
    });
  });
});
