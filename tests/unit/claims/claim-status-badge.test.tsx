import { render, screen } from "@testing-library/react";
import { ClaimStatusBadge } from "@/modules/claims/ui/claim-status-badge";

describe("ClaimStatusBadge", () => {
  test("renders Submitted - Awaiting HOD approval with blue styling", () => {
    render(<ClaimStatusBadge status="Submitted - Awaiting HOD approval" />);

    const badge = screen.getByText("Submitted - Awaiting HOD approval");

    expect(badge).toHaveClass("border-sky-300");
    expect(badge).toHaveClass("bg-sky-50/80");
    expect(badge).toHaveClass("text-sky-800");
    expect(badge).not.toHaveClass("border-amber-300");
  });

  test("keeps HOD approved status with amber styling", () => {
    render(<ClaimStatusBadge status="HOD approved - Awaiting finance approval" />);

    const badge = screen.getByText("HOD approved - Awaiting finance approval");

    expect(badge).toHaveClass("border-amber-300");
    expect(badge).toHaveClass("bg-amber-50/80");
    expect(badge).toHaveClass("text-amber-800");
    expect(badge).not.toHaveClass("border-sky-300");
  });
});
