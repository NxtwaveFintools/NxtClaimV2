export const PAYMENT_MODE_REIMBURSEMENT = "reimbursement";
export const PAYMENT_MODE_PETTY_CASH = "petty cash";
export const PAYMENT_MODE_PETTY_CASH_REQUEST = "petty cash request";
export const PAYMENT_MODE_BULK_PETTY_CASH_REQUEST = "bulk petty cash request";
export const PAYMENT_MODE_CORPORATE_CARD = "corporate card";
export const PAYMENT_MODE_HAPPAY = "happay";
export const PAYMENT_MODE_FOREX = "forex";

const EXPENSE_PAYMENT_MODE_NAMES = new Set([
  PAYMENT_MODE_REIMBURSEMENT,
  PAYMENT_MODE_CORPORATE_CARD,
  PAYMENT_MODE_HAPPAY,
  PAYMENT_MODE_FOREX,
  PAYMENT_MODE_PETTY_CASH,
]);

const ADVANCE_PAYMENT_MODE_NAMES = new Set([
  PAYMENT_MODE_PETTY_CASH_REQUEST,
  PAYMENT_MODE_BULK_PETTY_CASH_REQUEST,
]);

const ADMIN_OVERRIDE_ALLOWED_PAYMENT_MODE_NAMES = new Set([
  PAYMENT_MODE_REIMBURSEMENT,
  PAYMENT_MODE_PETTY_CASH,
]);

export function normalizePaymentModeName(name: string | null | undefined): string {
  if (!name) {
    return "";
  }

  return name.trim().toLowerCase();
}

export function isCorporateCardPaymentModeName(name: string | null | undefined): boolean {
  return normalizePaymentModeName(name) === PAYMENT_MODE_CORPORATE_CARD;
}

export function isExpensePaymentModeName(name: string | null | undefined): boolean {
  return EXPENSE_PAYMENT_MODE_NAMES.has(normalizePaymentModeName(name));
}

export function isAdvancePaymentModeName(name: string | null | undefined): boolean {
  return ADVANCE_PAYMENT_MODE_NAMES.has(normalizePaymentModeName(name));
}

export function isAdminPaymentModeOverrideAllowedName(name: string | null | undefined): boolean {
  return ADMIN_OVERRIDE_ALLOWED_PAYMENT_MODE_NAMES.has(normalizePaymentModeName(name));
}
