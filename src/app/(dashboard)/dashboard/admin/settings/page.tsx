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
import { AdminsManagement } from "@/modules/admin/ui/settings/admins-management";
import { DepartmentViewersManagement } from "@/modules/admin/ui/settings/department-viewers-management";
import { PolicyManagement } from "@/modules/admin/ui/settings/policy-management";
import { AdminClaimOverride } from "@/modules/admin/ui/settings/admin-claim-override";
import { AdminPaymentModeOverride } from "@/modules/admin/ui/settings/admin-payment-mode-override";
import { BackButton } from "@/components/ui/back-button";
import type { MasterDataTableName } from "@/core/domain/admin/contracts";
import { getPolicyGateState } from "@/modules/policies/server/get-policy-gate-state";
import { isAdminPaymentModeOverrideAllowedName } from "@/core/constants/payment-modes";

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
    items: [{ key: "admins", label: "Administrators" }],
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
  const [adminCheck, resolvedParams] = await Promise.all([isAdmin(), searchParams]);

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

  const isMasterDataTab = activeTab in MASTER_DATA_MAP;
  const masterMeta = MASTER_DATA_MAP[activeTab];

  const [
    adminsResult,
    viewersResult,
    masterDataResult,
    departmentsResult,
    financeResult,
    policyGateStateResult,
    paymentModeOverrideResult,
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
    activeTab === "policy" ? getPolicyGateState() : Promise.resolve(null),
    activeTab === "claim-override"
      ? masterDataService.getItems({ tableName: "master_payment_modes" })
      : Promise.resolve(null),
  ]);

  const paymentModeOverrideOptions = (paymentModeOverrideResult?.data ?? [])
    .filter((item) => item.isActive)
    .filter((item) => isAdminPaymentModeOverrideAllowedName(item.name))
    .map((item) => ({ id: item.id, name: item.name }));

  function tabHref(key: string) {
    return `${ROUTES.admin.settings}?tab=${key}`;
  }

  const activeGroup = getActiveGroup(activeTab);
  const activeItem = getActiveItem(activeGroup, activeTab);
  const activeMeta = TAB_META[activeTab] ?? TAB_META.categories;
  const ActiveIcon = activeMeta.icon;
  return (
    <main className="mx-auto max-w-400 px-4 py-6 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <BackButton fallbackHref={ROUTES.dashboard} className="w-fit" />
              <span className="inline-flex rounded-full border border-border bg-background-secondary px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Admin Control Center
              </span>
            </div>

            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {activeMeta.eyebrow}
            </p>
            <h1 className="dashboard-font-display mt-2 text-2xl font-semibold text-foreground">
              System Settings
            </h1>

            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex rounded-full border border-border bg-background-secondary px-3 py-1.5 text-xs font-medium text-foreground">
                {activeGroup.groupLabel}
              </span>
              <span className="inline-flex rounded-full border border-border bg-background-secondary px-3 py-1.5 text-xs font-medium text-foreground">
                {activeItem.label}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-24 xl:self-start">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Workspace Sections
              </p>
            </div>

            <nav className="space-y-4 p-3" aria-label="Settings navigation">
              {SIDEBAR_GROUPS.map((group) => (
                <div key={group.groupLabel}>
                  <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {group.groupLabel}
                  </p>

                  <ul className="mt-2 space-y-1">
                    {group.items.map((item) => {
                      const isActive = activeTab === item.key;
                      const ItemIcon = TAB_META[item.key]?.icon ?? Database;

                      return (
                        <li key={item.key}>
                          <RouterLink
                            href={tabHref(item.key)}
                            className={`group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                              isActive
                                ? "border-accent bg-accent-muted text-accent"
                                : "border-transparent text-muted-foreground hover:border-border hover:bg-background-secondary hover:text-foreground"
                            }`}
                          >
                            <div
                              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                                isActive
                                  ? "border-accent/30 bg-card text-accent"
                                  : "border-border bg-card text-muted-foreground"
                              }`}
                            >
                              <ItemIcon className="h-4 w-4" aria-hidden="true" />
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold">{item.label}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {TAB_META[item.key]?.eyebrow ?? group.groupLabel}
                              </p>
                            </div>

                            <ArrowRight
                              className={`h-4 w-4 shrink-0 transition-transform ${
                                isActive
                                  ? "text-accent"
                                  : "text-muted-foreground group-hover:translate-x-0.5 group-hover:text-foreground"
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

        <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {activeMeta.eyebrow}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background-secondary text-accent">
                  <ActiveIcon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="dashboard-font-display truncate text-xl font-semibold text-foreground">
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

            {activeTab === "claim-override" ? (
              <div className="space-y-4">
                <AdminClaimOverride />
                {paymentModeOverrideResult?.errorMessage ? (
                  <ErrorBox message={paymentModeOverrideResult.errorMessage} />
                ) : (
                  <AdminPaymentModeOverride paymentModes={paymentModeOverrideOptions} />
                )}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-200">
      {message}
    </p>
  );
}
