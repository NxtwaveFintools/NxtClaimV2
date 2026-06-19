"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { FormInput } from "@/components/ui/form-input";
import { FormSelect } from "@/components/ui/form-select";
import { FormTextarea } from "@/components/ui/form-textarea";
import { SheetClose, useOptionalSheetContext } from "@/components/ui/sheet";
import { AiAuditCaption } from "@/components/ui/ai-audit-caption";
import { LOCATION_TYPE_OPTIONS } from "@/core/constants/location-types";
import {
  isAdvancePaymentModeName,
  isExpensePaymentModeName,
  normalizePaymentModeName,
  PAYMENT_MODE_PETTY_CASH_REQUEST,
} from "@/core/constants/payment-modes";
import type { ClaimExpenseAiMetadata } from "@/core/domain/claims/contracts";
import { computeForeignTotal } from "@/modules/claims/utils/compute-totals";
import { ISO_CURRENCY_CODES, PINNED_CURRENCY_CODES } from "@/core/constants/iso-currency-codes";

type DropdownOption = {
  id: string;
  name: string;
};

type FinanceEditClaimActionResult = {
  ok: boolean;
  error?: string;
  duplicateClaimId?: string;
};

type FinanceEditPresentation = "inline-toggle" | "embedded";

type ExpenseComponentAmountField = "basicAmount" | "cgstAmount" | "sgstAmount" | "igstAmount";

type ExpenseAmountState = {
  basicAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
};

type ForeignCurrencyCode = string;

type ForeignAmountState = {
  foreignCurrencyCode: ForeignCurrencyCode;
  foreignBasicAmount: number;
  foreignGstAmount: number;
  foreignTotalAmount: number;
};

type FinanceEditClaimFormProps = {
  editFlow: "finance" | "own";
  claim: {
    id: string;
    employeeName: string;
    employeeEmail: string | null;
    submissionType: "Self" | "On Behalf";
    onBehalfEmail: string | null;
    onBehalfEmployeeCode: string | null;
    detailType: "expense" | "advance";
    departmentId: string;
    paymentModeId: string;
    expense: {
      id: string;
      billNo: string;
      expenseCategoryId: string | null;
      locationId: string | null;
      locationType: string | null;
      locationDetails: string | null;
      transactionDate: string;
      isGstApplicable: boolean | null;
      gstNumber: string | null;
      basicAmount: number | null;
      cgstAmount: number | null;
      sgstAmount: number | null;
      igstAmount: number | null;
      totalAmount: number | null;
      vendorName: string | null;
      purpose: string | null;
      productId: string | null;
      peopleInvolved: string | null;
      remarks: string | null;
      aiMetadata?: ClaimExpenseAiMetadata | null;
      foreignCurrencyCode?: ForeignCurrencyCode | null;
      foreignBasicAmount?: number | null;
      foreignGstAmount?: number | null;
      foreignTotalAmount?: number | null;
    } | null;
    advance: {
      id: string;
      purpose: string;
      totalAmount: number | null;
      expectedUsageDate: string;
      productId: string | null;
      locationId: string | null;
      remarks: string | null;
    } | null;
  };
  departments: DropdownOption[];
  paymentModes: DropdownOption[];
  expenseCategories: DropdownOption[];
  products: DropdownOption[];
  locations: DropdownOption[];
  isEditMode?: boolean;
  canEditPaymentMode?: boolean;
  requireEditReason?: boolean;
  defaultEditReason?: string;
  presentation?: FinanceEditPresentation;
  showSecondaryAction?: boolean;
  onSuccess?: () => void | Promise<void>;
  onCancel?: () => void;
  action: (formData: FormData) => Promise<FinanceEditClaimActionResult>;
};

function roundCurrency(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function toNonNegativeCurrency(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0;
  }

  return roundCurrency(Math.max(0, value));
}

function calculateExpenseTotal(input: {
  basicAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
}): number {
  return roundCurrency(input.basicAmount + input.cgstAmount + input.sgstAmount + input.igstAmount);
}

function buildExpenseAmountState(
  expense:
    | Pick<
        NonNullable<FinanceEditClaimFormProps["claim"]["expense"]>,
        "basicAmount" | "cgstAmount" | "sgstAmount" | "igstAmount" | "totalAmount"
      >
    | null
    | undefined,
): ExpenseAmountState {
  const basicAmount = toNonNegativeCurrency(expense?.basicAmount);
  const cgstAmount = toNonNegativeCurrency(expense?.cgstAmount);
  const sgstAmount = toNonNegativeCurrency(expense?.sgstAmount);
  const igstAmount = toNonNegativeCurrency(expense?.igstAmount);
  const totalAmount =
    expense?.totalAmount === null || expense?.totalAmount === undefined
      ? calculateExpenseTotal({ basicAmount, cgstAmount, sgstAmount, igstAmount })
      : toNonNegativeCurrency(expense.totalAmount);

  return {
    basicAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalAmount,
  };
}

function buildForeignAmountState(expense: {
  foreignCurrencyCode?: ForeignCurrencyCode | null;
  foreignBasicAmount?: number | null;
  foreignGstAmount?: number | null;
}): ForeignAmountState {
  const foreignBasicAmount = toNonNegativeCurrency(expense.foreignBasicAmount);
  const foreignGstAmount = toNonNegativeCurrency(expense.foreignGstAmount);
  return {
    foreignCurrencyCode: expense.foreignCurrencyCode ?? "INR",
    foreignBasicAmount,
    foreignGstAmount,
    foreignTotalAmount: computeForeignTotal({
      basicAmount: foreignBasicAmount,
      gstAmount: foreignGstAmount,
    }),
  };
}

function toCurrencyInputValue(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value.slice(0, 10);
}

export function FinanceEditClaimForm({
  editFlow,
  claim,
  departments,
  paymentModes,
  expenseCategories,
  products,
  locations,
  isEditMode = true,
  canEditPaymentMode = false,
  requireEditReason = true,
  defaultEditReason,
  presentation = "inline-toggle",
  showSecondaryAction = true,
  onSuccess,
  onCancel,
  action,
}: FinanceEditClaimFormProps) {
  const sheetContext = useOptionalSheetContext();
  const isFinanceEdit = editFlow === "finance";
  const isOwnEdit = editFlow === "own";
  const initialExpenseAmounts = buildExpenseAmountState(claim.expense);
  const [isInlineOpen, setIsInlineOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expenseAmounts, setExpenseAmounts] = useState<ExpenseAmountState>(
    () => initialExpenseAmounts,
  );
  const [totalAmountInputValue, setTotalAmountInputValue] = useState<string>(() =>
    toCurrencyInputValue(initialExpenseAmounts.totalAmount),
  );
  const [advanceTotalAmount, setAdvanceTotalAmount] = useState<number>(() =>
    toNonNegativeCurrency(claim.advance?.totalAmount),
  );
  const [foreignAmounts, setForeignAmounts] = useState<ForeignAmountState>(() =>
    buildForeignAmountState(claim.expense ?? {}),
  );
  const expenseId = claim.expense?.id ?? null;
  const aiMetadata = isFinanceEdit ? (claim.expense?.aiMetadata ?? null) : null;
  const expenseBasicAmount = claim.expense?.basicAmount ?? null;
  const expenseCgstAmount = claim.expense?.cgstAmount ?? null;
  const expenseSgstAmount = claim.expense?.sgstAmount ?? null;
  const expenseIgstAmount = claim.expense?.igstAmount ?? null;
  const expenseTotalAmount = claim.expense?.totalAmount ?? null;
  const expenseForeignCurrencyCode = claim.expense?.foreignCurrencyCode ?? null;
  const expenseForeignBasicAmount = claim.expense?.foreignBasicAmount ?? null;
  const expenseForeignGstAmount = claim.expense?.foreignGstAmount ?? null;
  const advanceId = claim.advance?.id ?? null;
  const advanceTotalAmountProp = claim.advance?.totalAmount ?? null;
  const currentPaymentModeName =
    paymentModes.find((pm) => pm.id === claim.paymentModeId)?.name ?? "";
  const canEditAdvanceTotalAmount =
    isFinanceEdit &&
    normalizePaymentModeName(currentPaymentModeName) === PAYMENT_MODE_PETTY_CASH_REQUEST;
  const isEmbeddedPresentation = presentation === "embedded";
  const isOpen = isEmbeddedPresentation ? true : isInlineOpen;
  const isDepartmentFieldLocked = isEditMode;
  const isPaymentModeFieldLocked = isEditMode && !canEditPaymentMode;
  const filteredPaymentModes = paymentModes.filter((paymentMode) =>
    claim.detailType === "expense"
      ? isExpensePaymentModeName(paymentMode.name)
      : isAdvancePaymentModeName(paymentMode.name),
  );
  const groupedWrapperClassName =
    "bg-muted/30 border border-border/50 rounded-xl p-5 mb-6 space-y-4";
  const groupedTitleClassName =
    "text-xs uppercase tracking-wider text-muted-foreground font-bold mb-4";
  const groupedGridClassName = "grid grid-cols-1 md:grid-cols-2 gap-4";
  const lockedFieldClassName =
    "rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400";

  useEffect(() => {
    const nextExpenseAmounts = buildExpenseAmountState({
      basicAmount: expenseBasicAmount,
      cgstAmount: expenseCgstAmount,
      sgstAmount: expenseSgstAmount,
      igstAmount: expenseIgstAmount,
      totalAmount: expenseTotalAmount,
    });

    setExpenseAmounts(nextExpenseAmounts);
    setTotalAmountInputValue(toCurrencyInputValue(nextExpenseAmounts.totalAmount));
  }, [
    expenseId,
    expenseBasicAmount,
    expenseCgstAmount,
    expenseSgstAmount,
    expenseIgstAmount,
    expenseTotalAmount,
  ]);

  useEffect(() => {
    setAdvanceTotalAmount(toNonNegativeCurrency(advanceTotalAmountProp));
  }, [advanceId, advanceTotalAmountProp]);

  useEffect(() => {
    setForeignAmounts(
      buildForeignAmountState({
        foreignCurrencyCode: expenseForeignCurrencyCode,
        foreignBasicAmount: expenseForeignBasicAmount,
        foreignGstAmount: expenseForeignGstAmount,
      }),
    );
  }, [expenseId, expenseForeignCurrencyCode, expenseForeignBasicAmount, expenseForeignGstAmount]);

  const handleExpenseComponentAmountChange = (
    field: ExpenseComponentAmountField,
    value: number | null,
  ) => {
    setExpenseAmounts((current) => {
      const next = {
        ...current,
        [field]: toNonNegativeCurrency(value),
      } as ExpenseAmountState;
      const nextTotalAmount = calculateExpenseTotal(next);

      setTotalAmountInputValue(toCurrencyInputValue(nextTotalAmount));

      return {
        ...next,
        totalAmount: nextTotalAmount,
      };
    });
  };

  const handleForeignCurrencyCodeChange = (code: ForeignCurrencyCode) => {
    setForeignAmounts((prev) => ({ ...prev, foreignCurrencyCode: code }));
  };

  const handleForeignAmountChange = (
    field: "foreignBasicAmount" | "foreignGstAmount",
    value: number | null,
  ) => {
    setForeignAmounts((prev) => {
      const updated = { ...prev, [field]: toNonNegativeCurrency(value) };
      return {
        ...updated,
        foreignTotalAmount: computeForeignTotal({
          basicAmount: updated.foreignBasicAmount,
          gstAmount: updated.foreignGstAmount,
        }),
      };
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    setIsSubmitting(true);

    try {
      const result = await action(formData);

      if (!result.ok) {
        if (result.duplicateClaimId) {
          const claimId = result.duplicateClaimId;
          const toastId = crypto.randomUUID();
          toast.error(
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold uppercase tracking-wide text-rose-600 dark:text-rose-500">
                  Duplicate Intercepted
                </span>
              </div>
              <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                An identical combination already exists in{" "}
                <Link
                  href={`/dashboard/claims/${claimId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => toast.dismiss(toastId)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-0.5 font-mono text-xs font-bold text-rose-600 underline decoration-rose-500/30 transition-all hover:scale-[1.02] hover:bg-rose-100 active:scale-[0.98] dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
                >
                  #{claimId}
                  <ExternalLink className="inline h-3 w-3 opacity-70" aria-hidden="true" />
                </Link>
              </p>
              <span className="mt-0.5 text-[11px] italic text-zinc-400 dark:text-zinc-500">
                Clicking opens in a new tab to preserve your current edits.
              </span>
            </div>,
            {
              id: toastId,
              duration: 8000,
              className:
                "bg-white/95 dark:bg-zinc-900/95 border border-rose-200 dark:border-rose-500/30 text-zinc-900 dark:text-zinc-200 rounded-xl shadow-xl dark:shadow-2xl backdrop-blur-md px-4 py-3.5 min-w-[340px]",
            },
          );
        } else {
          toast.error(result.error ?? "Unable to save claim edits.");
        }
        return;
      }

      toast.success("Claim edits saved.");

      if (isEmbeddedPresentation) {
        sheetContext?.setOpen(false);
      } else {
        setIsInlineOpen(false);
      }

      await onSuccess?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save claim edits.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return (
      <Button
        onClick={() => {
          setIsInlineOpen(true);
        }}
        variant="secondary"
        size="md"
        className="border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-600/60 dark:bg-indigo-600/15 dark:text-indigo-200 dark:hover:bg-indigo-600/25"
      >
        Edit Claim
      </Button>
    );
  }

  const expense = claim.expense;
  const advance = claim.advance;

  return (
    <section
      className={`${
        isEmbeddedPresentation
          ? "h-full rounded-none border-0 bg-transparent p-0"
          : "mt-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-indigo-700/40 dark:bg-zinc-800"
      }`}
    >
      <form
        onSubmit={handleSubmit}
        className={isEmbeddedPresentation ? "flex h-full min-h-0 flex-col" : "mt-4 grid gap-4"}
      >
        <input type="hidden" name="detailType" value={claim.detailType} />
        <input
          type="hidden"
          name="detailId"
          value={claim.detailType === "expense" ? (expense?.id ?? "") : (advance?.id ?? "")}
        />
        <input
          type="hidden"
          name="foreignCurrencyCode"
          value={foreignAmounts.foreignCurrencyCode}
        />
        <input type="hidden" name="foreignBasicAmount" value={foreignAmounts.foreignBasicAmount} />
        <input type="hidden" name="foreignGstAmount" value={foreignAmounts.foreignGstAmount} />
        <input type="hidden" name="foreignTotalAmount" value={foreignAmounts.foreignTotalAmount} />

        <fieldset
          disabled={isSubmitting}
          className={isEmbeddedPresentation ? "flex min-h-0 flex-1 flex-col" : "contents"}
        >
          <div
            className={
              isEmbeddedPresentation ? "flex-1 overflow-y-auto p-6 space-y-6" : "space-y-4"
            }
          >
            <div className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-300">
                Edit Claim
              </h2>
              <p className="text-xs text-zinc-600 dark:text-indigo-100/80">
                Routing context is locked during edits. Only detail fields can be updated.
              </p>
            </div>

            <div className={groupedWrapperClassName}>
              <h4 className={groupedTitleClassName}>General Info</h4>
              <div className={groupedGridClassName}>
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Claim ID (Read-only)
                  <FormInput
                    value={claim.id}
                    disabled
                    className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                  />
                </label>

                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Employee Name (Read-only)
                  <FormInput
                    value={claim.employeeName}
                    disabled
                    className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                  />
                </label>

                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Employee Email (Read-only)
                  <FormInput
                    value={claim.employeeEmail ?? "N/A"}
                    disabled
                    className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                  />
                </label>

                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Submission Type (Read-only)
                  <FormInput
                    value={claim.submissionType}
                    disabled={isEditMode}
                    readOnly={isEditMode}
                    className={lockedFieldClassName}
                  />
                </label>

                {claim.submissionType === "On Behalf" ? (
                  <>
                    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                      On Behalf Email (Read-only)
                      <FormInput
                        value={claim.onBehalfEmail ?? "N/A"}
                        disabled={isEditMode}
                        readOnly={isEditMode}
                        className={lockedFieldClassName}
                      />
                    </label>

                    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                      On Behalf Employee ID (Read-only)
                      <FormInput
                        value={claim.onBehalfEmployeeCode ?? "N/A"}
                        disabled={isEditMode}
                        readOnly={isEditMode}
                        className={lockedFieldClassName}
                      />
                    </label>
                  </>
                ) : null}
              </div>
            </div>

            <div className={groupedWrapperClassName}>
              <h4 className={groupedTitleClassName}>Routing Context</h4>
              <div className={groupedGridClassName}>
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Department
                  <FormSelect
                    name="departmentId"
                    required
                    defaultValue={claim.departmentId}
                    disabled={isDepartmentFieldLocked}
                    className={
                      isDepartmentFieldLocked
                        ? lockedFieldClassName
                        : "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    }
                  >
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </FormSelect>
                </label>

                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Payment Mode
                  {isFinanceEdit && isPaymentModeFieldLocked ? (
                    <input type="hidden" name="paymentModeId" value={claim.paymentModeId} />
                  ) : null}
                  <FormSelect
                    name="paymentModeId"
                    required
                    defaultValue={claim.paymentModeId}
                    disabled={isPaymentModeFieldLocked}
                    className={
                      isPaymentModeFieldLocked
                        ? lockedFieldClassName
                        : "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    }
                  >
                    {filteredPaymentModes.map((paymentMode) => (
                      <option key={paymentMode.id} value={paymentMode.id}>
                        {paymentMode.name}
                      </option>
                    ))}
                  </FormSelect>
                </label>
              </div>
            </div>

            {claim.detailType === "expense" ? (
              isFinanceEdit ? (
                <>
                  <div className={groupedWrapperClassName}>
                    <h4 className={groupedTitleClassName}>Finance Approval</h4>
                    <div className={groupedGridClassName}>
                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Total Amount
                        <input
                          type="hidden"
                          name="totalAmount"
                          value={String(expenseAmounts.totalAmount)}
                        />
                        <CurrencyInput
                          value={expenseAmounts.totalAmount}
                          disabled
                          className={lockedFieldClassName}
                        />
                      </label>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Finance can correct accounting metadata and amount components before approval.
                      Total amount is derived from the edited values.
                    </p>
                  </div>

                  <div className={groupedWrapperClassName}>
                    <h4 className={groupedTitleClassName}>Vendor Details</h4>
                    <div className={groupedGridClassName}>
                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Bill No
                        <FormInput
                          name="billNo"
                          required
                          defaultValue={expense?.billNo ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                        <AiAuditCaption aiMetadata={aiMetadata} fieldKey="bill_no" />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Expense Category
                        <FormSelect
                          name="expenseCategoryId"
                          required
                          defaultValue={expense?.expenseCategoryId ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="" disabled>
                            Select expense category
                          </option>
                          {expenseCategories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </FormSelect>
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Vendor Name
                        <FormInput
                          name="vendorName"
                          defaultValue={expense?.vendorName ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                        <AiAuditCaption aiMetadata={aiMetadata} fieldKey="vendor_name" />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Location
                        <FormSelect
                          name="locationId"
                          required
                          defaultValue={expense?.locationId ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="" disabled>
                            Select location
                          </option>
                          {locations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.name}
                            </option>
                          ))}
                        </FormSelect>
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Location Type
                        <FormSelect
                          name="locationType"
                          defaultValue={expense?.locationType ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="">Not specified</option>
                          {LOCATION_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </FormSelect>
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Location Details
                        <FormInput
                          name="locationDetails"
                          defaultValue={expense?.locationDetails ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Transaction Date
                        <DateInput
                          name="transactionDate"
                          required
                          defaultValue={toDateInputValue(expense?.transactionDate)}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                        <AiAuditCaption aiMetadata={aiMetadata} fieldKey="transaction_date" />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        GST Applicable
                        <FormSelect
                          name="isGstApplicable"
                          required
                          defaultValue={expense?.isGstApplicable ? "true" : "false"}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </FormSelect>
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        GST Number
                        <FormInput
                          name="gstNumber"
                          defaultValue={expense?.gstNumber ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                        <AiAuditCaption aiMetadata={aiMetadata} fieldKey="gst_number" />
                      </label>
                    </div>
                  </div>

                  <div className={groupedWrapperClassName}>
                    <h4 className={groupedTitleClassName}>Additional Details</h4>
                    <div className={groupedGridClassName}>
                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
                        Purpose
                        <FormInput
                          name="purpose"
                          required
                          defaultValue={expense?.purpose ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Product
                        <FormSelect
                          name="productId"
                          defaultValue={expense?.productId ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="">None</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name}
                            </option>
                          ))}
                        </FormSelect>
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        People Involved
                        <FormInput
                          name="peopleInvolved"
                          defaultValue={expense?.peopleInvolved ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
                        Remarks
                        <FormTextarea
                          name="remarks"
                          rows={3}
                          defaultValue={expense?.remarks ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                    </div>
                  </div>

                  <div className={groupedWrapperClassName}>
                    <h4 className={groupedTitleClassName}>Amount Details</h4>
                    <div className={groupedGridClassName}>
                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Basic Amount
                        <CurrencyInput
                          name="basicAmount"
                          min="0"
                          step="0.01"
                          required
                          value={expenseAmounts.basicAmount}
                          onValueChange={(value) => {
                            handleExpenseComponentAmountChange("basicAmount", value);
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                        <AiAuditCaption aiMetadata={aiMetadata} fieldKey="basic_amount" />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        CGST Amount
                        <CurrencyInput
                          name="cgstAmount"
                          min="0"
                          step="0.01"
                          value={expenseAmounts.cgstAmount}
                          onValueChange={(value) => {
                            handleExpenseComponentAmountChange("cgstAmount", value);
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                        <AiAuditCaption aiMetadata={aiMetadata} fieldKey="cgst_amount" />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        SGST Amount
                        <CurrencyInput
                          name="sgstAmount"
                          min="0"
                          step="0.01"
                          value={expenseAmounts.sgstAmount}
                          onValueChange={(value) => {
                            handleExpenseComponentAmountChange("sgstAmount", value);
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                        <AiAuditCaption aiMetadata={aiMetadata} fieldKey="sgst_amount" />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        IGST Amount
                        <CurrencyInput
                          name="igstAmount"
                          min="0"
                          step="0.01"
                          value={expenseAmounts.igstAmount}
                          onValueChange={(value) => {
                            handleExpenseComponentAmountChange("igstAmount", value);
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                        <AiAuditCaption aiMetadata={aiMetadata} fieldKey="igst_amount" />
                      </label>
                    </div>
                  </div>

                  <div className={groupedWrapperClassName}>
                    <h4 className={groupedTitleClassName}>Foreign Expense Details</h4>
                    <div className={groupedGridClassName}>
                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Foreign Currency
                        <FormSelect
                          value={foreignAmounts.foreignCurrencyCode}
                          onChange={(e) => {
                            handleForeignCurrencyCodeChange(e.target.value as ForeignCurrencyCode);
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          {PINNED_CURRENCY_CODES.map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                          <option value="" disabled>
                            ──────────
                          </option>
                          {ISO_CURRENCY_CODES.filter(
                            (code) => !PINNED_CURRENCY_CODES.includes(code),
                          ).map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </FormSelect>
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Foreign Basic Amount
                        <CurrencyInput
                          min="0"
                          step="0.01"
                          value={foreignAmounts.foreignBasicAmount}
                          onValueChange={(value) => {
                            handleForeignAmountChange("foreignBasicAmount", value);
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Foreign GST Amount
                        <CurrencyInput
                          min="0"
                          step="0.01"
                          value={foreignAmounts.foreignGstAmount}
                          onValueChange={(value) => {
                            handleForeignAmountChange("foreignGstAmount", value);
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Foreign Total Amount
                        <CurrencyInput
                          value={foreignAmounts.foreignTotalAmount}
                          disabled
                          readOnly
                          className={lockedFieldClassName}
                        />
                      </label>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className={groupedWrapperClassName}>
                    <h4 className={groupedTitleClassName}>Vendor Details</h4>
                    <div className={groupedGridClassName}>
                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Bill No
                        <FormInput
                          name="billNo"
                          required
                          defaultValue={expense?.billNo ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Expense Category
                        <FormSelect
                          name="expenseCategoryId"
                          required
                          defaultValue={expense?.expenseCategoryId ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="" disabled>
                            Select expense category
                          </option>
                          {expenseCategories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </FormSelect>
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Vendor Name
                        <FormInput
                          name="vendorName"
                          defaultValue={expense?.vendorName ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Location
                        <FormSelect
                          name="locationId"
                          required
                          defaultValue={expense?.locationId ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="" disabled>
                            Select location
                          </option>
                          {locations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.name}
                            </option>
                          ))}
                        </FormSelect>
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Transaction Date
                        <DateInput
                          name="transactionDate"
                          required
                          defaultValue={toDateInputValue(expense?.transactionDate)}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        GST Applicable
                        <FormSelect
                          name="isGstApplicable"
                          required
                          defaultValue={expense?.isGstApplicable ? "true" : "false"}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </FormSelect>
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        GST Number
                        <FormInput
                          name="gstNumber"
                          defaultValue={expense?.gstNumber ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                    </div>
                  </div>

                  <div className={groupedWrapperClassName}>
                    <h4 className={groupedTitleClassName}>Additional Details</h4>
                    <div className={groupedGridClassName}>
                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
                        Purpose
                        <FormInput
                          name="purpose"
                          required
                          defaultValue={expense?.purpose ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Product
                        <FormSelect
                          name="productId"
                          defaultValue={expense?.productId ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="">None</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name}
                            </option>
                          ))}
                        </FormSelect>
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        People Involved
                        <FormInput
                          name="peopleInvolved"
                          defaultValue={expense?.peopleInvolved ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
                        Remarks
                        <FormTextarea
                          name="remarks"
                          rows={3}
                          defaultValue={expense?.remarks ?? ""}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>
                    </div>
                  </div>

                  <div className={groupedWrapperClassName}>
                    <h4 className={groupedTitleClassName}>Amount Details</h4>
                    <div className={groupedGridClassName}>
                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Basic Amount
                        <CurrencyInput
                          name="basicAmount"
                          min="0"
                          step="0.01"
                          required
                          value={expenseAmounts.basicAmount}
                          onValueChange={(value) => {
                            handleExpenseComponentAmountChange("basicAmount", value);
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        CGST Amount
                        <CurrencyInput
                          name="cgstAmount"
                          min="0"
                          step="0.01"
                          value={expenseAmounts.cgstAmount}
                          onValueChange={(value) => {
                            handleExpenseComponentAmountChange("cgstAmount", value);
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        SGST Amount
                        <CurrencyInput
                          name="sgstAmount"
                          min="0"
                          step="0.01"
                          value={expenseAmounts.sgstAmount}
                          onValueChange={(value) => {
                            handleExpenseComponentAmountChange("sgstAmount", value);
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        IGST Amount
                        <CurrencyInput
                          name="igstAmount"
                          min="0"
                          step="0.01"
                          value={expenseAmounts.igstAmount}
                          onValueChange={(value) => {
                            handleExpenseComponentAmountChange("igstAmount", value);
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Total Amount
                        <CurrencyInput
                          value={totalAmountInputValue}
                          disabled
                          className={lockedFieldClassName}
                        />
                      </label>
                    </div>
                  </div>

                  <div className={groupedWrapperClassName}>
                    <h4 className={groupedTitleClassName}>Foreign Expense Details</h4>
                    <div className={groupedGridClassName}>
                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Foreign Currency
                        <FormSelect
                          value={foreignAmounts.foreignCurrencyCode}
                          onChange={(e) => {
                            handleForeignCurrencyCodeChange(e.target.value as ForeignCurrencyCode);
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          {PINNED_CURRENCY_CODES.map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                          <option value="" disabled>
                            ──────────
                          </option>
                          {ISO_CURRENCY_CODES.filter(
                            (code) => !PINNED_CURRENCY_CODES.includes(code),
                          ).map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </FormSelect>
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Foreign Basic Amount
                        <CurrencyInput
                          min="0"
                          step="0.01"
                          value={foreignAmounts.foreignBasicAmount}
                          onValueChange={(value) => {
                            handleForeignAmountChange("foreignBasicAmount", value);
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Foreign GST Amount
                        <CurrencyInput
                          min="0"
                          step="0.01"
                          value={foreignAmounts.foreignGstAmount}
                          onValueChange={(value) => {
                            handleForeignAmountChange("foreignGstAmount", value);
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      </label>

                      <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                        Foreign Total Amount
                        <CurrencyInput
                          value={foreignAmounts.foreignTotalAmount}
                          disabled
                          readOnly
                          className={lockedFieldClassName}
                        />
                      </label>
                    </div>
                  </div>
                </>
              )
            ) : isFinanceEdit ? (
              <>
                <div className={groupedWrapperClassName}>
                  <h4 className={groupedTitleClassName}>Finance Approval</h4>
                  <div className={groupedGridClassName}>
                    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                      Total Amount
                      {canEditAdvanceTotalAmount ? (
                        <CurrencyInput
                          name="totalAmount"
                          min="0"
                          step="0.01"
                          required
                          value={advanceTotalAmount}
                          onValueChange={(value) => {
                            setAdvanceTotalAmount(toNonNegativeCurrency(value));
                          }}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                      ) : (
                        <>
                          <input
                            type="hidden"
                            name="totalAmount"
                            value={String(advanceTotalAmount)}
                          />
                          <CurrencyInput
                            value={advanceTotalAmount}
                            disabled
                            className={lockedFieldClassName}
                          />
                        </>
                      )}
                    </label>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {canEditAdvanceTotalAmount
                      ? "Finance can edit the total amount for Petty Cash Requests before approval."
                      : "Finance can correct advance metadata before approval. Total amount remains locked."}
                  </p>
                </div>

                <div className={groupedWrapperClassName}>
                  <h4 className={groupedTitleClassName}>Advance Details</h4>
                  <div className={groupedGridClassName}>
                    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
                      Purpose
                      <FormInput
                        name="purpose"
                        required
                        defaultValue={advance?.purpose ?? ""}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </label>

                    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                      Expected Usage Date
                      <DateInput
                        name="expectedUsageDate"
                        required
                        defaultValue={toDateInputValue(advance?.expectedUsageDate)}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </label>
                  </div>
                </div>

                <div className={groupedWrapperClassName}>
                  <h4 className={groupedTitleClassName}>Additional Details</h4>
                  <div className={groupedGridClassName}>
                    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                      Product
                      <FormSelect
                        name="productId"
                        defaultValue={advance?.productId ?? ""}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      >
                        <option value="">None</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </FormSelect>
                    </label>

                    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                      Location
                      <FormSelect
                        name="locationId"
                        defaultValue={advance?.locationId ?? ""}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      >
                        <option value="">None</option>
                        {locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                          </option>
                        ))}
                      </FormSelect>
                    </label>

                    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
                      Remarks
                      <FormTextarea
                        name="remarks"
                        rows={3}
                        defaultValue={advance?.remarks ?? ""}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </label>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className={groupedWrapperClassName}>
                  <h4 className={groupedTitleClassName}>Advance Details</h4>
                  <div className={groupedGridClassName}>
                    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
                      Purpose
                      <FormInput
                        name="purpose"
                        required
                        defaultValue={advance?.purpose ?? ""}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </label>

                    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                      Total Amount
                      <CurrencyInput
                        value={advance?.totalAmount ?? ""}
                        disabled
                        className={lockedFieldClassName}
                      />
                    </label>

                    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                      Expected Usage Date
                      <DateInput
                        name="expectedUsageDate"
                        required
                        defaultValue={toDateInputValue(advance?.expectedUsageDate)}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </label>
                  </div>
                </div>

                <div className={groupedWrapperClassName}>
                  <h4 className={groupedTitleClassName}>Additional Details</h4>
                  <div className={groupedGridClassName}>
                    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                      Product
                      <FormSelect
                        name="productId"
                        defaultValue={advance?.productId ?? ""}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      >
                        <option value="">None</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </FormSelect>
                    </label>

                    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                      Location
                      <FormSelect
                        name="locationId"
                        defaultValue={advance?.locationId ?? ""}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      >
                        <option value="">None</option>
                        {locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                          </option>
                        ))}
                      </FormSelect>
                    </label>

                    <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
                      Remarks
                      <FormTextarea
                        name="remarks"
                        rows={3}
                        defaultValue={advance?.remarks ?? ""}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </label>
                  </div>
                </div>
              </>
            )}

            {isOwnEdit || isFinanceEdit ? (
              <div className={groupedWrapperClassName}>
                <h4 className={groupedTitleClassName}>Attachments</h4>

                <label className="col-span-full grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  {claim.detailType === "expense"
                    ? "Replace Receipt File"
                    : "Replace Supporting Document"}
                  <span className="border-2 border-dashed border-border/60 rounded-lg p-6 flex flex-col items-center justify-center bg-muted/10">
                    <span className="mb-2 text-xs text-muted-foreground">
                      PDF, PNG, JPG, JPEG, WEBP
                    </span>
                    <input
                      name="receiptFile"
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp"
                      className="w-full max-w-md text-sm text-zinc-900 dark:text-zinc-100 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-700 dark:file:bg-zinc-700 dark:file:text-zinc-100"
                    />
                  </span>
                </label>

                {claim.detailType === "expense" ? (
                  <label className="col-span-full grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    Replace Bank Statement File
                    <span className="border-2 border-dashed border-border/60 rounded-lg p-6 flex flex-col items-center justify-center bg-muted/10">
                      <span className="mb-2 text-xs text-muted-foreground">
                        PDF, PNG, JPG, JPEG, WEBP
                      </span>
                      <input
                        name="bankStatementFile"
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.webp"
                        className="w-full max-w-md text-sm text-zinc-900 dark:text-zinc-100 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-700 dark:file:bg-zinc-700 dark:file:text-zinc-100"
                      />
                    </span>
                  </label>
                ) : null}
              </div>
            ) : null}

            {requireEditReason ? (
              <div className={groupedWrapperClassName}>
                <h4 className={groupedTitleClassName}>Audit Reason</h4>
                <label className="col-span-full grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  Reason for Edit
                  <FormTextarea
                    name="editReason"
                    rows={4}
                    required
                    minLength={5}
                    defaultValue={defaultEditReason ?? ""}
                    placeholder="Explain why this claim edit is required for audit tracking."
                    className="col-span-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </label>
              </div>
            ) : null}
          </div>

          <div
            className={
              isEmbeddedPresentation
                ? "w-full border-t border-border bg-background p-4 flex justify-end gap-3"
                : "mt-4 flex flex-wrap justify-end gap-3"
            }
          >
            <Button
              type="submit"
              disabled={isSubmitting}
              variant="primary"
              size="md"
              className="text-zinc-950 bg-indigo-500 hover:bg-indigo-400"
            >
              {isSubmitting ? (
                <>
                  <svg
                    className="mr-2 h-4 w-4 animate-spin"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                    fill="none"
                  >
                    <circle
                      cx="10"
                      cy="10"
                      r="7"
                      stroke="currentColor"
                      strokeOpacity="0.3"
                      strokeWidth="2"
                    />
                    <path
                      d="M10 3a7 7 0 0 1 7 7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                  Processing...
                </>
              ) : (
                "Save Claim Edits"
              )}
            </Button>

            {showSecondaryAction ? (
              isEmbeddedPresentation ? (
                <SheetClose
                  disabled={isSubmitting}
                  onClick={() => {
                    onCancel?.();
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  Cancel
                </SheetClose>
              ) : (
                <Button
                  disabled={isSubmitting}
                  onClick={() => {
                    setIsInlineOpen(false);
                    onCancel?.();
                  }}
                  type="button"
                  variant="secondary"
                  size="md"
                  className="dark:border-zinc-600"
                >
                  Cancel
                </Button>
              )
            ) : null}
          </div>
        </fieldset>
      </form>
    </section>
  );
}
