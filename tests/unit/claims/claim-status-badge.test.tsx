import { render, screen } from "@testing-library/react";
import { ClaimStatusBadge } from "@/modules/claims/ui/claim-status-badge";

describe("ClaimStatusBadge", () => {
  test("shows a short 'Awaiting HOD' label with slate tone for a freshly submitted claim", () => {
    render(<ClaimStatusBadge status="Submitted - Awaiting HOD approval" />);

    const badge = screen.getByText("Awaiting HOD");

    expect(badge).toHaveClass("bg-slate-50");
    expect(badge).toHaveClass("text-slate-700");
    expect(badge).not.toHaveClass("bg-blue-50");
  });

  test("shows a 'HOD Approved' label with blue tone once HOD has approved", () => {
    render(<ClaimStatusBadge status="HOD approved - Awaiting finance approval" />);

    const badge = screen.getByText("HOD Approved");

    expect(badge).toHaveClass("bg-blue-50");
    expect(badge).toHaveClass("text-blue-700");
    expect(badge).not.toHaveClass("bg-slate-50");
  });

  test("keeps the full status text available for accessibility and tooltips", () => {
    render(<ClaimStatusBadge status="Payment Done - Closed" />);

    const badge = screen.getByText("Payment Done");

    expect(badge).toHaveAttribute("title", "Payment Done - Closed");
    expect(badge).toHaveAttribute("aria-label", "Payment Done - Closed");
  });

  test("distinguishes resubmittable rejections (amber) from final rejections (red)", () => {
    const { rerender } = render(<ClaimStatusBadge status="Rejected - Resubmission Allowed" />);
    expect(screen.getByText("Rejected · Resubmit")).toHaveClass("bg-amber-50");

    rerender(<ClaimStatusBadge status="Rejected - Resubmission Not Allowed" />);
    expect(screen.getByText("Rejected")).toHaveClass("bg-rose-50");
  });
});
