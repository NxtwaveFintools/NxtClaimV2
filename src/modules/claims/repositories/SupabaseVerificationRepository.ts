import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import {
  normalizeSentinel,
  type SubmittedSnapshot,
} from "@/modules/claims/verification/comparison-engine";
import {
  gradeDuplicateArms,
  type DuplicateArm,
} from "@/modules/claims/verification/duplicate-grading";

const CLAIMS_BUCKET = "claims";

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function inferMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

export type VerificationTrigger = "l1_approved" | "finance_edit" | "manual_rerun";

export type VerificationRunRow = {
  id: string;
  claim_id: string;
  trigger: VerificationTrigger;
  attempts: number;
  receipt_file_path: string | null;
  bank_statement_file_path: string | null;
  submitted_values_snapshot: SubmittedSnapshot;
};

export type VerificationCheckInput = {
  field: string;
  lane: string;
  submitted_value: string | null;
  extracted_raw: string | null;
  extracted_normalized: string | null;
  verdict: string;
  hardness: string;
  confidence: number | null;
  tolerance_applied: string | null;
  mismatch_reason: string | null;
};

export class SupabaseVerificationRepository {
  /** Download a stored receipt for server-side re-extraction. */
  async downloadClaimEvidence(filePath: string): Promise<{
    data: { buffer: Buffer; mimeType: string } | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client.storage.from(CLAIMS_BUCKET).download(filePath);

    if (error || !data) {
      return { data: null, errorMessage: error?.message ?? "File not found in storage." };
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const mimeType = data.type && data.type.length > 0 ? data.type : inferMimeType(filePath);
    return { data: { buffer, mimeType }, errorMessage: null };
  }

  /** Enqueue a verification run (no-op returning null id for non-expense claims). */
  async enqueueVerificationRun(input: {
    claimId: string;
    trigger: VerificationTrigger;
  }): Promise<{ data: string | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client.rpc("enqueue_verification_run", {
      p_claim_id: input.claimId,
      p_trigger: input.trigger,
    });
    if (error) {
      return { data: null, errorMessage: error.message };
    }
    return { data: (data as string | null) ?? null, errorMessage: null };
  }

  /** Atomically claim up to `limit` queued runs (FOR UPDATE SKIP LOCKED). */
  async dequeueVerificationRuns(
    limit: number,
  ): Promise<{ data: VerificationRunRow[]; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client.rpc("dequeue_verification_runs", { p_limit: limit });
    if (error) {
      return { data: [], errorMessage: error.message };
    }
    return { data: (data as VerificationRunRow[]) ?? [], errorMessage: null };
  }

  async completeVerificationRun(input: {
    runId: string;
    overallVerdict: string;
    model: string;
    receiptHash: string | null;
    bankHash: string | null;
    invoiceDuplicateStatus: string;
    invoiceDuplicateClaimIds: string[];
    amountDateDuplicateStatus: string;
    amountDateDuplicateClaimIds: string[];
    checks: VerificationCheckInput[];
  }): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { error } = await client.rpc("complete_verification_run", {
      p_run_id: input.runId,
      p_overall_verdict: input.overallVerdict,
      p_model: input.model,
      p_receipt_hash: input.receiptHash,
      p_bank_hash: input.bankHash,
      p_invoice_duplicate_status: input.invoiceDuplicateStatus,
      p_invoice_duplicate_claim_ids: input.invoiceDuplicateClaimIds,
      p_amount_date_duplicate_status: input.amountDateDuplicateStatus,
      p_amount_date_duplicate_claim_ids: input.amountDateDuplicateClaimIds,
      p_checks: input.checks,
    });
    return { errorMessage: error?.message ?? null };
  }

  /**
   * Finance-stage duplicate detection on EXTRACTED values. Grades BOTH arms
   * (invoice number AND amount+date) independently — a claim may match either,
   * both, or neither, against potentially different peer claims. A failed
   * invoice read (submitted invoice present but nothing extracted) marks the
   * invoice arm `unavailable` while still grading amount+date.
   */
  async detectDuplicate(input: {
    claimId: string;
    extractedBillNo: string | null;
    submittedBillNo: string | null;
    transactionDate: string | null;
    totalAmount: number | null;
  }): Promise<{
    data: { invoice: DuplicateArm; amountDate: DuplicateArm };
    errorMessage: string | null;
  }> {
    const extractedInv = normalizeSentinel(input.extractedBillNo);
    const submittedInv = normalizeSentinel(input.submittedBillNo);
    const invoiceUnavailable = extractedInv === null && submittedInv !== null;
    const amountDateAvailable = input.transactionDate !== null && input.totalAmount !== null;

    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client.rpc("find_claim_duplicates", {
      p_exclude_claim_id: input.claimId,
      p_bill_no: extractedInv, // null → invoice arm yields nothing; amount+date arm still runs
      p_transaction_date: input.transactionDate,
      p_total_amount: input.totalAmount,
    });
    if (error) {
      return {
        data: {
          invoice: { status: "unavailable", claimIds: [] },
          amountDate: { status: "unavailable", claimIds: [] },
        },
        errorMessage: error.message,
      };
    }

    const rows = (data ?? []) as { claim_id: string; match_kind: string }[];
    return {
      data: gradeDuplicateArms(rows, { invoiceUnavailable, amountDateAvailable }),
      errorMessage: null,
    };
  }

  async failVerificationRun(input: {
    runId: string;
    error: string;
    retryable: boolean;
  }): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { error } = await client.rpc("fail_verification_run", {
      p_run_id: input.runId,
      p_error: input.error,
      p_retryable: input.retryable,
    });
    return { errorMessage: error?.message ?? null };
  }

  /** Single-flight: returns true when this worker now holds the lease. */
  async acquireWorkerLease(ttlSeconds: number): Promise<boolean> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client.rpc("acquire_verification_worker_lease", {
      p_ttl_seconds: ttlSeconds,
    });
    if (error) {
      return false;
    }
    return data === true;
  }

  async releaseWorkerLease(): Promise<void> {
    const client = getServiceRoleSupabaseClient();
    await client.rpc("release_verification_worker_lease");
  }

  /** Latest non-superseded run for a claim, with its per-field checks (for the panel). */
  async getClaimVerificationSummary(
    claimId: string,
  ): Promise<{ data: VerificationSummary | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data: runRows, error: runError } = await client
      .from("claim_verification_runs")
      .select(
        "id, status, overall_verdict, duplicate_status, duplicate_claim_ids, model, receipt_file_hash, finished_at, created_at",
      )
      .eq("claim_id", claimId)
      .eq("superseded", false)
      .order("created_at", { ascending: false })
      .limit(1);

    if (runError) {
      return { data: null, errorMessage: runError.message };
    }
    const run = (runRows ?? [])[0] as VerificationRunSummaryRow | undefined;
    if (!run) {
      return { data: null, errorMessage: null };
    }

    const { data: checkRows, error: checkError } = await client
      .from("claim_verification_checks")
      .select(
        "field, lane, submitted_value, extracted_raw, extracted_normalized, verdict, hardness, confidence, tolerance_applied, mismatch_reason",
      )
      .eq("run_id", run.id);

    if (checkError) {
      return { data: null, errorMessage: checkError.message };
    }

    return {
      data: {
        runId: run.id,
        status: run.status,
        overallVerdict: run.overall_verdict,
        duplicateStatus: run.duplicate_status,
        duplicateClaimIds: run.duplicate_claim_ids ?? [],
        model: run.model,
        receiptFileHash: run.receipt_file_hash,
        finishedAt: run.finished_at,
        checks: ((checkRows ?? []) as VerificationCheckRow[]).map((c) => ({
          field: c.field,
          lane: c.lane,
          submittedValue: c.submitted_value,
          extractedRaw: c.extracted_raw,
          extractedNormalized: c.extracted_normalized,
          verdict: c.verdict,
          hardness: c.hardness,
          confidence: c.confidence,
          toleranceApplied: c.tolerance_applied,
          mismatchReason: c.mismatch_reason,
        })),
      },
      errorMessage: null,
    };
  }

  /** Bulk badge state + duplicate status for the finance queue, one entry per claim id. */
  async getLatestVerdictsByClaimIds(claimIds: string[]): Promise<{
    data: Record<string, { verdict: VerificationBadgeState; duplicate: DuplicateStatus }>;
    errorMessage: string | null;
  }> {
    if (claimIds.length === 0) {
      return { data: {}, errorMessage: null };
    }
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("claim_latest_verification")
      .select("claim_id, status, overall_verdict, duplicate_status")
      .in("claim_id", claimIds);

    if (error) {
      return { data: {}, errorMessage: error.message };
    }

    const map: Record<string, { verdict: VerificationBadgeState; duplicate: DuplicateStatus }> = {};
    for (const row of (data ?? []) as LatestVerificationRow[]) {
      map[row.claim_id] = {
        verdict: deriveBadgeState(row.status, row.overall_verdict),
        duplicate: (row.duplicate_status ?? "unavailable") as DuplicateStatus,
      };
    }
    return { data: map, errorMessage: null };
  }

  /** Count of finance-queue claims per AI badge state (drives the filter chips). */
  async getFinanceQueueVerdictCounts(): Promise<{
    data: Record<VerificationBadgeState, number>;
    errorMessage: string | null;
  }> {
    const empty: Record<VerificationBadgeState, number> = {
      pending: 0,
      verified: 0,
      mismatch: 0,
      statement_mismatch: 0,
      needs_review: 0,
      extraction_failed: 0,
      no_document: 0,
    };
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("finance_verification_queue_badge")
      .select("badge_state");
    if (error) {
      return { data: empty, errorMessage: error.message };
    }
    const counts = { ...empty };
    for (const row of (data ?? []) as { badge_state: VerificationBadgeState }[]) {
      if (row.badge_state in counts) {
        counts[row.badge_state] += 1;
      }
    }
    return { data: counts, errorMessage: null };
  }

  /** Claim ids in the finance queue whose latest badge matches `state` (server-side filter). */
  async getFinanceQueueClaimIdsByVerdict(
    state: VerificationBadgeState,
  ): Promise<{ data: string[]; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("finance_verification_queue_badge")
      .select("claim_id")
      .eq("badge_state", state);
    if (error) {
      return { data: [], errorMessage: error.message };
    }
    return {
      data: ((data ?? []) as { claim_id: string }[]).map((r) => r.claim_id),
      errorMessage: null,
    };
  }

  /** Mark-verified-anyway: records an override audit entry attributed to the finance user. */
  async overrideVerification(input: {
    claimId: string;
    actorId: string;
    reason: string | null;
  }): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { error } = await client.rpc("override_verification_run", {
      p_claim_id: input.claimId,
      p_actor_id: input.actorId,
      p_reason: input.reason,
    });
    return { errorMessage: error?.message ?? null };
  }

  /** Manual re-run requested by a finance user. */
  async rerunVerification(input: {
    claimId: string;
    actorId: string;
  }): Promise<{ data: string | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client.rpc("rerun_verification", {
      p_claim_id: input.claimId,
      p_actor_id: input.actorId,
    });
    if (error) {
      return { data: null, errorMessage: error.message };
    }
    return { data: (data as string | null) ?? null, errorMessage: null };
  }
}

type VerificationRunSummaryRow = {
  id: string;
  status: string;
  overall_verdict: string | null;
  duplicate_status: DuplicateStatus;
  duplicate_claim_ids: string[] | null;
  model: string | null;
  receipt_file_hash: string | null;
  finished_at: string | null;
  created_at: string;
};

type VerificationCheckRow = {
  field: string;
  lane: string;
  submitted_value: string | null;
  extracted_raw: string | null;
  extracted_normalized: string | null;
  verdict: string;
  hardness: string;
  confidence: number | null;
  tolerance_applied: string | null;
  mismatch_reason: string | null;
};

export type VerificationCheckRecord = {
  field: string;
  lane: string;
  submittedValue: string | null;
  extractedRaw: string | null;
  extractedNormalized: string | null;
  verdict: string;
  hardness: string;
  confidence: number | null;
  toleranceApplied: string | null;
  mismatchReason: string | null;
};

export type DuplicateStatus = "none" | "invoice_match" | "amount_date_match" | "unavailable";

export type VerificationSummary = {
  runId: string;
  status: string;
  overallVerdict: string | null;
  duplicateStatus: DuplicateStatus;
  duplicateClaimIds: string[];
  model: string | null;
  receiptFileHash: string | null;
  finishedAt: string | null;
  checks: VerificationCheckRecord[];
};

export type VerificationBadgeState =
  | "pending"
  | "verified"
  | "mismatch"
  | "statement_mismatch"
  | "needs_review"
  | "extraction_failed"
  | "no_document";

type LatestVerificationRow = {
  claim_id: string;
  status: string;
  overall_verdict: string | null;
  duplicate_status: DuplicateStatus | null;
};

const VERIFICATION_BADGE_STATES: VerificationBadgeState[] = [
  "pending",
  "verified",
  "mismatch",
  "statement_mismatch",
  "needs_review",
  "extraction_failed",
  "no_document",
];

export function isVerificationBadgeState(value: unknown): value is VerificationBadgeState {
  return (
    typeof value === "string" && VERIFICATION_BADGE_STATES.includes(value as VerificationBadgeState)
  );
}

function deriveBadgeState(status: string, verdict: string | null): VerificationBadgeState {
  if (status === "queued" || status === "running") {
    return "pending";
  }
  switch (verdict) {
    case "verified":
    case "mismatch":
    case "statement_mismatch":
    case "needs_review":
    case "no_document":
      return verdict;
    default:
      return "extraction_failed";
  }
}
