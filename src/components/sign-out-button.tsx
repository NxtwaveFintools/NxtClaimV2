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
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        isPending ? "opacity-50 cursor-not-allowed" : ""
      }`}
      style={{
        backgroundColor: "transparent",
        borderColor: "var(--border)",
        color: "var(--muted-foreground)",
      }}
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      <span>{isPending ? "Signing Out..." : "Sign Out"}</span>
    </button>
  );
}
