"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  FileX,
  RefreshCw,
  Wand2,
  Copy,
} from "lucide-react";
import { markClaimVerifiedAction, rerunClaimVerificationAction } from "@/modules/claims/actions";
import type {
  VerificationCheckRecord,
  VerificationSummary,
} from "@/modules/claims/repositories/SupabaseVerificationRepository";

type VerificationPanelProps = {
  claimId: string;
  summary: VerificationSummary | null;
  canAct: boolean;
};

const FIELD_LABELS: Record<string, string> = {
  total_amount: "Total Amount",
  transaction_date: "Transaction Date",
  bill_no: "Bill No",
  gst_number: "GST Number",
  vendor_name: "Vendor",
  cgst_amount: "CGST",
  sgst_amount: "SGST",
  igst_amount: "IGST",
  foreign_currency_code: "Foreign Currency",
  statement_amount: "Amount",
  statement_date: "Date",
  statement_reference: "Reference",
  fx_reconciliation: "FX rate (INR/unit)",
  currency_mismatch: "Currency",
};

type DisplayState = {
  label: string;
  sentence: string;
  /** Chip + soft surface classes (border/bg/text), used for the verdict pill. */
  className: string;
  /** Left accent bar color for the banner. */
  barClassName: string;
  /** Icon chip background. */
  iconWrapClassName: string;
  Icon: typeof ShieldCheck;
};

function resolveDisplayState(summary: VerificationSummary | null): DisplayState {
  if (!summary || summary.status === "queued" || summary.status === "running") {
    return {
      label: "Pending",
      sentence: "AI verification is in progress. Check back in a moment.",
      className:
        "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
      barClassName: "bg-zinc-300 dark:bg-zinc-700",
      iconWrapClassName: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
      Icon: ShieldQuestion,
    };
  }

  switch (summary.overallVerdict) {
    case "verified":
      return {
        label: "Verified",
        sentence: "Every checked field matches the receipt within tolerance.",
        className:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/15 dark:text-emerald-300",
        barClassName: "bg-emerald-400 dark:bg-emerald-500",
        iconWrapClassName:
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
        Icon: ShieldCheck,
      };
    case "mismatch":
      return {
        label: "Mismatch",
        sentence: "One or more key fields do not match the receipt. Review highlighted rows.",
        className:
          "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/15 dark:text-rose-300",
        barClassName: "bg-rose-400 dark:bg-rose-500",
        iconWrapClassName: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
        Icon: ShieldAlert,
      };
    case "statement_mismatch":
      return {
        label: "Statement mismatch",
        sentence:
          "The receipt checks out, but the bank statement's amount or date doesn't match. Review the statement rows.",
        className:
          "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800/50 dark:bg-orange-900/15 dark:text-orange-300",
        barClassName: "bg-orange-400 dark:bg-orange-500",
        iconWrapClassName:
          "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
        Icon: ShieldAlert,
      };
    case "needs_review":
      return {
        label: "Needs review",
        sentence: "Soft signals need a human look (low confidence or non-amount differences).",
        className:
          "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/15 dark:text-amber-200",
        barClassName: "bg-amber-400 dark:bg-amber-500",
        iconWrapClassName: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
        Icon: ShieldQuestion,
      };
    case "no_document":
      return {
        label: "No document",
        sentence: "No receipt is on record for this claim, so nothing could be verified.",
        className:
          "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
        barClassName: "bg-zinc-300 dark:bg-zinc-700",
        iconWrapClassName: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
        Icon: FileX,
      };
    default:
      return {
        label: "Extraction failed",
        sentence: "The AI could not read the stored receipt. Try a manual re-run.",
        className:
          "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        barClassName: "bg-zinc-400 dark:bg-zinc-600",
        iconWrapClassName: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
        Icon: FileX,
      };
  }
}

function verdictChipClass(verdict: string): string {
  switch (verdict) {
    case "match":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
    case "mismatch":
      return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300";
    case "fuzzy_match":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200";
    default:
      return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  }
}

/** Counts used for the at-a-glance summary chips on the banner. */
function tallyChecks(checks: VerificationCheckRecord[]) {
  let matched = 0;
  let review = 0;
  let mismatched = 0;
  for (const c of checks) {
    if (c.verdict === "match") matched += 1;
    else if (c.verdict === "fuzzy_match") review += 1;
    else if (c.verdict === "mismatch") mismatched += 1;
  }
  return { matched, review, mismatched };
}

function CountChip({ tone, label }: { tone: "ok" | "warn" | "bad"; label: string }) {
  const dot = tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-rose-500";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 ring-1 ring-inset ring-zinc-200/70 dark:bg-zinc-900/60 dark:text-zinc-300 dark:ring-zinc-700/70">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function CheckTable({
  title,
  sourceLabel,
  rows,
}: {
  title: string;
  sourceLabel: string;
  rows: VerificationCheckRecord[];
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {title}
      </p>
      <div className="overflow-hidden rounded-xl border border-zinc-200/80 dark:border-zinc-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-50 text-[10px] uppercase tracking-wider text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Field</th>
              <th className="px-3 py-2 font-semibold">Submitted</th>
              <th className="px-3 py-2 font-semibold">{sourceLabel}</th>
              <th className="px-3 py-2 text-right font-semibold">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((check) => {
              const isMismatch = check.verdict === "mismatch";
              const isFuzzy = check.verdict === "fuzzy_match";
              const rowTint = isMismatch
                ? "bg-rose-50/60 dark:bg-rose-900/10"
                : isFuzzy
                  ? "bg-amber-50/50 dark:bg-amber-900/10"
                  : "";
              return (
                <tr
                  key={check.field}
                  className={`border-t border-zinc-100 align-top dark:border-zinc-800/80 ${rowTint}`}
                >
                  <td className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                    {FIELD_LABELS[check.field] ?? check.field}
                    {check.mismatchReason && (isMismatch || isFuzzy) ? (
                      <span className="mt-0.5 block text-[10px] font-normal leading-4 text-zinc-400 dark:text-zinc-500">
                        {check.mismatchReason}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-400">
                    {check.submittedValue ?? "—"}
                  </td>
                  <td
                    className="px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-400"
                    title={check.extractedRaw ?? undefined}
                  >
                    {check.extractedNormalized ?? check.extractedRaw ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${verdictChipClass(check.verdict)}`}
                      title={check.mismatchReason ?? undefined}
                    >
                      {check.verdict.replace("_", " ")}
                      {check.confidence !== null ? ` · ${check.confidence}` : ""}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function VerificationPanel({ claimId, summary, canAct }: VerificationPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const state = resolveDisplayState(summary);
  const checks = summary?.checks ?? [];
  const receiptChecks = checks.filter((c) => c.lane !== "bank_statement");
  const statementChecks = checks.filter((c) => c.lane === "bank_statement");
  const tally = tallyChecks(checks);
  const hasChecks = checks.length > 0;
  // Offer "apply receipt values" only when there are receipt values that differ.
  const canApplyReceiptValues =
    canAct &&
    receiptChecks.some((c) => c.extractedNormalized !== null) &&
    (summary?.overallVerdict === "mismatch" || summary?.overallVerdict === "needs_review");

  const openPrefilledEdit = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("edit", "ai");
    router.push(`${pathname}?${params.toString()}`);
  };

  const runAction = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(result.message ?? "Done.");
        router.refresh();
      } else {
        toast.error(result.message ?? "Action failed.");
      }
    });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white/80 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-950/60">
      {/* Verdict banner — the first thing finance reads. */}
      <div className="relative flex items-start gap-4 p-5">
        <span
          className={`absolute inset-y-0 left-0 w-1.5 ${state.barClassName}`}
          aria-hidden="true"
        />
        <div
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${state.iconWrapClassName}`}
        >
          <state.Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
              AI Verification
            </h3>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${state.className}`}
            >
              {state.label}
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            {state.sentence}
          </p>
          {hasChecks ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <CountChip tone="ok" label={`${tally.matched} matched`} />
              {tally.review > 0 ? (
                <CountChip tone="warn" label={`${tally.review} to review`} />
              ) : null}
              {tally.mismatched > 0 ? (
                <CountChip tone="bad" label={`${tally.mismatched} mismatched`} />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-zinc-100 px-5 pb-5 pt-1 dark:border-zinc-800/80">
        <CheckTable title="Receipt comparison" sourceLabel="Receipt" rows={receiptChecks} />
        <CheckTable
          title="Bank statement comparison"
          sourceLabel="Statement"
          rows={statementChecks}
        />

        {summary && summary.invoiceDuplicate.status === "match" ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-800/50 dark:bg-rose-900/15">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Possible duplicate — same invoice number as:
            </p>
            <ul className="mt-2 space-y-1">
              {summary.invoiceDuplicate.claimIds.map((id) => (
                <li key={id}>
                  <a
                    href={`/dashboard/claims/${id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {id}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {summary && summary.amountDateDuplicate.status === "match" ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/15">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Possible duplicate — same amount & date as:
            </p>
            <ul className="mt-2 space-y-1">
              {summary.amountDateDuplicate.claimIds.map((id) => (
                <li key={id}>
                  <a
                    href={`/dashboard/claims/${id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {id}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {summary?.receiptFileHash ? (
          <p className="mt-3 text-[11px] leading-5 text-zinc-400 dark:text-zinc-500">
            Evidence: run {summary.runId.slice(0, 8)} · model {summary.model ?? "n/a"} · receipt
            sha256 {summary.receiptFileHash.slice(0, 12)}…
            {summary.finishedAt ? ` · ${summary.finishedAt}` : ""}
          </p>
        ) : null}

        {canAct ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => runAction(() => rerunClaimVerificationAction({ claimId }))}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
              Re-run verification
            </button>
            {canApplyReceiptValues ? (
              <button
                type="button"
                disabled={isPending}
                onClick={openPrefilledEdit}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-700/60 dark:bg-indigo-900/20 dark:text-indigo-200 dark:hover:bg-indigo-900/35"
              >
                <Wand2 className="h-3.5 w-3.5" />
                Apply receipt values
              </button>
            ) : null}
            {summary && summary.overallVerdict !== "verified" ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => runAction(() => markClaimVerifiedAction({ claimId }))}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-700/60 dark:bg-emerald-900/20 dark:text-emerald-200 dark:hover:bg-emerald-900/35"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Mark verified anyway
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
