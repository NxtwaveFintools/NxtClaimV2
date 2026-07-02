import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VerificationFilterChips } from "@/modules/claims/ui/verification-filter-chips";
import { bulkRerunExtractionFailedAction } from "@/modules/claims/actions";
import { toast } from "sonner";
import type { VerificationBadgeState } from "@/modules/claims/repositories/SupabaseVerificationRepository";

let mockSearch = "";
const mockRefresh = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: mockRefresh }),
  usePathname: () => "/dashboard/my-claims",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/modules/claims/actions", () => ({
  bulkRerunExtractionFailedAction: jest.fn(),
}));

const mockAction = bulkRerunExtractionFailedAction as jest.Mock;

function makeCounts(
  overrides?: Partial<Record<VerificationBadgeState, number>>,
): Record<VerificationBadgeState, number> {
  return {
    mismatch: 0,
    statement_mismatch: 0,
    needs_review: 0,
    verified: 0,
    pending: 0,
    extraction_failed: 0,
    no_document: 0,
    ...overrides,
  };
}

describe("VerificationFilterChips — bulk re-verify button", () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    mockSearch = "";
  });

  test("hides the button when the extraction_failed filter is not active", () => {
    mockSearch = "";
    render(<VerificationFilterChips counts={makeCounts({ extraction_failed: 5 })} />);
    expect(screen.queryByText(/Re-verify all/)).not.toBeInTheDocument();
  });

  test("hides the button when the filter is active but the count is 0", () => {
    mockSearch = "ai_verdict=extraction_failed";
    render(<VerificationFilterChips counts={makeCounts({ extraction_failed: 0 })} />);
    expect(screen.queryByText(/Re-verify all/)).not.toBeInTheDocument();
  });

  test("shows the button with the count when the filter is active", () => {
    mockSearch = "ai_verdict=extraction_failed";
    render(<VerificationFilterChips counts={makeCounts({ extraction_failed: 5 })} />);
    expect(screen.getByText("Re-verify all (5)")).toBeInTheDocument();
  });

  test("confirms, calls the action, toasts the actual count, and refreshes", async () => {
    mockSearch = "ai_verdict=extraction_failed";
    jest.spyOn(window, "confirm").mockReturnValue(true);
    mockAction.mockResolvedValue({ ok: true, count: 4 });

    render(<VerificationFilterChips counts={makeCounts({ extraction_failed: 5 })} />);
    fireEvent.click(screen.getByText("Re-verify all (5)"));

    await waitFor(() => {
      expect(mockAction).toHaveBeenCalledTimes(1);
      expect(toast.success).toHaveBeenCalledWith("Re-queued 4 claims for verification");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  test("does not call the action when the confirm is dismissed", () => {
    mockSearch = "ai_verdict=extraction_failed";
    jest.spyOn(window, "confirm").mockReturnValue(false);

    render(<VerificationFilterChips counts={makeCounts({ extraction_failed: 5 })} />);
    fireEvent.click(screen.getByText("Re-verify all (5)"));

    expect(mockAction).not.toHaveBeenCalled();
  });

  test("shows an error toast when the action fails", async () => {
    mockSearch = "ai_verdict=extraction_failed";
    jest.spyOn(window, "confirm").mockReturnValue(true);
    mockAction.mockResolvedValue({
      ok: false,
      message: "Only finance approvers can re-run AI verification.",
    });

    render(<VerificationFilterChips counts={makeCounts({ extraction_failed: 5 })} />);
    fireEvent.click(screen.getByText("Re-verify all (5)"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Only finance approvers can re-run AI verification.",
      );
      expect(mockRefresh).not.toHaveBeenCalled();
    });
  });
});
