import Link from "next/link";
import { ROUTES } from "@/core/config/route-registry";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-b from-zinc-50 via-white to-zinc-100 px-6 py-10 dark:from-[#0B0F1A] dark:via-[#111827] dark:to-[#0B0F1A]">
      <main className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-xl shadow-zinc-900/5 transition-colors dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/30">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400">
          NxtClaim V2
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
          Page Not Found
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          The page you are looking for does not exist or has moved.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href={ROUTES.dashboard}
            className="inline-flex rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98]"
          >
            Go to Dashboard
          </Link>
          <Link
            href={ROUTES.claims.myClaims}
            className="inline-flex rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition-all duration-200 hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            My Claims
          </Link>
        </div>
      </main>
    </div>
  );
}
