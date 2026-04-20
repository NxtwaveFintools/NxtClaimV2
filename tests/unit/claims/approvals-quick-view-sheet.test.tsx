import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ApprovalsAuditModeDialog } from "@/modules/claims/ui/approvals-quick-view-sheet";

const mockGetClaimQuickViewHydrationAction = jest.fn();
const mockGetClaimFormHydrationAction = jest.fn();
const mockUpdateClaimByFinanceAction = jest.fn();
const mockRouterRefresh = jest.fn();

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/my-claims",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    refresh: mockRouterRefresh,
  }),
}));

jest.mock("@/modules/claims/actions", () => ({
  getClaimQuickViewHydrationAction: (...args: unknown[]) =>
    mockGetClaimQuickViewHydrationAction(...args),
  getClaimFormHydrationAction: (...args: unknown[]) => mockGetClaimFormHydrationAction(...args),
  updateClaimByFinanceAction: (...args: unknown[]) => mockUpdateClaimByFinanceAction(...args),
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
  id: "CLAIM-1",
  employeeId: "EMP-1",
  departmentId: "dep-1",
  paymentModeId: "mode-1",
  submissionType: "Self" as const,
  detailType: "expense" as const,
  onBehalfOfId: null,
  onBehalfEmail: null,
  onBehalfEmployeeCode: null,
  status: "Submitted - Awaiting HOD approval" as const,
  rejectionReason: null,
  submittedAt: "2026-04-10",
  assignedL1ApproverId: "hod-user-1",
  assignedL2ApproverId: null,
  submittedBy: "submitter-user-1",
  submitter: "Jane Doe",
  submitterName: "Jane Doe",
  submitterEmail: "jane@example.com",
  beneficiaryName: null,
  beneficiaryEmail: null,
  departmentName: "Operations",
  paymentModeName: "Corporate Card",
  expense: {
    id: "expense-1",
    billNo: "BILL-100",
    purpose: "Client visit",
    expenseCategoryId: "cat-1",
    expenseCategoryName: "Printing & Stationery",
    productId: "prod-1",
    productName: "NxtWave",
    locationId: "loc-1",
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
    aiMetadata: null,
    receiptFilePath: null,
    bankStatementFilePath: null,
  },
  advance: null,
};

describe("ApprovalsAuditModeDialog quick view", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouterRefresh.mockReset();
    mockGetClaimQuickViewHydrationAction.mockResolvedValue({
      ok: true,
      data: {
        claim: hydratedClaim,
        auditLogs: [],
        canViewAiMetadata: false,
      },
    });
    mockGetClaimFormHydrationAction.mockResolvedValue({
      data: {
        currentUser: {
          id: "finance-user-1",
          email: "finance@example.com",
          name: "Finance User",
          isGlobalHod: false,
        },
        options: {
          departments: [{ id: "dep-1", name: "Operations" }],
          departmentRouting: [],
          paymentModes: [{ id: "mode-1", name: "Corporate Card", detailType: "expense" }],
          expenseCategories: [{ id: "cat-1", name: "Printing & Stationery" }],
          products: [{ id: "prod-1", name: "NxtWave" }],
          locations: [{ id: "loc-1", name: "Hyderabad" }],
        },
      },
      errorMessage: null,
    });
    mockUpdateClaimByFinanceAction.mockResolvedValue({ ok: true, message: "Claim updated." });
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

  test("opens nested quick edit dialog and refreshes quick view data after save", async () => {
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
        canInlineEdit
      >
        <button type="button">Approve</button>
      </ApprovalsAuditModeDialog>,
    );

    await user.click(screen.getByRole("button", { name: /view claim/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /edit/i }));

    await waitFor(() => {
      expect(screen.getByText("Quick Edit Claim")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockGetClaimFormHydrationAction).toHaveBeenCalledTimes(1);
    });

    const hydrationCallsBeforeSave = mockGetClaimQuickViewHydrationAction.mock.calls.length;
    const editReasonInput = await screen.findByLabelText(/reason for edit/i);
    await user.type(editReasonInput, "Test edit reason");
    const saveButton = await screen.findByRole("button", { name: /save changes/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockUpdateClaimByFinanceAction).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mockGetClaimQuickViewHydrationAction.mock.calls.length).toBeGreaterThan(
        hydrationCallsBeforeSave,
      );
    });

    await waitFor(() => {
      expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText("Quick Edit Claim")).not.toBeInTheDocument();
  });

  test("renders AI warning when viewer is allowed to see AI metadata", async () => {
    const user = userEvent.setup();
    const claimId = "CLAIM-AI-WARNING-TRUE";

    mockGetClaimQuickViewHydrationAction.mockResolvedValueOnce({
      ok: true,
      data: {
        claim: {
          ...hydratedClaim,
          id: claimId,
          expense: hydratedClaim.expense
            ? {
                ...hydratedClaim.expense,
                aiMetadata: {
                  edited_fields: {
                    total_amount: {
                      original: 113,
                    },
                  },
                },
              }
            : null,
        },
        auditLogs: [],
        canViewAiMetadata: true,
      },
    });

    render(
      <ApprovalsAuditModeDialog
        claimId={claimId}
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
      expect(screen.getByText("AI originally read: ₹113.00")).toBeInTheDocument();
    });
  });

  test("does not render AI warning when viewer is not allowed", async () => {
    const user = userEvent.setup();
    const claimId = "CLAIM-AI-WARNING-FALSE";

    mockGetClaimQuickViewHydrationAction.mockResolvedValueOnce({
      ok: true,
      data: {
        claim: {
          ...hydratedClaim,
          id: claimId,
          expense: hydratedClaim.expense
            ? {
                ...hydratedClaim.expense,
                aiMetadata: {
                  edited_fields: {
                    total_amount: {
                      original: 113,
                    },
                  },
                },
              }
            : null,
        },
        auditLogs: [],
        canViewAiMetadata: false,
      },
    });

    render(
      <ApprovalsAuditModeDialog
        claimId={claimId}
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

    expect(screen.queryByText(/AI originally read:/i)).not.toBeInTheDocument();
  });
});
