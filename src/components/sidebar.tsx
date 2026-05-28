"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  CirclePlus,
  FileText,
  LayoutDashboard,
  LogOut,
  Moon,
  Settings,
  Sun,
} from "lucide-react";
import { RouterLink } from "@/components/ui/router-link";
import { CompanyPolicyButton, type CompanyPolicyState } from "@/components/company-policy-button";
import { ROUTES } from "@/core/config/route-registry";
import { logoutAction } from "@/modules/auth/actions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const iconMap: Record<string, React.ElementType<any>> = {
  LayoutDashboard,
  CirclePlus,
  FileText,
  CalendarDays,
  BarChart3,
  Settings,
};

type DashboardNavItem = {
  href: string;
  label: string;
  iconName: string;
  isActive: boolean;
};

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
  navigationItems: DashboardNavItem[];
  userEmail: string;
  avatarInitial: string;
  displayName: string;
  emailDomain: string;
  companyPolicyState: CompanyPolicyState | null;
  hidden?: boolean;
};

function SidebarTooltip({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (!collapsed) return null;
  return (
    <div
      className="pointer-events-none invisible absolute left-full ml-3 z-50 whitespace-nowrap rounded px-2 py-1 opacity-0 transition-opacity group-hover:visible group-hover:opacity-100"
      style={{ backgroundColor: "var(--foreground)", color: "var(--card)", fontSize: 14 }}
    >
      {label}
    </div>
  );
}

export function Sidebar({
  collapsed,
  onToggle,
  navigationItems,
  userEmail,
  avatarInitial,
  displayName,
  emailDomain,
  companyPolicyState,
  hidden = false,
}: SidebarProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [isSigningOut, startSignOut] = useTransition();
  const router = useRouter();

  const isDark = resolvedTheme === "dark";

  const handleSignOut = () => {
    startSignOut(async () => {
      await logoutAction();
      router.push(ROUTES.login);
    });
  };

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 z-30"
      style={{
        width: collapsed ? 56 : 240,
        backgroundColor: "var(--card)",
        borderRight: "1px solid var(--border)",
        transition: "width 200ms ease, transform 200ms ease",
        transform: hidden ? "translateX(-100%)" : "translateX(0)",
      }}
    >
      <div className="relative flex h-full flex-col">
        {/* Logo Header */}
        <div
          className="flex h-12 shrink-0 items-center"
          style={{
            padding: collapsed ? "0" : "0 16px",
            justifyContent: collapsed ? "center" : "flex-start",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
            style={{ backgroundColor: "var(--accent)" }}
          >
            <svg viewBox="0 0 48 48" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
              <rect x="8" y="8" width="23" height="29" rx="4.5" fill="white" fillOpacity="0.14" />
              <rect x="11" y="5" width="23" height="29" rx="4.5" fill="white" fillOpacity="0.94" />
              <rect
                x="16"
                y="11"
                width="13"
                height="2.5"
                rx="1.25"
                fill="#4F46E5"
                fillOpacity="0.65"
              />
              <rect
                x="16"
                y="16.5"
                width="9"
                height="1.8"
                rx="0.9"
                fill="#4F46E5"
                fillOpacity="0.35"
              />
              <rect
                x="16"
                y="20.5"
                width="11"
                height="1.8"
                rx="0.9"
                fill="#4F46E5"
                fillOpacity="0.35"
              />
              <rect
                x="16"
                y="24.5"
                width="7"
                height="1.8"
                rx="0.9"
                fill="#4F46E5"
                fillOpacity="0.25"
              />
              <circle cx="35" cy="35" r="9" fill="#10B981" />
              <path
                d="M31 35L34 38L39 31.5"
                stroke="white"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          {!collapsed && (
            <span
              className="ml-2.5 truncate"
              style={{ fontSize: 16, fontWeight: 600, color: "var(--foreground)" }}
            >
              NxtClaim V2
            </span>
          )}
        </div>

        {/* Collapse Toggle */}
        <button
          type="button"
          onClick={onToggle}
          className="absolute flex items-center justify-center rounded-full border shadow-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            width: 24,
            height: 24,
            right: -12,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 10,
            backgroundColor: "var(--card)",
            borderColor: "var(--border)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >
          <ChevronLeft
            className="h-4 w-4"
            style={{
              color: "var(--muted-foreground)",
              transform: collapsed ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 200ms ease",
            }}
          />
        </button>

        {/* Primary Nav */}
        <nav
          className="flex-1 pt-2"
          aria-label="Dashboard navigation"
          style={{ overflow: collapsed ? "hidden" : "auto" }}
        >
          {navigationItems.map((item) => {
            const Icon = iconMap[item.iconName] ?? (() => null);

            return (
              <div key={item.href} className="group relative">
                <RouterLink
                  href={item.href}
                  className={`flex items-center transition-colors ${
                    collapsed ? "justify-center" : ""
                  }`}
                  style={{
                    height: 36,
                    margin: "1px 8px",
                    padding: collapsed ? 0 : item.isActive ? "0 9px 0 9px" : "0 12px",
                    borderRadius: 6,
                    gap: collapsed ? 0 : 10,
                    ...(item.isActive
                      ? {
                          backgroundColor: "var(--accent-muted)",
                          borderLeft: "3px solid var(--accent)",
                          color: "var(--accent)",
                          fontWeight: 500,
                        }
                      : {
                          backgroundColor: "transparent",
                          borderLeft: "3px solid transparent",
                          color: "var(--muted-foreground)",
                        }),
                  }}
                  onMouseEnter={(e) => {
                    if (!item.isActive) {
                      const target = e.currentTarget;
                      target.style.backgroundColor = "var(--background-secondary)";
                      target.style.color = "var(--foreground)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!item.isActive) {
                      const target = e.currentTarget;
                      target.style.backgroundColor = "transparent";
                      target.style.color = "var(--muted-foreground)";
                    }
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {!collapsed && <span style={{ fontSize: 14 }}>{item.label}</span>}
                </RouterLink>
                <SidebarTooltip label={item.label} collapsed={collapsed} />
              </div>
            );
          })}
        </nav>

        {/* Utility Nav */}
        <div className="shrink-0 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          {/* Company Policy */}
          <div className="group relative" style={{ margin: "1px 8px" }}>
            <CompanyPolicyButton
              initialState={companyPolicyState}
              triggerClassName="flex items-center transition-colors w-full"
              triggerStyle={{
                height: 36,
                padding: collapsed ? 0 : "0 12px",
                borderRadius: 6,
                justifyContent: collapsed ? "center" : "flex-start",
                gap: collapsed ? 0 : 10,
                borderLeft: "3px solid transparent",
                color: "var(--muted-foreground)",
                backgroundColor: "transparent",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                const target = e.currentTarget;
                target.style.backgroundColor = "var(--background-secondary)";
                target.style.color = "var(--foreground)";
              }}
              onMouseLeave={(e) => {
                const target = e.currentTarget;
                target.style.backgroundColor = "transparent";
                target.style.color = "var(--muted-foreground)";
              }}
            >
              <>
                <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                {!collapsed && <span style={{ fontSize: 14 }}>Company Policy</span>}
              </>
            </CompanyPolicyButton>
            <SidebarTooltip label="Company Policy" collapsed={collapsed} />
          </div>

          {/* Theme Toggle */}
          <div className="group relative" style={{ margin: "1px 8px" }}>
            <button
              type="button"
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="flex items-center transition-colors"
              style={{
                height: 36,
                width: collapsed ? "calc(100% - 0px)" : "calc(100% - 0px)",
                padding: collapsed ? 0 : "0 12px",
                borderRadius: 6,
                justifyContent: collapsed ? "center" : "flex-start",
                gap: collapsed ? 0 : 10,
                borderLeft: "3px solid transparent",
                color: "var(--muted-foreground)",
              }}
              onMouseEnter={(e) => {
                const target = e.currentTarget;
                target.style.backgroundColor = "var(--background-secondary)";
                target.style.color = "var(--foreground)";
              }}
              onMouseLeave={(e) => {
                const target = e.currentTarget;
                target.style.backgroundColor = "transparent";
                target.style.color = "var(--muted-foreground)";
              }}
              aria-label="Toggle theme"
            >
              {isDark ? (
                <Sun className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              {!collapsed && (
                <span style={{ fontSize: 14 }}>{isDark ? "Light Mode" : "Dark Mode"}</span>
              )}
            </button>
            <SidebarTooltip label={isDark ? "Light Mode" : "Dark Mode"} collapsed={collapsed} />
          </div>
        </div>

        {/* User Footer */}
        <div
          className="shrink-0 flex items-center"
          style={{
            height: 60,
            padding: collapsed ? "0" : "0 12px",
            justifyContent: collapsed ? "center" : "flex-start",
            borderTop: "1px solid var(--border)",
            marginTop: 4,
          }}
        >
          <div className={`group relative flex items-center ${collapsed ? "" : "flex-1 min-w-0"}`}>
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-semibold"
              style={{
                backgroundColor: "var(--accent-muted)",
                color: "var(--accent)",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {avatarInitial}
            </div>

            {!collapsed && (
              <>
                <div className="ml-2 min-w-0 flex-1">
                  <p
                    className="truncate"
                    style={{ fontSize: 14, fontWeight: 500, color: "var(--foreground)" }}
                  >
                    {displayName}
                  </p>
                  <p
                    className="truncate"
                    style={{ fontSize: 12, color: "var(--muted-foreground)" }}
                  >
                    {emailDomain}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
                  aria-label="Sign Out"
                  style={{ color: "var(--muted-foreground)" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#dc2626";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--muted-foreground)";
                  }}
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </>
            )}

            {/* Tooltip for collapsed state */}
            {collapsed && (
              <div
                className="pointer-events-none invisible absolute left-full ml-3 z-50 whitespace-nowrap rounded px-2 py-1 text-xs opacity-0 transition-opacity group-hover:visible group-hover:opacity-100"
                style={{ backgroundColor: "var(--foreground)", color: "var(--card)" }}
              >
                {userEmail}
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
