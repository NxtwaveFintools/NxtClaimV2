import { render, screen } from "@testing-library/react";
import { RecentClaims } from "@/modules/dashboard/ui/recent-claims";

describe("RecentClaims", () => {
  test("renders the claims supplied by the dashboard data path", () => {
    render(
      <RecentClaims
        claims={[
          {
            id: "real-claim-1",
            claimId: "REAL-2026-0001",
            date: "2026-05-20T08:00:00.000Z",
            category: "Travel",
            amount: 2500,
            status: "Submitted - Awaiting HOD approval",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("REAL-2026-0001")).toHaveLength(2);
    expect(screen.getAllByText("Travel")).toHaveLength(2);
    expect(screen.getAllByText("\u20b92,500.00")).toHaveLength(2);
    expect(screen.queryByText("CLM-2026-0058")).not.toBeInTheDocument();
  });

  test("renders an empty state when there are no recent claims", () => {
    render(<RecentClaims claims={[]} />);

    expect(screen.getByText("No recent claims")).toBeInTheDocument();
    expect(screen.getByText("Submitted claims will appear here.")).toBeInTheDocument();
  });
});
