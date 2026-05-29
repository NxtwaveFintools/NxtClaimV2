import { fireEvent, render, screen } from "@testing-library/react";
import { MyClaimsPaginationControls } from "@/modules/claims/ui/my-claims-pagination-controls";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  usePathname: () => "/dashboard/my-claims",
}));

describe("MyClaimsPaginationControls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders compact top controls with summary and navigation", () => {
    render(
      <MyClaimsPaginationControls
        hasNextPage
        currentCursor={null}
        nextCursor="next-cursor"
        prevCursor={null}
        summaryText="Showing 5 of 17 claims"
        position="top"
        searchParams={{ view: "submissions" }}
      />,
    );

    expect(screen.getByText("Showing 5 of 17 claims")).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous" })).toHaveClass("h-8");
    expect(screen.getByRole("button", { name: "Next" })).toHaveClass("h-8");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(mockReplace).toHaveBeenCalledWith(
      "/dashboard/my-claims?view=submissions&cursor=next-cursor&prevCursor=__first__",
      { scroll: false },
    );
  });
});
