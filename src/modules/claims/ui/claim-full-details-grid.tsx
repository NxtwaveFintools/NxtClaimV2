import { formatDate } from "@/lib/format";
import type { ReactNode } from "react";

type ClaimExpenseAiMetadata = {
  edited_fields: Record<string, { original: string | number | boolean | null }>;
};

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
  aiMetadata?: ClaimExpenseAiMetadata | null;
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
  showAiWarnings?: boolean;
  visualStyle?: "default" | "minimal";
};

const AI_AMOUNT_FIELDS = new Set([
  "basic_amount",
  "cgst_amount",
  "sgst_amount",
  "igst_amount",
  "total_amount",
]);

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
  showAiWarnings = false,
  visualStyle = "default",
}: ClaimFullDetailsGridProps) {
  const isQuickViewMode = viewMode === "quick-view";
  const isMinimalVisual = visualStyle === "minimal";
  const microGridClassName = "grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mt-6";
  const microCardClassName =
    "bg-muted/30 border border-border/40 rounded-lg p-4 flex flex-col justify-start h-full";
  const microLabelClassName =
    "text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1";
  const microValueClassName = "text-sm md:text-base text-foreground font-medium break-words";
  const summaryGridClasses = isQuickViewMode
    ? "mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
    : isMinimalVisual
      ? microGridClassName
      : "mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4";
  const summaryCardClassName = isMinimalVisual
    ? microCardClassName
    : "rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-800/40";
  const detailSectionClassName = isMinimalVisual
    ? "mt-6"
    : "mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900";
  const detailHeadingClassName = isMinimalVisual
    ? "text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"
    : "text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-400";
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
  const editedFields = showAiWarnings ? claim.expense?.aiMetadata?.edited_fields : undefined;

  const getAiOriginalValue = (field: string): string | number | boolean | null | undefined => {
    return editedFields?.[field]?.original;
  };

  const formatAiOriginalValue = (
    field: string,
    value: string | number | boolean | null,
  ): string => {
    if (value === null) {
      return "N/A";
    }

    if (AI_AMOUNT_FIELDS.has(field) && typeof value === "number") {
      return formatAmount(value);
    }

    if (field === "transaction_date" && typeof value === "string") {
      return formatDate(value);
    }

    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }

    return String(value);
  };

  const renderAiWarning = (field: string): ReactNode => {
    const originalValue = getAiOriginalValue(field);
    if (originalValue === undefined) {
      return null;
    }

    return (
      <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
        AI originally read: {formatAiOriginalValue(field, originalValue)}
      </p>
    );
  };

  const fieldLabelClassName = isMinimalVisual
    ? microLabelClassName
    : "text-[10px] font-semibold uppercase tracking-wider text-slate-400";
  const fieldValueClassName = isMinimalVisual
    ? microValueClassName
    : "mt-0.5 text-sm font-medium text-slate-900 dark:text-slate-100";
  const emphasizedValueClassName = isMinimalVisual
    ? microValueClassName
    : "mt-0.5 text-sm font-bold text-slate-900 dark:text-slate-100";
  const detailGridClassName = isMinimalVisual
    ? microGridClassName
    : "mt-3 grid grid-cols-2 gap-x-6 gap-y-2.5 md:grid-cols-3";
  const detailCardClassName = isMinimalVisual ? microCardClassName : undefined;

  return (
    <>
      {includeSummary ? (
        <div className={summaryGridClasses}>
          {isQuickViewMode ? null : (
            <article className={summaryCardClassName}>
              <p className={fieldLabelClassName}>Amount</p>
              <p className={emphasizedValueClassName}>{formatAmount(totalAmount)}</p>
            </article>
          )}
          {isQuickViewMode ? null : (
            <article className={summaryCardClassName}>
              <p className={fieldLabelClassName}>Transaction Date</p>
              <p className={fieldValueClassName}>{formatDate(transactionDate)}</p>
            </article>
          )}
          <article
            className={`${summaryCardClassName} ${
              isMinimalVisual ? "col-span-2 md:col-span-2" : ""
            }`}
          >
            <p className={fieldLabelClassName}>Category</p>
            <p className={fieldValueClassName}>{formatOptionalText(categoryLabel)}</p>
          </article>
          <article
            className={`${summaryCardClassName} ${
              isQuickViewMode ? "sm:col-span-2" : isMinimalVisual ? "col-span-2 md:col-span-2" : ""
            }`}
          >
            <p className={fieldLabelClassName}>Payment Mode</p>
            <p className={fieldValueClassName}>{claim.paymentModeName ?? "Unknown"}</p>
          </article>
          {isQuickViewMode ? null : (
            <article
              className={`${summaryCardClassName} ${
                isMinimalVisual ? "col-span-2 md:col-span-2" : ""
              }`}
            >
              <p className={fieldLabelClassName}>Bill No</p>
              <p className={fieldValueClassName}>
                {formatOptionalText(claim.expense?.billNo, "-")}
              </p>
            </article>
          )}
          <article className={summaryCardClassName}>
            <p className={fieldLabelClassName}>Department</p>
            <p className={fieldValueClassName}>{claim.departmentName ?? "Unknown"}</p>
          </article>
          {isQuickViewMode ? null : (
            <article className={summaryCardClassName}>
              <p className={fieldLabelClassName}>Submitted On</p>
              <p className={fieldValueClassName}>{formatDate(claim.submittedAt)}</p>
            </article>
          )}
        </div>
      ) : null}

      {includeExpenseDetail && claim.expense ? (
        <section className={detailSectionClassName}>
          <h2 className={detailHeadingClassName}>Expense Detail</h2>
          <div className={detailGridClassName}>
            <div
              className={
                isMinimalVisual ? `${microCardClassName} col-span-2 md:col-span-2` : undefined
              }
            >
              <p className={fieldLabelClassName}>Bill No</p>
              <p className={fieldValueClassName}>{formatOptionalText(claim.expense.billNo, "-")}</p>
              {renderAiWarning("bill_no")}
            </div>
            {isQuickViewMode ? null : (
              <div className={detailCardClassName}>
                <p className={fieldLabelClassName}>Vendor</p>
                <p className={fieldValueClassName}>
                  {formatOptionalText(claim.expense.vendorName)}
                </p>
                {renderAiWarning("vendor_name")}
              </div>
            )}
            <div className={detailCardClassName}>
              <p className={fieldLabelClassName}>Transaction Date</p>
              <p className={fieldValueClassName}>{formatDate(claim.expense.transactionDate)}</p>
              {renderAiWarning("transaction_date")}
            </div>
            <div className={detailCardClassName}>
              <p className={fieldLabelClassName}>Total Amount</p>
              <p className={emphasizedValueClassName}>{formatAmount(claim.expense.totalAmount)}</p>
              {renderAiWarning("total_amount")}
            </div>
            <div
              className={
                isMinimalVisual ? `${microCardClassName} col-span-2 md:col-span-full` : undefined
              }
            >
              <p className={fieldLabelClassName}>Purpose</p>
              <p className={fieldValueClassName}>{formatOptionalText(claim.expense.purpose)}</p>
            </div>
            {isQuickViewMode ? null : (
              <>
                <div
                  className={
                    isMinimalVisual ? `${microCardClassName} col-span-2 md:col-span-2` : undefined
                  }
                >
                  <p className={fieldLabelClassName}>Expense Category</p>
                  <p className={fieldValueClassName}>
                    {formatOptionalText(claim.expense.expenseCategoryName)}
                  </p>
                  {renderAiWarning("expense_category_id")}
                </div>
                <div className={detailCardClassName}>
                  <p className={fieldLabelClassName}>Product</p>
                  <p className={fieldValueClassName}>
                    {formatOptionalText(claim.expense.productName)}
                  </p>
                </div>
                <div className={detailCardClassName}>
                  <p className={fieldLabelClassName}>Location</p>
                  <p className={fieldValueClassName}>
                    {formatOptionalText(claim.expense.locationName)}
                  </p>
                </div>
                {claim.expense.locationType ? (
                  <div className={detailCardClassName}>
                    <p className={fieldLabelClassName}>Location Type</p>
                    <p className={fieldValueClassName}>{claim.expense.locationType}</p>
                  </div>
                ) : null}
                {claim.expense.locationDetails ? (
                  <div
                    className={
                      isMinimalVisual ? `${microCardClassName} col-span-2 md:col-span-2` : undefined
                    }
                  >
                    <p className={fieldLabelClassName}>Location Details</p>
                    <p className={fieldValueClassName}>{claim.expense.locationDetails}</p>
                  </div>
                ) : null}
                <div className={detailCardClassName}>
                  <p className={fieldLabelClassName}>GST Applicable</p>
                  <p className={fieldValueClassName}>
                    {claim.expense.isGstApplicable === null
                      ? "N/A"
                      : claim.expense.isGstApplicable
                        ? "Yes"
                        : "No"}
                  </p>
                </div>
                <div className={detailCardClassName}>
                  <p className={fieldLabelClassName}>GST Number</p>
                  <p className={fieldValueClassName}>
                    {formatOptionalText(claim.expense.gstNumber)}
                  </p>
                  {renderAiWarning("gst_number")}
                </div>
                <div className={detailCardClassName}>
                  <p className={fieldLabelClassName}>Basic Amount</p>
                  <p className={fieldValueClassName}>{formatAmount(claim.expense.basicAmount)}</p>
                  {renderAiWarning("basic_amount")}
                </div>
                {shouldShowExpenseTaxBreakdown ? (
                  <>
                    <div className={detailCardClassName}>
                      <p className={fieldLabelClassName}>CGST</p>
                      <p className={fieldValueClassName}>
                        {formatAmount(claim.expense.cgstAmount)}
                      </p>
                      {renderAiWarning("cgst_amount")}
                    </div>
                    <div className={detailCardClassName}>
                      <p className={fieldLabelClassName}>SGST</p>
                      <p className={fieldValueClassName}>
                        {formatAmount(claim.expense.sgstAmount)}
                      </p>
                      {renderAiWarning("sgst_amount")}
                    </div>
                    <div className={detailCardClassName}>
                      <p className={fieldLabelClassName}>IGST</p>
                      <p className={fieldValueClassName}>
                        {formatAmount(claim.expense.igstAmount)}
                      </p>
                      {renderAiWarning("igst_amount")}
                    </div>
                  </>
                ) : null}
                <div
                  className={
                    isMinimalVisual
                      ? `${microCardClassName} col-span-2 md:col-span-full`
                      : undefined
                  }
                >
                  <p className={fieldLabelClassName}>Remarks</p>
                  <p className={fieldValueClassName}>{formatOptionalText(claim.expense.remarks)}</p>
                </div>
                <div
                  className={
                    isMinimalVisual
                      ? `${microCardClassName} col-span-2 md:col-span-full`
                      : "col-span-2 md:col-span-1"
                  }
                >
                  <p className={fieldLabelClassName}>People Involved</p>
                  <p className={fieldValueClassName}>
                    {formatOptionalText(claim.expense.peopleInvolved)}
                  </p>
                </div>
              </>
            )}
          </div>
        </section>
      ) : null}

      {includeAdvanceDetail && claim.advance ? (
        <section className={detailSectionClassName}>
          <h2 className={detailHeadingClassName}>Advance Detail</h2>
          <div className={detailGridClassName}>
            <div
              className={
                isMinimalVisual ? `${microCardClassName} col-span-2 md:col-span-full` : undefined
              }
            >
              <p className={fieldLabelClassName}>Purpose</p>
              <p className={fieldValueClassName}>{claim.advance.purpose}</p>
            </div>
            <div className={detailCardClassName}>
              <p className={fieldLabelClassName}>Requested Amount</p>
              <p className={emphasizedValueClassName}>
                {formatAmount(claim.advance.requestedAmount)}
              </p>
            </div>
            <div className={detailCardClassName}>
              <p className={fieldLabelClassName}>Expected Usage Date</p>
              <p className={fieldValueClassName}>{formatDate(claim.advance.expectedUsageDate)}</p>
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
