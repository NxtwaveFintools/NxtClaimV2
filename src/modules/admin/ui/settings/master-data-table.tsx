"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MasterDataItem, MasterDataTableName } from "@/core/domain/admin/contracts";
import { createMasterDataItemAction, updateMasterDataItemAction } from "@/modules/admin/actions";

type Props = {
  tableName: MasterDataTableName;
  displayName: string;
  items: MasterDataItem[];
};

export function MasterDataTable({ tableName, displayName, items }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [addName, setAddName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  function handleAdd() {
    const name = addName.trim();
    if (!name) {
      setAddError("Name is required.");
      return;
    }
    setAddError(null);
    startTransition(async () => {
      const result = await createMasterDataItemAction(tableName, name);
      if (result.ok) {
        setAddName("");
        router.refresh();
      } else {
        setAddError(result.message ?? "Failed to create item.");
      }
    });
  }

  function handleRename(id: string) {
    const name = editName.trim();
    if (!name) return;
    startTransition(async () => {
      const result = await updateMasterDataItemAction(tableName, id, { name });
      if (result.ok) {
        setEditingId(null);
        setEditName("");
        router.refresh();
      }
    });
  }

  function handleToggleActive(item: MasterDataItem) {
    startTransition(async () => {
      await updateMasterDataItemAction(tableName, item.id, { isActive: !item.isActive });
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-300">
          {displayName}
        </h3>
      </div>

      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500">No items yet.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              {editingId === item.id ? (
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRename(item.id)}
                  className="flex-1 rounded-lg border border-indigo-400 px-2 py-1 text-sm outline-none dark:border-indigo-500 dark:bg-zinc-800"
                  autoFocus
                />
              ) : (
                <span
                  className={`flex-1 text-sm ${
                    item.isActive
                      ? "text-zinc-800 dark:text-zinc-200"
                      : "text-zinc-400 line-through dark:text-zinc-500"
                  }`}
                >
                  {item.name}
                </span>
              )}

              <div className="flex items-center gap-2">
                {editingId === item.id ? (
                  <>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleRename(item.id)}
                      className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => {
                      setEditingId(item.id);
                      setEditName(item.name);
                    }}
                    className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Rename
                  </button>
                )}

                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleToggleActive(item)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    item.isActive
                      ? "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      : "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                  }`}
                >
                  {item.isActive ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder={`Add new ${displayName.toLowerCase()} name…`}
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm outline-none transition-colors focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-800 dark:focus:border-indigo-500"
          />
          <button
            type="button"
            disabled={isPending}
            onClick={handleAdd}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {addError ? <p className="mt-1 text-xs text-rose-600">{addError}</p> : null}
      </div>
    </div>
  );
}
