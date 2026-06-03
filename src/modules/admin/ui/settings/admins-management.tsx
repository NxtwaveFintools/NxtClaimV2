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
        setAddError(result.message ?? "We couldn't update administrator access. Please try again.");
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
    <div className="overflow-hidden rounded-[26px] border border-border/80 bg-background-secondary/50">
      <div className="border-b border-border/80 px-5 py-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-foreground">
          Administrators
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Keep privileged access intentional by limiting who can manage the admin workspace.
        </p>
      </div>

      {admins.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">No admins configured yet.</p>
      ) : (
        <div className="divide-y divide-zinc-100/80 dark:divide-zinc-800/80">
          {admins.map((admin) => (
            <div
              key={admin.id}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-medium text-foreground">
                  {admin.fullName ?? (admin.provisionalEmail ? "Pending first login" : "—")}
                </p>
                <p className="text-xs text-muted-foreground">{admin.email}</p>
                {admin.provisionalEmail ? (
                  <span className="mt-0.5 inline-block rounded-full bg-warning-muted px-2 py-0.5 text-[10px] font-semibold text-warning">
                    Pending login
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {confirmRemoveId === admin.id ? (
                  <>
                    <span className="text-xs text-muted-foreground">Remove this admin?</span>
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
                    className="border-danger/40 text-danger hover:bg-danger/10"
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-border/80 bg-card/70 px-5 py-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Promote user to Admin
        </p>
        <p className="mb-2 text-xs text-muted-foreground">
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
            className="nxt-input flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
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
        {addError ? <p className="mt-1 text-xs text-danger">{addError}</p> : null}
      </div>
    </div>
  );
}
