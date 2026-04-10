import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ApprovalsAuditModeDialog } from "@/modules/claims/ui/approvals-quick-view-sheet";

const mockGetClaimQuickViewHydrationAction = jest.fn();

jest.mock("@/modules/claims/actions", () => ({
  getClaimQuickViewHydrationAction: (...args: unknown[]) =>
    mockGetClaimQuickViewHydrationAction(...args),
}));

jest.mock("@/modules/claims/ui/claim-semantic-download-button", () => ({
  ClaimSemanticDownloadButton: () => null,
}));

jest.mock("@/components/ui/router-link", () => ({
  RouterLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const hydratedClaim = {
  submittedAt: "2026-04-10",
  departmentName: "Operations",
  paymentModeName: "Corporate Card",
  expense: {
    id: "expense-1",
    billNo: "BILL-100",
    purpose: "Client visit",
    expenseCategoryName: "Printing & Stationery",
    productName: "NxtWave",
    locationName: "Hyderabad",
    locationType: "Office",
    locationDetails: "Floor 3",
    transactionDate: "2026-04-09",
    isGstApplicable: true,
    gstNumber: "29ABCDE1234F2Z5",
    basicAmount: 1000,
    cgstAmount: 90,
    sgstAmount: 90,
    igstAmount: 0,
    totalAmount: 1180,
    vendorName: "Foobar Labs",
    peopleInvolved: "Alice, Bob",
    remarks: "Urgent print run",
  },
  advance: null,
};

describe("ApprovalsAuditModeDialog quick view", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetClaimQuickViewHydrationAction.mockResolvedValue({
      ok: true,
      data: {
        claim: hydratedClaim,
        auditLogs: [],
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("hides the requested fields in the compact quick view while preserving the summary values that remain", async () => {
    const user = userEvent.setup();

    render(
      <ApprovalsAuditModeDialog
        claimId="CLAIM-1"
        detailType="expense"
        submitter="Jane Doe"
        amountLabel="₹1,180.00"
        submissionType="Self"
        onBehalfEmail={null}
        expenseReceiptFilePath={null}
        expenseReceiptSignedUrl={null}
        expenseBankStatementFilePath={null}
        expenseBankStatementSignedUrl={null}
        advanceSupportingDocumentPath={null}
        advanceSupportingDocumentSignedUrl={null}
        auditLogs={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /view claim/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("Expense Detail")).toBeInTheDocument();
    });

    expect(screen.queryByText(/^Submitted On$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Vendor$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Expense Category$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Product$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Location$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^GST Applicable$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^GST Number$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Basic Amount$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^CGST$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^SGST$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^IGST$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Remarks$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^People Involved$/)).not.toBeInTheDocument();

    expect(screen.getByText(/^Category$/)).toBeInTheDocument();
    expect(screen.getByText(/^Payment Mode$/)).toBeInTheDocument();
    expect(screen.getByText(/^Purpose$/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Transaction Date$/)).toHaveLength(1);
    expect(screen.getByText(/^Total Amount$/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Bill No$/).length).toBeGreaterThan(0);
  });
});
