import { SupabaseDashboardRepository } from "@/modules/dashboard/repositories/SupabaseDashboardRepository";

type WalletQueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type WalletQueryBuilder = {
  eq: jest.Mock;
  maybeSingle: jest.Mock;
};

type PendingQueryResult = {
  data: Array<{ amount: number | string | null }> | null;
  error: { message: string } | null;
};

type PendingQueryBuilder = PromiseLike<PendingQueryResult> & {
  eq: jest.Mock;
  ilike?: jest.Mock;
  in: jest.Mock;
};

const mockFrom = jest.fn();
const mockGetServiceRoleSupabaseClient = jest.fn();

jest.mock("@/core/infra/supabase/server-client", () => ({
  getServiceRoleSupabaseClient: () => mockGetServiceRoleSupabaseClient(),
}));

function createWalletBuilder(result: WalletQueryResult): WalletQueryBuilder {
  const builder: WalletQueryBuilder = {
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => result),
  };

  return builder;
}

describe("SupabaseDashboardRepository.getWalletTotals", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns wallet totals when a wallet row exists", async () => {
    const queryBuilder = createWalletBuilder({
      data: {
        total_reimbursements_received: "100.50",
        total_petty_cash_received: "250.25",
        total_petty_cash_spent: "80.10",
        petty_cash_balance: "170.15",
      },
      error: null,
    });

    mockFrom.mockReturnValue({
      select: jest.fn(() => queryBuilder),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseDashboardRepository();
    const result = await repository.getWalletTotals("11111111-1111-1111-1111-111111111111");

    expect(queryBuilder.maybeSingle).toHaveBeenCalledTimes(1);
    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      totalPettyCashReceived: 250.25,
      totalPettyCashSpent: 80.1,
      totalReimbursements: 100.5,
      pettyCashBalance: 170.15,
    });
  });

  test("returns zeroed totals when no wallet row exists", async () => {
    const queryBuilder = createWalletBuilder({
      data: null,
      error: null,
    });

    mockFrom.mockReturnValue({
      select: jest.fn(() => queryBuilder),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseDashboardRepository();
    const result = await repository.getWalletTotals("11111111-1111-1111-1111-111111111111");

    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      totalPettyCashReceived: 0,
      totalPettyCashSpent: 0,
      totalReimbursements: 0,
      pettyCashBalance: 0,
    });
  });

  test("retries once for transient fetch failures", async () => {
    let attempts = 0;

    const queryBuilder: WalletQueryBuilder = {
      eq: jest.fn(() => queryBuilder),
      maybeSingle: jest.fn(async () => {
        attempts += 1;

        if (attempts === 1) {
          return {
            data: null,
            error: { message: "TypeError: fetch failed" },
          };
        }

        return {
          data: {
            total_reimbursements_received: 20,
            total_petty_cash_received: 30,
            total_petty_cash_spent: 10,
            petty_cash_balance: 20,
          },
          error: null,
        };
      }),
    };

    mockFrom.mockReturnValue({
      select: jest.fn(() => queryBuilder),
    });

    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseDashboardRepository();
    const result = await repository.getWalletTotals("11111111-1111-1111-1111-111111111111");

    expect(attempts).toBe(2);
    expect(result.errorMessage).toBeNull();
    expect(result.data).toEqual({
      totalPettyCashReceived: 30,
      totalPettyCashSpent: 10,
      totalReimbursements: 20,
      pettyCashBalance: 20,
    });
  });
});

describe("SupabaseDashboardRepository.getAmountSpentClaimCount", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("counts active paid petty cash claims for the beneficiary", async () => {
    const spentBuilder: PendingQueryBuilder = {
      eq: jest.fn(() => spentBuilder),
      ilike: jest.fn(() => spentBuilder),
      in: jest.fn(() => spentBuilder),
      then: jest.fn((resolve, reject) =>
        Promise.resolve({
          data: [{ amount: "100.50" }, { amount: "25" }],
          error: null,
        }).then(resolve, reject),
      ),
    };
    const select = jest.fn(() => spentBuilder);

    mockFrom.mockReturnValue({ select });
    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseDashboardRepository();
    const result = await repository.getAmountSpentClaimCount(
      "11111111-1111-1111-1111-111111111111",
    );

    expect(mockFrom).toHaveBeenCalledWith("vw_enterprise_claims_dashboard");
    expect(select).toHaveBeenCalledWith("amount");
    expect(spentBuilder.eq).toHaveBeenCalledWith("is_active", true);
    expect(spentBuilder.eq).toHaveBeenCalledWith(
      "on_behalf_of_id",
      "11111111-1111-1111-1111-111111111111",
    );
    expect(spentBuilder.eq).toHaveBeenCalledWith("status", "Payment Done - Closed");
    expect(spentBuilder.ilike).toHaveBeenCalledWith("type_of_claim", "petty cash");
    expect(result).toEqual({
      data: {
        amountSpentClaimCount: 2,
      },
      errorMessage: null,
    });
  });
});

describe("SupabaseDashboardRepository.getPendingReimbursementTotals", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("sums pending reimbursement amount and count for active beneficiary claims", async () => {
    const pendingBuilder: PendingQueryBuilder = {
      eq: jest.fn(() => pendingBuilder),
      in: jest.fn(() => pendingBuilder),
      then: jest.fn((resolve, reject) =>
        Promise.resolve({
          data: [{ amount: "100.50" }, { amount: "25" }, { amount: null }],
          error: null,
        }).then(resolve, reject),
      ),
    };
    const select = jest.fn(() => pendingBuilder);

    mockFrom.mockReturnValue({ select });
    mockGetServiceRoleSupabaseClient.mockReturnValue({
      from: mockFrom,
    });

    const repository = new SupabaseDashboardRepository();
    const result = await repository.getPendingReimbursementTotals(
      "11111111-1111-1111-1111-111111111111",
    );

    expect(mockFrom).toHaveBeenCalledWith("vw_enterprise_claims_dashboard");
    expect(select).toHaveBeenCalledWith("amount");
    expect(pendingBuilder.eq).toHaveBeenCalledWith("is_active", true);
    expect(pendingBuilder.eq).toHaveBeenCalledWith(
      "on_behalf_of_id",
      "11111111-1111-1111-1111-111111111111",
    );
    expect(pendingBuilder.in).toHaveBeenCalledWith("status", [
      "Submitted - Awaiting HOD approval",
      "HOD approved - Awaiting finance approval",
      "Finance Approved - Payment under process",
    ]);
    expect(result).toEqual({
      data: {
        pendingReimbursementAmount: 125.5,
        pendingReimbursementCount: 3,
      },
      errorMessage: null,
    });
  });
});
