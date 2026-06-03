"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DepartmentWithActors } from "@/core/domain/admin/contracts";
import { updateDepartmentActorsByEmailAction } from "@/modules/admin/actions";
import { AddDepartmentForm } from "@/modules/admin/ui/add-department-form";
import { Button } from "@/components/ui/button";

type Props = {
  departments: DepartmentWithActors[];
};

export function DepartmentsManagement({ departments }: Props) {
  return (
    <div className="space-y-4">
      <AddDepartmentForm />

      {departments.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          No departments found.
        </p>
      ) : (
        departments.map((dept) => <DepartmentActorRow key={dept.id} department={dept} />)
      )}
    </div>
  );
}

function DepartmentActorRow({ department }: { department: DepartmentWithActors }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [approver1Email, setApprover1Email] = useState(
    department.approver1Email ?? department.approver1ProvisionalEmail ?? "",
  );
  const [approver2Email, setApprover2Email] = useState(
    department.approver2Email ?? department.approver2ProvisionalEmail ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateDepartmentActorsByEmailAction(
        department.id,
        approver1Email,
        approver2Email,
      );
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.message ?? "We couldn't save these settings. Please review and try again.");
      }
    });
  }

  const approver1IsPending =
    !department.approver1Id && Boolean(department.approver1ProvisionalEmail);
  const approver2IsPending =
    !department.approver2Id && Boolean(department.approver2ProvisionalEmail);

  return (
    <div className="rounded-[26px] border border-border/80 bg-background-secondary/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-base font-semibold text-foreground">{department.name}</span>
          {!department.isActive ? (
            <span className="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              Inactive
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Approver 1
            {approver1IsPending ? (
              <span className="inline-flex items-center rounded-full bg-warning-muted px-2 py-0.5 text-xs font-semibold text-warning">
                Pending first login
              </span>
            ) : null}
          </label>
          <input
            type="email"
            value={approver1Email}
            onChange={(e) => {
              setApprover1Email(e.target.value);
              setSaved(false);
            }}
            placeholder="approver1@company.com"
            className="nxt-input w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none"
          />
        </div>

        <div>
          <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Approver 2
            {approver2IsPending ? (
              <span className="inline-flex items-center rounded-full bg-warning-muted px-2 py-0.5 text-xs font-semibold text-warning">
                Pending first login
              </span>
            ) : null}
          </label>
          <input
            type="email"
            value={approver2Email}
            onChange={(e) => {
              setApprover2Email(e.target.value);
              setSaved(false);
            }}
            placeholder="approver2@company.com"
            className="nxt-input w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          disabled={isPending || !approver1Email || !approver2Email}
          onClick={handleSave}
          type="button"
          variant="primary"
          size="md"
        >
          {isPending ? "Saving…" : "Save Approvers"}
        </Button>
        {saved ? <span className="text-xs font-semibold text-success">Saved ✓</span> : null}
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
