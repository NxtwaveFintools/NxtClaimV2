import Link from "next/link";
import { notFound } from "next/navigation";
import { logger } from "@/core/infra/logging/logger";
import { ROUTES } from "@/core/config/route-registry";
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
import { BackButton } from "@/components/ui/back-button";
import { ThemeToggle } from "@/components/theme-toggle";
import type { MasterDataTableName } from "@/core/domain/admin/contracts";

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
];

const ALL_KEYS = SIDEBAR_GROUPS.flatMap((g) => g.items.map((i) => i.key));
type TabKey = string;

const MASTER_DATA_MAP: Record<string, { tableName: MasterDataTableName; displayName: string }> = {
  categories: { tableName: "master_expense_categories", displayName: "Expense Categories" },
  products: { tableName: "master_products", displayName: "Products" },
  locations: { tableName: "master_locations", displayName: "Locations" },
  "payment-modes": { tableName: "master_payment_modes", displayName: "Payment Modes" },
};

const PAGE_SIZE = 20;

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchParamsValue>>;
}) {
  const adminCheck = await isAdmin();
  if (!adminCheck) {
    notFound();
  }

  const resolvedParams = await searchParams;
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
    masterDataResult,
    departmentsResult,
    financeResult,
    usersResult,
    adminsResult,
    viewersResult,
  ] = await Promise.all([
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
    activeTab === "admins" ? adminsService.getAdmins() : Promise.resolve(null),
    activeTab === "viewers" ? viewersService.getDepartmentViewers() : Promise.resolve(null),
  ]);

  const allUsersResult =
    activeTab === "finance" ? await adminsService.getAllUsers({ cursor: null, limit: 500 }) : null;

  const allUsers = allUsersResult?.data?.data ?? [];

  function tabHref(key: string) {
    return `${ROUTES.admin.settings}?tab=${key}`;
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-8 dark:bg-[#0B0F1A] sm:px-6">
      <main className="mx-auto max-w-6xl space-y-6">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <BackButton fallbackHref={ROUTES.claims.myClaims} className="w-fit" />
          <ThemeToggle />
        </div>

        {/* Page header */}
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">System Settings</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage master data, departments, and system roles.
          </p>
        </div>

        {/* Sidebar + content layout */}
        <div className="flex flex-col gap-6 md:flex-row md:gap-8">
          {/* Left sidebar */}
          <aside className="w-full flex-shrink-0 md:w-56">
            <nav className="space-y-5" aria-label="Settings navigation">
              {SIDEBAR_GROUPS.map((group) => (
                <div key={group.groupLabel}>
                  <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                    {group.groupLabel}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((item) => {
                      const isActive = activeTab === item.key;
                      return (
                        <li key={item.key}>
                          <Link
                            href={tabHref(item.key)}
                            className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                              isActive
                                ? "bg-indigo-600 text-white shadow-sm"
                                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            }`}
                          >
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>

          {/* Right content */}
          <div className="min-w-0 flex-1">
            <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
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
                    departments={(departmentsResult?.data ?? []).map((d) => ({
                      id: d.id,
                      name: d.name,
                    }))}
                  />
                )
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
      {message}
    </p>
  );
}
