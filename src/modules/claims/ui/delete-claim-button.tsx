"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { deleteClaimAction } from "@/modules/claims/actions";

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
        toast.error(result.message ?? "Failed to delete claim.");
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

  return (
    <>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className={
          compact
            ? "inline-flex h-8 items-center justify-center rounded-lg border border-rose-200 px-2.5 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700/60 dark:text-rose-300 dark:hover:bg-rose-950/40"
            : "inline-flex h-9 items-center justify-center rounded-xl border border-rose-200 px-3 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700/60 dark:text-rose-300 dark:hover:bg-rose-950/40"
        }
      >
        {isPending ? "Deleting..." : "Delete Claim"}
      </button>

      {isModalOpen ? (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-sm"
          onClick={handleModalClose}
        >
          <div className="flex min-h-full items-center justify-center">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-claim-title"
              aria-describedby="delete-claim-description"
              className="mx-4 w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>

              <h2
                id="delete-claim-title"
                className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
              >
                Delete Claim
              </h2>
              <p
                id="delete-claim-description"
                className="mx-auto mt-2 max-w-sm text-sm text-zinc-500 dark:text-zinc-400"
              >
                Are you sure you want to delete this claim? This action will remove it from your
                queue.
              </p>

              <div className="mt-6 flex flex-row gap-3">
                <button
                  type="button"
                  onClick={handleModalClose}
                  disabled={isPending}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={isPending}
                  className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-transparent bg-rose-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
