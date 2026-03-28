"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DepartmentWithActors } from "@/core/domain/admin/contracts";
import { updateDepartmentActorsByEmailAction } from "@/modules/admin/actions";

type Props = {
  departments: DepartmentWithActors[];
};

export function DepartmentsManagement({ departments }: Props) {
  if (departments.length === 0) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        No departments found.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {departments.map((dept) => (
        <DepartmentActorRow key={dept.id} department={dept} />
      ))}
    </div>
  );
}

function DepartmentActorRow({ department }: { department: DepartmentWithActors }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Pre-fill from existing linked email or provisional email
  const [hodEmail, setHodEmail] = useState(
    department.hodUserEmail ?? department.hodProvisionalEmail ?? "",
  );
  const [founderEmail, setFounderEmail] = useState(
    department.founderUserEmail ?? department.founderProvisionalEmail ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateDepartmentActorsByEmailAction(
        department.id,
        hodEmail,
        founderEmail,
      );
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.message ?? "Failed to update.");
      }
    });
  }

  const hodIsPending = !department.hodUserId && Boolean(department.hodProvisionalEmail);
  const founderIsPending = !department.founderUserId && Boolean(department.founderProvisionalEmail);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {department.name}
          </span>
          {!department.isActive ? (
            <span className="ml-2 inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              Inactive
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            HOD
            {hodIsPending ? (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Pending first login
              </span>
            ) : null}
          </label>
          <input
            type="email"
            value={hodEmail}
            onChange={(e) => {
              setHodEmail(e.target.value);
              setSaved(false);
            }}
            placeholder="hod@company.com"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 outline-none transition-colors focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:focus:border-indigo-500"
          />
        </div>

        <div>
          <label className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Founder
            {founderIsPending ? (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Pending first login
              </span>
            ) : null}
          </label>
          <input
            type="email"
            value={founderEmail}
            onChange={(e) => {
              setFounderEmail(e.target.value);
              setSaved(false);
            }}
            placeholder="founder@company.com"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 outline-none transition-colors focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:focus:border-indigo-500"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={isPending || !hodEmail || !founderEmail}
          onClick={handleSave}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save Actors"}
        </button>
        {saved ? (
          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            Saved ✓
          </span>
        ) : null}
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      </div>
    </div>
  );
}
