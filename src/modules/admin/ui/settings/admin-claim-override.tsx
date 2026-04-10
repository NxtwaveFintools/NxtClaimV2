"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DB_CLAIM_STATUSES, type DbClaimStatus } from "@/core/constants/statuses";
import type { AdminClaimOverrideSummary } from "@/core/domain/admin/contracts";
import { formatCurrency } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  adminForceUpdateClaimStatusAction,
  adminGetClaimOverrideSummaryAction,
  softDeleteClaimAction,
} from "@/modules/admin/actions";

type PendingAction = "search" | "update-status" | "soft-delete" | null;

export function AdminClaimOverride() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [claimReference, setClaimReference] = useState("");
  const [claimSummary, setClaimSummary] = useState<AdminClaimOverrideSummary | null>(null);
  const [targetStatus, setTargetStatus] = useState<DbClaimStatus>(DB_CLAIM_STATUSES[0]);
  const [overrideReason, setOverrideReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function clearFeedback() {
    setMessage(null);
    setErrorMessage(null);
  }

  async function syncSummaryByReference(reference: string): Promise<boolean> {
    const result = await adminGetClaimOverrideSummaryAction(reference);

    if (!result.ok || !result.data) {
      setClaimSummary(null);
      setErrorMessage(result.message ?? "Claim not found.");
      return false;
    }

    setClaimSummary(result.data);
    setTargetStatus(result.data.status);
    return true;
  }

  function handleSearch() {
    const normalizedReference = claimReference.trim();

    if (!normalizedReference) {
      clearFeedback();
      setClaimSummary(null);
      setErrorMessage("Enter a Claim ID to search.");
      return;
    }

    clearFeedback();

    startTransition(async () => {
      setPendingAction("search");

      try {
        const loaded = await syncSummaryByReference(normalizedReference);
        if (loaded) {
          setMessage(`Loaded claim ${normalizedReference}.`);
        }
      } finally {
        setPendingAction(null);
      }
    });
  }

  function handleForceStatusUpdate() {
    if (!claimSummary) {
      clearFeedback();
      setErrorMessage("Search and load a claim before updating status.");
      return;
    }

    const reason = overrideReason.trim();
    if (reason.length < 5) {
      clearFeedback();
      setErrorMessage("Reason must be at least 5 characters.");
      return;
    }

    clearFeedback();

    startTransition(async () => {
      setPendingAction("update-status");

      try {
        const result = await adminForceUpdateClaimStatusAction(
          claimSummary.claimId,
          targetStatus,
          reason,
        );

        if (!result.ok) {
          setErrorMessage(result.message ?? "Failed to update claim status.");
          return;
        }

        const refreshed = await syncSummaryByReference(claimSummary.claimId);
        if (!refreshed) {
          return;
        }

        setMessage("Claim status updated using admin override.");
        setOverrideReason("");
        router.refresh();
      } finally {
        setPendingAction(null);
      }
    });
  }

  function handleSoftDelete() {
    if (!claimSummary) {
      clearFeedback();
      setErrorMessage("Search and load a claim before soft deleting.");
      return;
    }

    clearFeedback();

    startTransition(async () => {
      setPendingAction("soft-delete");

      try {
        const result = await softDeleteClaimAction(claimSummary.claimId);

        if (!result.ok) {
          setErrorMessage(result.message ?? "Failed to soft-delete claim.");
          return;
        }

        const refreshed = await syncSummaryByReference(claimSummary.claimId);
        if (!refreshed) {
          return;
        }

        setMessage("Claim soft-deleted successfully.");
        router.refresh();
      } finally {
        setPendingAction(null);
      }
    });
  }

  const isSearching = isPending && pendingAction === "search";
  const isUpdatingStatus = isPending && pendingAction === "update-status";
  const isSoftDeleting = isPending && pendingAction === "soft-delete";

  return (
    <section className="space-y-4 rounded-[26px] border border-zinc-200/80 bg-zinc-50/60 p-5 dark:border-zinc-800/80 dark:bg-zinc-950/40">
      <header>
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-300">
          Admin Claim Override
        </h3>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Forcefully override claim status using admin-only controls. All changes are logged into
          claim audit history.
        </p>
      </header>

      <div className="grid gap-2">
        <label
          htmlFor="claim-override-reference"
          className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400"
        >
          Enter Claim ID or Claim Number
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <input
            id="claim-override-reference"
            type="text"
            value={claimReference}
            onChange={(event) => setClaimReference(event.target.value)}
            placeholder="CLAIM-EMP123-20260408-0001"
            className="nxt-input min-w-65 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          />
          <Button
            disabled={isPending}
            onClick={handleSearch}
            type="button"
            variant="secondary"
            size="md"
          >
            {isSearching ? "Searching..." : "Search"}
          </Button>
        </div>
      </div>

      {message ? <Alert tone="success" description={message} /> : null}

      {errorMessage ? <Alert tone="error" description={errorMessage} /> : null}

      {claimSummary ? (
        <>
          <div className="rounded-xl border border-zinc-200 bg-white/90 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
            <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
              Claim Summary
            </h4>

            <dl className="mt-3 grid gap-3 text-sm text-zinc-700 dark:text-zinc-300 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
                  Claim ID
                </dt>
                <dd className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">
                  {claimSummary.claimId}
                </dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
                  Current Status
                </dt>
                <dd className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">
                  {claimSummary.status}
                </dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
                  Submitter
                </dt>
                <dd className="mt-1">
                  {claimSummary.submitterName ?? claimSummary.submitterEmail ?? "Unknown"}
                </dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
                  Department
                </dt>
                <dd className="mt-1">{claimSummary.departmentName ?? "Unknown"}</dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
                  Amount
                </dt>
                <dd className="mt-1">{formatCurrency(claimSummary.amount)}</dd>
              </div>

              <div>
                <dt className="text-xs uppercase tracking-[0.08em] text-zinc-400 dark:text-zinc-500">
                  Claim State
                </dt>
                <dd className="mt-1">{claimSummary.isActive ? "Active" : "Soft-deleted"}</dd>
              </div>
            </dl>
          </div>

          <div className="grid gap-2">
            <label
              htmlFor="claim-override-status"
              className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400"
            >
              Override Status
            </label>
            <select
              id="claim-override-status"
              value={targetStatus}
              disabled={isPending}
              onChange={(event) => setTargetStatus(event.target.value as DbClaimStatus)}
              className="nxt-input rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              {DB_CLAIM_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <label
              htmlFor="claim-override-reason"
              className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400"
            >
              Override Reason (Required)
            </label>
            <textarea
              id="claim-override-reason"
              value={overrideReason}
              onChange={(event) => setOverrideReason(event.target.value)}
              rows={3}
              placeholder="State why this override is required."
              className="nxt-input rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              disabled={isPending}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={isPending}
              onClick={handleForceStatusUpdate}
              type="button"
              variant="primary"
              size="md"
            >
              {isUpdatingStatus ? "Updating..." : "Update Status"}
            </Button>

            <Button
              disabled={isPending}
              onClick={handleSoftDelete}
              type="button"
              variant="secondary"
              size="md"
              className="border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/60"
            >
              {isSoftDeleting ? "Deleting..." : "Soft Delete"}
            </Button>
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Hard delete is disabled by governance policy for financial audit safety.
          </p>
        </>
      ) : null}
    </section>
  );
}
