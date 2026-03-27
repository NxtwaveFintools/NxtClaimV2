import Link from "next/link";
import { redirect } from "next/navigation";
import { ROUTES } from "@/core/config/route-registry";
import { ThemeToggle } from "@/components/theme-toggle";
import { logger } from "@/core/infra/logging/logger";
import { GetWalletSummaryService } from "@/core/domain/dashboard/GetWalletSummaryService";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";
import { SupabaseDashboardRepository } from "@/modules/dashboard/repositories/SupabaseDashboardRepository";
import { WalletSummary } from "@/modules/dashboard/ui/wallet-summary";

const authRepository = new SupabaseServerAuthRepository();
const dashboardRepository = new SupabaseDashboardRepository();
const getWalletSummaryService = new GetWalletSummaryService({
  repository: dashboardRepository,
  logger,
});

async function logoutDashboardAction(): Promise<void> {
  "use server";

  await authRepository.signOut();
  redirect(ROUTES.login);
}

export default async function DashboardPage() {
  const currentUserResult = await authRepository.getCurrentUser();
  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    redirect(ROUTES.login);
  }

  const walletResult = await getWalletSummaryService.execute(currentUserResult.user.id);
  const walletSummary = walletResult.data ?? GetWalletSummaryService.empty();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-6 py-10 dark:from-[#0B0F1A] dark:via-[#111827] dark:to-[#0B0F1A]">
      <main className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5 transition-colors dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400">
              NxtClaim V2
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-slate-900 dark:text-slate-100">
              Dashboard
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Authenticated as {currentUserResult.user.email ?? "Unknown User"}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex max-w-[220px] items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {currentUserResult.user.email ?? "Unknown User"}
            </span>
            <ThemeToggle />
            <form action={logoutDashboardAction}>
              <button
                type="submit"
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-slate-700 active:scale-[0.98] dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        {walletResult.errorMessage ? (
          <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            Unable to load wallet summary. {walletResult.errorMessage}
          </p>
        ) : null}

        <WalletSummary summary={walletSummary} />

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={ROUTES.claims.new}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98]"
          >
            New Claim
          </Link>

          <Link
            href={ROUTES.claims.myClaims}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98]"
          >
            My Claims
          </Link>
        </div>
      </main>
    </div>
  );
}
