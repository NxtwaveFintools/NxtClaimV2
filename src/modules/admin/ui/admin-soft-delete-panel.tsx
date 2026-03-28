"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/core/config/route-registry";
import { softDeleteClaimAction } from "@/modules/admin/actions";

type Props = {
  claimId: string;
};

export function AdminSoftDeletePanel({ claimId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSoftDelete() {
    setError(null);
    startTransition(async () => {
      const result = await softDeleteClaimAction(claimId);
      if (result.ok) {
        router.push(`${ROUTES.claims.myClaims}?view=admin`);
      } else {
        setError(result.message ?? "Failed to soft-delete claim.");
        setConfirming(false);
      }
    });
  }

  return (
    <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm dark:border-rose-800/40 dark:bg-rose-950/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-rose-700 dark:text-rose-300">
            Admin Control
          </h2>
          <p className="mt-0.5 text-xs text-rose-600/80 dark:text-rose-400/80">
            Soft-delete this claim. It will be hidden from all submitter and approver views. This
            action is reversible only via direct database access.
          </p>
        </div>

        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="whitespace-nowrap rounded-lg border border-rose-400 bg-white px-3 py-1.5 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-600 dark:bg-transparent dark:text-rose-300 dark:hover:bg-rose-950/40"
          >
            Soft Delete Claim
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-rose-700 dark:text-rose-300">
              Are you sure?
            </span>
            <button
              type="button"
              disabled={isPending}
              onClick={handleSoftDelete}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Deleting…" : "Yes, Delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={isPending}
              className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {error ? <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{error}</p> : null}
    </section>
  );
}
