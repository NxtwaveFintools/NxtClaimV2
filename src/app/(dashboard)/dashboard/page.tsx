import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CalendarDays, CirclePlus, FileText, Settings } from "lucide-react";
import { ROUTES } from "@/core/config/route-registry";
import { RouterLink } from "@/components/ui/router-link";
import { logger } from "@/core/infra/logging/logger";
import { GetWalletSummaryService } from "@/core/domain/dashboard/GetWalletSummaryService";
import { GetMyClaimsPaginatedService } from "@/core/domain/claims/GetMyClaimsPaginatedService";
import { SupabaseDashboardRepository } from "@/modules/dashboard/repositories/SupabaseDashboardRepository";
import { WalletSummary } from "@/modules/dashboard/ui/wallet-summary";
import { RecentClaims, type RecentClaimRecord } from "@/modules/dashboard/ui/recent-claims";
import { DashboardSummarySkeleton, PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";
import { isAdmin } from "@/modules/admin/server/is-admin";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";
import { formatDate } from "@/lib/format";
import { getUserFirstName } from "@/lib/user-name";
import { getUserFriendlyErrorMessage } from "@/core/errors/user-facing-errors";

export const dynamic = "force-dynamic";

const dashboardRepository = new SupabaseDashboardRepository();
const getWalletSummaryService = new GetWalletSummaryService({
  repository: dashboardRepository,
  logger,
});
const claimRepository = new SupabaseClaimRepository();
const getMyClaimsPaginatedService = new GetMyClaimsPaginatedService({
  repository: claimRepository,
  logger,
});

const indiaHourFormatter = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  hour12: false,
  timeZone: "Asia/Kolkata",
});

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <PageHeaderSkeleton actions={2} />
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <DashboardSummarySkeleton cards={3} />
      </div>
      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="grid gap-3 p-4 md:hidden">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={`dashboard-recent-mobile-${index}`} className="h-24 w-full" />
          ))}
        </div>
        <div className="hidden p-4 md:block">
          <div className="grid grid-cols-6 gap-3">
            {Array.from({ length: 18 }).map((_, index) => (
              <Skeleton key={`dashboard-recent-table-${index}`} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

async function DashboardPageContent({
  userId,
  userEmail,
  isAdminUser,
  greeting,
  currentDateLabel,
}: {
  userId: string;
  userEmail: string;
  isAdminUser: boolean;
  greeting: string;
  currentDateLabel: string;
}) {
  const [walletResult, recentClaimsResult] = await Promise.all([
    getWalletSummaryService.execute(userId),
    getMyClaimsPaginatedService.execute({
      userId,
      cursor: null,
      limit: 5,
    }),
  ]);
  const walletSummary = walletResult.data ?? GetWalletSummaryService.empty();
  const recentClaims: RecentClaimRecord[] = recentClaimsResult.data.map((claim) => ({
    id: claim.id,
    claimId: claim.id,
    date: claim.submittedAt,
    category: claim.categoryName ?? claim.typeOfClaim ?? "Claim",
    amount: claim.totalAmount,
    status: claim.status,
  }));

  return (
    <>
      <section className="mb-4">
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--foreground)" }}>
          {greeting}, {getUserFirstName(userEmail)}
        </h1>

        <p
          className="mt-1"
          style={{
            fontSize: 15,
            fontWeight: 400,
            color: "var(--muted-foreground)",
          }}
        >
          Manage submissions, approvals, and payment progress from a single finance workspace with a
          cleaner, more focused review surface.
        </p>

        <div className="mt-2 flex items-center gap-1.5">
          <CalendarDays
            className="h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
            style={{ color: "var(--muted-foreground)" }}
          />
          <span style={{ fontSize: 14, color: "var(--muted-foreground)" }}>{currentDateLabel}</span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={ROUTES.claims.new}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-4 font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: "var(--accent)", fontSize: 14 }}
          >
            <CirclePlus className="h-3.5 w-3.5" aria-hidden="true" />
            New Claim
          </Link>

          <RouterLink
            href={ROUTES.claims.myClaims}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-4 font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            style={{
              backgroundColor: "transparent",
              borderColor: "var(--border)",
              color: "var(--muted-foreground)",
              fontSize: 14,
            }}
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            Claims
          </RouterLink>

          {isAdminUser ? (
            <Link
              href={ROUTES.admin.settings}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-4 font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              style={{
                backgroundColor: "transparent",
                borderColor: "var(--border)",
                color: "var(--muted-foreground)",
                fontSize: 14,
              }}
            >
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              System Settings
            </Link>
          ) : null}
        </div>
      </section>

      {walletResult.errorMessage ? (
        <p
          className="mb-4 rounded-md border px-4 py-3"
          style={{
            borderColor: "#fecaca",
            backgroundColor: "#fef2f2",
            color: "#b91c1c",
            fontSize: 15,
          }}
        >
          {getUserFriendlyErrorMessage(walletResult.errorMessage, "analytics")}
        </p>
      ) : null}

      <WalletSummary summary={walletSummary} />

      <div className="mt-6">
        <RecentClaims claims={recentClaims} errorMessage={recentClaimsResult.errorMessage} />
      </div>
    </>
  );
}

export default async function DashboardPage() {
  const [currentUserResult, isAdminUser] = await Promise.all([getCachedCurrentUser(), isAdmin()]);

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    redirect(ROUTES.login);
  }

  const userId = currentUserResult.user.id;
  const userEmail = currentUserResult.user.email ?? "Unknown User";

  const currentDate = new Date();
  const currentHour = Number(indiaHourFormatter.format(currentDate));
  const greeting =
    currentHour < 12 ? "Good morning" : currentHour < 18 ? "Good afternoon" : "Good evening";
  const currentDateLabel = formatDate(currentDate);

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardPageContent
        userId={userId}
        userEmail={userEmail}
        isAdminUser={isAdminUser}
        greeting={greeting}
        currentDateLabel={currentDateLabel}
      />
    </Suspense>
  );
}
