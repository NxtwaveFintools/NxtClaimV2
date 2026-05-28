import dynamic from "next/dynamic";
import { AppLayout, type DashboardNavItem } from "@/components/app-layout";
import type { CompanyPolicyState } from "@/components/company-policy-button";
import { ROUTES } from "@/core/config/route-registry";
import { DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS } from "@/core/constants/statuses";
import { resolveDashboardAnalyticsScope } from "@/core/domain/dashboard/resolve-analytics-scope";
import { logger } from "@/core/infra/logging/logger";
import { pageBodyFont, pageDisplayFont } from "@/lib/fonts";
import { getEmailDomain, getUserDisplayName, getUserInitials } from "@/lib/user-name";
import { isAdmin } from "@/modules/admin/server/is-admin";
import { getClaimFormHydrationAction } from "@/modules/claims/actions";
import { isFinancePendingApprovalsViewer } from "@/modules/claims/server/get-pending-approvals-viewer-context";
import { SupabaseDashboardRepository } from "@/modules/dashboard/repositories/SupabaseDashboardRepository";
import { getPolicyGateState } from "@/modules/policies/server/get-policy-gate-state";

const NewClaimFormClient = dynamic(
  () => import("@/modules/claims/ui/new-claim-form-client").then((mod) => mod.NewClaimFormClient),
  {
    loading: () => (
      <div className="h-96 animate-pulse rounded-xl bg-zinc-200 dark:bg-gray-800/40" />
    ),
  },
);

const dashboardRepository = new SupabaseDashboardRepository();

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
      isActive: false,
    },
    {
      href: ROUTES.claims.new,
      label: "New Claim",
      iconName: "CirclePlus",
      isActive: true,
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

export default async function NewClaimPage() {
  const hydrationResult = await getClaimFormHydrationAction();

  if (hydrationResult.errorMessage || !hydrationResult.data) {
    return (
      <div
        className={`${pageBodyFont.variable} ${pageDisplayFont.variable} dashboard-font-body`}
        style={{ minHeight: "100vh", backgroundColor: "var(--background)" }}
      >
        <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <h1 className="dashboard-font-display text-2xl font-semibold text-foreground">
              New Claim
            </h1>
            <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
              Unable to load claim form data. {hydrationResult.errorMessage ?? "Unknown error."}
            </p>
          </section>
        </main>
      </div>
    );
  }

  const currentUser = hydrationResult.data.currentUser;
  const [isAdminUser, policyGateState, analyticsViewerContextResult, isFinanceUser] =
    await Promise.all([
      isAdmin(),
      getPolicyGateState(),
      dashboardRepository.getAnalyticsViewerContext(currentUser.id),
      isFinancePendingApprovalsViewer(currentUser.id),
    ]);

  if (analyticsViewerContextResult.errorMessage) {
    logger.warn("claims.new.navigation.analytics_visibility_check_failed", {
      userId: currentUser.id,
      error: analyticsViewerContextResult.errorMessage,
    });
  }

  const canViewAnalytics = analyticsViewerContextResult.data
    ? resolveDashboardAnalyticsScope(analyticsViewerContextResult.data) !== null
    : false;

  return (
    <div
      className={`${pageBodyFont.variable} ${pageDisplayFont.variable} dashboard-font-body`}
      style={{ minHeight: "100vh", backgroundColor: "var(--background)" }}
    >
      <AppLayout
        navigationItems={buildNavigationItems({
          canViewAnalytics,
          isAdminUser,
          isFinanceUser,
        })}
        userEmail={currentUser.email}
        avatarInitial={getUserInitials(currentUser.email)}
        displayName={getUserDisplayName(currentUser.email)}
        emailDomain={getEmailDomain(currentUser.email)}
        companyPolicyState={toCompanyPolicyState(policyGateState)}
      >
        <div className="mx-auto w-full max-w-[1440px] pb-20">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:px-5">
            <div>
              <h1 className="dashboard-font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
                New Claim
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Submit one claim for one transaction. Review all details before submission.
              </p>
            </div>
          </header>

          <NewClaimFormClient
            currentUser={hydrationResult.data.currentUser}
            options={hydrationResult.data.options}
          />
        </div>
      </AppLayout>
    </div>
  );
}
