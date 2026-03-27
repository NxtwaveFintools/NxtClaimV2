"use client";

import Image from "next/image";
import Link from "next/link";
import { Eye, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { ROUTES } from "@/core/config/route-registry";
import type { ClaimAuditLogRecord } from "@/core/domain/claims/contracts";
import { ClaimSemanticDownloadButton } from "@/modules/claims/ui/claim-semantic-download-button";
import { ClaimAuditTimeline } from "@/modules/claims/ui/claim-audit-timeline";

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
  auditLogs: (ClaimAuditLogRecord & { formattedCreatedAt: string })[];
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
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
      No preview available for this evidence file.
    </div>
  );
}

type EvidenceEntry = {
  key: string;
  label: string;
  path: string | null;
  signedUrl: string;
  semanticName: string;
};

type AuditTab = {
  key: string;
  label: string;
};

function AuditModeTabs({
  tabs,
  activeTab,
  onSelect,
}: {
  tabs: AuditTab[];
  activeTab: string;
  onSelect: (key: string) => void;
}): ReactNode {
  return (
    <div role="tablist" aria-label="Document viewer tabs" className="flex items-center gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          type="button"
          aria-selected={activeTab === tab.key}
          aria-controls={`audit-viewer-panel-${tab.key}`}
          onClick={() => {
            onSelect(tab.key);
          }}
          className={`inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold transition-colors ${
            activeTab === tab.key
              ? "bg-indigo-600 text-white"
              : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-zinc-800"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function EvidenceViewer({ claimId, entry }: { claimId: string; entry: EvidenceEntry }): ReactNode {
  if (!isRenderableEvidencePath(entry.path)) {
    return <NoEvidenceFallback />;
  }

  if (isPdfEvidence(entry.path, entry.signedUrl)) {
    return (
      <iframe
        src={entry.signedUrl}
        title={`${entry.label} preview for ${claimId}`}
        className="h-full w-full rounded-xl border border-slate-200 bg-white dark:border-slate-800"
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <Image
        src={entry.signedUrl}
        alt={`${entry.label} preview for ${claimId}`}
        width={1920}
        height={1200}
        unoptimized
        className="max-h-full w-auto max-w-full object-contain"
      />
    </div>
  );
}

export function ApprovalsAuditModeDialog({
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
  auditLogs,
  children,
}: ApprovalsQuickViewSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(true);
  const [activeEvidenceKey, setActiveEvidenceKey] = useState<string>("receipt");

  const onBehalfContext = useMemo(() => {
    if (submissionType !== "On Behalf") {
      return "Self submission";
    }

    return onBehalfEmail ? `On Behalf (${onBehalfEmail})` : "On Behalf";
  }, [onBehalfEmail, submissionType]);

  const evidenceByKey = useMemo(() => {
    const entries = new Map<string, EvidenceEntry>();

    if (detailType === "expense") {
      if (isRenderableEvidencePath(expenseReceiptFilePath) && expenseReceiptSignedUrl) {
        entries.set("receipt", {
          key: "receipt",
          label: "Receipt",
          path: expenseReceiptFilePath,
          signedUrl: expenseReceiptSignedUrl,
          semanticName: `${claimId}-EXP`,
        });
      }

      if (isRenderableEvidencePath(expenseBankStatementFilePath) && expenseBankStatementSignedUrl) {
        entries.set("bank-statement", {
          key: "bank-statement",
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
      entries.set("receipt", {
        key: "receipt",
        label: "Receipt",
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

  const hasReceiptTab = evidenceByKey.has("receipt");
  const hasBankStatementTab = evidenceByKey.has("bank-statement");
  const tabs = useMemo<AuditTab[]>(() => {
    const items: AuditTab[] = [];
    if (hasReceiptTab) {
      items.push({ key: "receipt", label: "Receipt" });
    }
    if (hasBankStatementTab) {
      items.push({ key: "bank-statement", label: "Bank Statement" });
    }
    return items;
  }, [hasBankStatementTab, hasReceiptTab]);

  const activeEntry =
    evidenceByKey.get(activeEvidenceKey) ??
    evidenceByKey.get("receipt") ??
    evidenceByKey.values().next().value;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
          setIsDetailsOpen(true);
          setActiveEvidenceKey("receipt");
        }}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-zinc-800"
      >
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        View
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close audit mode"
            className="absolute inset-0 bg-slate-950/60"
            onClick={() => {
              setIsOpen(false);
            }}
          />

          <section className="absolute inset-0 m-0 h-screen w-screen max-w-none rounded-none bg-white p-0 shadow-2xl dark:bg-slate-900">
            <button
              type="button"
              aria-label="Close"
              onClick={() => {
                setIsOpen(false);
              }}
              className="absolute right-4 top-4 z-50 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white/90 text-slate-700 backdrop-blur transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200 dark:hover:bg-zinc-800"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>

            <div className="flex h-full w-full">
              <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  isDetailsOpen ? "w-96" : "w-0"
                }`}
              >
                <aside className="flex h-full w-96 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                        Audit Mode
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
                  </div>

                  <div className="flex-1 overflow-y-auto px-6 py-5">
                    <section className="grid gap-3 sm:grid-cols-2">
                      <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                        <p className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                          Amount
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {amountLabel}
                        </p>
                      </article>
                      <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                        <p className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                          Category
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {categoryName}
                        </p>
                      </article>
                      <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:col-span-2">
                        <p className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                          Purpose
                        </p>
                        <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                          {purpose ?? "N/A"}
                        </p>
                      </article>
                      <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:col-span-2">
                        <p className="text-xs uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                          On Behalf Context
                        </p>
                        <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100">
                          {onBehalfContext}
                        </p>
                      </article>
                    </section>

                    <div className="mt-5">
                      <ClaimAuditTimeline
                        logs={auditLogs}
                        title="Audit History"
                        emptyLabel="No audit history available for this claim yet."
                      />
                    </div>
                  </div>

                  <section className="sticky bottom-0 border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">
                      Take Action
                    </p>
                    <div className="flex flex-wrap items-start gap-3">{children}</div>
                  </section>
                </aside>
              </div>

              <section className="flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-slate-900">
                <div className="border-b border-slate-200 px-6 py-4 pr-20 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <button
                        type="button"
                        aria-label={
                          isDetailsOpen ? "Collapse audit details" : "Expand audit details"
                        }
                        onClick={() => {
                          setIsDetailsOpen((current) => !current);
                        }}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-zinc-800"
                      >
                        {isDetailsOpen ? (
                          <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>

                      <AuditModeTabs
                        tabs={tabs}
                        activeTab={activeEvidenceKey}
                        onSelect={setActiveEvidenceKey}
                      />
                    </div>

                    <div className="shrink-0">
                      {activeEntry ? (
                        <ClaimSemanticDownloadButton
                          url={activeEntry.signedUrl}
                          semanticName={activeEntry.semanticName}
                          label={activeEntry.label}
                          compact
                        />
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="h-full min-h-0 flex-1 overflow-auto p-6">
                  {activeEntry ? (
                    <div
                      id={`audit-viewer-panel-${activeEntry.key}`}
                      role="tabpanel"
                      className="h-full min-h-[520px] w-full"
                    >
                      <EvidenceViewer claimId={claimId} entry={activeEntry} />
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      No receipt/supporting document preview is available for this claim.
                    </div>
                  )}
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export { ApprovalsAuditModeDialog as ApprovalsQuickViewSheet };
