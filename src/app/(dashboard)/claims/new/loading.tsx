import { PageHeaderSkeleton } from "@/components/ui/skeleton";
import { NewClaimFormSkeleton } from "@/modules/claims/ui/new-claim-form-skeleton";

export default function NewClaimLoading() {
  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-4 pb-20">
      <header className="rounded-xl border border-border bg-card px-4 py-3 sm:px-5">
        <PageHeaderSkeleton actions={0} />
      </header>
      <NewClaimFormSkeleton />
    </div>
  );
}
