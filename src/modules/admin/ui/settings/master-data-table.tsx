"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MasterDataItem, MasterDataTableName } from "@/core/domain/admin/contracts";
import { createMasterDataItemAction, updateMasterDataItemAction } from "@/modules/admin/actions";
import { Button } from "@/components/ui/button";

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
    <div className="overflow-hidden rounded-[26px] border border-zinc-200/80 bg-zinc-50/50 dark:border-zinc-800/80 dark:bg-zinc-950/40">
      <div className="border-b border-zinc-200/80 px-5 py-4 dark:border-zinc-800/80">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-300">
          {displayName}
        </h3>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Active items stay visible in claim forms. Retired items remain intact for historical
          records and reporting.
        </p>
      </div>

      <div className="divide-y divide-zinc-100/80 dark:divide-zinc-800/80">
        {items.length === 0 ? (
          <p className="px-5 py-10 text-sm text-zinc-500 dark:text-zinc-400">No items yet.</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              {editingId === item.id ? (
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRename(item.id)}
                  className="nxt-input flex-1 rounded-xl border border-indigo-400 bg-white px-3 py-2 text-sm outline-none dark:border-indigo-500 dark:bg-zinc-900"
                  autoFocus
                />
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={`min-w-0 truncate text-sm font-medium ${
                      item.isActive
                        ? "text-zinc-800 dark:text-zinc-200"
                        : "text-zinc-400 line-through dark:text-zinc-500"
                    }`}
                  >
                    {item.name}
                  </span>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      item.isActive
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {item.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {editingId === item.id ? (
                  <>
                    <Button
                      disabled={isPending}
                      onClick={() => handleRename(item.id)}
                      type="button"
                      variant="primary"
                      size="sm"
                    >
                      Save
                    </Button>
                    <Button
                      onClick={() => setEditingId(null)}
                      type="button"
                      variant="secondary"
                      size="sm"
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    disabled={isPending}
                    onClick={() => {
                      setEditingId(item.id);
                      setEditName(item.name);
                    }}
                    type="button"
                    variant="secondary"
                    size="sm"
                  >
                    Rename
                  </Button>
                )}

                <Button
                  disabled={isPending}
                  onClick={() => handleToggleActive(item)}
                  type="button"
                  size="sm"
                  variant="secondary"
                  className={
                    item.isActive
                      ? undefined
                      : "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                  }
                >
                  {item.isActive ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-zinc-200/80 bg-white/70 px-5 py-4 dark:border-zinc-800/80 dark:bg-zinc-950/40">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder={`Add new ${displayName.toLowerCase()} name…`}
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
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
            Add
          </Button>
        </div>
        {addError ? <p className="mt-1 text-xs text-rose-600">{addError}</p> : null}
      </div>
    </div>
  );
}
