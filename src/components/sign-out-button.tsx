"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { logoutAction } from "@/modules/auth/actions";
import { ROUTES } from "@/core/config/route-registry";

export function SignOutButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        startTransition(async () => {
          await logoutAction();
          router.push(ROUTES.login);
        });
      }}
      disabled={isPending}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 ${
        isPending ? "opacity-50 cursor-not-allowed" : ""
      }`}
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      <span>{isPending ? "Signing Out..." : "Sign Out"}</span>
    </button>
  );
}
