"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { deleteClaimAction } from "@/modules/claims/actions";
import { getUserFriendlyErrorMessage } from "@/core/errors/user-facing-errors";

type DeleteClaimButtonProps = {
  claimId: string;
  compact?: boolean;
  redirectToHref?: string;
};

export function DeleteClaimButton({
  claimId,
  compact = false,
  redirectToHref,
}: DeleteClaimButtonProps) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (isPending) {
      return;
    }

    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    if (isPending) {
      return;
    }

    setIsModalOpen(false);
  };

  const handleConfirmDelete = () => {
    if (isPending) {
      return;
    }

    startTransition(async () => {
      const result = await deleteClaimAction(claimId);

      if (!result.ok) {
        toast.error(getUserFriendlyErrorMessage(result.message, "claim-delete"));
        return;
      }

      setIsModalOpen(false);
      toast.success("Claim deleted successfully.");

      if (redirectToHref) {
        router.push(redirectToHref, { scroll: false });
        return;
      }

      router.refresh();
    });
  };

  const modal = isModalOpen ? (
    <div className="fixed inset-0 z-[260] bg-black/50" onClick={handleModalClose}>
      <div className="flex min-h-full items-center justify-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-claim-title"
          aria-describedby="delete-claim-description"
          className="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-none"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-danger-muted text-danger">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>

          <h2 id="delete-claim-title" className="text-lg font-semibold text-foreground">
            Delete Claim
          </h2>
          <p
            id="delete-claim-description"
            className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground"
          >
            Are you sure you want to delete this claim? This action will remove it from your queue.
          </p>

          <div className="mt-6 flex flex-row gap-3">
            <button
              type="button"
              onClick={handleModalClose}
              disabled={isPending}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-background-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={isPending}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-transparent bg-danger px-4 text-sm font-semibold text-white transition-colors hover:bg-danger/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className={
          compact
            ? "inline-flex h-8 items-center justify-center rounded-lg border border-danger/30 px-2 text-[11px] font-semibold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
            : "inline-flex h-9 items-center justify-center rounded-lg border border-danger/30 px-3 text-sm font-semibold text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        {isPending ? "Deleting..." : compact ? "Delete" : "Delete Claim"}
      </button>

      {typeof document !== "undefined" && modal ? createPortal(modal, document.body) : null}
    </>
  );
}
