import { render, screen, within } from "@testing-library/react";
import { WalletSummary } from "@/modules/dashboard/ui/wallet-summary";

describe("WalletSummary", () => {
  test("renders a compact horizontal stats bar with four metric cells", () => {
    render(
      <WalletSummary
        summary={{
          totalPettyCashReceived: 0,
          totalPettyCashSpent: 123,
          totalReimbursements: 22,
          amountReceived: 22,
          amountSpent: 123,
          pettyCashBalance: -123,
          amountSpentClaimCount: 1,
          pendingReimbursementAmount: 16256,
          pendingReimbursementCount: 10,
        }}
      />,
    );

    expect(screen.getByText("WALLET SUMMARY")).toHaveStyle({ marginBottom: "12px" });
    expect(screen.getByLabelText("Wallet summary metrics")).toHaveStyle({
      display: "flex",
      flexDirection: "row",
      overflow: "hidden",
    });

    expect(screen.getByLabelText("Petty cash balance metric")).toHaveStyle({ flex: "1" });
    expect(screen.getByLabelText("Amount received metric")).toHaveStyle({
      flex: "1",
      borderLeft: "1px solid var(--border)",
    });
    expect(screen.getByLabelText("Amount spent metric")).toHaveStyle({
      flex: "1",
      borderLeft: "1px solid var(--border)",
    });
    expect(screen.getByLabelText("Pending reimbursement metric")).toHaveStyle({
      flex: "1",
      borderLeft: "1px solid var(--border)",
    });

    expect(
      within(screen.getByLabelText("Petty cash balance metric")).getByText("-\u20b9123.00"),
    ).toHaveStyle({ fontSize: "22px", color: "#dc2626" });
    expect(
      within(screen.getByLabelText("Petty cash balance metric")).getByText(
        "Company is owed \u20b9123.00",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Petty Cash \u00b7 \u20b90.00")).toBeInTheDocument();
    expect(screen.getByText("Reimbursements \u00b7 \u20b922.00")).toBeInTheDocument();
    expect(screen.getByText("Petty cash utilized")).toBeInTheDocument();
    expect(screen.getByText("1 claim")).toBeInTheDocument();
    expect(screen.getByText("10 claims in pipeline")).toBeInTheDocument();
    expect(screen.getByText("Awaiting HOD or finance action")).toBeInTheDocument();

    expect(screen.queryByLabelText("Petty cash utilization")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Received threshold marker")).not.toBeInTheDocument();
  });

  test("renders settled balance and zero pending reimbursement state", () => {
    render(
      <WalletSummary
        summary={{
          totalPettyCashReceived: 0,
          totalPettyCashSpent: 0,
          totalReimbursements: 0,
          amountReceived: 0,
          amountSpent: 0,
          pettyCashBalance: 0,
          amountSpentClaimCount: 0,
          pendingReimbursementAmount: 0,
          pendingReimbursementCount: 0,
        }}
      />,
    );

    expect(
      within(screen.getByLabelText("Petty cash balance metric")).getByText("\u20b90.00"),
    ).toHaveStyle({
      color: "var(--foreground)",
    });
    expect(screen.getByText("Balance is settled")).toBeInTheDocument();
    expect(screen.getByText("0 claims")).toBeInTheDocument();
    expect(screen.getByText("No claims in pipeline")).toBeInTheDocument();
    expect(screen.queryByText("Awaiting HOD or finance action")).not.toBeInTheDocument();
  });

  test("renders positive balance credit copy", () => {
    render(
      <WalletSummary
        summary={{
          totalPettyCashReceived: 100,
          totalPettyCashSpent: 25,
          totalReimbursements: 0,
          amountReceived: 100,
          amountSpent: 25,
          pettyCashBalance: 75,
          amountSpentClaimCount: 2,
          pendingReimbursementAmount: 0,
          pendingReimbursementCount: 0,
        }}
      />,
    );

    expect(
      within(screen.getByLabelText("Petty cash balance metric")).getByText("\u20b975.00"),
    ).toHaveStyle({
      color: "#16a34a",
    });
    expect(
      within(screen.getByLabelText("Petty cash balance metric")).getByText("\u20b975.00 in credit"),
    ).toBeInTheDocument();
    expect(screen.getByText("2 claims")).toBeInTheDocument();
  });
});
