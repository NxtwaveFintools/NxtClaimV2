"use client";

import Image from "next/image";
import Link from "next/link";
import { Eye, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { ROUTES } from "@/core/config/route-registry";
import { ClaimSemanticDownloadButton } from "@/modules/claims/ui/claim-semantic-download-button";

type ApprovalsQuickViewSheetProps = {
  claimId: string;
  detailType: "expense" | "advance";
  submitter: string;
  amountLabel: string;
  categoryName: string;
  purpose: string | null;
  submissionType: "Self" | "On Behalf";
  onBehalfEmail: string | null;
  expenseReceiptFilePath: string | null;
  expenseReceiptSignedUrl: string | null;
  expenseBankStatementFilePath: string | null;
  expenseBankStatementSignedUrl: string | null;
  advanceSupportingDocumentPath: string | null;
  advanceSupportingDocumentSignedUrl: string | null;
  children?: ReactNode;
};

function isRenderableEvidencePath(path: string | null): path is string {
  return Boolean(path && path.trim() !== "" && path !== "N/A");
}

function isPdfEvidence(path: string | null, signedUrl: string | null): boolean {
  const candidate = path ?? signedUrl ?? "";
  return candidate.toLowerCase().endsWith(".pdf");
}

function NoEvidenceFallback(): ReactNode {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-zinc-900 dark:text-slate-400">
      No preview available for this evidence file.
    </div>
  );
}

export function ApprovalsQuickViewSheet({
  claimId,
  detailType,
  submitter,
  amountLabel,
  categoryName,
  purpose,
  submissionType,
  onBehalfEmail,
  expenseReceiptFilePath,
  expenseReceiptSignedUrl,
  expenseBankStatementFilePath,
  expenseBankStatementSignedUrl,
  advanceSupportingDocumentPath,
  advanceSupportingDocumentSignedUrl,
  children,
}: ApprovalsQuickViewSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const onBehalfContext = useMemo(() => {
    if (submissionType !== "On Behalf") {
      return "Self submission";
    }

    return onBehalfEmail ? `On Behalf (${onBehalfEmail})` : "On Behalf";
  }, [onBehalfEmail, submissionType]);

  const evidenceEntries = useMemo(() => {
    const entries: Array<{
      key: string;
      label: string;
      path: string | null;
      signedUrl: string;
      semanticName: string;
    }> = [];

    if (detailType === "expense") {
      if (isRenderableEvidencePath(expenseReceiptFilePath) && expenseReceiptSignedUrl) {
        entries.push({
          key: "expense-receipt",
          label: "Expense Receipt",
          path: expenseReceiptFilePath,
          signedUrl: expenseReceiptSignedUrl,
          semanticName: `${claimId}-EXP`,
        });
      }

      if (isRenderableEvidencePath(expenseBankStatementFilePath) && expenseBankStatementSignedUrl) {
        entries.push({
          key: "expense-bank-statement",
          label: "Bank Statement",
          path: expenseBankStatementFilePath,
          signedUrl: expenseBankStatementSignedUrl,
          semanticName: `${claimId}-BNK`,
        });
      }
    }

    if (
      detailType === "advance" &&
      isRenderableEvidencePath(advanceSupportingDocumentPath) &&
      advanceSupportingDocumentSignedUrl
    ) {
      entries.push({
        key: "advance-supporting-document",
        label: "Petty Cash Request Document",
        path: advanceSupportingDocumentPath,
        signedUrl: advanceSupportingDocumentSignedUrl,
        semanticName: `${claimId}-PCR`,
      });
    }

    return entries;
  }, [
    advanceSupportingDocumentPath,
    advanceSupportingDocumentSignedUrl,
    claimId,
    detailType,
    expenseBankStatementFilePath,
    expenseBankStatementSignedUrl,
    expenseReceiptFilePath,
    expenseReceiptSignedUrl,
  ]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-zinc-900 dark:text-slate-200 dark:hover:bg-zinc-800"
      >
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        View
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close quick view"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
            onClick={() => {
              setIsOpen(false);
            }}
          />

          <aside className="absolute right-0 top-0 h-full w-full overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-zinc-950 sm:p-6 md:w-1/2">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                  Quick View
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  <Link
                    href={ROUTES.claims.detail(claimId)}
                    className="text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {claimId}
                  </Link>
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{submitter}</p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  setIsOpen(false);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-zinc-800"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <section className="mt-5 space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.1em] text-slate-600 dark:text-slate-300">
                Evidence Files
              </h3>
              {evidenceEntries.length > 0 ? (
                <div className="space-y-4">
                  {evidenceEntries.map((entry) => (
                    <article
                      key={entry.key}
                      className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800"
                    >
                      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
                        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                          {entry.label}
                        </p>
                        <ClaimSemanticDownloadButton
                          url={entry.signedUrl}
                          semanticName={entry.semanticName}
                          label={entry.label}
                          compact
                        />
                      </header>
                      <div className="p-2">
                        {!isRenderableEvidencePath(entry.path) ? (
                          <NoEvidenceFallback />
                        ) : isPdfEvidence(entry.path, entry.signedUrl) ? (
                          <iframe
                            src={entry.signedUrl}
                            title={`${entry.label} preview for ${claimId}`}
                            className="h-[320px] w-full rounded-lg border border-slate-200 bg-white dark:border-slate-800"
                          />
                        ) : (
                          <Image
                            src={entry.signedUrl}
                            alt={`${entry.label} preview for ${claimId}`}
                            width={1200}
                            height={840}
                            unoptimized
                            className="max-h-[320px] w-full rounded-lg border border-slate-200 object-contain dark:border-slate-800"
                          />
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  No receipt/supporting document preview is available for this claim.
                </div>
              )}
            </section>

            <section className="mt-5 grid gap-3 sm:grid-cols-2">
              <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                  Amount
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {amountLabel}
                </p>
              </article>
              <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                  Category
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {categoryName}
                </p>
              </article>
              <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-800 sm:col-span-2">
                <p className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                  Purpose
                </p>
                <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {purpose ?? "N/A"}
                </p>
              </article>
              <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-800 sm:col-span-2">
                <p className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                  On Behalf Context
                </p>
                <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {onBehalfContext}
                </p>
              </article>
            </section>

            <section className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                Take Action
              </p>
              <div className="flex flex-wrap items-start gap-3">{children}</div>
            </section>
          </aside>
        </div>
      ) : null}
    </>
  );
}
