export function computeInrTotal(input: {
  basicAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
}): number {
  return (
    Math.round((input.basicAmount + input.cgstAmount + input.sgstAmount + input.igstAmount) * 100) /
    100
  );
}

export function computeForeignTotal(input: { basicAmount: number; gstAmount: number }): number {
  return Math.round((input.basicAmount + input.gstAmount) * 100) / 100;
}
