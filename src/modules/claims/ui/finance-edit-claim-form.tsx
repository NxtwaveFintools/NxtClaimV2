"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

type DropdownOption = {
  id: string;
  name: string;
};

type FinanceEditClaimFormProps = {
  claim: {
    id: string;
    employeeName: string;
    employeeEmail: string | null;
    submissionType: "Self" | "On Behalf";
    detailType: "expense" | "advance";
    departmentId: string;
    paymentModeId: string;
    expense: {
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
  action: (formData: FormData) => Promise<void>;
};

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
  action,
}: FinanceEditClaimFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    setIsSubmitting(true);

    try {
      await toast.promise(action(formData), {
        loading: "Saving finance edits...",
        success: "Finance edits saved.",
        error: (error) =>
          error instanceof Error ? error.message : "Unable to save finance edits.",
      });
      setIsOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
        }}
        className="inline-flex items-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition-all duration-200 hover:bg-indigo-100 active:scale-[0.98] dark:border-indigo-600/60 dark:bg-indigo-600/15 dark:text-indigo-200 dark:hover:bg-indigo-600/25"
      >
        Edit Details
      </button>
    );
  }

  const expense = claim.expense;
  const advance = claim.advance;

  return (
    <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-indigo-700/40 dark:bg-zinc-800">
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-300">
        Finance Edit Claim
      </h2>
      <p className="mt-2 text-xs text-zinc-600 dark:text-indigo-100/80">
        Finance can correct claim and detail values before final processing.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-4">
        <input type="hidden" name="detailType" value={claim.detailType} />

        <fieldset disabled={isSubmitting} className="contents">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              Claim ID (Read-only)
              <input
                value={claim.id}
                disabled
                className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
              />
            </label>

            <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              Employee Name (Read-only)
              <input
                value={claim.employeeName}
                disabled
                className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
              />
            </label>

            <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              Employee Email (Read-only)
              <input
                value={claim.employeeEmail ?? "N/A"}
                disabled
                className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
              />
            </label>

            <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              Submission Type (Read-only)
              <input
                value={claim.submissionType}
                disabled
                className="rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              Department
              <select
                name="departmentId"
                required
                defaultValue={claim.departmentId}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
              Payment Mode
              <select
                name="paymentModeId"
                required
                defaultValue={claim.paymentModeId}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {paymentModes.map((paymentMode) => (
                  <option key={paymentMode.id} value={paymentMode.id}>
                    {paymentMode.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {claim.detailType === "expense" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Bill No
                <input
                  name="billNo"
                  required
                  defaultValue={expense?.billNo ?? ""}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Expense Category
                <select
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
                </select>
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Vendor Name
                <input
                  name="vendorName"
                  defaultValue={expense?.vendorName ?? ""}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Location
                <select
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
                </select>
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Transaction Date
                <input
                  name="transactionDate"
                  type="date"
                  required
                  defaultValue={toDateInputValue(expense?.transactionDate)}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                GST Applicable
                <select
                  name="isGstApplicable"
                  required
                  defaultValue={expense?.isGstApplicable ? "true" : "false"}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                GST Number
                <input
                  name="gstNumber"
                  defaultValue={expense?.gstNumber ?? ""}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Basic Amount
                <input
                  name="basicAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={expense?.basicAmount ?? ""}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                CGST Amount
                <input
                  name="cgstAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={expense?.cgstAmount ?? 0}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                SGST Amount
                <input
                  name="sgstAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={expense?.sgstAmount ?? 0}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                IGST Amount
                <input
                  name="igstAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={expense?.igstAmount ?? 0}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Total Amount
                <input
                  name="totalAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={expense?.totalAmount ?? ""}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
                Purpose
                <input
                  name="purpose"
                  required
                  defaultValue={expense?.purpose ?? ""}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Product
                <select
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
                </select>
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                People Involved
                <input
                  name="peopleInvolved"
                  defaultValue={expense?.peopleInvolved ?? ""}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
                Remarks
                <textarea
                  name="remarks"
                  rows={3}
                  defaultValue={expense?.remarks ?? ""}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
                Purpose
                <input
                  name="purpose"
                  required
                  defaultValue={advance?.purpose ?? ""}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Product
                <select
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
                </select>
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Location
                <select
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
                </select>
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Requested Amount
                <input
                  name="requestedAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={advance?.requestedAmount ?? ""}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                Expected Usage Date
                <input
                  name="expectedUsageDate"
                  type="date"
                  required
                  defaultValue={toDateInputValue(advance?.expectedUsageDate)}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300 md:col-span-2">
                Remarks
                <textarea
                  name="remarks"
                  rows={3}
                  defaultValue={advance?.remarks ?? ""}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </label>
            </div>
          )}

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

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition-all duration-200 hover:bg-indigo-400 active:scale-[0.98]"
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
                "Save Finance Edits"
              )}
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                setIsOpen(false);
              }}
              className="inline-flex items-center rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition-all duration-200 hover:bg-zinc-100 active:scale-[0.98] dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
