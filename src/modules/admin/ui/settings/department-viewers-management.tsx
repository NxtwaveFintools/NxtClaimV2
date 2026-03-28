"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DepartmentViewerAdminRecord } from "@/core/domain/admin/contracts";
import { addDepartmentViewerAction, removeDepartmentViewerAction } from "@/modules/admin/actions";

type Department = { id: string; name: string };

type Props = {
  viewers: DepartmentViewerAdminRecord[];
  departments: Department[];
};

export function DepartmentViewersManagement({ viewers, departments }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedDeptId, setSelectedDeptId] = useState("");
  const [email, setEmail] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  // Group viewers by department
  const viewersByDept = new Map<string, DepartmentViewerAdminRecord[]>();
  for (const v of viewers.filter((v) => v.isActive)) {
    const existing = viewersByDept.get(v.departmentId) ?? [];
    existing.push(v);
    viewersByDept.set(v.departmentId, existing);
  }

  function handleAdd() {
    const trimmedEmail = email.trim();
    if (!selectedDeptId) {
      setAddError("Please select a department.");
      return;
    }
    if (!trimmedEmail) {
      setAddError("Please enter an email address.");
      return;
    }
    setAddError(null);
    startTransition(async () => {
      const result = await addDepartmentViewerAction(selectedDeptId, trimmedEmail);
      if (result.ok) {
        setEmail("");
        router.refresh();
      } else {
        setAddError(result.message ?? "Failed to add viewer.");
      }
    });
  }

  function handleRemove(viewerId: string) {
    startTransition(async () => {
      await removeDepartmentViewerAction(viewerId);
      setConfirmRemoveId(null);
      router.refresh();
    });
  }

  // Departments that have viewers
  const deptsWithViewers = departments.filter((d) => viewersByDept.has(d.id));

  return (
    <div className="space-y-6">
      {/* Existing viewers grouped by department */}
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-300">
            Department Viewers (POC)
          </h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Users assigned as viewers can see all claims for their assigned departments (read-only).
          </p>
        </div>

        {deptsWithViewers.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500">No department viewers assigned yet.</p>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {deptsWithViewers.map((dept) => {
              const deptViewers = viewersByDept.get(dept.id) ?? [];
              return (
                <div key={dept.id} className="px-4 py-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {dept.name}
                  </p>
                  <div className="space-y-1.5">
                    {deptViewers.map((viewer) => (
                      <div
                        key={viewer.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50"
                      >
                        <div>
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {viewer.fullName ?? "—"}
                          </p>
                          <p className="text-xs text-zinc-500">{viewer.email}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          {confirmRemoveId === viewer.id ? (
                            <>
                              <span className="text-xs text-zinc-500">Remove?</span>
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => handleRemove(viewer.id)}
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
                              onClick={() => setConfirmRemoveId(viewer.id)}
                              className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/30"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add new viewer */}
        <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Assign a Department Viewer
          </p>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            Select a department and enter the user&apos;s email. The user must have signed in at
            least once.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedDeptId}
              onChange={(e) => setSelectedDeptId(e.target.value)}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm outline-none transition-colors focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-indigo-500"
            >
              <option value="">Select department…</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </select>
            <input
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className="flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm outline-none transition-colors focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-indigo-500"
            />
            <button
              type="button"
              disabled={isPending || !selectedDeptId || !email.trim()}
              onClick={handleAdd}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Assign
            </button>
          </div>
          {addError ? <p className="mt-1 text-xs text-rose-600">{addError}</p> : null}
        </div>
      </div>
    </div>
  );
}
