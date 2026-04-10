"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminRecord } from "@/core/domain/admin/contracts";
import { addAdminAction, removeAdminAction } from "@/modules/admin/actions";
import { Button } from "@/components/ui/button";

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
    <div className="overflow-hidden rounded-[26px] border border-zinc-200/80 bg-zinc-50/50 dark:border-zinc-800/80 dark:bg-zinc-950/40">
      <div className="border-b border-zinc-200/80 px-5 py-4 dark:border-zinc-800/80">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-300">
          Administrators
        </h3>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Keep privileged access intentional by limiting who can manage the admin workspace.
        </p>
      </div>

      {admins.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">No admins configured yet.</p>
      ) : (
        <div className="divide-y divide-zinc-100/80 dark:divide-zinc-800/80">
          {admins.map((admin) => (
            <div
              key={admin.id}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
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

              <div className="flex flex-wrap items-center gap-2">
                {confirmRemoveId === admin.id ? (
                  <>
                    <span className="text-xs text-zinc-500">Remove this admin?</span>
                    <Button
                      disabled={isPending}
                      onClick={() => handleRemove(admin.id)}
                      type="button"
                      variant="danger"
                      size="sm"
                    >
                      {isPending ? "Removing…" : "Confirm"}
                    </Button>
                    <Button
                      onClick={() => setConfirmRemoveId(null)}
                      type="button"
                      variant="secondary"
                      size="sm"
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => setConfirmRemoveId(admin.id)}
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/30"
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-zinc-200/80 bg-white/70 px-5 py-4 dark:border-zinc-800/80 dark:bg-zinc-950/40">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Promote user to Admin
        </p>
        <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
          Enter the user&apos;s email address. If they haven&apos;t signed in yet, they will be
          granted admin access automatically on their first login.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="email"
            placeholder="user@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="nxt-input flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900"
          />
          <Button
            disabled={isPending}
            onClick={handleAdd}
            type="button"
            variant="primary"
            size="md"
          >
            Promote
          </Button>
        </div>
        {addError ? <p className="mt-1 text-xs text-rose-600">{addError}</p> : null}
      </div>
    </div>
  );
}
