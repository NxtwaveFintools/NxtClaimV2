import Link from "next/link";
import { AppShellHeader } from "@/components/app-shell-header";
import { ROUTES } from "@/core/config/route-registry";
import { CLAIM_STATUSES, type ClaimStatus } from "@/core/constants/statuses";
import { GetMyClaimsService } from "@/core/domain/claims/GetMyClaimsService";
import type { ClaimSubmissionType, GetMyClaimsFilters } from "@/core/domain/claims/contracts";
import { logger } from "@/core/infra/logging/logger";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";
import {
  CLAIM_STATUS_COLUMN_WIDTH_CLASSES,
  ClaimStatusBadge,
} from "@/modules/claims/ui/claim-status-badge";

const SUBMISSION_TYPES: ClaimSubmissionType[] = ["Self", "On Behalf"];

type SearchParamsValue = string | string[] | undefined;

function firstParamValue(value: SearchParamsValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function normalizeClaimStatus(value: string | undefined): ClaimStatus | undefined {
  if (!value) {
    return undefined;
  }

  if (CLAIM_STATUSES.includes(value as ClaimStatus)) {
    return value as ClaimStatus;
  }

  return undefined;
}

function normalizeSubmissionType(value: string | undefined): ClaimSubmissionType | undefined {
  if (value === "Self" || value === "On Behalf") {
    return value;
  }

  return undefined;
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return value;
}

function formatSubmittedDate(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export default async function MyClaimsPage({
  searchParams,
}: {
  searchParams?: Record<string, SearchParamsValue>;
}) {
  const authRepository = new SupabaseServerAuthRepository();
  const claimRepository = new SupabaseClaimRepository();
  const claimsService = new GetMyClaimsService({ repository: claimRepository, logger });

  const currentUserResult = await authRepository.getCurrentUser();

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return (
      <div className="nxt-page-bg">
        <AppShellHeader />
        <div className="relative mx-auto max-w-400 px-4 py-6 sm:px-6 lg:px-8">
          <main className="mx-auto max-w-6xl rounded-[28px] border border-rose-200 bg-white/92 p-6 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-colors dark:border-rose-900/40 dark:bg-zinc-900/92">
            <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">My Claims</h1>
            <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
              Unable to authenticate your session.{" "}
              {currentUserResult.errorMessage ?? "Please log in again."}
            </p>
            <Link
              href={ROUTES.login}
              className="mt-4 inline-flex rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98]"
            >
              Go to Login
            </Link>
          </main>
        </div>
      </div>
    );
  }

  const selectedPaymentModeId = firstParamValue(searchParams?.paymentModeId);
  const selectedSubmissionType = normalizeSubmissionType(
    firstParamValue(searchParams?.submissionType),
  );
  const selectedStatus = normalizeClaimStatus(firstParamValue(searchParams?.status));
  const selectedFromDate = normalizeDate(firstParamValue(searchParams?.fromDate));
  const selectedToDate = normalizeDate(firstParamValue(searchParams?.toDate));

  const filters: GetMyClaimsFilters = {
    paymentModeId: selectedPaymentModeId,
    submissionType: selectedSubmissionType,
    status: selectedStatus,
    dateType: "claim_date",
    fromDate: selectedFromDate,
    toDate: selectedToDate,
  };

  const [claimsResult, paymentModesResult] = await Promise.all([
    claimsService.execute({
      userId: currentUserResult.user.id,
      filters,
    }),
    claimRepository.getActivePaymentModes(),
  ]);

  const claimRows = claimsResult.claims;
  const hasError = Boolean(claimsResult.errorMessage || paymentModesResult.errorMessage);
  const currentEmail = currentUserResult.user.email ?? "Unknown User";

  return (
    <div className="nxt-page-bg">
      <AppShellHeader currentEmail={currentEmail} />
      <div className="relative z-0 mx-auto w-full max-w-400 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <main className="mx-auto max-w-6xl space-y-5">
          <section className="overflow-hidden rounded-[28px] border border-zinc-200/70 bg-white/88 shadow-[0_24px_70px_-30px_rgba(15,23,42,0.14),0_8px_24px_-8px_rgba(99,102,241,0.05)] backdrop-blur-lg transition-colors dark:border-zinc-800/80 dark:bg-zinc-900/88 dark:shadow-[0_24px_70px_-30px_rgba(0,0,0,0.40)]">
            {/* Gradient top stripe */}
            <div className="h-1 w-full bg-linear-to-r from-indigo-500 via-violet-500 to-sky-500" />
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold tracking-[-0.03em] text-zinc-950 sm:text-3xl dark:text-zinc-50">
                    My Claims
                  </h1>
                  <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                    View and manage your reimbursement claims
                  </p>
                </div>
                <div className="flex items-center gap-2.5">
                  <Link
                    href={ROUTES.claims.new}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98]"
                  >
                    + New Claim
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <article className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white/92 p-5 shadow-[0_4px_24px_-8px_rgba(15,23,42,0.06)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/80 dark:shadow-black/10">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
                Total Claims
              </p>
              <p className="mt-2 text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
                {claimRows.length}
              </p>
            </article>

            <article className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white/92 p-5 shadow-[0_4px_24px_-8px_rgba(15,23,42,0.06)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/80 dark:shadow-black/10">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
                Active Filter
              </p>
              <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {selectedStatus ?? "All Statuses"}
              </p>
            </article>

            <article className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white/92 p-5 shadow-[0_4px_24px_-8px_rgba(15,23,42,0.06)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/80 dark:shadow-black/10">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
                Submission Type
              </p>
              <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {selectedSubmissionType ?? "All Types"}
              </p>
            </article>
          </section>

          <section className="rounded-[28px] border border-zinc-200/80 bg-white/92 p-5 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
            <form method="GET" action={ROUTES.claims.list} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-5">
                <label className="grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  Payment Mode
                  <select
                    name="paymentModeId"
                    defaultValue={selectedPaymentModeId ?? ""}
                    className="nxt-input rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    <option value="">All Payment Modes</option>
                    {paymentModesResult.data.map((mode) => (
                      <option key={mode.id} value={mode.id}>
                        {mode.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  Submission Type
                  <select
                    name="submissionType"
                    defaultValue={selectedSubmissionType ?? ""}
                    className="nxt-input rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    <option value="">All Types</option>
                    {SUBMISSION_TYPES.map((submissionType) => (
                      <option key={submissionType} value={submissionType}>
                        {submissionType}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  Status
                  <select
                    name="status"
                    defaultValue={selectedStatus ?? ""}
                    className="nxt-input rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    <option value="">All Statuses</option>
                    {CLAIM_STATUSES.map((statusOption) => (
                      <option key={statusOption} value={statusOption}>
                        {statusOption}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  From Date
                  <input
                    name="fromDate"
                    type="date"
                    defaultValue={selectedFromDate ?? ""}
                    className="nxt-input rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </label>

                <label className="grid gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  To Date
                  <input
                    name="toDate"
                    type="date"
                    defaultValue={selectedToDate ?? ""}
                    className="nxt-input rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  className="inline-flex rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98]"
                >
                  Apply
                </button>
                <Link
                  href={ROUTES.claims.list}
                  className="inline-flex rounded-xl border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Reset
                </Link>
              </div>
            </form>
          </section>

          <section className="overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/92 shadow-[0_20px_60px_-20px_rgba(15,23,42,0.12)] backdrop-blur-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900/92 dark:shadow-black/25">
            <div className="border-b border-zinc-200/80 px-5 py-3.5 dark:border-zinc-800">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
                All Claims
              </h2>
            </div>

            {hasError ? (
              <div className="px-5 py-6">
                <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
                  Unable to load claims.{" "}
                  {claimsResult.errorMessage ?? paymentModesResult.errorMessage}
                </p>
              </div>
            ) : claimRows.length === 0 ? (
              <div className="grid place-items-center px-4 py-14 text-center">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-12 w-12 text-zinc-300">
                  <path
                    fill="currentColor"
                    d="M7 3h10l3 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8l3-5Zm.53 2L6.33 7h11.34l-1.2-2H7.53ZM6 9v10h12V9H6Z"
                  />
                </svg>
                <p className="mt-4 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  No claims found
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                  Try changing filters or create a new claim.
                </p>
              </div>
            ) : (
              <div className="nxt-scroll overflow-x-auto">
                <table className="min-w-full divide-y divide-zinc-200/80 text-left text-sm dark:divide-zinc-800">
                  <thead className="bg-zinc-50/80 text-[11px] uppercase tracking-[0.14em] text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
                    <tr>
                      <th className="px-5 py-3.5 font-semibold">Claim ID</th>
                      <th className="px-5 py-3.5 font-semibold">Department</th>
                      <th className="px-5 py-3.5 font-semibold">Total Amount</th>
                      <th
                        className={`${CLAIM_STATUS_COLUMN_WIDTH_CLASSES} px-5 py-3.5 font-semibold`}
                      >
                        Status
                      </th>
                      <th className="px-5 py-3.5 font-semibold">Submitted On</th>
                      <th className="px-5 py-3.5 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100/80 bg-white/50 text-zinc-700 dark:divide-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-300">
                    {claimRows.map((claim) => (
                      <tr
                        key={claim.id}
                        className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40"
                      >
                        <td className="px-5 py-3.5 font-medium text-zinc-900 dark:text-zinc-100">
                          {claim.claimId}
                        </td>
                        <td className="px-5 py-3.5">{claim.department}</td>
                        <td className="px-5 py-3.5 font-semibold text-zinc-900 dark:text-zinc-100">
                          {formatAmount(claim.totalAmount)}
                        </td>
                        <td
                          className={`${CLAIM_STATUS_COLUMN_WIDTH_CLASSES} px-5 py-3.5 align-top`}
                        >
                          <ClaimStatusBadge status={claim.status} fullWidth />
                        </td>
                        <td className="px-5 py-3.5">{formatSubmittedDate(claim.submittedOn)}</td>
                        <td className="px-5 py-3.5">
                          <span className="inline-flex rounded-xl border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                            View
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
