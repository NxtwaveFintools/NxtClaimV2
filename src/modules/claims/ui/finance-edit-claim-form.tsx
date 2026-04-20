"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { FormInput } from "@/components/ui/form-input";
import { FormSelect } from "@/components/ui/form-select";
import { FormTextarea } from "@/components/ui/form-textarea";

type DropdownOption = {
  id: string;
  name: string;
};

type FinanceEditClaimActionResult = {
  ok: boolean;
  error?: string;
};

type FinanceEditFieldScope = "full" | "quick-view-core";
type FinanceEditPresentation = "inline-toggle" | "embedded";

type ExpenseAmountState = {
  basicAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
};

type ExpenseComponentAmountField = "basicAmount" | "cgstAmount" | "sgstAmount" | "igstAmount";

type FinanceEditClaimFormProps = {
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
    } | null;
    advance: {
      id: string;
      purpose: string;
      requestedAmount: number | null;
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
  fieldScope?: FinanceEditFieldScope;
  presentation?: FinanceEditPresentation;
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
  claim,
  departments,
  paymentModes,
  expenseCategories,
  products,
  locations,
  isEditMode = true,
  canEditPaymentMode = false,
  requireEditReason = true,
  fieldScope = "full",
  presentation = "inline-toggle",
  onSuccess,
  onCancel,
  action,
}: FinanceEditClaimFormProps) {
  const initialExpenseAmounts = buildExpenseAmountState(claim.expense);
  const [isInlineOpen, setIsInlineOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expenseAmounts, setExpenseAmounts] = useState<ExpenseAmountState>(
    () => initialExpenseAmounts,
  );
  const [totalAmountInputValue, setTotalAmountInputValue] = useState<string>(() =>
    toCurrencyInputValue(initialExpenseAmounts.totalAmount),
  );
  const expenseId = claim.expense?.id ?? null;
  const expenseBasicAmount = claim.expense?.basicAmount ?? null;
  const expenseCgstAmount = claim.expense?.cgstAmount ?? null;
  const expenseSgstAmount = claim.expense?.sgstAmount ?? null;
  const expenseIgstAmount = claim.expense?.igstAmount ?? null;
  const expenseTotalAmount = claim.expense?.totalAmount ?? null;
  const isEmbeddedPresentation = presentation === "embedded";
  const isQuickViewScope = fieldScope === "quick-view-core";
  const isOpen = isEmbeddedPresentation ? true : isInlineOpen;
  const isDepartmentFieldLocked = isEditMode;
  const isPaymentModeFieldLocked = isEditMode && !canEditPaymentMode;
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

  const handleExpenseTotalAmountChange = (value: number | null) => {
    setExpenseAmounts((current) => {
      const enteredTotalAmount = toNonNegativeCurrency(value);
      const taxAmount = roundCurrency(current.cgstAmount + current.sgstAmount + current.igstAmount);

      if (enteredTotalAmount < taxAmount) {
        return {
          basicAmount: enteredTotalAmount,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 0,
          totalAmount: enteredTotalAmount,
        };
      }

      return {
        ...current,
        basicAmount: roundCurrency(Math.max(0, enteredTotalAmount - taxAmount)),
        totalAmount: enteredTotalAmount,
      };
    });
  };

  const handleTotalAmountInputChange = (nextValue: string) => {
    setTotalAmountInputValue(nextValue);

    if (nextValue.trim().length === 0) {
      return;
    }

    const parsedValue = Number(nextValue);
    if (!Number.isFinite(parsedValue)) {
      return;
    }

    handleExpenseTotalAmountChange(parsedValue);
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
        toast.error(result.error ?? "Unable to save claim edits.");
        return;
      }

      toast.success("Claim edits saved.");

      if (!isEmbeddedPresentation) {
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
      className={`${isEmbeddedPresentation ? "" : "mt-6 "}rounded-xl border border-zinc-200 bg-white p-4 dark:border-indigo-700/40 dark:bg-zinc-800`}
    >
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-300">
        {isQuickViewScope ? "Quick Edit" : "Edit Claim"}
      </h2>
      <p className="mt-2 text-xs text-zinc-600 dark:text-indigo-100/80">
        {isQuickViewScope
          ? "Update core claim fields directly from Quick View."
          : "Routing context is locked during edits. Only detail fields can be updated."}
      </p>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-4">
        <input type="hidden" name="detailType" value={claim.detailType} />
        <input
          type="hidden"
          name="detailId"
          value={claim.detailType === "expense" ? (expense?.id ?? "") : (advance?.id ?? "")}
        />

        <fieldset disabled={isSubmitting} className="contents">
          <div className={`grid gap-3 ${isQuickViewScope ? "sm:grid-cols-2" : "md:grid-cols-2"}`}>
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

            {isQuickViewScope ? null : (
              <>
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
              </>
            )}
          </div>

          {isQuickViewScope ? null : (
            <div className="grid gap-3 md:grid-cols-2">
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
                  {paymentModes.map((paymentMode) => (
                    <option key={paymentMode.id} value={paymentMode.id}>
                      {paymentMode.name}
                    </option>
                  ))}
                </FormSelect>
              </label>
            </div>
          )}

          {claim.detailType === "expense" ? (
            isQuickViewScope ? (
              <div className="grid gap-3 md:grid-cols-2">
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
                  Transaction Date
                  <DateInput
                    name="transactionDate"
                    required
                    defaultValue={toDateInputValue(expense?.transactionDate)}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </label>

                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Total Amount
                  <CurrencyInput
                    name="totalAmount"
                    min="0"
                    step="0.01"
                    required
                    value={totalAmountInputValue}
                    onChange={(event) => {
                      handleTotalAmountInputChange(event.currentTarget.value);
                    }}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </label>

                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
                  Purpose
                  <FormInput
                    name="purpose"
                    required
                    defaultValue={expense?.purpose ?? ""}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </label>

                <input type="hidden" name="locationId" value={expense?.locationId ?? ""} />
                <input
                  type="hidden"
                  name="isGstApplicable"
                  value={expense?.isGstApplicable ? "true" : "false"}
                />
                <input type="hidden" name="gstNumber" value={expense?.gstNumber ?? ""} />
                <input type="hidden" name="vendorName" value={expense?.vendorName ?? ""} />
                <input type="hidden" name="basicAmount" value={expenseAmounts.basicAmount} />
                <input type="hidden" name="cgstAmount" value={expenseAmounts.cgstAmount} />
                <input type="hidden" name="sgstAmount" value={expenseAmounts.sgstAmount} />
                <input type="hidden" name="igstAmount" value={expenseAmounts.igstAmount} />
                <input type="hidden" name="productId" value={expense?.productId ?? ""} />
                <input type="hidden" name="peopleInvolved" value={expense?.peopleInvolved ?? ""} />
                <input type="hidden" name="remarks" value={expense?.remarks ?? ""} />
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
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
                    name="totalAmount"
                    min="0"
                    step="0.01"
                    required
                    value={totalAmountInputValue}
                    onChange={(event) => {
                      handleTotalAmountInputChange(event.currentTarget.value);
                    }}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </label>

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
            )
          ) : isQuickViewScope ? (
            <div className="grid gap-3 md:grid-cols-2">
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
                Requested Amount
                <CurrencyInput
                  name="requestedAmount"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={advance?.requestedAmount ?? ""}
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

              <input type="hidden" name="productId" value={advance?.productId ?? ""} />
              <input type="hidden" name="locationId" value={advance?.locationId ?? ""} />
              <input type="hidden" name="remarks" value={advance?.remarks ?? ""} />
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
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

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Requested Amount
                <CurrencyInput
                  name="requestedAmount"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={advance?.requestedAmount ?? ""}
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
          )}

          {isQuickViewScope ? null : (
            <>
              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Replace Receipt File
                <input
                  name="receiptFile"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-700 dark:file:bg-zinc-700 dark:file:text-zinc-100"
                />
              </label>

              {claim.detailType === "expense" ? (
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Replace Bank Statement File
                  <input
                    name="bankStatementFile"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-700 dark:file:bg-zinc-700 dark:file:text-zinc-100"
                  />
                </label>
              ) : null}
            </>
          )}

          {requireEditReason ? (
            <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
              Reason for Edit
              <FormTextarea
                name="editReason"
                rows={isQuickViewScope ? 3 : 4}
                required
                minLength={5}
                placeholder="Explain why this claim edit is required for audit tracking."
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </label>
          ) : null}

          <div className="flex flex-wrap gap-2">
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
              ) : isQuickViewScope ? (
                "Save Changes"
              ) : (
                "Save Claim Edits"
              )}
            </Button>
            <Button
              disabled={isSubmitting}
              onClick={() => {
                if (!isEmbeddedPresentation) {
                  setIsInlineOpen(false);
                }

                onCancel?.();
              }}
              type="button"
              variant="secondary"
              size="md"
              className="dark:border-zinc-600"
            >
              {isEmbeddedPresentation ? "Close" : "Cancel"}
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
