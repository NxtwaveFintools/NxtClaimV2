"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Eye, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
    <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
      No preview available for this evidence file.
    </div>
  );
}

function getSubmitterInitials(value: string): string {
  const tokens = value
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const initials = tokens
    .slice(0, 2)
    .map((token) => token[0]?.toUpperCase() ?? "")
    .join("");

  return initials || "NC";
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
    <div
      role="tablist"
      aria-label="Document viewer tabs"
      className="flex flex-wrap items-center gap-2"
    >
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
          className={`inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold transition-colors ${
            activeTab === tab.key
              ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/25"
              : "border border-zinc-300/80 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
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
        className="h-full min-h-0 w-full border-0 bg-white"
      />
    );
  }

  return (
    <div className="nxt-scroll flex h-full min-h-0 w-full items-start justify-center overflow-auto bg-zinc-100/70 p-5 dark:bg-zinc-900/70">
      <Image
        src={entry.signedUrl}
        alt={`${entry.label} preview for ${claimId}`}
        width={1920}
        height={1200}
        unoptimized
        className="h-auto w-auto max-w-full rounded-2xl object-contain shadow-[0_24px_60px_-28px_rgba(15,23,42,0.35)]"
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
  const canUseDOM = typeof window !== "undefined" && typeof document !== "undefined";

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

  const defaultEvidenceKey = useMemo(() => {
    if (evidenceByKey.has("receipt")) {
      return "receipt";
    }

    const firstKey = evidenceByKey.keys().next().value;
    return typeof firstKey === "string" ? firstKey : "receipt";
  }, [evidenceByKey]);

  useEffect(() => {
    if (!canUseDOM || !isOpen) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [canUseDOM, isOpen]);

  const activeEntry =
    evidenceByKey.get(activeEvidenceKey) ??
    evidenceByKey.get(defaultEvidenceKey) ??
    evidenceByKey.values().next().value;

  const hasActions = Boolean(children);
  const claimTypeLabel = detailType === "expense" ? "Expense Claim" : "Advance Claim";
  const reviewModeLabel = hasActions ? "Action required" : "Read only";
  const activeEvidenceLabel = activeEntry?.label ?? "No document";

  const openPanel = () => {
    setActiveEvidenceKey(defaultEvidenceKey);
    setIsDetailsOpen(true);
    setIsOpen(true);
  };

  const closePanel = () => {
    setIsOpen(false);
  };

  const panelContent =
    canUseDOM && isOpen
      ? createPortal(
          <div className="fixed inset-0 z-100">
            <div className="absolute inset-0 bg-zinc-950/45 backdrop-blur-sm" />

            <div className="absolute inset-0 overflow-hidden">
              <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-[#f7f8fc] via-[#edf2ff] to-[#eff6ff] dark:from-[#050816] dark:via-[#08101d] dark:to-[#07111d]" />
              <div className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-indigo-300/25 blur-3xl dark:bg-indigo-500/12" />
              <div className="pointer-events-none absolute right-10 top-10 h-80 w-80 rounded-full bg-sky-200/30 blur-3xl dark:bg-sky-500/10" />
              <div className="pointer-events-none absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-violet-200/20 blur-3xl dark:bg-violet-500/10" />

              <div
                className="relative flex h-dvh w-screen flex-col text-zinc-950 shadow-[0_30px_120px_-20px_rgba(15,23,42,0.4)] dark:text-zinc-50"
                style={{ animation: "slideInFromRight 0.28s cubic-bezier(0.22,1,0.36,1) both" }}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`claim-review-title-${claimId}`}
              >
                <header className="border-b border-zinc-200/80 bg-white/78 px-4 py-3 shadow-[0_12px_40px_-30px_rgba(15,23,42,0.32)] backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-950/78 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <button
                        type="button"
                        aria-label="Go back"
                        onClick={closePanel}
                        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-zinc-200/80 bg-white px-3.5 text-sm font-semibold text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        <span className="hidden sm:inline">Back</span>
                      </button>

                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                          Claim Review Workspace
                        </p>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                          <Link
                            id={`claim-review-title-${claimId}`}
                            href={ROUTES.claims.detail(claimId)}
                            className="truncate text-base font-bold text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            {claimId}
                          </Link>
                          <span className="inline-flex h-7 items-center rounded-full border border-zinc-200/80 bg-zinc-100/80 px-3 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                            {claimTypeLabel}
                          </span>
                          <span className="inline-flex h-7 items-center rounded-full border border-indigo-200/80 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 dark:border-indigo-700/60 dark:bg-indigo-950/30 dark:text-indigo-300">
                            {reviewModeLabel}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span className="hidden rounded-full border border-zinc-200/80 bg-zinc-50 px-3 py-1.5 text-sm font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 lg:inline-flex">
                        {amountLabel}
                      </span>
                      {activeEntry ? (
                        <ClaimSemanticDownloadButton
                          url={activeEntry.signedUrl}
                          semanticName={activeEntry.semanticName}
                          label={activeEntry.label}
                          compact
                        />
                      ) : null}
                      <button
                        type="button"
                        aria-label={
                          isDetailsOpen ? "Collapse details panel" : "Expand details panel"
                        }
                        onClick={() => {
                          setIsDetailsOpen((current) => !current);
                        }}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200/80 bg-white text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        {isDetailsOpen ? (
                          <PanelRightClose className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label="Close review panel"
                        onClick={closePanel}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200/80 bg-white text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </header>

                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 lg:flex-row lg:p-5 xl:p-6">
                  <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-4xl border border-zinc-200/80 bg-white/82 shadow-[0_24px_70px_-34px_rgba(15,23,42,0.26)] backdrop-blur-sm dark:border-zinc-800/80 dark:bg-zinc-950/72 dark:shadow-black/25">
                    <div className="border-b border-zinc-200/80 bg-white/78 px-5 py-3 dark:border-zinc-800/80 dark:bg-zinc-950/72">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-zinc-400 dark:text-zinc-500">
                              Evidence Workspace
                            </p>
                            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-medium text-zinc-600 dark:text-zinc-400">
                              <span className="truncate">{categoryName}</span>
                              <span className="text-zinc-300 dark:text-zinc-600">·</span>
                              <span className="truncate">{submitter}</span>
                              <span className="text-zinc-300 dark:text-zinc-600">·</span>
                              <span className="truncate text-zinc-400 dark:text-zinc-500">
                                {onBehalfContext}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {tabs.length > 1 ? (
                            <AuditModeTabs
                              tabs={tabs}
                              activeTab={activeEvidenceKey}
                              onSelect={setActiveEvidenceKey}
                            />
                          ) : activeEntry ? (
                            <span className="inline-flex h-8 items-center rounded-full border border-indigo-200/80 bg-indigo-50 px-4 text-[12px] font-semibold text-indigo-700 dark:border-indigo-700/60 dark:bg-indigo-950/30 dark:text-indigo-300">
                              {activeEntry.label}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-hidden bg-zinc-100/70 p-3 dark:bg-zinc-900/65 sm:p-5">
                      {activeEntry ? (
                        <div
                          id={`audit-viewer-panel-${activeEntry.key}`}
                          role="tabpanel"
                          className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[24px] border border-zinc-200/80 bg-white shadow-[0_20px_80px_-32px_rgba(15,23,42,0.22)] dark:border-zinc-800/80 dark:bg-zinc-900 dark:shadow-black/30"
                        >
                          <EvidenceViewer claimId={claimId} entry={activeEntry} />
                        </div>
                      ) : (
                        <div className="flex h-full min-h-0 flex-1 items-center justify-center rounded-[24px] border border-dashed border-zinc-300 bg-white p-8 dark:border-zinc-700 dark:bg-zinc-900">
                          <div className="max-w-sm text-center">
                            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                              <Eye className="h-6 w-6 text-zinc-400" aria-hidden="true" />
                            </div>
                            <p className="text-[13px] font-bold tracking-tight text-zinc-700 dark:text-zinc-200">
                              No document attached
                            </p>
                            <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                              There is no receipt or supporting document available for preview on
                              this claim.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>

                  {isDetailsOpen ? (
                    <aside className="nxt-scroll flex min-h-0 w-full shrink-0 flex-col overflow-y-auto rounded-4xl border border-zinc-200/80 bg-white/82 p-4 shadow-[0_24px_70px_-34px_rgba(15,23,42,0.26)] backdrop-blur-sm dark:border-zinc-800/80 dark:bg-zinc-950/72 dark:shadow-black/25 lg:w-95 xl:w-105">
                      <div className="rounded-[28px] border border-zinc-200/80 bg-zinc-50/80 p-5 dark:border-zinc-800/80 dark:bg-zinc-900/75">
                        <div className="flex items-center gap-4">
                          <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[18px] bg-linear-to-br from-indigo-600 to-sky-500 text-[13px] font-extrabold tracking-wide text-white shadow-lg shadow-indigo-500/25">
                            {getSubmitterInitials(submitter)}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-zinc-400 dark:text-zinc-500">
                              Submitted by
                            </p>
                            <p className="mt-1 text-[16px] font-bold leading-tight tracking-[-0.015em] text-zinc-950 dark:text-zinc-50">
                              {submitter}
                            </p>
                            <p className="mt-0.5 text-[12px] font-medium text-zinc-500 dark:text-zinc-400">
                              {onBehalfContext}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                        <div className="rounded-[20px] border border-zinc-200/80 bg-white p-4 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900/80">
                          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                            Amount
                          </p>
                          <p className="mt-2 text-[15px] font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                            {amountLabel}
                          </p>
                        </div>

                        <div className="rounded-[20px] border border-zinc-200/80 bg-white p-4 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900/80">
                          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                            Category
                          </p>
                          <p className="mt-2 text-[15px] font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                            {categoryName}
                          </p>
                        </div>

                        <div className="rounded-[20px] border border-zinc-200/80 bg-white p-4 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900/80">
                          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                            Claim Type
                          </p>
                          <p className="mt-2 text-[15px] font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                            {claimTypeLabel}
                          </p>
                        </div>

                        <div className="rounded-[20px] border border-zinc-200/80 bg-white p-4 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900/80">
                          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                            Active Document
                          </p>
                          <p className="mt-2 text-[15px] font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                            {activeEvidenceLabel}
                          </p>
                        </div>
                      </div>

                      <div className="mt-2.5 rounded-[20px] border border-zinc-200/80 bg-white p-4 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900/80">
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                          Purpose
                        </p>
                        <p className="mt-2 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                          {purpose ?? "No purpose was provided for this claim."}
                        </p>
                      </div>

                      <div className="mt-2.5">
                        <ClaimAuditTimeline
                          logs={auditLogs}
                          title="Workflow Timeline"
                          emptyLabel="No audit history available for this claim yet."
                        />
                      </div>

                      {hasActions ? (
                        <div className="mt-2.5 rounded-[24px] border border-zinc-900/10 bg-zinc-950 p-5 text-white shadow-[0_20px_60px_-30px_rgba(15,23,42,0.45)] dark:border-zinc-800">
                          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/50">
                            Take Action
                          </p>
                          <p className="mt-1.5 text-[13px] leading-snug text-white/65">
                            Review the evidence, then complete the next approval step.
                          </p>
                          <div className="mt-4 grid gap-2 sm:grid-cols-2 [&>button]:w-full [&>form]:w-full [&>form>button]:w-full">
                            {children}
                          </div>
                        </div>
                      ) : null}
                    </aside>
                  ) : null}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={openPanel}
        className="inline-flex h-9 min-w-28 items-center justify-center gap-2 rounded-xl border border-zinc-300/80 bg-white px-3.5 text-sm font-semibold text-zinc-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <Eye className="h-4 w-4" aria-hidden="true" />
        View Claim
      </button>

      {panelContent}
    </>
  );
}

export { ApprovalsAuditModeDialog as ApprovalsQuickViewSheet };
