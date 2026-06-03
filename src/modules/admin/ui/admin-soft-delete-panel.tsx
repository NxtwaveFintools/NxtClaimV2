"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/core/config/route-registry";
import { softDeleteClaimAction } from "@/modules/admin/actions";

type Props = {
  claimId: string;
  isActive: boolean;
};

export function AdminSoftDeletePanel({ claimId, isActive }: Props) {
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
        setError(
          result.message ??
            "We couldn't delete this claim. It may no longer be eligible for deletion.",
        );
        setConfirming(false);
      }
    });
  }

  return (
    <section className="rounded-xl border border-danger/30 bg-danger-muted p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-danger">
            Admin Control
          </h2>
          <p className="mt-0.5 text-xs text-danger/70">
            {isActive
              ? "Soft-delete this claim. It will be hidden from all submitter and approver views. This action is reversible only via direct database access."
              : "This claim is already inactive and can be reviewed in read-only mode."}
          </p>
        </div>

        {!isActive ? (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            This claim has been soft-deleted.
          </span>
        ) : !confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="whitespace-nowrap rounded-lg border border-danger/40 bg-card px-3 py-1.5 text-sm font-semibold text-danger transition-colors hover:bg-danger/10"
          >
            Soft Delete Claim
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-danger">Are you sure?</span>
            <button
              type="button"
              disabled={isPending}
              onClick={handleSoftDelete}
              className="rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white hover:bg-danger/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Deleting…" : "Yes, Delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={isPending}
              className="rounded-lg border border-danger/40 px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
    </section>
  );
}
