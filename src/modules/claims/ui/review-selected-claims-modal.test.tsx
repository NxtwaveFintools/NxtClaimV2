import { render, screen, fireEvent, within } from "@testing-library/react";
import { ReviewSelectedClaimsModal } from "@/modules/claims/ui/review-selected-claims-modal";
import { formatCurrency } from "@/lib/format";
import type { ReviewClaimRow } from "@/modules/claims/utils/review-selected-claims";

function buildRows(): ReviewClaimRow[] {
  return [
    {
      id: "1",
      submitter: "User A",
      submitterEmail: "a@x.com",
      onBehalfEmail: null,
      categoryName: "Food",
      detailType: "expense",
      totalAmount: 10,
    },
    {
      id: "2",
      submitter: "User A",
      submitterEmail: "a@x.com",
      onBehalfEmail: null,
      categoryName: "Travel Domestic",
      detailType: "expense",
      totalAmount: 20,
    },
    {
      id: "3",
      submitter: "User B",
      submitterEmail: "b@x.com",
      onBehalfEmail: null,
      categoryName: "Food",
      detailType: "expense",
      totalAmount: 50,
    },
    {
      id: "4",
      submitter: "User A",
      submitterEmail: "a@x.com",
      onBehalfEmail: null,
      categoryName: "Advance",
      detailType: "advance",
      totalAmount: 5,
    },
  ];
}

function renderModal(
  overrides: Partial<React.ComponentProps<typeof ReviewSelectedClaimsModal>> = {},
) {
  const props: React.ComponentProps<typeof ReviewSelectedClaimsModal> = {
    open: true,
    rows: buildRows(),
    selectedCount: 4,
    isApproving: false,
    isRejecting: false,
    onApproveAll: jest.fn(),
    onRejectAll: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };

  return { props, ...render(<ReviewSelectedClaimsModal {...props} />) };
}

describe("ReviewSelectedClaimsModal", () => {
  it("sums a submitter's expense claims into one row (10 + 20 = 30)", () => {
    renderModal();
    const expenseRows = screen.getAllByTestId("review-expense-row");
    // User A's two expense claims collapse into one row; User B is the other -> 2 rows.
    expect(expenseRows).toHaveLength(2);
    const userARow = expenseRows.find((rowEl) => within(rowEl).queryByText("User A"));
    expect(userARow).toHaveTextContent(formatCurrency(30));
  });

  it("orders expense rows by summed total, highest first (B=50 before A=30)", () => {
    renderModal();
    const expenseRows = screen.getAllByTestId("review-expense-row");
    expect(within(expenseRows[0]).getByText("User B")).toBeInTheDocument();
    expect(within(expenseRows[1]).getByText("User A")).toBeInTheDocument();
  });

  it("lists advance claims in their own separate section", () => {
    renderModal();
    const advanceRows = screen.getAllByTestId("review-advance-row");
    expect(advanceRows).toHaveLength(1);
    expect(advanceRows[0]).toHaveTextContent("User A");
    expect(advanceRows[0]).toHaveTextContent(formatCurrency(5));
  });

  it("shows a submitter's distinct expense categories as separate badges", () => {
    renderModal();
    const userAExpenseRow = screen
      .getAllByTestId("review-expense-row")
      .find((rowEl) => within(rowEl).queryByText("User A"));
    expect(userAExpenseRow).toBeDefined();
    // User A's two expense claims are Food + Travel Domestic, each rendered as its own badge.
    const badges = within(userAExpenseRow!).getAllByTestId("review-category-badge");
    expect(badges.map((badge) => badge.textContent)).toEqual(["Food", "Travel Domestic"]);
  });

  it("does not show categories in the advance section", () => {
    renderModal();
    const advanceRows = screen.getAllByTestId("review-advance-row");
    expect(
      within(advanceRows[0]).queryByTestId("review-expense-categories"),
    ).not.toBeInTheDocument();
  });

  it("hides the advance section when no advance claims are selected", () => {
    renderModal({ rows: buildRows().filter((row) => row.detailType === "expense") });
    expect(screen.queryByTestId("review-advance-row")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("review-expense-row").length).toBeGreaterThan(0);
  });

  it("shows the total selected count in the header", () => {
    renderModal({ selectedCount: 7 });
    expect(screen.getByText(/7 selected/i)).toBeInTheDocument();
  });

  it("does not render the removed cross-page scope toggle box", () => {
    renderModal();
    expect(screen.queryByText(/match across all pages/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /this page \(\d+\)/i })).not.toBeInTheDocument();
  });

  it("clarifies (no toggle) when more claims are selected than shown on this page", () => {
    // 4 rows on this page but 52 selected across pages.
    renderModal({ selectedCount: 52 });
    const clarifier = screen.getByTestId("review-scope-clarifier");
    expect(clarifier).toHaveTextContent(/this page'?s 4/i);
    expect(clarifier).toHaveTextContent(/all 52/i);
    // It must not be a toggle.
    expect(within(clarifier).queryByRole("button")).not.toBeInTheDocument();
  });

  it("hides the clarifier when the selected count matches the claims shown", () => {
    renderModal({ selectedCount: 4 });
    expect(screen.queryByTestId("review-scope-clarifier")).not.toBeInTheDocument();
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

  it("disables Back and Confirm Rejection when isRejecting is true", () => {
    const { rerender, props } = renderModal({ isRejecting: false });

    // Open the reject form, then simulate an in-flight rejection starting.
    fireEvent.click(screen.getByRole("button", { name: /^reject all$/i }));
    rerender(<ReviewSelectedClaimsModal {...props} isRejecting={true} />);

    expect(screen.getByRole("button", { name: /back/i })).toBeDisabled();
    // The confirm button relabels itself to "Processing..." while the request is in-flight.
    expect(screen.getByRole("button", { name: /processing/i })).toBeDisabled();
  });

  it("clicking Back from the reject form returns to the Approve All / Reject All view", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /^reject all$/i }));
    expect(screen.getByRole("button", { name: /confirm rejection/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(screen.getByRole("button", { name: /approve all/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject all$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm rejection/i })).not.toBeInTheDocument();
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
