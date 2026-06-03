import dynamic from "next/dynamic";
import { getClaimFormHydrationAction } from "@/modules/claims/actions";
import { NewClaimFormSkeleton } from "@/modules/claims/ui/new-claim-form-skeleton";
import { getUserFriendlyErrorMessage } from "@/core/errors/user-facing-errors";

const NewClaimFormClient = dynamic(
  () => import("@/modules/claims/ui/new-claim-form-client").then((mod) => mod.NewClaimFormClient),
  {
    loading: () => <NewClaimFormSkeleton />,
  },
);

export default async function NewClaimPage() {
  const hydrationResult = await getClaimFormHydrationAction();

  if (hydrationResult.errorMessage || !hydrationResult.data) {
    return (
      <main className="mx-auto w-full max-w-4xl">
        <section className="rounded-xl border border-border bg-card p-5">
          <h1 className="dashboard-font-display text-2xl font-semibold text-foreground">
            New Claim
          </h1>
          <p className="mt-3 rounded-lg border border-danger/30 bg-danger-muted px-3 py-2 text-sm text-danger">
            {getUserFriendlyErrorMessage(hydrationResult.errorMessage, "claim-submission")}
          </p>
        </section>
      </main>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] pb-20">
      <header className="mb-4 rounded-xl border border-border bg-card px-4 py-3 sm:px-5">
        <div>
          <h1 className="text-xl font-semibold leading-tight text-foreground sm:text-2xl">
            New Claim
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Submit one claim for one transaction. Review all details before submission.
          </p>
        </div>
      </header>

      <NewClaimFormClient
        currentUser={hydrationResult.data.currentUser}
        options={hydrationResult.data.options}
      />
    </div>
  );
}
