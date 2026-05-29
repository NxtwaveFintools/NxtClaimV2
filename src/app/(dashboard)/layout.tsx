import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppLayout } from "@/components/app-layout";
import { PolicyGate } from "@/components/layout/PolicyGate";
import { AppShellSkeleton, PageHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/core/config/route-registry";
import { resolveDashboardAnalyticsScope } from "@/core/domain/dashboard/resolve-analytics-scope";
import { logger } from "@/core/infra/logging/logger";
import { getDashboardNavItems } from "@/lib/dashboard-navigation";
import { getEmailDomain, getUserDisplayName, getUserInitials } from "@/lib/user-name";
import { isAdmin } from "@/modules/admin/server/is-admin";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import { getCachedPendingApprovalsViewerContext } from "@/modules/claims/server/get-pending-approvals-viewer-context";
import { SupabaseDashboardRepository } from "@/modules/dashboard/repositories/SupabaseDashboardRepository";
import { getPolicyGateState } from "@/modules/policies/server/get-policy-gate-state";
import type { CompanyPolicyState } from "@/components/company-policy-button";

const dashboardRepository = new SupabaseDashboardRepository();

function DashboardGroupLayoutFallback() {
  return (
    <AppShellSkeleton>
      <main className="mx-auto max-w-7xl space-y-5">
        <section className="rounded-xl border border-border bg-card p-4">
          <PageHeaderSkeleton actions={0} />
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={`dashboard-layout-fallback-row-${index}`} className="h-4 w-full" />
            ))}
          </div>
        </section>
      </main>
    </AppShellSkeleton>
  );
}

async function DashboardGroupPolicyGate({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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

  const [analyticsViewerContextResult, pendingViewerContext] = await Promise.all([
    dashboardRepository.getAnalyticsViewerContext(userId),
    getCachedPendingApprovalsViewerContext(userId),
  ]);

  if (analyticsViewerContextResult.errorMessage) {
    logger.warn("dashboard.shell.analytics_visibility_check_failed", {
      userId,
      error: analyticsViewerContextResult.errorMessage,
    });
  }

  const canViewAnalytics = analyticsViewerContextResult.data
    ? resolveDashboardAnalyticsScope(analyticsViewerContextResult.data) !== null
    : false;

  const navItems = getDashboardNavItems({
    canViewAnalytics,
    canViewHodPendingClaims:
      !pendingViewerContext.errorMessage && pendingViewerContext.activeScope === "finance",
    isAdminUser,
  });

  const companyPolicyState: CompanyPolicyState = {
    policy: policyGateState.policy
      ? {
          id: policyGateState.policy.id,
          versionName: policyGateState.policy.versionName,
          fileUrl: policyGateState.policy.fileUrl,
          createdAt: policyGateState.policy.createdAt,
        }
      : null,
    accepted: policyGateState.accepted,
    acceptedAt: policyGateState.acceptedAt,
    message: policyGateState.errorMessage,
  };

  return (
    <PolicyGate initialState={policyGateState}>
      <AppLayout
        navigationItems={navItems}
        userEmail={userEmail}
        avatarInitial={getUserInitials(userEmail)}
        displayName={getUserDisplayName(userEmail)}
        emailDomain={getEmailDomain(userEmail)}
        companyPolicyState={companyPolicyState}
      >
        {children}
      </AppLayout>
    </PolicyGate>
  );
}

export default function DashboardGroupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <Suspense fallback={<DashboardGroupLayoutFallback />}>
      <DashboardGroupPolicyGate>{children}</DashboardGroupPolicyGate>
    </Suspense>
  );
}
