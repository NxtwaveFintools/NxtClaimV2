import Link from "next/link";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { redirect } from "next/navigation";
import { CalendarDays, CirclePlus, FileText, LayoutDashboard, Settings } from "lucide-react";
import { ROUTES } from "@/core/config/route-registry";
import { AppShellHeader } from "@/components/app-shell-header";
import { logger } from "@/core/infra/logging/logger";
import { GetWalletSummaryService } from "@/core/domain/dashboard/GetWalletSummaryService";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";
import { SupabaseDashboardRepository } from "@/modules/dashboard/repositories/SupabaseDashboardRepository";
import { WalletSummary } from "@/modules/dashboard/ui/wallet-summary";
import { isAdmin } from "@/modules/admin/server/is-admin";

export const dynamic = "force-dynamic";

const authRepository = new SupabaseServerAuthRepository();
const dashboardRepository = new SupabaseDashboardRepository();
const getWalletSummaryService = new GetWalletSummaryService({
  repository: dashboardRepository,
  logger,
});

const dashboardBodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-dashboard-inter",
});

const dashboardDisplayFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-dashboard-display",
});

const indiaDateFormatter = new Intl.DateTimeFormat("en-IN", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

const indiaHourFormatter = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  hour12: false,
  timeZone: "Asia/Kolkata",
});

export default async function DashboardPage() {
  const [currentUserResult, isAdminUser] = await Promise.all([
    authRepository.getCurrentUser(),
    isAdmin(),
  ]);
  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    redirect(ROUTES.login);
  }

  const walletResult = await getWalletSummaryService.execute(currentUserResult.user.id);
  const walletSummary = walletResult.data ?? GetWalletSummaryService.empty();
  const userEmail = currentUserResult.user.email ?? "Unknown User";
  const currentDate = new Date();
  const currentHour = Number(indiaHourFormatter.format(currentDate));
  const greeting =
    currentHour < 12 ? "Good morning" : currentHour < 18 ? "Good afternoon" : "Good evening";
  const currentDateLabel = indiaDateFormatter.format(currentDate);
  const navigationItems = [
    {
      href: ROUTES.dashboard,
      label: "Dashboard",
      icon: LayoutDashboard,
      isActive: true,
    },
    {
      href: ROUTES.claims.new,
      label: "New Claim",
      icon: CirclePlus,
      isActive: false,
    },
    {
      href: ROUTES.claims.myClaims,
      label: "My Claims",
      icon: FileText,
      isActive: false,
    },
    ...(isAdminUser
      ? [
          {
            href: ROUTES.admin.settings,
            label: "System Settings",
            icon: Settings,
            isActive: false,
          },
        ]
      : []),
  ];

  return (
    <div
      className={`${dashboardBodyFont.variable} ${dashboardDisplayFont.variable} dashboard-font-body relative isolate min-h-screen bg-zinc-50 dark:bg-slate-950`}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-indigo-100/70 via-white/0 to-white/0 dark:from-indigo-950/30 dark:via-transparent dark:to-transparent" />
        <div className="absolute left-[-12%] top-24 h-72 w-72 rounded-full bg-indigo-200/35 blur-3xl dark:bg-indigo-500/10" />
        <div className="absolute right-[-10%] top-16 h-80 w-80 rounded-full bg-sky-200/30 blur-3xl dark:bg-sky-500/10" />
      </div>

      <AppShellHeader currentEmail={userEmail} />

      <div className="relative mx-auto flex max-w-[1600px] gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <aside className="hidden lg:sticky lg:top-24 lg:block lg:h-[calc(100vh-7rem)] lg:w-72">
          <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/90 p-4 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.28)] backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/90 dark:shadow-black/20">
            <nav className="space-y-2" aria-label="Dashboard navigation">
              {navigationItems.map((item) => {
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition-all duration-200 ${
                      item.isActive
                        ? "border-indigo-200 bg-gradient-to-r from-indigo-50 to-sky-50 text-indigo-700 shadow-sm dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200"
                        : "border-transparent text-zinc-700 hover:border-zinc-200 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/70"
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        item.isActive
                          ? "bg-white text-indigo-600 shadow-sm dark:bg-slate-950 dark:text-indigo-300"
                          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 text-sm font-semibold">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>

        <main className="min-w-0 flex-1 space-y-6">
          <section className="overflow-hidden rounded-[30px] border border-zinc-200/80 bg-white/90 shadow-[0_30px_80px_-36px_rgba(15,23,42,0.35)] backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/90 dark:shadow-black/25">
            <div className="relative p-6 sm:p-8">
              <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-r from-indigo-100/70 via-sky-100/40 to-transparent dark:from-indigo-500/10 dark:via-sky-500/5 dark:to-transparent" />
              <div className="relative">
                <h2 className="dashboard-font-display text-2xl font-semibold tracking-[-0.02em] text-zinc-950 sm:text-3xl dark:text-zinc-50">
                  {greeting}, {userEmail}
                </h2>

                <div className="mt-6 flex flex-wrap gap-3">
                  <div className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 shadow-sm shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:shadow-none">
                    <CalendarDays
                      className="h-4 w-4 text-zinc-500 dark:text-zinc-400"
                      aria-hidden="true"
                    />
                    <span>{currentDateLabel}</span>
                  </div>
                </div>

                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href={ROUTES.claims.new}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-colors hover:bg-indigo-500"
                  >
                    <CirclePlus className="h-4 w-4" aria-hidden="true" />
                    New Claim
                  </Link>

                  <Link
                    href={ROUTES.claims.myClaims}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    My Claims
                  </Link>

                  {isAdminUser ? (
                    <Link
                      href={ROUTES.admin.settings}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      <Settings className="h-4 w-4" aria-hidden="true" />
                      System Settings
                    </Link>
                  ) : null}
                </div>

                <div className="mt-6 flex gap-2 overflow-x-auto pb-1 lg:hidden">
                  {navigationItems.map((item) => {
                    const Icon = item.icon;

                    return (
                      <Link
                        key={`mobile-${item.href}`}
                        href={item.href}
                        className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-colors ${
                          item.isActive
                            ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200"
                            : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                        }`}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {walletResult.errorMessage ? (
            <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
              Unable to load wallet summary. {walletResult.errorMessage}
            </p>
          ) : null}

          <WalletSummary summary={walletSummary} />
        </main>
      </div>
    </div>
  );
}
