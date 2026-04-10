"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DepartmentViewerAdminRecord } from "@/core/domain/admin/contracts";
import { addDepartmentViewerAction, removeDepartmentViewerAction } from "@/modules/admin/actions";
import { Button } from "@/components/ui/button";

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
      <div className="overflow-hidden rounded-[26px] border border-zinc-200/80 bg-zinc-50/50 dark:border-zinc-800/80 dark:bg-zinc-950/40">
        <div className="border-b border-zinc-200/80 px-5 py-4 dark:border-zinc-800/80">
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
          <div className="divide-y divide-zinc-100/80 dark:divide-zinc-800/80">
            {deptsWithViewers.map((dept) => {
              const deptViewers = viewersByDept.get(dept.id) ?? [];
              return (
                <div key={dept.id} className="px-5 py-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {dept.name}
                  </p>
                  <div className="space-y-1.5">
                    {deptViewers.map((viewer) => (
                      <div
                        key={viewer.id}
                        className="flex flex-col gap-3 rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-3 dark:border-zinc-800/80 dark:bg-zinc-900/70 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {viewer.fullName ?? "—"}
                          </p>
                          <p className="text-xs text-zinc-500">{viewer.email}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {confirmRemoveId === viewer.id ? (
                            <>
                              <span className="text-xs text-zinc-500">Remove?</span>
                              <Button
                                disabled={isPending}
                                onClick={() => handleRemove(viewer.id)}
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
                              onClick={() => setConfirmRemoveId(viewer.id)}
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
                </div>
              );
            })}
          </div>
        )}

        {/* Add new viewer */}
        <div className="border-t border-zinc-200/80 bg-white/70 px-5 py-4 dark:border-zinc-800/80 dark:bg-zinc-950/40">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Assign a Department Viewer
          </p>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            Select a department and enter the user&apos;s email. The user must have signed in at
            least once.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <select
              value={selectedDeptId}
              onChange={(e) => setSelectedDeptId(e.target.value)}
              className="nxt-input rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900"
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
              className="nxt-input flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-900"
            />
            <Button
              disabled={isPending || !selectedDeptId || !email.trim()}
              onClick={handleAdd}
              type="button"
              variant="primary"
              size="md"
            >
              Assign
            </Button>
          </div>
          {addError ? <p className="mt-1 text-xs text-rose-600">{addError}</p> : null}
        </div>
      </div>
    </div>
  );
}
