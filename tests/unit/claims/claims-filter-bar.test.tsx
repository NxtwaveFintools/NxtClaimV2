import { act, cleanup, render } from "@testing-library/react";
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
      jest.advanceTimersByTime(500);
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
});
