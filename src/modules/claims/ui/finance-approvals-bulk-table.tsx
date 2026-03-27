"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DB_CLAIM_STATUSES, type DbClaimStatus } from "@/core/constants/statuses";
import { ROUTES } from "@/core/config/route-registry";
import {
  approveClaimAction,
  approveFinanceAction,
  bulkApprove,
  bulkMarkPaid,
  bulkReject,
  markPaymentDoneAction,
  rejectClaimAction,
  rejectFinanceAction,
} from "@/modules/claims/actions";
import type {
  ClaimAuditLogRecord,
  ClaimDetailType,
  ClaimSubmissionType,
  GetMyClaimsFilters,
} from "@/core/domain/claims/contracts";
import { ApprovalsAuditModeDialog } from "@/modules/claims/ui/approvals-quick-view-sheet";
import { ClaimDecisionActionForm } from "@/modules/claims/ui/claim-decision-action-form";
import { ClaimRejectWithReasonForm } from "@/modules/claims/ui/claim-reject-with-reason-form";
import { ClaimStatusBadge } from "@/modules/claims/ui/claim-status-badge";
import { getAvailableClaimActions } from "@/modules/claims/utils/get-available-claim-actions";

type FinanceApprovalRow = {
  id: string;
  employeeId: string;
  submitter: string;
  departmentName: string | null;
  paymentModeName: string;
  detailType: ClaimDetailType;
  submissionType: ClaimSubmissionType;
  onBehalfEmail: string | null;
  purpose: string | null;
  categoryName: string;
  expenseReceiptFilePath: string | null;
  expenseBankStatementFilePath: string | null;
  advanceSupportingDocumentPath: string | null;
  formattedTotalAmount: string;
  status: DbClaimStatus;
  formattedSubmittedAt: string;
  formattedHodActionDate: string;
  formattedFinanceActionDate: string;
};

type FinanceApprovalsBulkTableProps = {
  rows: FinanceApprovalRow[];
  actionableIds: string[];
  totalSelectableCount: number;
  filters: GetMyClaimsFilters;
  approvalScope: "l1" | "finance";
  evidenceSignedUrlByClaimId: Record<
    string,
    {
      expenseReceiptSignedUrl: string | null;
      expenseBankStatementSignedUrl: string | null;
      advanceSupportingDocumentSignedUrl: string | null;
    }
  >;
  auditLogsByClaimId: Record<string, (ClaimAuditLogRecord & { formattedCreatedAt: string })[]>;
};

function normalizeFilters(filters: GetMyClaimsFilters): GetMyClaimsFilters {
  const status = Array.isArray(filters.status)
    ? filters.status.filter((candidate): candidate is DbClaimStatus =>
        DB_CLAIM_STATUSES.includes(candidate as DbClaimStatus),
      )
    : undefined;

  return {
    ...filters,
    status,
    paymentModeId: filters.paymentModeId?.trim() || undefined,
    departmentId: filters.departmentId?.trim() || undefined,
    locationId: filters.locationId?.trim() || undefined,
    productId: filters.productId?.trim() || undefined,
    expenseCategoryId: filters.expenseCategoryId?.trim() || undefined,
    searchQuery: filters.searchQuery?.trim() || undefined,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  };
}

export function FinanceApprovalsBulkTable({
  rows,
  actionableIds,
  totalSelectableCount,
  filters,
  approvalScope,
  evidenceSignedUrlByClaimId,
  auditLogsByClaimId,
}: FinanceApprovalsBulkTableProps) {
  const router = useRouter();
  const actionFilters = normalizeFilters(filters) as Parameters<typeof bulkApprove>[0]["filters"];
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isGlobalSelect, setIsGlobalSelect] = useState(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [isSubmittingBulkReject, setIsSubmittingBulkReject] = useState(false);

  const selectedOnPageCount = useMemo(
    () => actionableIds.filter((id) => selectedIds.includes(id)).length,
    [actionableIds, selectedIds],
  );
  const isPageFullySelected =
    actionableIds.length > 0 && selectedOnPageCount === actionableIds.length;
  const selectedCount = isGlobalSelect ? totalSelectableCount : selectedIds.length;
  const canBulkAct = selectedCount > 0;

  // Map selected IDs back to their row data for status inspection.
  // When isGlobalSelect is true we can't inspect all pages, so we fall back to
  // trusting the server-side status guard and mark every action as valid.
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.includes(row.id)),
    [rows, selectedIds],
  );

  const isApproveValid = useMemo(() => {
    if (!canBulkAct) return false;
    if (isGlobalSelect) return true;
    const validStatus =
      approvalScope === "l1"
        ? ("Submitted - Awaiting HOD approval" as const)
        : ("HOD approved - Awaiting finance approval" as const);
    return selectedRows.length > 0 && selectedRows.every((row) => row.status === validStatus);
  }, [canBulkAct, isGlobalSelect, selectedRows, approvalScope]);

  const isRejectValid = isApproveValid;

  const isMarkAsPaidValid = useMemo(() => {
    if (!canBulkAct || approvalScope !== "finance") return false;
    if (isGlobalSelect) return true;
    return (
      selectedRows.length > 0 &&
      selectedRows.every((row) => row.status === "Finance Approved - Payment under process")
    );
  }, [canBulkAct, isGlobalSelect, selectedRows, approvalScope]);

  const approveRejectInvalidReason =
    approvalScope === "l1"
      ? "All selected claims must be 'Submitted - Awaiting HOD approval' to use this action"
      : "All selected claims must be 'HOD approved - Awaiting finance approval' to use this action";

  const approveTitle = !canBulkAct
    ? "Select claims to use this action"
    : !isApproveValid
      ? approveRejectInvalidReason
      : "Approve selected claims";

  const rejectTitle = !canBulkAct
    ? "Select claims to use this action"
    : !isRejectValid
      ? approveRejectInvalidReason
      : "Reject selected claims";

  const markPaidTitle = !canBulkAct
    ? "Select claims to use this action"
    : !isMarkAsPaidValid
      ? "All selected claims must be 'Finance Approved - Payment under process' to mark as paid"
      : "Mark selected claims as paid";

  const toggleMaster = (checked: boolean) => {
    if (!checked) {
      setSelectedIds([]);
      setIsGlobalSelect(false);
      return;
    }

    setSelectedIds([...actionableIds]);
    setIsGlobalSelect(false);
  };

  const toggleRow = (claimId: string, checked: boolean) => {
    setIsGlobalSelect(false);
    setSelectedIds((current) => {
      if (checked) {
        return current.includes(claimId) ? current : [...current, claimId];
      }

      return current.filter((id) => id !== claimId);
    });
  };

  const submitBulkApprove = async () => {
    if (!canBulkAct) {
      return;
    }

    await toast.promise(
      (async () => {
        if (approvalScope === "l1") {
          const targetIds = isGlobalSelect ? actionableIds : selectedIds;

          if (targetIds.length === 0) {
            throw new Error("No actionable claims selected.");
          }

          for (const claimId of targetIds) {
            const result = await approveClaimAction({ claimId });
            if (!result.ok) {
              throw new Error(result.message ?? "Unable to approve claim.");
            }
          }
        } else {
          const result = await bulkApprove({
            claimIds: selectedIds,
            isGlobalSelect,
            filters: actionFilters,
          });

          if (!result.ok) {
            throw new Error(result.message);
          }
        }

        setSelectedIds([]);
        setIsGlobalSelect(false);
        router.refresh();
        return approvalScope === "l1"
          ? `${(isGlobalSelect ? actionableIds : selectedIds).length} claim(s) approved.`
          : "Claims approved.";
      })(),
      {
        loading: "Bulk approving claims...",
        success: (message) => message,
        error: (error) => (error instanceof Error ? error.message : "Bulk approve failed."),
      },
    );
  };

  const submitBulkMarkPaid = async () => {
    if (approvalScope !== "finance") {
      return;
    }

    if (!canBulkAct) {
      return;
    }

    await toast.promise(
      (async () => {
        const result = await bulkMarkPaid({
          claimIds: selectedIds,
          isGlobalSelect,
          filters: actionFilters,
        });

        if (!result.ok) {
          throw new Error(result.message);
        }

        setSelectedIds([]);
        setIsGlobalSelect(false);
        router.refresh();
        return result.message;
      })(),
      {
        loading: "Bulk marking claims as paid...",
        success: (message) => message,
        error: (error) => (error instanceof Error ? error.message : "Bulk mark as paid failed."),
      },
    );
  };

  const submitBulkReject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canBulkAct || isSubmittingBulkReject) {
      return;
    }

    const formData = new FormData(event.currentTarget);
    const rejectionReason = String(formData.get("rejectionReason") ?? "").trim();
    const allowResubmission = formData.get("allowResubmission") === "true";

    setIsSubmittingBulkReject(true);

    try {
      await toast.promise(
        (async () => {
          if (approvalScope === "l1") {
            const targetIds = isGlobalSelect ? actionableIds : selectedIds;

            if (targetIds.length === 0) {
              throw new Error("No actionable claims selected.");
            }

            for (const claimId of targetIds) {
              const result = await rejectClaimAction({
                claimId,
                rejectionReason,
                allowResubmission,
              });

              if (!result.ok) {
                throw new Error(result.message ?? "Unable to reject claim.");
              }
            }
          } else {
            const result = await bulkReject({
              claimIds: selectedIds,
              isGlobalSelect,
              filters: actionFilters,
              rejectionReason,
              allowResubmission,
            });

            if (!result.ok) {
              throw new Error(result.message);
            }
          }

          setSelectedIds([]);
          setIsGlobalSelect(false);
          setIsRejectModalOpen(false);
          router.refresh();
          return approvalScope === "l1"
            ? `${(isGlobalSelect ? actionableIds : selectedIds).length} claim(s) rejected.`
            : "Claims rejected.";
        })(),
        {
          loading: "Bulk rejecting claims...",
          success: (message) => message,
          error: (error) => (error instanceof Error ? error.message : "Bulk reject failed."),
        },
      );
    } finally {
      setIsSubmittingBulkReject(false);
    }
  };

  return (
    <div className="min-h-[600px]">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            aria-hidden="true"
            className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-700 dark:text-zinc-300"
          >
            Approvals History
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={submitBulkApprove}
              disabled={!isApproveValid}
              title={approveTitle}
              className="inline-flex h-8 items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 transition-all duration-200 enabled:hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-700/60 dark:bg-emerald-950/20 dark:text-emerald-300 dark:enabled:hover:bg-emerald-950/40"
            >
              Bulk Approve
            </button>
            <button
              type="button"
              onClick={() => {
                if (isRejectValid) {
                  setIsRejectModalOpen(true);
                }
              }}
              disabled={!isRejectValid}
              title={rejectTitle}
              className="inline-flex h-8 items-center justify-center rounded-lg border border-rose-300 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition-all duration-200 enabled:hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700/60 dark:bg-rose-950/20 dark:text-rose-300 dark:enabled:hover:bg-rose-950/40"
            >
              Bulk Reject
            </button>
            {approvalScope === "finance" ? (
              <button
                type="button"
                onClick={submitBulkMarkPaid}
                disabled={!isMarkAsPaidValid}
                title={markPaidTitle}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-indigo-300 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 transition-all duration-200 enabled:hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-950/20 dark:text-indigo-300 dark:enabled:hover:bg-indigo-950/40"
              >
                Bulk Mark Paid
              </button>
            ) : null}
          </div>
        </div>

        {selectedCount > 0 ? (
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
            {selectedCount} claim(s) selected
          </p>
        ) : null}
      </div>

      {isPageFullySelected && !isGlobalSelect && totalSelectableCount > actionableIds.length ? (
        <div className="mx-4 mt-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/20 dark:text-indigo-300">
          All {actionableIds.length} claims on this page are selected.{" "}
          <button
            type="button"
            onClick={() => {
              setIsGlobalSelect(true);
            }}
            className="font-semibold underline underline-offset-2"
          >
            Select all {totalSelectableCount} claims
          </button>
        </div>
      ) : null}

      {isGlobalSelect ? (
        <div className="mx-4 mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
          All {totalSelectableCount} matching claims are selected.
          <button
            type="button"
            onClick={() => {
              setIsGlobalSelect(false);
              setSelectedIds([...actionableIds]);
            }}
            className="ml-2 font-semibold underline underline-offset-2"
          >
            Keep page-only selection
          </button>
        </div>
      ) : null}

      <div className="w-full overflow-x-auto">
        <table className="min-w-[1720px] divide-y divide-zinc-200 text-left text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 text-xs uppercase tracking-[0.12em] text-zinc-600 dark:bg-zinc-900/50 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={isPageFullySelected}
                  onChange={(event) => {
                    toggleMaster(event.currentTarget.checked);
                  }}
                  disabled={actionableIds.length === 0}
                  aria-label="Select all claims on this page"
                  data-testid="bulk-master-checkbox"
                  className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-700"
                />
              </th>
              <th className="whitespace-nowrap px-4 py-3 font-semibold">CLAIM ID</th>
              <th className="whitespace-nowrap px-4 py-3 font-semibold">EMPLOYEE ID</th>
              <th className="whitespace-nowrap px-4 py-3 font-semibold">EMPLOYEE NAME</th>
              <th className="whitespace-nowrap px-4 py-3 font-semibold">DEPARTMENT</th>
              <th className="whitespace-nowrap px-4 py-3 font-semibold">TYPE OF CLAIM</th>
              <th className="whitespace-nowrap px-4 py-3 font-semibold">AMOUNT</th>
              <th className="whitespace-nowrap px-4 py-3 font-semibold">STATUS</th>
              <th className="whitespace-nowrap px-4 py-3 font-semibold">SUBMITTED ON</th>
              <th className="whitespace-nowrap px-4 py-3 font-semibold">HOD ACTION DATE</th>
              <th className="whitespace-nowrap px-4 py-3 font-semibold">FINANCE ACTION DATE</th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white text-zinc-700 dark:divide-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            {rows.map((claim) => {
              const isChecked = isGlobalSelect || selectedIds.includes(claim.id);
              const userRole = approvalScope === "l1" ? "HOD" : "Finance";
              const availableActions = getAvailableClaimActions(claim.status, userRole);
              const canApproveOrReject = availableActions.canApprove && availableActions.canReject;
              const canMarkPaid = availableActions.canMarkPaid;
              const isActionable = canApproveOrReject || canMarkPaid;

              const approveSingle = async () => {
                const result =
                  approvalScope === "l1"
                    ? await approveClaimAction({ claimId: claim.id })
                    : await approveFinanceAction({ claimId: claim.id });
                if (!result.ok) {
                  throw new Error(result.message ?? "Unable to approve claim.");
                }
                router.refresh();
              };

              const rejectSingle = async (formData: FormData) => {
                const rejectionReason = String(formData.get("rejectionReason") ?? "").trim();
                const allowResubmission = formData.get("allowResubmission") === "true";
                const result =
                  approvalScope === "l1"
                    ? await rejectClaimAction({
                        claimId: claim.id,
                        rejectionReason,
                        allowResubmission,
                      })
                    : await rejectFinanceAction({
                        claimId: claim.id,
                        rejectionReason,
                        allowResubmission,
                      });

                if (!result.ok) {
                  throw new Error(result.message ?? "Unable to reject claim.");
                }

                router.refresh();
              };

              const markPaidSingle = async () => {
                const result = await markPaymentDoneAction({ claimId: claim.id });
                if (!result.ok) {
                  throw new Error(result.message ?? "Unable to mark as paid.");
                }
                router.refresh();
              };

              const renderRowActions = (compact: boolean) => {
                if (canApproveOrReject) {
                  return (
                    <>
                      <ClaimDecisionActionForm
                        action={approveSingle}
                        decision="approve"
                        compact={compact}
                        loadingMessage="Approving finance step..."
                        successMessage="Finance decision approved."
                        errorMessage="Unable to approve finance step."
                      />
                      <ClaimRejectWithReasonForm action={rejectSingle} compact={compact} />
                    </>
                  );
                }

                if (canMarkPaid) {
                  return (
                    <ClaimDecisionActionForm
                      action={markPaidSingle}
                      decision="mark-paid"
                      compact={compact}
                      loadingMessage="Marking payment as done..."
                      successMessage="Claim marked as paid."
                      errorMessage="Unable to mark payment as done."
                    />
                  );
                }

                return (
                  <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                    No actions
                  </span>
                );
              };

              return (
                <tr
                  key={claim.id}
                  className="group transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40"
                >
                  <td className="px-4 py-3">
                    {isActionable ? (
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(event) => {
                          toggleRow(claim.id, event.currentTarget.checked);
                        }}
                        aria-label={`Select claim ${claim.id}`}
                        className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-700"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="inline-block h-4 w-4 rounded border border-transparent"
                      />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                    <Link
                      href={ROUTES.claims.detail(claim.id)}
                      className="text-indigo-500 hover:text-indigo-400 hover:underline"
                    >
                      {claim.id}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{claim.employeeId}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block max-w-[220px] truncate align-bottom">
                      {claim.submitter}
                    </span>
                  </td>
                  <td className="px-4 py-3">{claim.departmentName ?? "Unknown Department"}</td>
                  <td className="px-4 py-3">{claim.paymentModeName}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100">
                    {claim.formattedTotalAmount}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <ClaimStatusBadge status={claim.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{claim.formattedSubmittedAt}</td>
                  <td className="whitespace-nowrap px-4 py-3">{claim.formattedHodActionDate}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {claim.formattedFinanceActionDate}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex min-w-[280px] flex-wrap items-start justify-end gap-2">
                      <ApprovalsAuditModeDialog
                        claimId={claim.id}
                        detailType={claim.detailType}
                        submitter={claim.submitter}
                        amountLabel={claim.formattedTotalAmount}
                        categoryName={claim.categoryName}
                        purpose={claim.purpose}
                        submissionType={claim.submissionType}
                        onBehalfEmail={claim.onBehalfEmail}
                        expenseReceiptFilePath={claim.expenseReceiptFilePath}
                        expenseReceiptSignedUrl={
                          evidenceSignedUrlByClaimId[claim.id]?.expenseReceiptSignedUrl ?? null
                        }
                        expenseBankStatementFilePath={claim.expenseBankStatementFilePath}
                        expenseBankStatementSignedUrl={
                          evidenceSignedUrlByClaimId[claim.id]?.expenseBankStatementSignedUrl ??
                          null
                        }
                        advanceSupportingDocumentPath={claim.advanceSupportingDocumentPath}
                        advanceSupportingDocumentSignedUrl={
                          evidenceSignedUrlByClaimId[claim.id]
                            ?.advanceSupportingDocumentSignedUrl ?? null
                        }
                        auditLogs={auditLogsByClaimId[claim.id] ?? []}
                      >
                        {renderRowActions(false)}
                      </ApprovalsAuditModeDialog>
                      {renderRowActions(true)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {isRejectModalOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close bulk reject dialog"
            className="absolute inset-0 bg-zinc-900/50"
            disabled={isSubmittingBulkReject}
            onClick={() => {
              setIsRejectModalOpen(false);
            }}
          />
          <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-lg -tranzinc-x-1/2 -tranzinc-y-1/2 rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Bulk Reject Claims
            </h3>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              One rejection reason will be applied to all selected claims.
            </p>

            <form onSubmit={submitBulkReject} className="mt-4 grid gap-4">
              <div className="grid gap-1.5">
                <label
                  htmlFor="bulkRejectionReason"
                  className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-600 dark:text-zinc-300"
                >
                  Shared Rejection Reason
                </label>
                <textarea
                  id="bulkRejectionReason"
                  name="rejectionReason"
                  required
                  minLength={5}
                  disabled={isSubmittingBulkReject}
                  rows={4}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-indigo-500 transition focus:ring dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  placeholder="Enter at least 5 characters"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="bulkAllowResubmission"
                  type="checkbox"
                  name="allowResubmission"
                  value="true"
                  disabled={isSubmittingBulkReject}
                  className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-700"
                />
                <label
                  htmlFor="bulkAllowResubmission"
                  className="text-sm text-zinc-700 dark:text-zinc-300"
                >
                  Allow resubmission for all selected claims
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isSubmittingBulkReject}
                  onClick={() => {
                    setIsRejectModalOpen(false);
                  }}
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 transition-all duration-200 hover:bg-zinc-100 active:scale-[0.98] disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingBulkReject}
                  className="inline-flex items-center justify-center rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-100 active:scale-[0.98] disabled:opacity-60 dark:border-rose-700/60 dark:bg-rose-950/20 dark:text-rose-300 dark:hover:bg-rose-950/40"
                >
                  {isSubmittingBulkReject ? "Processing..." : "Confirm Bulk Rejection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
