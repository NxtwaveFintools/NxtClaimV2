"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import type { CompanyPolicyState } from "@/components/company-policy-button";
import { isDashboardNavItemActive } from "@/lib/dashboard-navigation";

export type DashboardNavItem = {
  href: string;
  label: string;
  iconName: string;
};

type AppLayoutProps = {
  children: ReactNode;
  navigationItems: DashboardNavItem[];
  userEmail: string;
  avatarInitial: string;
  displayName: string;
  emailDomain: string;
  companyPolicyState: CompanyPolicyState | null;
};

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}

export function AppLayout({
  children,
  navigationItems,
  userEmail,
  avatarInitial,
  displayName,
  emailDomain,
  companyPolicyState,
}: AppLayoutProps) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);

  const sidebarWidth = collapsed ? (isMobile ? 0 : 56) : 240;
  const mainMargin = isMobile && collapsed ? 0 : sidebarWidth;
  const activeNavigationItems = useMemo(
    () =>
      navigationItems.map((item) => ({
        ...item,
        isActive: isDashboardNavItemActive(item.href, pathname),
      })),
    [navigationItems, pathname],
  );
  const handleSidebarToggle = useCallback(() => {
    setCollapsed((current) => !current);
  }, []);

  return (
    <>
      <Sidebar
        collapsed={isMobile ? true : collapsed}
        hidden={isMobile && collapsed}
        onToggle={handleSidebarToggle}
        navigationItems={activeNavigationItems}
        userEmail={userEmail}
        avatarInitial={avatarInitial}
        displayName={displayName}
        emailDomain={emailDomain}
        companyPolicyState={companyPolicyState}
      />

      {/* Mobile overlay backdrop */}
      {isMobile && !collapsed && (
        <div
          className="fixed inset-0 z-20 bg-black/40 dark:bg-black/60"
          onClick={() => setCollapsed(true)}
          aria-hidden="true"
        />
      )}

      <main
        style={{
          marginLeft: mainMargin,
          transition: "margin-left 200ms ease",
          minHeight: "100vh",
          backgroundColor: "var(--background)",
        }}
      >
        <div style={{ padding: isMobile ? 16 : 32 }}>{children}</div>
      </main>
    </>
  );
}
