import { cleanup, render, screen } from "@testing-library/react";
import { VerificationPanel } from "@/modules/claims/ui/verification-panel";
import type { VerificationSummary } from "@/modules/claims/repositories/SupabaseVerificationRepository";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => "/dashboard/claims/CLM-TEST",
  useSearchParams: () => ({ toString: () => "" }),
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    loading: jest.fn(),
  },
}));

jest.mock("@/modules/claims/actions", () => ({
  markClaimVerifiedAction: jest.fn(),
  rerunClaimVerificationAction: jest.fn(),
}));

/** Base summary with both duplicate arms set to "none" — override per test. */
function makeSummary(overrides?: Partial<VerificationSummary>): VerificationSummary {
  return {
    runId: "run-aaaa-1111",
    status: "completed",
    overallVerdict: "verified",
    invoiceDuplicate: { status: "none", claimIds: [] },
    amountDateDuplicate: { status: "none", claimIds: [] },
    model: "gemini-pro",
    receiptFileHash: null,
    finishedAt: null,
    checks: [],
    ...overrides,
  };
}

describe("VerificationPanel — duplicate arm boxes", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders BOTH duplicate boxes when both arms are 'match'", () => {
    render(
      <VerificationPanel
        claimId="CLM-BOTH"
        summary={makeSummary({
          invoiceDuplicate: { status: "match", claimIds: ["CLM-INV-1"] },
          amountDateDuplicate: { status: "match", claimIds: ["CLM-AMT-1"] },
        })}
        canAct={false}
      />,
    );

    expect(screen.getByText("Possible duplicate — same invoice number as:")).toBeInTheDocument();
    expect(screen.getByText("CLM-INV-1")).toBeInTheDocument();

    expect(screen.getByText("Possible duplicate — same amount & date as:")).toBeInTheDocument();
    expect(screen.getByText("CLM-AMT-1")).toBeInTheDocument();
  });

  test("renders only the invoice box when invoice is 'match' and amountDate is 'none'", () => {
    render(
      <VerificationPanel
        claimId="CLM-INV"
        summary={makeSummary({
          invoiceDuplicate: { status: "match", claimIds: ["CLM-INV-1"] },
          amountDateDuplicate: { status: "none", claimIds: [] },
        })}
        canAct={false}
      />,
    );

    expect(screen.getByText("Possible duplicate — same invoice number as:")).toBeInTheDocument();
    expect(
      screen.queryByText("Possible duplicate — same amount & date as:"),
    ).not.toBeInTheDocument();
  });

  test("renders only the amount & date box when amountDate is 'match' and invoice is 'none'", () => {
    render(
      <VerificationPanel
        claimId="CLM-AMT"
        summary={makeSummary({
          invoiceDuplicate: { status: "none", claimIds: [] },
          amountDateDuplicate: { status: "match", claimIds: ["CLM-AMT-1"] },
        })}
        canAct={false}
      />,
    );

    expect(screen.getByText("Possible duplicate — same amount & date as:")).toBeInTheDocument();
    expect(
      screen.queryByText("Possible duplicate — same invoice number as:"),
    ).not.toBeInTheDocument();
  });

  test("renders neither duplicate box when both arms are 'none'", () => {
    render(<VerificationPanel claimId="CLM-NONE" summary={makeSummary()} canAct={false} />);

    expect(
      screen.queryByText("Possible duplicate — same invoice number as:"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Possible duplicate — same amount & date as:"),
    ).not.toBeInTheDocument();
  });
});
