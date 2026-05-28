import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CalendarDays, CirclePlus, FileText, Settings } from "lucide-react";
import { ROUTES } from "@/core/config/route-registry";
import { AppLayout } from "@/components/app-layout";
import { PolicyGate } from "@/components/layout/PolicyGate";
import { RouterLink } from "@/components/ui/router-link";
import { DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS } from "@/core/constants/statuses";
import { resolveDashboardAnalyticsScope } from "@/core/domain/dashboard/resolve-analytics-scope";
import { logger } from "@/core/infra/logging/logger";
import { GetWalletSummaryService } from "@/core/domain/dashboard/GetWalletSummaryService";
import { GetMyClaimsPaginatedService } from "@/core/domain/claims/GetMyClaimsPaginatedService";
import { SupabaseDashboardRepository } from "@/modules/dashboard/repositories/SupabaseDashboardRepository";
import { WalletSummary } from "@/modules/dashboard/ui/wallet-summary";
import { RecentClaims, type RecentClaimRecord } from "@/modules/dashboard/ui/recent-claims";
import { isAdmin } from "@/modules/admin/server/is-admin";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";
import { isFinancePendingApprovalsViewer } from "@/modules/claims/server/get-pending-approvals-viewer-context";
import { getPolicyGateState } from "@/modules/policies/server/get-policy-gate-state";
import { pageBodyFont, pageDisplayFont } from "@/lib/fonts";
import { formatDate } from "@/lib/format";
import {
  getUserFirstName,
  getUserDisplayName,
  getUserInitials,
  getEmailDomain,
} from "@/lib/user-name";
import type { CompanyPolicyState } from "@/components/company-policy-button";

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

type DashboardNavItem = {
  href: string;
  label: string;
  iconName: string;
  isActive: boolean;
};

function buildHodPendingNavHref(): string {
  const params = new URLSearchParams({ status: DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS });
  return `${ROUTES.claims.hodPending}?${params.toString()}`;
}

function buildNavigationItems(input: {
  canViewAnalytics: boolean;
  isAdminUser: boolean;
  isFinanceUser: boolean;
}): DashboardNavItem[] {
  return [
    {
      href: ROUTES.dashboard,
      label: "Dashboard",
      iconName: "LayoutDashboard",
      isActive: true,
    },
    {
      href: ROUTES.claims.new,
      label: "New Claim",
      iconName: "CirclePlus",
      isActive: false,
    },
    {
      href: ROUTES.claims.myClaims,
      label: "Claims",
      iconName: "FileText",
      isActive: false,
    },
    ...(input.isFinanceUser
      ? [
          {
            href: buildHodPendingNavHref(),
            label: "HOD Pending",
            iconName: "CalendarDays",
            isActive: false,
          },
        ]
      : []),
    ...(input.canViewAnalytics
      ? [
          {
            href: ROUTES.dashboardAnalytics,
            label: "Analytics",
            iconName: "BarChart3",
            isActive: false,
          },
        ]
      : []),
    ...(input.isAdminUser
      ? [
          {
            href: ROUTES.admin.settings,
            label: "System Settings",
            iconName: "Settings",
            isActive: false,
          },
        ]
      : []),
  ];
}

function toCompanyPolicyState(
  gateState: Awaited<ReturnType<typeof getPolicyGateState>>,
): CompanyPolicyState {
  return {
    policy: gateState.policy
      ? {
          id: gateState.policy.id,
          versionName: gateState.policy.versionName,
          fileUrl: gateState.policy.fileUrl,
          createdAt: gateState.policy.createdAt,
        }
      : null,
    accepted: gateState.accepted,
    acceptedAt: gateState.acceptedAt,
    message: gateState.errorMessage,
  };
}

function DashboardSkeleton() {
  return (
    <div className="flex min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <aside
        className="fixed left-0 top-0 bottom-0 flex flex-col"
        style={{
          width: 240,
          backgroundColor: "var(--card)",
          borderRight: "1px solid var(--border)",
        }}
      >
        <div
          className="flex h-14 shrink-0 items-center px-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div
            className="shimmer-sweep h-5 w-5 rounded"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
          <div
            className="shimmer-sweep ml-2.5 h-4 w-24 rounded-md"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
        </div>
        <div className="flex-1 space-y-1 px-2 pt-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={`nav-skeleton-${index}`}
              className="shimmer-sweep h-10 rounded-md"
              style={{ margin: "2px 0", backgroundColor: "var(--background-secondary)" }}
            />
          ))}
        </div>
        <div
          className="flex h-16 shrink-0 items-center px-3"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <div
            className="shimmer-sweep h-8 w-8 rounded-full"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
          <div className="ml-2.5 flex-1 space-y-1.5">
            <div
              className="shimmer-sweep h-3 w-20 rounded-md"
              style={{ backgroundColor: "var(--background-secondary)" }}
            />
            <div
              className="shimmer-sweep h-2.5 w-28 rounded-md"
              style={{ backgroundColor: "var(--background-secondary)" }}
            />
          </div>
        </div>
      </aside>

      <main
        style={{
          marginLeft: 240,
          padding: 32,
          backgroundColor: "var(--background)",
          minHeight: "100vh",
        }}
      >
        <div className="space-y-2">
          <div
            className="shimmer-sweep h-7 w-64 rounded-md"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
          <div
            className="shimmer-sweep h-4 w-full max-w-[520px] rounded-md"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
          <div
            className="shimmer-sweep h-3 w-48 rounded-md"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
        </div>
        <div className="mt-5 flex gap-2">
          <div
            className="shimmer-sweep h-9 w-28 rounded-md"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
          <div
            className="shimmer-sweep h-9 w-28 rounded-md"
            style={{ backgroundColor: "var(--background-secondary)" }}
          />
        </div>

        <div className="mb-8 mt-8" />

        <div
          className="shimmer-sweep mb-4 h-4 w-32 rounded-md"
          style={{ backgroundColor: "var(--background-secondary)" }}
        />

        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={`wallet-skeleton-${index}`}
              className="rounded-lg border p-5"
              style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
            >
              <div className="flex items-start justify-between">
                <div
                  className="shimmer-sweep h-4 w-24 rounded-md"
                  style={{ backgroundColor: "var(--background-secondary)" }}
                />
                <div
                  className="shimmer-sweep h-8 w-8 rounded-md"
                  style={{ backgroundColor: "var(--background-secondary)" }}
                />
              </div>
              <div
                className="shimmer-sweep mt-3 h-8 w-32 rounded-md"
                style={{ backgroundColor: "var(--background-secondary)" }}
              />
              <div
                className="shimmer-sweep mt-2 h-3 w-full rounded-md"
                style={{ backgroundColor: "var(--background-secondary)" }}
              />
            </div>
          ))}
        </div>
      </main>
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
          Unable to load wallet summary. {walletResult.errorMessage}
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
  const [currentUserResult, isAdminUser, policyGateState] = await Promise.all([
    getCachedCurrentUser(),
    isAdmin(),
    getPolicyGateState(),
  ]);

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    redirect(ROUTES.login);
  }

  const userId = currentUserResult.user.id;
  const userEmail = currentUserResult.user.email ?? "Unknown User";

  const [analyticsViewerContextResult, isFinanceUser] = await Promise.all([
    dashboardRepository.getAnalyticsViewerContext(userId),
    isFinancePendingApprovalsViewer(userId),
  ]);

  if (analyticsViewerContextResult.errorMessage) {
    logger.warn("dashboard.navigation.analytics_visibility_check_failed", {
      userId,
      error: analyticsViewerContextResult.errorMessage,
    });
  }

  const canViewAnalytics = analyticsViewerContextResult.data
    ? resolveDashboardAnalyticsScope(analyticsViewerContextResult.data) !== null
    : false;
  const navigationItems = buildNavigationItems({
    canViewAnalytics,
    isAdminUser,
    isFinanceUser,
  });

  const displayName = getUserDisplayName(userEmail);
  const emailDomain = getEmailDomain(userEmail);
  const avatarInitial = getUserInitials(userEmail);

  const currentDate = new Date();
  const currentHour = Number(indiaHourFormatter.format(currentDate));
  const greeting =
    currentHour < 12 ? "Good morning" : currentHour < 18 ? "Good afternoon" : "Good evening";
  const currentDateLabel = formatDate(currentDate);

  const companyPolicyState = toCompanyPolicyState(policyGateState);

  return (
    <PolicyGate initialState={policyGateState}>
      <div
        className={`${pageBodyFont.variable} ${pageDisplayFont.variable} dashboard-font-body`}
        style={{ minHeight: "100vh", backgroundColor: "var(--background)" }}
      >
        <AppLayout
          navigationItems={navigationItems}
          userEmail={userEmail}
          avatarInitial={avatarInitial}
          displayName={displayName}
          emailDomain={emailDomain}
          companyPolicyState={companyPolicyState}
        >
          <Suspense fallback={<DashboardSkeleton />}>
            <DashboardPageContent
              userId={userId}
              userEmail={userEmail}
              isAdminUser={isAdminUser}
              greeting={greeting}
              currentDateLabel={currentDateLabel}
            />
          </Suspense>
        </AppLayout>
      </div>
    </PolicyGate>
  );
}
