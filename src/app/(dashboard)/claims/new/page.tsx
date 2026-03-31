import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { getClaimFormHydrationAction } from "@/modules/claims/actions";
import { AppShellHeader } from "@/components/app-shell-header";
import { BackButton } from "@/components/ui/back-button";
import { NewClaimFormClient } from "@/modules/claims/ui/new-claim-form-client";
import { ROUTES } from "@/core/config/route-registry";

const pageBodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-dashboard-inter",
});

const pageDisplayFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-dashboard-display",
});

export default async function NewClaimPage() {
  const hydrationResult = await getClaimFormHydrationAction();
  const currentEmail = hydrationResult.data?.currentUser.email;

  return (
    <div
      className={`${pageBodyFont.variable} ${pageDisplayFont.variable} dashboard-font-body nxt-page-bg`}
    >
      {/* ── Navbar ── */}
      <AppShellHeader currentEmail={currentEmail} />

      {/* ── Page content ── */}
      <div className="relative z-0 mx-auto w-full max-w-[1400px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        {/* ── Back button — outside the card ── */}
        <BackButton className="mb-4" fallbackHref={ROUTES.claims.myClaims} />

        {/* ── Page header ── */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-indigo-600 dark:text-indigo-400">
              NxtClaim V2
            </p>
            <h1 className="dashboard-font-display mt-1.5 text-2xl font-bold tracking-[-0.03em] text-zinc-950 sm:text-3xl dark:text-zinc-50">
              New Claim
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Submit one claim for one transaction. Draft saving is disabled.
            </p>
          </div>
        </div>

        {/* ── Error state ── */}
        {hydrationResult.errorMessage || !hydrationResult.data ? (
          <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white/90 p-6 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/90">
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
              Unable to load claim form data. {hydrationResult.errorMessage ?? "Unknown error."}
            </p>
          </div>
        ) : (
          /* ── Form card ── */
          <div className="overflow-hidden rounded-2xl border border-zinc-200/70 bg-white/88 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12),0_4px_16px_-4px_rgba(99,102,241,0.04)] backdrop-blur-lg transition-all dark:border-zinc-800/80 dark:bg-zinc-900/88 dark:shadow-[0_20px_60px_-20px_rgba(0,0,0,0.40)]">
            {/* Coloured top accent stripe */}
            <div className="h-0.5 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500" />

            <div className="p-4 sm:p-6">
              <NewClaimFormClient
                currentUser={hydrationResult.data.currentUser}
                options={hydrationResult.data.options}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
