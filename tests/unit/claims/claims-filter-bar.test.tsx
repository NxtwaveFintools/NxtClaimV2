import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClaimsFilterBar } from "@/modules/claims/ui/claims-filter-bar";

const mockReplace = jest.fn();
const mockGetAccessTokenAction = jest.fn();

let currentSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => "/dashboard/my-claims",
  useSearchParams: () => currentSearchParams,
}));

jest.mock("@/modules/auth/actions", () => ({
  getAccessTokenAction: () => mockGetAccessTokenAction(),
}));

function setCurrentUrl(search: string): void {
  const nextHref = search ? `/dashboard/my-claims?${search}` : "/dashboard/my-claims";
  window.history.replaceState({}, "", nextHref);
  currentSearchParams = new URLSearchParams(search);
}

const sharedProps = {
  paymentModes: [],
  departments: [],
  locations: [],
  products: [],
  expenseCategories: [],
};

describe("ClaimsFilterBar URL sync", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    sessionStorage.clear();
    setCurrentUrl("");
  });

  afterEach(() => {
    cleanup();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  async function flushDebounceWindow(): Promise<void> {
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
  }

  test("does not replace URL on mount when query already contains active filters", async () => {
    setCurrentUrl("view=submissions&search_field=claim_id&search_query=INV-1001");

    render(<ClaimsFilterBar {...sharedProps} exportScope="submissions" />);

    await flushDebounceWindow();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  test("does not restore session filters into URL when URL already has non-filter params", async () => {
    sessionStorage.setItem(
      "dashboard-filter-approvals-search-query",
      JSON.stringify("persisted-query"),
    );

    setCurrentUrl("view=approvals");

    render(<ClaimsFilterBar {...sharedProps} exportScope="approvals" />);

    await flushDebounceWindow();

    expect(mockReplace).not.toHaveBeenCalled();
  });

  test("renders a disabled locked status filter for finance HOD-pending scope", async () => {
    render(
      <ClaimsFilterBar
        {...sharedProps}
        exportScope="finance_hod_pending"
        storageScope="finance_hod_pending"
        lockedStatus="Submitted - Awaiting HOD approval"
        statusFilterMode="disabled"
      />,
    );

    await flushDebounceWindow();

    const statusSelect = screen.getByDisplayValue("Submitted - Awaiting HOD approval");

    expect(statusSelect).toBeDisabled();
  });

  test("preserves locked status when clear all is used", async () => {
    setCurrentUrl("status=Submitted+-+Awaiting+HOD+approval&department_id=dept-1");

    render(
      <ClaimsFilterBar
        {...sharedProps}
        exportScope="finance_hod_pending"
        storageScope="finance_hod_pending"
        lockedStatus="Submitted - Awaiting HOD approval"
        statusFilterMode="disabled"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));

    expect(mockReplace).toHaveBeenCalledWith(
      "/dashboard/my-claims?status=Submitted+-+Awaiting+HOD+approval",
      { scroll: false },
    );
  });

  test("keeps primary filters visible and secondary filters collapsed by default", async () => {
    const { rerender } = render(<ClaimsFilterBar {...sharedProps} exportScope="submissions" />);

    await flushDebounceWindow();

    expect(screen.getByLabelText("Search Category")).toBeVisible();
    expect(screen.getByLabelText("Search")).toBeVisible();
    expect(screen.getByLabelText("Status")).toBeVisible();
    expect(screen.getByLabelText("From")).toBeVisible();
    expect(screen.getByLabelText("To")).toBeVisible();
    expect(screen.getByRole("button", { name: /More Filters/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Export Excel" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Clear All" })).toBeVisible();

    expect(screen.getByLabelText("Submission Type")).not.toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /More Filters/ }));
    setCurrentUrl("filters=open");
    rerender(<ClaimsFilterBar {...sharedProps} exportScope="submissions" />);

    expect(screen.getByLabelText("Submission Type")).toBeVisible();
  });
});
