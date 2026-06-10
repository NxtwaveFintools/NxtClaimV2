import { render, screen, fireEvent, within } from "@testing-library/react";
import { ReviewSelectedClaimsModal } from "@/modules/claims/ui/review-selected-claims-modal";
import type { ReviewClaimRow } from "@/modules/claims/utils/review-selected-claims";

// Recharts relies on layout measurement that jsdom does not provide; mock it so the
// modal's own structure is what we assert and the test output stays pristine.
jest.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Passthrough,
    PieChart: Passthrough,
    Pie: () => null,
    Cell: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

function buildRows(): ReviewClaimRow[] {
  return [
    {
      id: "1",
      submitter: "User A",
      submitterEmail: "a@x.com",
      categoryName: "Petty Cash",
      totalAmount: 10,
    },
    {
      id: "2",
      submitter: "User A",
      submitterEmail: "a@x.com",
      categoryName: "Travel",
      totalAmount: 20,
    },
    {
      id: "3",
      submitter: "User B",
      submitterEmail: "b@x.com",
      categoryName: "Petty Cash",
      totalAmount: 50,
    },
  ];
}

function renderModal(
  overrides: Partial<React.ComponentProps<typeof ReviewSelectedClaimsModal>> = {},
) {
  const props: React.ComponentProps<typeof ReviewSelectedClaimsModal> = {
    open: true,
    rows: buildRows(),
    onPageCount: 3,
    selectedCount: 3,
    totalSelectableCount: 3,
    isGlobalSelect: false,
    isApproving: false,
    isRejecting: false,
    onToggleScope: jest.fn(),
    onApproveAll: jest.fn(),
    onRejectAll: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };

  return { props, ...render(<ReviewSelectedClaimsModal {...props} />) };
}

describe("ReviewSelectedClaimsModal", () => {
  it("renders one row per submitter group (collapsing a submitter's multiple claims)", () => {
    renderModal();
    // User A's two claims collapse into one group -> 2 submitter rows total.
    expect(screen.getAllByTestId("review-submitter-row")).toHaveLength(2);
  });

  it("orders submitter rows by summed total, highest first (B=50 before A=30)", () => {
    renderModal();
    const rows = screen.getAllByTestId("review-submitter-row");
    expect(within(rows[0]).getByText("User B")).toBeInTheDocument();
    expect(within(rows[1]).getByText("User A")).toBeInTheDocument();
  });

  it("renders the pie chart region", () => {
    renderModal();
    expect(screen.getByTestId("review-pie-chart")).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    renderModal({ open: false });
    expect(
      screen.queryByRole("heading", { name: /review selected claims/i }),
    ).not.toBeInTheDocument();
  });

  it("fires onApproveAll when Approve All is clicked", () => {
    const onApproveAll = jest.fn();
    renderModal({ onApproveAll });
    fireEvent.click(screen.getByRole("button", { name: /approve all/i }));
    expect(onApproveAll).toHaveBeenCalledTimes(1);
  });

  it("reveals an inline reason field and fires onRejectAll with reason + resubmission flag", () => {
    const onRejectAll = jest.fn();
    renderModal({ onRejectAll });

    fireEvent.click(screen.getByRole("button", { name: /^reject all$/i }));

    const reason = screen.getByLabelText(/rejection reason/i);
    fireEvent.change(reason, { target: { value: "Missing supporting documents" } });
    fireEvent.click(screen.getByLabelText(/allow resubmission/i));
    fireEvent.click(screen.getByRole("button", { name: /confirm rejection/i }));

    expect(onRejectAll).toHaveBeenCalledWith("Missing supporting documents", true);
  });

  it("shows the cross-page notice and toggle only when more claims exist across pages", () => {
    const onToggleScope = jest.fn();
    renderModal({ onPageCount: 10, totalSelectableCount: 33, selectedCount: 10, onToggleScope });

    expect(screen.getByText(/33 claims match across all pages/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /all 33/i }));
    expect(onToggleScope).toHaveBeenCalledWith(true);
  });

  it("hides the cross-page toggle when every selectable claim is on the page", () => {
    renderModal({ onPageCount: 3, totalSelectableCount: 3 });
    expect(screen.queryByText(/match across all pages/i)).not.toBeInTheDocument();
  });

  it("resets the inline reject form after the modal is closed and reopened", () => {
    const { rerender, props } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: /^reject all$/i }));
    fireEvent.change(screen.getByLabelText(/rejection reason/i), {
      target: { value: "Stale reason that must not persist" },
    });

    // Close, then reopen.
    rerender(<ReviewSelectedClaimsModal {...props} open={false} />);
    rerender(<ReviewSelectedClaimsModal {...props} open={true} />);

    // Back to the default action view; no pre-filled reason.
    expect(screen.getByRole("button", { name: /approve all/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/rejection reason/i)).not.toBeInTheDocument();
  });
});
