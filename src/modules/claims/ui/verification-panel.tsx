"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, ShieldQuestion, FileX, RefreshCw } from "lucide-react";
import { markClaimVerifiedAction, rerunClaimVerificationAction } from "@/modules/claims/actions";
import type { VerificationSummary } from "@/modules/claims/repositories/SupabaseVerificationRepository";

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
};

type DisplayState = {
  label: string;
  sentence: string;
  className: string;
  Icon: typeof ShieldCheck;
};

function resolveDisplayState(summary: VerificationSummary | null): DisplayState {
  if (!summary || summary.status === "queued" || summary.status === "running") {
    return {
      label: "Pending",
      sentence: "AI verification is in progress. Check back in a moment.",
      className:
        "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
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
        Icon: ShieldCheck,
      };
    case "mismatch":
      return {
        label: "Mismatch",
        sentence: "One or more key fields do not match the receipt. Review highlighted rows.",
        className:
          "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/15 dark:text-rose-300",
        Icon: ShieldAlert,
      };
    case "needs_review":
      return {
        label: "Needs review",
        sentence: "Soft signals need a human look (low confidence or non-amount differences).",
        className:
          "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/15 dark:text-amber-200",
        Icon: ShieldQuestion,
      };
    case "no_document":
      return {
        label: "No document",
        sentence: "No receipt is on record for this claim, so nothing could be verified.",
        className:
          "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
        Icon: FileX,
      };
    default:
      return {
        label: "Extraction failed",
        sentence: "The AI could not read the stored receipt. Try a manual re-run.",
        className:
          "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
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

export function VerificationPanel({ claimId, summary, canAct }: VerificationPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const state = resolveDisplayState(summary);
  const checks = summary?.checks ?? [];

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
    <section className="rounded-2xl border border-zinc-200/80 bg-white/80 p-5 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-950/60">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
          AI Verification
        </h3>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${state.className}`}
        >
          <state.Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {state.label}
        </span>
      </div>

      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{state.sentence}</p>

      {checks.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200/80 dark:border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 text-[10px] uppercase tracking-wider text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Field</th>
                <th className="px-3 py-2 font-semibold">Submitted</th>
                <th className="px-3 py-2 font-semibold">Receipt</th>
                <th className="px-3 py-2 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((check) => {
                const isMismatch = check.verdict === "mismatch";
                return (
                  <tr
                    key={check.field}
                    className={`border-t border-zinc-100 dark:border-zinc-800/80 ${
                      isMismatch ? "bg-rose-50/60 dark:bg-rose-900/10" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-300">
                      {FIELD_LABELS[check.field] ?? check.field}
                    </td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                      {check.submittedValue ?? "—"}
                    </td>
                    <td
                      className="px-3 py-2 text-zinc-600 dark:text-zinc-400"
                      title={check.extractedRaw ?? undefined}
                    >
                      {check.extractedNormalized ?? check.extractedRaw ?? "—"}
                    </td>
                    <td className="px-3 py-2">
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
    </section>
  );
}
