import { getClaimFormHydrationAction } from "@/modules/claims/actions";
import { BackButton } from "@/components/ui/back-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { NewClaimFormClient } from "@/modules/claims/ui/new-claim-form-client";
import { ROUTES } from "@/core/config/route-registry";

export default async function NewClaimPage() {
  const hydrationResult = await getClaimFormHydrationAction();

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 dark:bg-[#0B0F1A]">
      <main className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-900">
        <BackButton className="mb-3" fallbackHref={ROUTES.claims.myClaims} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400">
              NxtClaim V2
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
              New Claim
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Submit one claim for one transaction. Draft saving is disabled.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hydrationResult.data ? (
              <span className="inline-flex max-w-[220px] items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                {hydrationResult.data.currentUser.email}
              </span>
            ) : null}
            <ThemeToggle />
          </div>
        </div>

        {hydrationResult.errorMessage || !hydrationResult.data ? (
          <p className="mt-6 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            Unable to load claim form data. {hydrationResult.errorMessage ?? "Unknown error."}
          </p>
        ) : (
          <div className="mt-6">
            <NewClaimFormClient
              currentUser={hydrationResult.data.currentUser}
              options={hydrationResult.data.options}
            />
          </div>
        )}
      </main>
    </div>
  );
}
