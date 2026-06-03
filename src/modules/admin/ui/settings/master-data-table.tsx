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
        setAddError(
          result.message ?? "We couldn't save these settings. Please review and try again.",
        );
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
    <div className="overflow-hidden rounded-[26px] border border-border/80 bg-background-secondary/50">
      <div className="border-b border-border/80 px-5 py-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-foreground">
          {displayName}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Active items stay visible in claim forms. Retired items remain intact for historical
          records and reporting.
        </p>
      </div>

      <div className="divide-y divide-zinc-100/80 dark:divide-zinc-800/80">
        {items.length === 0 ? (
          <p className="px-5 py-10 text-sm text-muted-foreground">No items yet.</p>
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
                  className="nxt-input flex-1 rounded-lg border border-accent bg-card px-3 py-2 text-sm outline-none"
                  autoFocus
                />
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={`min-w-0 truncate text-sm font-medium ${
                      item.isActive ? "text-foreground" : "text-muted-foreground line-through"
                    }`}
                  >
                    {item.name}
                  </span>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      item.isActive
                        ? "bg-success-muted text-success"
                        : "bg-background-secondary text-muted-foreground"
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
                    item.isActive ? undefined : "border-success/40 text-success hover:bg-success/10"
                  }
                >
                  {item.isActive ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border/80 bg-card/70 px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder={`Add new ${displayName.toLowerCase()} name…`}
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
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
            Add
          </Button>
        </div>
        {addError ? <p className="mt-1 text-xs text-danger">{addError}</p> : null}
      </div>
    </div>
  );
}
