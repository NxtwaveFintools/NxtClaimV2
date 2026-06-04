"use client";

import { startTransition, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const sidebarWidth = collapsed ? 56 : 240;
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

  useEffect(() => {
    startTransition(() => {
      setMobileSidebarOpen(false);
    });
  }, [pathname]);

  useEffect(() => {
    if (!mobileSidebarOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileSidebarOpen]);

  return (
    <>
      <Sidebar
        collapsed={isMobile ? false : collapsed}
        hidden={isMobile && !mobileSidebarOpen}
        onToggle={isMobile ? () => setMobileSidebarOpen(false) : handleSidebarToggle}
        showCollapseToggle={!isMobile}
        navigationItems={activeNavigationItems}
        userEmail={userEmail}
        avatarInitial={avatarInitial}
        displayName={displayName}
        emailDomain={emailDomain}
        companyPolicyState={companyPolicyState}
      />

      {isMobile && mobileSidebarOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 dark:bg-black/60 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <main
        className="min-w-0"
        style={{
          marginLeft: isMobile ? 0 : sidebarWidth,
          transition: "margin-left 200ms ease",
          minHeight: "100vh",
          backgroundColor: "var(--background)",
        }}
      >
        <div className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground transition-colors hover:bg-background-secondary"
            aria-label="Open navigation menu"
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">NxtClaim V2</p>
          </div>
        </div>
        <div className="w-full min-w-0 max-w-full px-4 py-4 md:px-8 md:py-8">{children}</div>
      </main>
    </>
  );
}
