"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

type ProductOption = {
  id: string;
  name: string;
};

type FinanceEditClaimFormProps = {
  claim: {
    id: string;
    detailType: "expense" | "advance";
    submittedAt: string;
    departmentName: string | null;
    paymentModeName: string | null;
    expense: {
      billNo: string;
      transactionDate: string;
      basicAmount: number | null;
      totalAmount: number | null;
      vendorName: string | null;
      purpose: string | null;
      productId: string | null;
      remarks: string | null;
    } | null;
    advance: {
      purpose: string;
      productId: string | null;
      remarks: string | null;
    } | null;
  };
  products: ProductOption[];
  action: (formData: FormData) => Promise<void>;
};

function formatDate(value: string | null): string {
  if (!value) {
    return "N/A";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export function FinanceEditClaimForm({ claim, products, action }: FinanceEditClaimFormProps) {
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
        className="inline-flex items-center rounded-xl border border-indigo-600/60 bg-indigo-600/15 px-4 py-2 text-sm font-semibold text-indigo-200 transition-all duration-200 hover:bg-indigo-600/25 active:scale-[0.98]"
      >
        Edit Details
      </button>
    );
  }

  const expense = claim.expense;
  const advance = claim.advance;

  return (
    <section className="mt-6 rounded-xl border border-indigo-700/40 bg-indigo-950/15 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-indigo-200">
        Finance Edit Claim
      </h2>
      <p className="mt-2 text-xs text-indigo-100/80">
        Only allowlisted fields are editable. Claim identity, dates, detail type, department, and
        payment mode are read-only.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-4">
        <input type="hidden" name="detailType" value={claim.detailType} />

        <fieldset disabled={isSubmitting} className="contents">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm text-indigo-100/90">
              Claim ID (Read-only)
              <input
                value={claim.id}
                disabled
                className="rounded-lg border border-indigo-700/60 bg-indigo-950/40 px-3 py-2 text-sm text-indigo-100/80"
              />
            </label>

            <label className="grid gap-1 text-sm text-indigo-100/90">
              Detail Type (Read-only)
              <input
                value={claim.detailType}
                disabled
                className="rounded-lg border border-indigo-700/60 bg-indigo-950/40 px-3 py-2 text-sm text-indigo-100/80"
              />
            </label>

            <label className="grid gap-1 text-sm text-indigo-100/90">
              Submitted At (Read-only)
              <input
                value={formatDate(claim.submittedAt)}
                disabled
                className="rounded-lg border border-indigo-700/60 bg-indigo-950/40 px-3 py-2 text-sm text-indigo-100/80"
              />
            </label>

            <label className="grid gap-1 text-sm text-indigo-100/90">
              Department (Read-only)
              <input
                value={claim.departmentName ?? "N/A"}
                disabled
                className="rounded-lg border border-indigo-700/60 bg-indigo-950/40 px-3 py-2 text-sm text-indigo-100/80"
              />
            </label>

            <label className="grid gap-1 text-sm text-indigo-100/90">
              Payment Mode (Read-only)
              <input
                value={claim.paymentModeName ?? "N/A"}
                disabled
                className="rounded-lg border border-indigo-700/60 bg-indigo-950/40 px-3 py-2 text-sm text-indigo-100/80"
              />
            </label>

            <label className="grid gap-1 text-sm text-indigo-100/90">
              Transaction Date (Read-only)
              <input
                value={
                  claim.detailType === "expense"
                    ? formatDate(expense?.transactionDate ?? null)
                    : "N/A"
                }
                disabled
                className="rounded-lg border border-indigo-700/60 bg-indigo-950/40 px-3 py-2 text-sm text-indigo-100/80"
              />
            </label>
          </div>

          {claim.detailType === "expense" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm text-slate-200">
                Bill No
                <input
                  name="billNo"
                  required
                  defaultValue={expense?.billNo ?? ""}
                  className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-slate-200">
                Vendor Name
                <input
                  name="vendorName"
                  defaultValue={expense?.vendorName ?? ""}
                  className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-slate-200">
                Basic Amount
                <input
                  name="basicAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={expense?.basicAmount ?? ""}
                  className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-slate-200">
                Total Amount
                <input
                  name="totalAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  defaultValue={expense?.totalAmount ?? ""}
                  className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-slate-200 md:col-span-2">
                Purpose
                <input
                  name="purpose"
                  required
                  defaultValue={expense?.purpose ?? ""}
                  className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-slate-200">
                Product
                <select
                  name="productId"
                  defaultValue={expense?.productId ?? ""}
                  className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="">None</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-sm text-slate-200 md:col-span-2">
                Remarks
                <textarea
                  name="remarks"
                  rows={3}
                  defaultValue={expense?.remarks ?? ""}
                  className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                />
              </label>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm text-slate-200 md:col-span-2">
                Purpose
                <input
                  name="purpose"
                  required
                  defaultValue={advance?.purpose ?? ""}
                  className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                />
              </label>

              <label className="grid gap-1 text-sm text-slate-200">
                Product
                <select
                  name="productId"
                  defaultValue={advance?.productId ?? ""}
                  className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="">None</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-sm text-slate-200 md:col-span-2">
                Remarks
                <textarea
                  name="remarks"
                  rows={3}
                  defaultValue={advance?.remarks ?? ""}
                  className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
                />
              </label>
            </div>
          )}

          <label className="grid gap-1 text-sm text-slate-200">
            Replace Receipt File
            <input
              name="receiptFile"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-100"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-all duration-200 hover:bg-indigo-400 active:scale-[0.98]"
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
              className="inline-flex items-center rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-200 transition-all duration-200 hover:bg-slate-800 active:scale-[0.98]"
            >
              Cancel
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
