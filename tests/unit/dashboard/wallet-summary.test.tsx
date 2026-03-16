import { render, screen } from "@testing-library/react";
import { WalletSummary } from "@/modules/dashboard/ui/wallet-summary";

describe("WalletSummary", () => {
  test("renders company owed hint for negative petty cash balance", () => {
    render(
      <WalletSummary
        summary={{
          totalPettyCashReceived: 100,
          totalPettyCashSpent: 250,
          totalReimbursements: 0,
          amountReceived: 100,
          amountSpent: 250,
          pettyCashBalance: -150,
        }}
      />,
    );

    expect(screen.getByText("-₹150.00")).toBeInTheDocument();
    expect(
      screen.getByText(/Company Owed = Petty Cash Spent - Petty Cash Received/i),
    ).toBeInTheDocument();
  });
});
