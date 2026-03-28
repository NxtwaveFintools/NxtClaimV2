"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminUserRecord } from "@/core/domain/admin/contracts";
import { USER_ROLES } from "@/core/constants/auth";
import { updateUserRoleAction } from "@/modules/admin/actions";

type Props = {
  users: AdminUserRecord[];
  hasNextPage: boolean;
  nextCursor: string | null;
  hasPreviousPage: boolean;
  previousCursor: string | null;
};

const ROLE_OPTIONS = [
  { value: USER_ROLES.employee, label: "Employee" },
  { value: USER_ROLES.hod, label: "HOD" },
  { value: USER_ROLES.founder, label: "Founder" },
  { value: USER_ROLES.finance, label: "Finance" },
];

export function UsersManagement({
  users,
  hasNextPage,
  nextCursor,
  hasPreviousPage,
  previousCursor,
}: Props) {
  const router = useRouter();

  function buildHref(cursor: string | null, prevCursor: string | null): string {
    const params = new URLSearchParams();
    params.set("tab", "users");
    if (cursor) params.set("cursor", cursor);
    if (prevCursor) params.set("prevCursor", prevCursor);
    return `?${params.toString()}`;
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-700 dark:text-zinc-300">
          Users &amp; Roles
        </h3>
      </div>

      {users.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">No users found.</p>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {users.map((user) => (
            <UserRoleRow key={user.id} user={user} onUpdated={() => router.refresh()} />
          ))}
        </div>
      )}

      {hasPreviousPage || hasNextPage ? (
        <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <a
            href={
              hasPreviousPage && previousCursor
                ? buildHref(previousCursor === "__first__" ? null : previousCursor, null)
                : "#"
            }
            aria-disabled={!hasPreviousPage}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
              hasPreviousPage
                ? "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                : "cursor-not-allowed border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600"
            }`}
          >
            Previous
          </a>
          <a
            href={hasNextPage && nextCursor ? buildHref(nextCursor, null) : "#"}
            aria-disabled={!hasNextPage}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
              hasNextPage
                ? "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                : "cursor-not-allowed border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600"
            }`}
          >
            Next
          </a>
        </div>
      ) : null}
    </div>
  );
}

function UserRoleRow({ user, onUpdated }: { user: AdminUserRecord; onUpdated: () => void }) {
  const [isPending, startTransition] = useTransition();

  function handleRoleChange(newRole: string) {
    startTransition(async () => {
      await updateUserRoleAction(user.id, newRole);
      onUpdated();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <div>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {user.fullName ?? "—"}
        </p>
        <p className="text-xs text-zinc-500">{user.email}</p>
      </div>

      <select
        value={user.role}
        disabled={isPending}
        onChange={(e) => handleRoleChange(e.target.value)}
        className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-800 outline-none transition-colors focus:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:focus:border-indigo-500"
      >
        {ROLE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
