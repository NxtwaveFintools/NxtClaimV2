import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import type { SubmittedSnapshot } from "@/modules/claims/verification/comparison-engine";

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
  submitted_values_snapshot: SubmittedSnapshot;
};

export type VerificationCheckInput = {
  field: string;
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
    checks: VerificationCheckInput[];
  }): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { error } = await client.rpc("complete_verification_run", {
      p_run_id: input.runId,
      p_overall_verdict: input.overallVerdict,
      p_model: input.model,
      p_receipt_hash: input.receiptHash,
      p_checks: input.checks,
    });
    return { errorMessage: error?.message ?? null };
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
      .select("id, status, overall_verdict, model, receipt_file_hash, finished_at, created_at")
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
        "field, submitted_value, extracted_raw, extracted_normalized, verdict, hardness, confidence, tolerance_applied, mismatch_reason",
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
        model: run.model,
        receiptFileHash: run.receipt_file_hash,
        finishedAt: run.finished_at,
        checks: ((checkRows ?? []) as VerificationCheckRow[]).map((c) => ({
          field: c.field,
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

  /** Bulk badge states for the finance queue: one derived state per claim id. */
  async getLatestVerdictsByClaimIds(
    claimIds: string[],
  ): Promise<{ data: Record<string, VerificationBadgeState>; errorMessage: string | null }> {
    if (claimIds.length === 0) {
      return { data: {}, errorMessage: null };
    }
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("claim_latest_verification")
      .select("claim_id, status, overall_verdict")
      .in("claim_id", claimIds);

    if (error) {
      return { data: {}, errorMessage: error.message };
    }

    const map: Record<string, VerificationBadgeState> = {};
    for (const row of (data ?? []) as LatestVerificationRow[]) {
      map[row.claim_id] = deriveBadgeState(row.status, row.overall_verdict);
    }
    return { data: map, errorMessage: null };
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
  model: string | null;
  receipt_file_hash: string | null;
  finished_at: string | null;
  created_at: string;
};

type VerificationCheckRow = {
  field: string;
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
  submittedValue: string | null;
  extractedRaw: string | null;
  extractedNormalized: string | null;
  verdict: string;
  hardness: string;
  confidence: number | null;
  toleranceApplied: string | null;
  mismatchReason: string | null;
};

export type VerificationSummary = {
  runId: string;
  status: string;
  overallVerdict: string | null;
  model: string | null;
  receiptFileHash: string | null;
  finishedAt: string | null;
  checks: VerificationCheckRecord[];
};

export type VerificationBadgeState =
  | "pending"
  | "verified"
  | "mismatch"
  | "needs_review"
  | "extraction_failed"
  | "no_document";

type LatestVerificationRow = {
  claim_id: string;
  status: string;
  overall_verdict: string | null;
};

function deriveBadgeState(status: string, verdict: string | null): VerificationBadgeState {
  if (status === "queued" || status === "running") {
    return "pending";
  }
  switch (verdict) {
    case "verified":
    case "mismatch":
    case "needs_review":
    case "no_document":
      return verdict;
    default:
      return "extraction_failed";
  }
}
