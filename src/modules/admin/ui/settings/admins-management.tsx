"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminRecord } from "@/core/domain/admin/contracts";
import { addAdminAction, removeAdminAction } from "@/modules/admin/actions";

type Props = {
  admins: AdminRecord[];
};

export function AdminsManagement({ admins }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newEmail, setNewEmail] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  function handleAdd() {
    const email = newEmail.trim();
    if (!email) {
      setAddError("Email is required.");
      return;
    }
    setAddError(null);
    startTransition(async () => {
      const result = await addAdminAction(email);
      if (result.ok) {
        setNewEmail("");
        router.refresh();
      } else {
        setAddError(result.message ?? "Failed to add admin.");
      }
    });
  }

  function handleRemove(adminId: string) {
    startTransition(async () => {
      await removeAdminAction(adminId);
      setConfirmRemoveId(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-300">
          Administrators
        </h3>
      </div>

      {admins.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">No admins configured yet.</p>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {admins.map((admin) => (
            <div
              key={admin.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {admin.fullName ?? (admin.provisionalEmail ? "Pending first login" : "—")}
                </p>
                <p className="text-xs text-zinc-500">{admin.email}</p>
                {admin.provisionalEmail ? (
                  <span className="mt-0.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    Pending login
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                {confirmRemoveId === admin.id ? (
                  <>
                    <span className="text-xs text-zinc-500">Remove this admin?</span>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleRemove(admin.id)}
                      className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                    >
                      {isPending ? "Removing…" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveId(null)}
                      className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveId(admin.id)}
                    className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/30"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Promote user to Admin
        </p>
        <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
          Enter the user&apos;s email address. If they haven&apos;t signed in yet, they will be
          granted admin access automatically on their first login.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="email"
            placeholder="user@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm outline-none transition-colors focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-indigo-500"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={handleAdd}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Promote
          </button>
        </div>
        {addError ? <p className="mt-1 text-xs text-rose-600">{addError}</p> : null}
      </div>
    </div>
  );
}
