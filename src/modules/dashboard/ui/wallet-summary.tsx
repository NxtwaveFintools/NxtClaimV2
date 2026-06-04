import { ArrowDownCircle, ArrowUpCircle, Clock, Wallet } from "lucide-react";
import type { WalletSummaryTotals } from "@/core/domain/dashboard/contracts";

type WalletSummaryProps = {
  summary: WalletSummaryTotals;
};

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatInr(value: number): string {
  const formatted = inrFormatter.format(Math.abs(value));
  return value < 0 ? `-${formatted}` : formatted;
}

function formatClaimCount(count: number): string {
  return `${count} ${count === 1 ? "claim" : "claims"}`;
}

function getBalanceColor(balance: number): string {
  if (balance < 0) return "var(--danger)";
  if (balance > 0) return "var(--success)";
  return "var(--foreground)";
}

function getBalanceMessage(balance: number): string {
  if (balance < 0) return `Company is owed ${formatInr(Math.abs(balance))}`;
  if (balance > 0) return `${formatInr(balance)} in credit`;
  return "Balance is settled";
}

const labelStyle = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--muted-foreground)",
} as const;

const valueStyle = {
  fontSize: 22,
  fontWeight: 700,
  lineHeight: 1.2,
} as const;

const subTextStyle = {
  fontSize: 12,
  color: "var(--muted-foreground)",
  lineHeight: 1.6,
  marginTop: 2,
} as const;

const iconWrapperStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 36,
  height: 36,
  borderRadius: 10,
  flexShrink: 0,
} as const;

export function WalletSummary({ summary }: WalletSummaryProps) {
  const hasPendingReimbursement =
    summary.pendingReimbursementAmount > 0 || summary.pendingReimbursementCount > 0;

  return (
    <section>
      <h2 style={{ ...labelStyle, marginBottom: 12 }}>WALLET SUMMARY</h2>

      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        aria-label="Wallet summary metrics"
      >
        {/* Petty Cash Balance */}
        <div className="nxt-card flex min-w-0 flex-col gap-3 p-4" style={{ borderRadius: 12 }}>
          <div className="flex items-center justify-between">
            <p style={labelStyle}>PETTY CASH BALANCE</p>
            <div style={{ ...iconWrapperStyle, backgroundColor: "var(--accent-muted)" }}>
              <Wallet className="h-4 w-4" style={{ color: "var(--accent)" }} aria-hidden="true" />
            </div>
          </div>
          <p
            className="break-words"
            style={{ ...valueStyle, color: getBalanceColor(summary.pettyCashBalance) }}
          >
            {formatInr(summary.pettyCashBalance)}
          </p>
          <p style={subTextStyle}>{getBalanceMessage(summary.pettyCashBalance)}</p>
        </div>

        {/* Amount Received */}
        <div className="nxt-card flex min-w-0 flex-col gap-3 p-4" style={{ borderRadius: 12 }}>
          <div className="flex items-center justify-between">
            <p style={labelStyle}>AMOUNT RECEIVED</p>
            <div style={{ ...iconWrapperStyle, backgroundColor: "var(--success-muted)" }}>
              <ArrowDownCircle
                className="h-4 w-4"
                style={{ color: "var(--success)" }}
                aria-hidden="true"
              />
            </div>
          </div>
          <p className="break-words" style={{ ...valueStyle, color: "var(--success)" }}>
            {formatInr(summary.amountReceived)}
          </p>
          <div style={subTextStyle}>
            <p>Petty Cash &middot; {formatInr(summary.totalPettyCashReceived)}</p>
            <p>Reimbursements &middot; {formatInr(summary.totalReimbursements)}</p>
          </div>
        </div>

        {/* Amount Spent */}
        <div className="nxt-card flex min-w-0 flex-col gap-3 p-4" style={{ borderRadius: 12 }}>
          <div className="flex items-center justify-between">
            <p style={labelStyle}>AMOUNT SPENT</p>
            <div style={{ ...iconWrapperStyle, backgroundColor: "var(--warning-muted)" }}>
              <ArrowUpCircle
                className="h-4 w-4"
                style={{ color: "var(--warning)" }}
                aria-hidden="true"
              />
            </div>
          </div>
          <p className="break-words" style={{ ...valueStyle, color: "var(--warning)" }}>
            {formatInr(summary.amountSpent)}
          </p>
          <div style={subTextStyle}>
            <p>Petty cash utilized</p>
            <p>{formatClaimCount(summary.amountSpentClaimCount)}</p>
          </div>
        </div>

        {/* Pending Reimbursement */}
        <div className="nxt-card flex min-w-0 flex-col gap-3 p-4" style={{ borderRadius: 12 }}>
          <div className="flex items-center justify-between">
            <p style={labelStyle}>PENDING REIMBURSEMENT</p>
            <div style={{ ...iconWrapperStyle, backgroundColor: "var(--pending-muted)" }}>
              <Clock className="h-4 w-4" style={{ color: "var(--pending)" }} aria-hidden="true" />
            </div>
          </div>
          <p
            className="break-words"
            style={{
              ...valueStyle,
              color: hasPendingReimbursement ? "var(--pending)" : "var(--muted-foreground)",
            }}
          >
            {formatInr(summary.pendingReimbursementAmount)}
          </p>
          <div style={subTextStyle}>
            {hasPendingReimbursement ? (
              <>
                <p>{summary.pendingReimbursementCount} claims in pipeline</p>
                <p>Awaiting HOD or finance action</p>
              </>
            ) : (
              <p>No claims in pipeline</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
