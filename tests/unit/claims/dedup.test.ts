import { describe, expect, it } from "@jest/globals";

// Predicate replicates the comparison logic from
// SupabaseClaimRepository.existsExpenseByCompositeKey. If the predicate is
// later extracted into a shared helper, import it here instead.

function rowMatchesInput(
  row: {
    total_amount: number | null;
    foreign_currency_code: string | null;
    foreign_basic_amount: number | null;
  },
  input: {
    totalAmount: number;
    foreignCurrencyCode?: string | null;
    foreignBasicAmount?: number | null;
  },
): boolean {
  const epsilon = 0.01;
  const inputForeignCode = input.foreignCurrencyCode ?? "INR";
  const inputForeignBasic = Number(input.foreignBasicAmount ?? 0);
  const isInputForeign = inputForeignCode !== "INR";
  const candidateForeignCode = row.foreign_currency_code ?? "INR";
  const candidateForeignBasic = Number(row.foreign_basic_amount ?? 0);
  const isCandidateForeign = candidateForeignCode !== "INR";
  if (isInputForeign !== isCandidateForeign) return false;
  if (isInputForeign) {
    if (candidateForeignCode !== inputForeignCode) return false;
    if (!Number.isFinite(candidateForeignBasic)) return false;
    return Math.abs(candidateForeignBasic - inputForeignBasic) <= epsilon;
  }
  const candidateTotalAmount = Number(row.total_amount);
  if (!Number.isFinite(candidateTotalAmount)) return false;
  return Math.abs(candidateTotalAmount - input.totalAmount) <= epsilon;
}

describe("expense dedup composite key — foreign claims", () => {
  it("two foreign claims same bill/date but different currencies do not collide", () => {
    const usdRow = { total_amount: 0, foreign_currency_code: "USD", foreign_basic_amount: 100 };
    const eurInput = { totalAmount: 0, foreignCurrencyCode: "EUR", foreignBasicAmount: 100 };
    expect(rowMatchesInput(usdRow, eurInput)).toBe(false);
  });

  it("two foreign claims same currency + same foreign_basic_amount do collide", () => {
    const usdRow = { total_amount: 0, foreign_currency_code: "USD", foreign_basic_amount: 100 };
    const usdInput = { totalAmount: 0, foreignCurrencyCode: "USD", foreignBasicAmount: 100 };
    expect(rowMatchesInput(usdRow, usdInput)).toBe(true);
  });

  it("foreign claim never collides with an INR claim sharing total=0", () => {
    const inrRow = { total_amount: 0, foreign_currency_code: "INR", foreign_basic_amount: 0 };
    const usdInput = { totalAmount: 0, foreignCurrencyCode: "USD", foreignBasicAmount: 100 };
    expect(rowMatchesInput(inrRow, usdInput)).toBe(false);
  });

  it("INR claims still dedup by total_amount with epsilon tolerance", () => {
    const row = { total_amount: 100.005, foreign_currency_code: "INR", foreign_basic_amount: 0 };
    const input = { totalAmount: 100.01, foreignCurrencyCode: "INR", foreignBasicAmount: 0 };
    expect(rowMatchesInput(row, input)).toBe(true);
  });
});
