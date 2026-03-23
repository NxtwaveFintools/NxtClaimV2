import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import type { DashboardRepository } from "@/core/domain/dashboard/contracts";

type WalletTotalsRow = {
  total_reimbursements_received: number | string | null;
  total_petty_cash_received: number | string | null;
  total_petty_cash_spent: number | string | null;
  petty_cash_balance: number | string | null;
};

const EMPTY_WALLET_TOTALS = {
  totalPettyCashReceived: 0,
  totalPettyCashSpent: 0,
  totalReimbursements: 0,
  pettyCashBalance: 0,
};

const TRANSIENT_FETCH_ERROR_FRAGMENT = "fetch failed";

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function isTransientFetchError(error: { message: string } | null): boolean {
  if (!error?.message) {
    return false;
  }

  return error.message.toLowerCase().includes(TRANSIENT_FETCH_ERROR_FRAGMENT);
}

async function runWithSingleRetry<T>(
  run: () => Promise<{ data: T; error: { message: string } | null }>,
): Promise<{
  data: T;
  error: { message: string } | null;
}> {
  const firstAttempt = await run();
  if (!isTransientFetchError(firstAttempt.error)) {
    return firstAttempt;
  }

  return run();
}

export class SupabaseDashboardRepository implements DashboardRepository {
  async getWalletTotals(userId: string): Promise<{
    data: {
      totalPettyCashReceived: number;
      totalPettyCashSpent: number;
      totalReimbursements: number;
      pettyCashBalance: number;
    } | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();

    const { data, error } = await runWithSingleRetry<WalletTotalsRow | null>(async () =>
      client
        .from("wallets")
        .select(
          "total_reimbursements_received, total_petty_cash_received, total_petty_cash_spent, petty_cash_balance",
        )
        .eq("user_id", userId)
        .maybeSingle(),
    );

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    if (!data) {
      return { data: EMPTY_WALLET_TOTALS, errorMessage: null };
    }

    const row = data;

    return {
      data: {
        totalPettyCashReceived: toNumber(row.total_petty_cash_received),
        totalPettyCashSpent: toNumber(row.total_petty_cash_spent),
        totalReimbursements: toNumber(row.total_reimbursements_received),
        pettyCashBalance: toNumber(row.petty_cash_balance),
      },
      errorMessage: null,
    };
  }
}
