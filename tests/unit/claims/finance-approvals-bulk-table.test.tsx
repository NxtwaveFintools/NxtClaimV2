import { fireEvent, render, screen } from "@testing-library/react";
import { FinanceApprovalsBulkTable } from "@/modules/claims/ui/finance-approvals-bulk-table";
import { formatCurrency } from "@/lib/format";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
  usePathname: () => "/dashboard/my-claims",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("sonner", () => ({
  toast: { promise: jest.fn() },
}));

jest.mock("@/modules/claims/actions", () => ({
  bulkApprove: jest.fn(),
  bulkApproveL1: jest.fn(),
  bulkMarkPaid: jest.fn(),
  bulkReject: jest.fn(),
  bulkRejectL1: jest.fn(),
}));

type Row = React.ComponentProps<typeof FinanceApprovalsBulkTable>["claims"][number];

function buildRow(overrides: Partial<Row>): Row {
  return {
    id: "CLAIM-1",
    employeeId: "NW0001",
    submitter: "Kaushik Gadagoju",
    submitterEmail: "gadagoju.kaushik@nxtwave.co.in",
    departmentName: "NXTWAVE EDGE",
    paymentModeName: "Petty Cash",
    onBehalfEmail: null,
    onBehalfEmployeeCode: null,
    categoryName: "Travel Domestic",
    detailType: "expense",
    totalAmount: 100,
    formattedTotalAmount: formatCurrency(100),
    status: "Submitted - Awaiting HOD approval",
    formattedSubmittedAt: "2026-04-14",
    formattedHodActionDate: "-",
    formattedFinanceActionDate: "-",
    ...overrides,
  };
}

describe("FinanceApprovalsBulkTable scope branching", () => {
  it("shows 'Review Selected Claims' (not the standalone bulk buttons) for the HOD (l1) scope", () => {
    render(
      <FinanceApprovalsBulkTable
        claims={[buildRow({ id: "CLAIM-1" })]}
        actionableIds={["CLAIM-1"]}
        totalSelectableCount={1}
        filters={{ status: ["Submitted - Awaiting HOD approval"] }}
        approvalScope="l1"
      />,
    );

    expect(screen.getByRole("button", { name: /review selected claims/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^bulk approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^bulk reject$/i })).not.toBeInTheDocument();
  });

  it("keeps the standalone bulk buttons (no review modal) for the finance scope", () => {
    render(
      <FinanceApprovalsBulkTable
        claims={[buildRow({ id: "CLAIM-1", status: "Finance Approved - Payment under process" })]}
        actionableIds={["CLAIM-1"]}
        totalSelectableCount={1}
        filters={{ status: ["Finance Approved - Payment under process"] }}
        approvalScope="finance"
      />,
    );

    expect(screen.getByRole("button", { name: /^bulk approve$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^bulk reject$/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /review selected claims/i }),
    ).not.toBeInTheDocument();
  });

  it("opens the review modal summing a submitter's expense claims into one row", () => {
    render(
      <FinanceApprovalsBulkTable
        claims={[
          buildRow({ id: "CLAIM-1", totalAmount: 100 }),
          buildRow({ id: "CLAIM-2", totalAmount: 200 }),
        ]}
        actionableIds={["CLAIM-1", "CLAIM-2"]}
        totalSelectableCount={2}
        filters={{ status: ["Submitted - Awaiting HOD approval"] }}
        approvalScope="l1"
      />,
    );

    // Select every actionable claim on the page, then open the review modal.
    fireEvent.click(screen.getByTestId("bulk-master-checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /review selected claims/i }));

    expect(screen.getByRole("heading", { name: /review selected claims/i })).toBeInTheDocument();

    // Both expense claims are from the same submitter -> one summed expense row (100 + 200).
    const expenseRows = screen.getAllByTestId("review-expense-row");
    expect(expenseRows).toHaveLength(1);
    expect(expenseRows[0]).toHaveTextContent("Kaushik Gadagoju");
    expect(expenseRows[0]).toHaveTextContent(formatCurrency(300));
  });
});
