import { ROUTES } from "@/core/config/route-registry";
import { DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS } from "@/core/constants/statuses";
import type { DashboardNavItem } from "@/components/app-layout";

export type DashboardNavPermissions = {
  canViewAnalytics: boolean;
  canViewHodPendingClaims: boolean;
  isAdminUser: boolean;
};

function buildHodPendingNavHref(): string {
  const params = new URLSearchParams({ status: DB_SUBMITTED_AWAITING_HOD_APPROVAL_STATUS });
  return `${ROUTES.claims.hodPending}?${params.toString()}`;
}

export function getDashboardNavItems(permissions: DashboardNavPermissions): DashboardNavItem[] {
  return [
    {
      href: ROUTES.dashboard,
      label: "Dashboard",
      iconName: "LayoutDashboard",
    },
    {
      href: ROUTES.claims.new,
      label: "New Claim",
      iconName: "CirclePlus",
    },
    {
      href: ROUTES.claims.myClaims,
      label: "Claims",
      iconName: "FileText",
    },
    ...(permissions.canViewHodPendingClaims
      ? [
          {
            href: buildHodPendingNavHref(),
            label: "HOD Pending",
            iconName: "CalendarDays",
          },
        ]
      : []),
    ...(permissions.canViewAnalytics
      ? [
          {
            href: ROUTES.dashboardAnalytics,
            label: "Analytics",
            iconName: "BarChart3",
          },
        ]
      : []),
    ...(permissions.isAdminUser
      ? [
          {
            href: ROUTES.admin.settings,
            label: "System Settings",
            iconName: "Settings",
          },
        ]
      : []),
  ];
}

export function isDashboardNavItemActive(href: string, pathname: string): boolean {
  if (href === ROUTES.dashboard) {
    return pathname === ROUTES.dashboard;
  }

  if (href === ROUTES.claims.myClaims) {
    return (
      pathname === ROUTES.claims.myClaims ||
      (pathname.startsWith("/dashboard/claims/") && pathname !== ROUTES.claims.hodPending)
    );
  }

  if (href.startsWith(ROUTES.claims.hodPending)) {
    return pathname === ROUTES.claims.hodPending;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
