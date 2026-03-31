import Link from "next/link";
import { AppShellHeader } from "@/components/app-shell-header";
import { ROUTES } from "@/core/config/route-registry";
import { CLAIM_STATUSES, type ClaimStatus } from "@/core/constants/statuses";
import { GetMyClaimsService } from "@/core/domain/claims/GetMyClaimsService";
import type { ClaimSubmissionType, GetMyClaimsFilters } from "@/core/domain/claims/contracts";
import { logger } from "@/core/infra/logging/logger";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";
import { SupabaseClaimRepository } from "@/modules/claims/repositories/SupabaseClaimRepository";

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
      <div className="min-h-screen bg-zinc-50 px-6 py-8 dark:bg-[#0B0F1A]">
        <main className="mx-auto max-w-6xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm transition-colors dark:border-rose-900/40 dark:bg-zinc-900">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">My Claims</h1>
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            Unable to authenticate your session.{" "}
            {currentUserResult.errorMessage ?? "Please log in again."}
          </p>
          <Link
            href={ROUTES.login}
            className="mt-4 inline-flex rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-zinc-700 active:scale-[0.98] dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Go to Login
          </Link>
        </main>
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
    <div className="min-h-screen bg-zinc-50 dark:bg-[#0B0F1A]">
      <AppShellHeader currentEmail={currentEmail} />
      <div className="px-6 py-8">
        <main className="mx-auto max-w-6xl space-y-5">
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
                  My Claims
                </h1>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  View and manage your reimbursement claims
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={ROUTES.claims.new}
                  className="inline-flex items-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98]"
                >
                  + New Claim
                </Link>
              </div>
            </div>
          </section>

          <section className="grid gap-5 md:grid-cols-3">
            <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                Total Claims
              </p>
              <p className="mt-2 text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
                {claimRows.length}
              </p>
            </article>

            <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                Active Filter
              </p>
              <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {selectedStatus ?? "All Statuses"}
              </p>
            </article>

            <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                Submission Type
              </p>
              <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {selectedSubmissionType ?? "All Types"}
              </p>
            </article>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
            <form method="GET" action={ROUTES.claims.list} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-5">
                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Payment Mode
                  <select
                    name="paymentModeId"
                    defaultValue={selectedPaymentModeId ?? ""}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    <option value="">All Payment Modes</option>
                    {paymentModesResult.data.map((mode) => (
                      <option key={mode.id} value={mode.id}>
                        {mode.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Submission Type
                  <select
                    name="submissionType"
                    defaultValue={selectedSubmissionType ?? ""}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    <option value="">All Types</option>
                    {SUBMISSION_TYPES.map((submissionType) => (
                      <option key={submissionType} value={submissionType}>
                        {submissionType}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  Status
                  <select
                    name="status"
                    defaultValue={selectedStatus ?? ""}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    <option value="">All Statuses</option>
                    {CLAIM_STATUSES.map((statusOption) => (
                      <option key={statusOption} value={statusOption}>
                        {statusOption}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  From Date
                  <input
                    name="fromDate"
                    type="date"
                    defaultValue={selectedFromDate ?? ""}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </label>

                <label className="grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                  To Date
                  <input
                    name="toDate"
                    type="date"
                    defaultValue={selectedToDate ?? ""}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </label>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className="inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:bg-indigo-500 active:scale-[0.98]"
                >
                  Apply
                </button>
                <Link
                  href={ROUTES.claims.list}
                  className="inline-flex rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Reset
                </Link>
              </div>
            </form>
          </section>

          <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-colors dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-700 dark:text-zinc-300">
                All Claims
              </h2>
            </div>

            {hasError ? (
              <div className="px-4 py-6">
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
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-zinc-200 text-left text-sm dark:divide-zinc-800">
                  <thead className="bg-zinc-50 text-xs uppercase tracking-[0.12em] text-zinc-600 dark:bg-zinc-900/50 dark:text-zinc-400">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Claim ID</th>
                      <th className="px-4 py-3 font-semibold">Department</th>
                      <th className="px-4 py-3 font-semibold">Total Amount</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Submitted On</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white text-zinc-700 dark:divide-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                    {claimRows.map((claim) => (
                      <tr
                        key={claim.id}
                        className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40"
                      >
                        <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                          {claim.claimId}
                        </td>
                        <td className="px-4 py-3">{claim.department}</td>
                        <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100">
                          {formatAmount(claim.totalAmount)}
                        </td>
                        <td className="px-4 py-3">{claim.status}</td>
                        <td className="px-4 py-3">{formatSubmittedDate(claim.submittedOn)}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
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
