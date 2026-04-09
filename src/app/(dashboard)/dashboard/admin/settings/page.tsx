import { notFound } from "next/navigation";
import {
  ArrowRight,
  Building2,
  Database,
  FileText,
  ShieldCheck,
  type LucideIcon,
  UserCog,
  Users,
} from "lucide-react";
import { AppShellHeader } from "@/components/app-shell-header";
import { logger } from "@/core/infra/logging/logger";
import { ROUTES } from "@/core/config/route-registry";
import { RouterLink } from "@/components/ui/router-link";
import { isAdmin } from "@/modules/admin/server/is-admin";
import { ManageMasterDataService } from "@/core/domain/admin/ManageMasterDataService";
import { ManageActorsService } from "@/core/domain/admin/ManageActorsService";
import { ManageAdminsService } from "@/core/domain/admin/ManageAdminsService";
import { ManageDepartmentViewersService } from "@/core/domain/admin/ManageDepartmentViewersService";
import { SupabaseAdminRepository } from "@/modules/admin/repositories/SupabaseAdminRepository";
import { MasterDataTable } from "@/modules/admin/ui/settings/master-data-table";
import { DepartmentsManagement } from "@/modules/admin/ui/settings/departments-management";
import { FinanceApproversManagement } from "@/modules/admin/ui/settings/finance-approvers-management";
import { UsersManagement } from "@/modules/admin/ui/settings/users-management";
import { AdminsManagement } from "@/modules/admin/ui/settings/admins-management";
import { DepartmentViewersManagement } from "@/modules/admin/ui/settings/department-viewers-management";
import { PolicyManagement } from "@/modules/admin/ui/settings/policy-management";
import { AdminClaimOverride } from "@/modules/admin/ui/settings/admin-claim-override";
import { BackButton } from "@/components/ui/back-button";
import type { MasterDataTableName } from "@/core/domain/admin/contracts";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import { getPolicyGateState } from "@/modules/policies/server/get-policy-gate-state";
import { pageBodyFont, pageDisplayFont } from "@/lib/fonts";

export const metadata = {
  title: "System Settings | NxtClaim",
};

type SearchParamsValue = string | string[] | undefined;

function firstParam(value: SearchParamsValue): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

type SidebarGroup = {
  groupLabel: string;
  items: { key: string; label: string }[];
};

const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    groupLabel: "Master Data",
    items: [
      { key: "categories", label: "Expense Categories" },
      { key: "products", label: "Products" },
      { key: "locations", label: "Locations" },
      { key: "payment-modes", label: "Payment Modes" },
    ],
  },
  {
    groupLabel: "Routing",
    items: [
      { key: "departments", label: "Departments & Actors" },
      { key: "finance", label: "Finance Approvers" },
      { key: "viewers", label: "Department Viewers" },
    ],
  },
  {
    groupLabel: "Access",
    items: [
      { key: "users", label: "Users" },
      { key: "admins", label: "Administrators" },
    ],
  },
  {
    groupLabel: "Governance",
    items: [
      { key: "policy", label: "Company Policy" },
      { key: "claim-override", label: "Claim Override" },
    ],
  },
];

const ALL_KEYS = SIDEBAR_GROUPS.flatMap((g) => g.items.map((i) => i.key));
type TabKey = string;

const MASTER_DATA_MAP: Record<string, { tableName: MasterDataTableName; displayName: string }> = {
  categories: { tableName: "master_expense_categories", displayName: "Expense Categories" },
  products: { tableName: "master_products", displayName: "Products" },
  locations: { tableName: "master_locations", displayName: "Locations" },
  "payment-modes": { tableName: "master_payment_modes", displayName: "Payment Modes" },
};

const TAB_META: Record<
  string,
  {
    eyebrow: string;
    description: string;
    spotlight: string;
    icon: LucideIcon;
  }
> = {
  categories: {
    eyebrow: "Master Data",
    description:
      "Control the dropdown datasets that power claim capture without hardcoding values into the UI.",
    spotlight: "Keep expense categories consistent for every new submission.",
    icon: Database,
  },
  products: {
    eyebrow: "Master Data",
    description:
      "Maintain the product list used across finance workflows with clean, audit-safe updates.",
    spotlight: "Add, rename, or retire products without affecting historical claims.",
    icon: Database,
  },
  locations: {
    eyebrow: "Master Data",
    description:
      "Manage active office and travel locations available during claim submission and review.",
    spotlight: "Keep location choices current while preserving old records.",
    icon: Database,
  },
  "payment-modes": {
    eyebrow: "Master Data",
    description:
      "Standardize how payment modes appear across the app so finance reporting stays clean.",
    spotlight: "One source of truth for reimbursement and advance payment modes.",
    icon: Database,
  },
  departments: {
    eyebrow: "Routing",
    description:
      "Configure department ownership and approval routing so each claim lands with the correct approver.",
    spotlight: "Department actor assignments control who becomes the permanent L1 approver.",
    icon: Building2,
  },
  finance: {
    eyebrow: "Routing",
    description:
      "Manage the finance approval roster and designate the primary approver for downstream processing.",
    spotlight: "Primary finance approver selection determines who anchors the finance queue.",
    icon: ShieldCheck,
  },
  viewers: {
    eyebrow: "Routing",
    description:
      "Assign department viewers who need read-only oversight over claims without decision permissions.",
    spotlight: "Useful for departmental POCs and operational visibility.",
    icon: Users,
  },
  users: {
    eyebrow: "Access",
    description:
      "Review users and align each account with the right organizational role for claim permissions.",
    spotlight: "Role updates here shape access across approvals, dashboards, and admin controls.",
    icon: Users,
  },
  admins: {
    eyebrow: "Access",
    description:
      "Promote or remove administrators who can manage system settings and privileged workflows.",
    spotlight: "Keep the admin surface intentionally small and well governed.",
    icon: UserCog,
  },
  policy: {
    eyebrow: "Governance",
    description:
      "Publish policy revisions and enforce mandatory acceptance across all users before dashboard access.",
    spotlight: "Every publish forces re-acceptance and preserves historical acceptance records.",
    icon: FileText,
  },
  "claim-override": {
    eyebrow: "Governance",
    description:
      "Search a claim and force status changes in exceptional cases while preserving audit timeline records.",
    spotlight: "Use only for controlled overrides that require explicit admin accountability.",
    icon: ShieldCheck,
  },
};

const PAGE_SIZE = 20;

function getActiveGroup(tabKey: TabKey): SidebarGroup {
  return (
    SIDEBAR_GROUPS.find((group) => group.items.some((item) => item.key === tabKey)) ??
    SIDEBAR_GROUPS[0]
  );
}

function getActiveItem(group: SidebarGroup, tabKey: TabKey) {
  return group.items.find((item) => item.key === tabKey) ?? group.items[0];
}

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParamsValue>>;
}) {
  const [adminCheck, currentUserResult, resolvedParams] = await Promise.all([
    isAdmin(),
    getCachedCurrentUser(),
    searchParams,
  ]);

  if (!adminCheck) {
    notFound();
  }

  const rawTab = firstParam(resolvedParams?.tab);
  const activeTab: TabKey = ALL_KEYS.includes(rawTab ?? "") ? (rawTab as TabKey) : "categories";

  const adminRepository = new SupabaseAdminRepository();
  const masterDataService = new ManageMasterDataService({ repository: adminRepository, logger });
  const actorsService = new ManageActorsService({ repository: adminRepository, logger });
  const adminsService = new ManageAdminsService({ repository: adminRepository, logger });
  const viewersService = new ManageDepartmentViewersService({
    repository: adminRepository,
    logger,
  });

  const cursor = firstParam(resolvedParams?.cursor) ?? null;
  const previousCursor = firstParam(resolvedParams?.prevCursor) ?? null;

  const isMasterDataTab = activeTab in MASTER_DATA_MAP;
  const masterMeta = MASTER_DATA_MAP[activeTab];

  const [
    adminsResult,
    viewersResult,
    masterDataResult,
    departmentsResult,
    financeResult,
    usersResult,
    policyGateStateResult,
  ] = await Promise.all([
    activeTab === "admins" ? adminsService.getAdmins() : Promise.resolve(null),
    activeTab === "viewers" ? viewersService.getDepartmentViewers() : Promise.resolve(null),
    isMasterDataTab
      ? masterDataService.getItems({ tableName: masterMeta.tableName })
      : Promise.resolve(null),
    activeTab === "departments" || activeTab === "viewers"
      ? actorsService.getDepartmentsWithActors()
      : Promise.resolve(null),
    activeTab === "finance" ? actorsService.getFinanceApprovers() : Promise.resolve(null),
    activeTab === "users"
      ? adminsService.getAllUsers({ cursor, limit: PAGE_SIZE })
      : Promise.resolve(null),
    activeTab === "policy" ? getPolicyGateState() : Promise.resolve(null),
  ]);

  function tabHref(key: string) {
    return `${ROUTES.admin.settings}?tab=${key}`;
  }

  const activeGroup = getActiveGroup(activeTab);
  const activeItem = getActiveItem(activeGroup, activeTab);
  const activeMeta = TAB_META[activeTab] ?? TAB_META.categories;
  const ActiveIcon = activeMeta.icon;
  const currentEmail = currentUserResult.user?.email ?? null;

  return (
    <div
      className={`${pageBodyFont.variable} ${pageDisplayFont.variable} dashboard-font-body nxt-page-bg`}
    >
      <AppShellHeader currentEmail={currentEmail} />

      <main className="mx-auto max-w-400 px-4 py-6 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-4xl border border-zinc-200/80 bg-white/92 shadow-[0_24px_80px_-28px_rgba(15,23,42,0.18)] backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/30">
          <div className="px-6 py-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <BackButton fallbackHref={ROUTES.dashboard} className="w-fit" />
                <span className="inline-flex rounded-full border border-indigo-200/80 bg-indigo-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700 dark:border-indigo-700/60 dark:bg-indigo-950/30 dark:text-indigo-300">
                  Admin Control Center
                </span>
              </div>

              <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-400 dark:text-zinc-500">
                {activeMeta.eyebrow}
              </p>
              <h1 className="dashboard-font-display mt-3 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-4xl">
                System Settings
              </h1>

              <div className="mt-6 flex flex-wrap gap-3">
                <span className="inline-flex rounded-full border border-zinc-200/80 bg-zinc-50 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                  {activeGroup.groupLabel}
                </span>
                <span className="inline-flex rounded-full border border-zinc-200/80 bg-zinc-50 px-3 py-1.5 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                  {activeItem.label}
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="xl:sticky xl:top-24 xl:self-start">
            <div className="overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/92 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.14)] backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
              <div className="border-b border-zinc-200/80 px-5 py-5 dark:border-zinc-800">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
                  Workspace Sections
                </p>
              </div>

              <nav className="space-y-6 p-4" aria-label="Settings navigation">
                {SIDEBAR_GROUPS.map((group) => (
                  <div key={group.groupLabel}>
                    <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
                      {group.groupLabel}
                    </p>

                    <ul className="mt-2 space-y-2">
                      {group.items.map((item) => {
                        const isActive = activeTab === item.key;
                        const ItemIcon = TAB_META[item.key]?.icon ?? Database;

                        return (
                          <li key={item.key}>
                            <RouterLink
                              href={tabHref(item.key)}
                              className={`group flex items-center gap-3 rounded-2xl border px-3 py-3 transition-all duration-200 ${
                                isActive
                                  ? "border-indigo-200/80 bg-indigo-50 text-indigo-900 shadow-sm dark:border-indigo-700/60 dark:bg-indigo-950/30 dark:text-indigo-100"
                                  : "border-transparent text-zinc-600 hover:border-zinc-200/80 hover:bg-zinc-50/80 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-950/60 dark:hover:text-zinc-100"
                              }`}
                            >
                              <div
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
                                  isActive
                                    ? "border-indigo-200 bg-white text-indigo-600 dark:border-indigo-700/60 dark:bg-indigo-950/40 dark:text-indigo-300"
                                    : "border-zinc-200/80 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                                }`}
                              >
                                <ItemIcon className="h-4 w-4" aria-hidden="true" />
                              </div>

                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold">{item.label}</p>
                                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                  {TAB_META[item.key]?.eyebrow ?? group.groupLabel}
                                </p>
                              </div>

                              <ArrowRight
                                className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
                                  isActive
                                    ? "text-indigo-500"
                                    : "text-zinc-300 group-hover:translate-x-0.5 group-hover:text-zinc-500 dark:text-zinc-600 dark:group-hover:text-zinc-300"
                                }`}
                                aria-hidden="true"
                              />
                            </RouterLink>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </nav>
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/92 shadow-[0_20px_60px_-24px_rgba(15,23,42,0.14)] backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
            <div className="border-b border-zinc-200/80 px-6 py-5 dark:border-zinc-800">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400 dark:text-zinc-500">
                  {activeMeta.eyebrow}
                </p>
                <div className="mt-3 flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-indigo-200/80 bg-linear-to-br from-indigo-50 to-sky-50 text-indigo-600 dark:border-indigo-700/60 dark:from-indigo-950/40 dark:to-sky-950/30 dark:text-indigo-300">
                    <ActiveIcon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="dashboard-font-display truncate text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                      {activeItem.label}
                    </h2>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-4 py-4 sm:px-6 sm:py-6">
              {isMasterDataTab && masterDataResult ? (
                masterDataResult.errorMessage ? (
                  <ErrorBox message={masterDataResult.errorMessage} />
                ) : (
                  <MasterDataTable
                    tableName={masterMeta.tableName}
                    displayName={masterMeta.displayName}
                    items={masterDataResult.data}
                  />
                )
              ) : null}

              {activeTab === "departments" && departmentsResult ? (
                departmentsResult.errorMessage ? (
                  <ErrorBox message={departmentsResult.errorMessage} />
                ) : (
                  <DepartmentsManagement departments={departmentsResult.data} />
                )
              ) : null}

              {activeTab === "finance" && financeResult ? (
                financeResult.errorMessage ? (
                  <ErrorBox message={financeResult.errorMessage} />
                ) : (
                  <FinanceApproversManagement approvers={financeResult.data} />
                )
              ) : null}

              {activeTab === "users" && usersResult ? (
                usersResult.errorMessage || !usersResult.data ? (
                  <ErrorBox message={usersResult.errorMessage ?? "Failed to load users."} />
                ) : (
                  <UsersManagement
                    users={usersResult.data.data}
                    hasNextPage={usersResult.data.hasNextPage}
                    nextCursor={usersResult.data.nextCursor}
                    hasPreviousPage={Boolean(previousCursor ?? cursor)}
                    previousCursor={previousCursor ?? (cursor ? "__first__" : null)}
                  />
                )
              ) : null}

              {activeTab === "admins" && adminsResult ? (
                adminsResult.errorMessage ? (
                  <ErrorBox message={adminsResult.errorMessage} />
                ) : (
                  <AdminsManagement admins={adminsResult.data} />
                )
              ) : null}

              {activeTab === "viewers" && viewersResult ? (
                viewersResult.errorMessage ? (
                  <ErrorBox message={viewersResult.errorMessage} />
                ) : (
                  <DepartmentViewersManagement
                    viewers={viewersResult.data}
                    departments={(departmentsResult?.data ?? []).map((department) => ({
                      id: department.id,
                      name: department.name,
                    }))}
                  />
                )
              ) : null}

              {activeTab === "policy" && policyGateStateResult ? (
                <PolicyManagement initialState={policyGateStateResult} />
              ) : null}

              {activeTab === "claim-override" ? <AdminClaimOverride /> : null}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-200">
      {message}
    </p>
  );
}
