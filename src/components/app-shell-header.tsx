import Link from "next/link";
import { CircleUser } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";
import { ROUTES } from "@/core/config/route-registry";

function NxtClaimLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="8" y="8" width="23" height="29" rx="4.5" fill="white" fillOpacity="0.14" />
      <rect x="11" y="5" width="23" height="29" rx="4.5" fill="white" fillOpacity="0.94" />
      <rect x="16" y="11" width="13" height="2.5" rx="1.25" fill="#4F46E5" fillOpacity="0.65" />
      <rect x="16" y="16.5" width="9" height="1.8" rx="0.9" fill="#4F46E5" fillOpacity="0.35" />
      <rect x="16" y="20.5" width="11" height="1.8" rx="0.9" fill="#4F46E5" fillOpacity="0.35" />
      <rect x="16" y="24.5" width="7" height="1.8" rx="0.9" fill="#4F46E5" fillOpacity="0.25" />
      <circle cx="35" cy="35" r="9" fill="#10B981" />
      <path
        d="M31 35L34 38L39 31.5"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type AppShellHeaderProps = {
  currentEmail?: string | null;
  actions?: React.ReactNode;
};

export function AppShellHeader({ currentEmail, actions }: AppShellHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/85 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-slate-950/88">
      <div className="mx-auto flex h-18 max-w-400 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href={ROUTES.dashboard} className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-indigo-200 bg-linear-to-br from-indigo-500 to-sky-500 shadow-sm shadow-indigo-500/20 dark:border-indigo-500/30 dark:shadow-indigo-500/10">
            <NxtClaimLogo className="h-7 w-7" />
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
              <span className="max-w-45 truncate sm:max-w-60">{currentEmail}</span>
            </div>
          ) : null}
          <ThemeToggle />
          {actions || <SignOutButton />}
        </div>
      </div>
    </header>
  );
}
