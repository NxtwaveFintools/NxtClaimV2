import Link from "next/link";
import { CircleUser, LayoutDashboard } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";
import { ROUTES } from "@/core/config/route-registry";

type AppShellHeaderProps = {
  currentEmail?: string | null;
  actions?: React.ReactNode;
};

export function AppShellHeader({ currentEmail, actions }: AppShellHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/85 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-slate-950/88">
      <div className="mx-auto flex h-[72px] max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href={ROUTES.dashboard} className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-500 to-sky-500 text-white shadow-sm shadow-indigo-500/20 dark:border-indigo-500/30 dark:shadow-indigo-500/10">
            <LayoutDashboard className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
              Internal Finance
            </p>
            <p className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">NxtClaim V2</p>
          </div>
        </Link>

        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          {currentEmail ? (
            <div className="inline-flex max-w-full items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
              <CircleUser
                className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400"
                aria-hidden="true"
              />
              <span className="max-w-[180px] truncate sm:max-w-[240px]">{currentEmail}</span>
            </div>
          ) : null}
          <ThemeToggle />
          {actions || <SignOutButton />}
        </div>
      </div>
    </header>
  );
}
