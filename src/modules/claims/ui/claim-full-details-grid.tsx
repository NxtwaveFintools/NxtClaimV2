import { formatDate } from "@/lib/format";

type ClaimExpenseDetail = {
  id: string;
  billNo: string;
  purpose: string | null;
  expenseCategoryName: string | null;
  productName: string | null;
  locationName: string | null;
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
  peopleInvolved: string | null;
  remarks: string | null;
};

type ClaimAdvanceDetail = {
  id: string;
  purpose: string;
  requestedAmount: number | null;
  expectedUsageDate: string;
};

export type ClaimFullDetailsRecord = {
  submittedAt: string;
  departmentName: string | null;
  paymentModeName: string | null;
  expense: ClaimExpenseDetail | null;
  advance: ClaimAdvanceDetail | null;
};

type ClaimFullDetailsGridProps = {
  claim: ClaimFullDetailsRecord;
  includeSummary?: boolean;
  includeExpenseDetail?: boolean;
  includeAdvanceDetail?: boolean;
  viewMode?: "full" | "quick-view";
};

const indiaAmountFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatAmount(amount: number | null): string {
  if (amount === null) {
    return "N/A";
  }

  return indiaAmountFormatter.format(amount);
}

function formatOptionalText(value: string | null | undefined, fallback = "N/A"): string {
  if (!value) {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function ClaimFullDetailsGrid({
  claim,
  includeSummary = true,
  includeExpenseDetail = true,
  includeAdvanceDetail = true,
  viewMode = "full",
}: ClaimFullDetailsGridProps) {
  const isQuickViewMode = viewMode === "quick-view";
  const summaryGridClasses = isQuickViewMode
    ? "mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
    : "mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4";
  const shouldShowExpenseTaxBreakdown =
    !!claim.expense &&
    (claim.expense.isGstApplicable === true ||
      (claim.expense.cgstAmount ?? 0) > 0 ||
      (claim.expense.sgstAmount ?? 0) > 0 ||
      (claim.expense.igstAmount ?? 0) > 0);

  const totalAmount = claim.expense?.totalAmount ?? claim.advance?.requestedAmount ?? null;
  const transactionDate =
    claim.expense?.transactionDate ?? claim.advance?.expectedUsageDate ?? null;
  const categoryLabel = claim.expense?.expenseCategoryName ?? (claim.advance ? "Advance" : null);

  return (
    <>
      {includeSummary ? (
        <div className={summaryGridClasses}>
          {isQuickViewMode ? null : (
            <article className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Amount
              </p>
              <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                {formatAmount(totalAmount)}
              </p>
            </article>
          )}
          {isQuickViewMode ? null : (
            <article className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Transaction Date
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatDate(transactionDate)}
              </p>
            </article>
          )}
          <article className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Category
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
              {formatOptionalText(categoryLabel)}
            </p>
          </article>
          <article
            className={`rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40 ${
              isQuickViewMode ? "sm:col-span-2" : ""
            }`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Payment Mode
            </p>
            <p className="mt-1 whitespace-normal break-words text-sm font-medium text-slate-900 dark:text-slate-100">
              {claim.paymentModeName ?? "Unknown"}
            </p>
          </article>
          {isQuickViewMode ? null : (
            <article className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Bill No
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatOptionalText(claim.expense?.billNo, "-")}
              </p>
            </article>
          )}
          <article className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Department
            </p>
            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
              {claim.departmentName ?? "Unknown"}
            </p>
          </article>
          {isQuickViewMode ? null : (
            <article className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Submitted On
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatDate(claim.submittedAt)}
              </p>
            </article>
          )}
        </div>
      ) : null}

      {includeExpenseDetail && claim.expense ? (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-400">
            Expense Detail
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 md:grid-cols-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Bill No
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatOptionalText(claim.expense.billNo, "-")}
              </p>
            </div>
            {isQuickViewMode ? null : (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Vendor
                </p>
                <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {formatOptionalText(claim.expense.vendorName)}
                </p>
              </div>
            )}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Transaction Date
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatDate(claim.expense.transactionDate)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
                Total Amount
              </p>
              <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                {formatAmount(claim.expense.totalAmount)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Purpose
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatOptionalText(claim.expense.purpose)}
              </p>
            </div>
            {isQuickViewMode ? null : (
              <>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Expense Category
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.expenseCategoryName)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Product
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.productName)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Location
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.locationName)}
                  </p>
                </div>
                {claim.expense.locationType ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Location Type
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                      {claim.expense.locationType}
                    </p>
                  </div>
                ) : null}
                {claim.expense.locationDetails ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Location Details
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                      {claim.expense.locationDetails}
                    </p>
                  </div>
                ) : null}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    GST Applicable
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {claim.expense.isGstApplicable === null
                      ? "N/A"
                      : claim.expense.isGstApplicable
                        ? "Yes"
                        : "No"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    GST Number
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.gstNumber)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Basic Amount
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {formatAmount(claim.expense.basicAmount)}
                  </p>
                </div>
                {shouldShowExpenseTaxBreakdown ? (
                  <>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        CGST
                      </p>
                      <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                        {formatAmount(claim.expense.cgstAmount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        SGST
                      </p>
                      <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                        {formatAmount(claim.expense.sgstAmount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        IGST
                      </p>
                      <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                        {formatAmount(claim.expense.igstAmount)}
                      </p>
                    </div>
                  </>
                ) : null}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Remarks
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.remarks)}
                  </p>
                </div>
                <div className="col-span-2 md:col-span-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    People Involved
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                    {formatOptionalText(claim.expense.peopleInvolved)}
                  </p>
                </div>
              </>
            )}
          </div>
        </section>
      ) : null}

      {includeAdvanceDetail && claim.advance ? (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-400">
            Advance Detail
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 md:grid-cols-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Purpose
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {claim.advance.purpose}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
                Requested Amount
              </p>
              <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-slate-100">
                {formatAmount(claim.advance.requestedAmount)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Expected Usage Date
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                {formatDate(claim.advance.expectedUsageDate)}
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}

export function ClaimFullDetailsGridSkeleton() {
  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={`claim-details-summary-skeleton-${index}`}
            className="h-16 animate-pulse rounded-[20px] border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-zinc-900/80"
          />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-[20px] border border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-zinc-900/80" />
    </div>
  );
}
