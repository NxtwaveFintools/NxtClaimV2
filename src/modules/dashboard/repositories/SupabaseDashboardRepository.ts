import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import type { DashboardRepository } from "@/core/domain/dashboard/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

type PaymentModeRow = {
  id: string;
  name: string;
};

type DetailAmountRow = {
  total_amount: number | string | null;
};

type AdvanceAmountRow = {
  requested_amount: number | string | null;
};

type ClaimExpenseRow = {
  expense_details: DetailAmountRow | DetailAmountRow[] | null;
};

type ClaimAdvanceRow = {
  advance_details: AdvanceAmountRow | AdvanceAmountRow[] | null;
};

const PAYMENT_DONE_CLOSED_STATUS = "Payment Done - Closed";
const PAYMENT_MODE_REIMBURSEMENT = "Reimbursement";
const PAYMENT_MODE_PETTY_CASH = "Petty Cash";
const PAYMENT_MODE_PETTY_CASH_REQUEST = "Petty Cash Request";
const PAYMENT_MODE_BULK_PETTY_CASH_REQUEST = "Bulk Petty Cash Request";
const FINANCE_APPROVED_STATUS = "Finance Approved - Payment under process";
const TRANSIENT_FETCH_ERROR_FRAGMENT = "fetch failed";

function getSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

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

function sumRows<T>(rows: T[], resolver: (row: T) => number): number {
  return rows.reduce((accumulator, row) => accumulator + resolver(row), 0);
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
  async getClosedWalletBaseTotals(userId: string): Promise<{
    data: {
      totalPettyCashReceived: number;
      totalPettyCashSpent: number;
      totalReimbursements: number;
      totalExpenseSubmitted: number;
    } | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();

    const { data: modeRows, error: modeError } = await runWithSingleRetry(() =>
      client
        .from("master_payment_modes")
        .select("id, name")
        .in("name", [
          PAYMENT_MODE_PETTY_CASH_REQUEST,
          PAYMENT_MODE_BULK_PETTY_CASH_REQUEST,
          PAYMENT_MODE_PETTY_CASH,
          PAYMENT_MODE_REIMBURSEMENT,
        ]),
    );

    if (modeError) {
      return { data: null, errorMessage: modeError.message };
    }

    const rows = (modeRows ?? []) as PaymentModeRow[];
    const paymentModeIdsByName = new Map(rows.map((row) => [row.name, row.id]));

    const pettyCashRequestModeId = paymentModeIdsByName.get(PAYMENT_MODE_PETTY_CASH_REQUEST);
    const bulkPettyCashRequestModeId = paymentModeIdsByName.get(
      PAYMENT_MODE_BULK_PETTY_CASH_REQUEST,
    );
    const pettyCashModeId = paymentModeIdsByName.get(PAYMENT_MODE_PETTY_CASH);
    const reimbursementModeId = paymentModeIdsByName.get(PAYMENT_MODE_REIMBURSEMENT);

    const [
      pettyCashReceivedResult,
      pettyCashSpentResult,
      reimbursementsResult,
      totalExpenseSubmittedResult,
    ] = await Promise.all([
      this.getAdvanceRequestedTotal(client, userId, {
        paymentModeIds: [pettyCashRequestModeId ?? null, bulkPettyCashRequestModeId ?? null].filter(
          (id): id is string => Boolean(id),
        ),
        statuses: [PAYMENT_DONE_CLOSED_STATUS],
      }),
      this.getExpenseTotal(client, userId, {
        paymentModeIds: pettyCashModeId ? [pettyCashModeId] : [],
        statuses: [PAYMENT_DONE_CLOSED_STATUS],
      }),
      this.getExpenseTotal(client, userId, {
        paymentModeIds: reimbursementModeId ? [reimbursementModeId] : [],
        statuses: [PAYMENT_DONE_CLOSED_STATUS],
      }),
      this.getExpenseTotal(client, userId, {
        statuses: [FINANCE_APPROVED_STATUS, PAYMENT_DONE_CLOSED_STATUS],
      }),
    ]);

    const firstError =
      pettyCashReceivedResult.errorMessage ??
      pettyCashSpentResult.errorMessage ??
      reimbursementsResult.errorMessage ??
      totalExpenseSubmittedResult.errorMessage;

    if (firstError) {
      return { data: null, errorMessage: firstError };
    }

    return {
      data: {
        totalPettyCashReceived: pettyCashReceivedResult.total,
        totalPettyCashSpent: pettyCashSpentResult.total,
        totalReimbursements: reimbursementsResult.total,
        totalExpenseSubmitted: totalExpenseSubmittedResult.total,
      },
      errorMessage: null,
    };
  }

  private async getExpenseTotal(
    client: SupabaseClient,
    userId: string,
    filters: {
      paymentModeIds?: string[];
      statuses?: string[];
    },
  ): Promise<{ total: number; errorMessage: string | null }> {
    const normalizedPaymentModeIds = filters.paymentModeIds?.filter(Boolean) ?? [];

    if (filters.paymentModeIds && normalizedPaymentModeIds.length === 0) {
      return { total: 0, errorMessage: null };
    }

    let query = client
      .from("claims")
      .select("expense_details(total_amount)")
      .eq("on_behalf_of_id", userId)
      .eq("detail_type", "expense")
      .eq("is_active", true);

    if (normalizedPaymentModeIds.length > 0) {
      query = query.in("payment_mode_id", normalizedPaymentModeIds);
    }

    const normalizedStatuses = filters.statuses?.filter(Boolean) ?? [];
    if (normalizedStatuses.length > 0) {
      query = query.in("status", normalizedStatuses);
    }

    const result = await runWithSingleRetry(() => query);

    if (result.error) {
      return { total: 0, errorMessage: result.error.message };
    }

    const rows = (result.data ?? []) as ClaimExpenseRow[];
    return {
      total: sumRows(rows, (row) => toNumber(getSingleRelation(row.expense_details)?.total_amount)),
      errorMessage: null,
    };
  }

  private async getAdvanceRequestedTotal(
    client: SupabaseClient,
    userId: string,
    filters: {
      paymentModeIds?: string[];
      statuses?: string[];
    },
  ): Promise<{ total: number; errorMessage: string | null }> {
    const normalizedPaymentModeIds = filters.paymentModeIds?.filter(Boolean) ?? [];

    if (filters.paymentModeIds && normalizedPaymentModeIds.length === 0) {
      return { total: 0, errorMessage: null };
    }

    let query = client
      .from("claims")
      .select("advance_details(requested_amount)")
      .eq("on_behalf_of_id", userId)
      .eq("detail_type", "advance")
      .eq("is_active", true);

    if (normalizedPaymentModeIds.length > 0) {
      query = query.in("payment_mode_id", normalizedPaymentModeIds);
    }

    const normalizedStatuses = filters.statuses?.filter(Boolean) ?? [];
    if (normalizedStatuses.length > 0) {
      query = query.in("status", normalizedStatuses);
    }

    const result = await runWithSingleRetry(() => query);

    if (result.error) {
      return { total: 0, errorMessage: result.error.message };
    }

    const rows = (result.data ?? []) as ClaimAdvanceRow[];
    return {
      total: sumRows(rows, (row) =>
        toNumber(getSingleRelation(row.advance_details)?.requested_amount),
      ),
      errorMessage: null,
    };
  }
}
