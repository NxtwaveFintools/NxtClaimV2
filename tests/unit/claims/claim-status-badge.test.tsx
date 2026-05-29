import { render, screen } from "@testing-library/react";
import { ClaimStatusBadge } from "@/modules/claims/ui/claim-status-badge";

describe("ClaimStatusBadge", () => {
  test("renders Submitted - Awaiting HOD approval with blue styling", () => {
    render(<ClaimStatusBadge status="Submitted - Awaiting HOD approval" />);

    const badge = screen.getByText("Awaiting HOD");

    expect(badge).toHaveClass("border-sky-300");
    expect(badge).toHaveClass("bg-sky-50/80");
    expect(badge).toHaveClass("text-sky-800");
    expect(badge).not.toHaveClass("border-amber-300");
    expect(badge).toHaveAttribute("title", "Submitted - Awaiting HOD approval");
  });

  test("keeps HOD approved status with amber styling", () => {
    render(<ClaimStatusBadge status="HOD approved - Awaiting finance approval" />);

    const badge = screen.getByText("Awaiting Finance");

    expect(badge).toHaveClass("border-amber-300");
    expect(badge).toHaveClass("bg-amber-50/80");
    expect(badge).toHaveClass("text-amber-800");
    expect(badge).not.toHaveClass("border-sky-300");
  });

  test("renders full finance processing status when fullStatus is enabled", () => {
    render(<ClaimStatusBadge status="Finance Approved - Payment under process" fullStatus />);

    const badge = screen.getByText("Finance Approved - Payment under process");

    expect(badge).toBeVisible();
    expect(badge).not.toHaveAttribute("title");
  });

  test("uses compact wrapping classes for full-width full statuses", () => {
    render(
      <ClaimStatusBadge status="Finance Approved - Payment under process" fullWidth fullStatus />,
    );

    const badge = screen.getByText("Finance Approved - Payment under process");

    expect(badge).toHaveClass("max-w-[190px]");
    expect(badge).toHaveClass("px-2.5");
    expect(badge).toHaveClass("py-1.5");
    expect(badge).toHaveClass("leading-tight");
  });
});
