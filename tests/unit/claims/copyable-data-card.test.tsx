import { render, screen } from "@testing-library/react";
import { CopyableDataCard } from "@/modules/claims/ui/copyable-data-card";

describe("CopyableDataCard", () => {
  test("uses compact claim-review fact tile styling", () => {
    render(<CopyableDataCard label="Claim ID" value="CLAIM-123" />);

    const tile = screen.getByRole("button", { name: /claim id/i });
    const label = screen.getByText("Claim ID");
    const value = screen.getByText("CLAIM-123");

    expect(tile).toHaveClass("min-h-16");
    expect(tile).toHaveClass("rounded-[10px]");
    expect(tile).toHaveClass("bg-background-secondary");
    expect(tile).toHaveClass("p-3");
    expect(label).toHaveClass("tracking-[0.06em]");
    expect(value).toHaveClass("text-[14px]");
  });
});
