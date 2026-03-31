"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FinanceApproverRecord } from "@/core/domain/admin/contracts";
import {
  addFinanceApproverByEmailAction,
  updateFinanceApproverAction,
} from "@/modules/admin/actions";

type Props = {
  approvers: FinanceApproverRecord[];
};

export function FinanceApproversManagement({ approvers }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  function handleAdd() {
    const trimmed = email.trim();
    if (!trimmed) {
      setAddError("Please enter an email address.");
      return;
    }
    setAddError(null);
    startTransition(async () => {
      const result = await addFinanceApproverByEmailAction(trimmed);
      if (result.ok) {
        setEmail("");
        router.refresh();
      } else {
        setAddError(result.message ?? "Failed to add approver.");
      }
    });
  }

  function handleToggle(id: string, currentValue: boolean) {
    startTransition(async () => {
      await updateFinanceApproverAction(id, { isActive: !currentValue });
      router.refresh();
    });
  }

  function handleSetPrimary(id: string) {
    startTransition(async () => {
      await updateFinanceApproverAction(id, { isPrimary: true });
      router.refresh();
    });
  }

  return (
    <div className="overflow-hidden rounded-[26px] border border-zinc-200/80 bg-zinc-50/50 dark:border-zinc-800/80 dark:bg-zinc-950/40">
      <div className="border-b border-zinc-200/80 px-5 py-4 dark:border-zinc-800/80">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-300">
          Finance Approvers
        </h3>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Configure the active finance reviewers and keep one approver designated as the primary
          processing owner.
        </p>
      </div>

      {approvers.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">No finance approvers configured.</p>
      ) : (
        <div className="divide-y divide-zinc-100/80 dark:divide-zinc-800/80">
          {approvers.map((approver) => (
            <div
              key={approver.id}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {approver.provisionalEmail ? (
                    <span className="italic text-zinc-500 dark:text-zinc-400">
                      {approver.email}
                    </span>
                  ) : (
                    (approver.fullName ?? "—")
                  )}
                  {approver.isPrimary ? (
                    <span className="ml-2 inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                      Primary
                    </span>
                  ) : null}
                  {approver.provisionalEmail ? (
                    <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      Pending first login
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-zinc-500">{approver.email}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!approver.provisionalEmail && !approver.isPrimary ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleSetPrimary(approver.id)}
                    className="rounded-xl border border-indigo-300 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/30"
                  >
                    Set Primary
                  </button>
                ) : null}

                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleToggle(approver.id, approver.isActive)}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    approver.isActive
                      ? "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      : "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                  }`}
                >
                  {approver.isActive ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-zinc-200/80 bg-white/70 px-5 py-4 dark:border-zinc-800/80 dark:bg-zinc-950/40">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Add Finance Approver
        </p>
        <p className="mb-2 text-xs text-zinc-400 dark:text-zinc-500">
          Enter their email. If they haven&apos;t logged in yet, they&apos;ll be granted access
          automatically when they do.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            placeholder="finance@example.com"
            className="nxt-input flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          />
          <button
            type="button"
            disabled={isPending || !email.trim()}
            onClick={handleAdd}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {addError ? <p className="mt-1 text-xs text-rose-600">{addError}</p> : null}
      </div>
    </div>
  );
}
