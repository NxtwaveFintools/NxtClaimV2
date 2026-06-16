import { createHash } from "node:crypto";
import { serverEnv } from "@/core/config/server-env";
import { logger } from "@/core/infra/logging/logger";
import { extractReceiptFromBuffer } from "@/modules/claims/actions/parse-receipt";
import {
  SupabaseVerificationRepository,
  type VerificationCheckInput,
  type VerificationRunRow,
} from "@/modules/claims/repositories/SupabaseVerificationRepository";
import {
  compareClaim,
  rollUpVerdict,
  type FieldCheck,
  type ReceiptExtractionView,
} from "@/modules/claims/verification/comparison-engine";

const BATCH_LIMIT = 5;
const LEASE_TTL_SECONDS = 90;

/** Worker-local retry classifier (the parse-receipt classifiers cannot be
 * exported from its "use server" module). Quota/unavailable → backoff requeue. */
function isRetryableGeminiError(error: unknown): boolean {
  const e = (error ?? {}) as { status?: number; statusText?: string; message?: string };
  if (e.status === 429 || e.status === 503) {
    return true;
  }
  const text = `${e.statusText ?? ""} ${e.message ?? ""}`.toLowerCase();
  return (
    text.includes("too many requests") ||
    text.includes("quota exceeded") ||
    text.includes("rate limit") ||
    text.includes("service unavailable")
  );
}

function toCheckInput(check: FieldCheck): VerificationCheckInput {
  return {
    field: check.field,
    submitted_value: check.submittedValue,
    extracted_raw: check.extractedRaw,
    extracted_normalized: check.extractedNormalized,
    verdict: check.verdict,
    hardness: check.hardness,
    confidence: check.confidence,
    tolerance_applied: check.toleranceApplied,
    mismatch_reason: check.mismatchReason,
  };
}

export class VerificationWorker {
  private readonly repository: SupabaseVerificationRepository;

  constructor(repository = new SupabaseVerificationRepository()) {
    this.repository = repository;
  }

  /** Process one batch under a single-flight lease. Safe to call on overlapping ticks. */
  async processBatch(): Promise<{ leased: boolean; processed: number }> {
    const leased = await this.repository.acquireWorkerLease(LEASE_TTL_SECONDS);
    if (!leased) {
      return { leased: false, processed: 0 };
    }

    let processed = 0;
    try {
      const { data: runs, errorMessage } =
        await this.repository.dequeueVerificationRuns(BATCH_LIMIT);
      if (errorMessage) {
        logger.error("claims.verification.dequeue_failed", { errorMessage });
        return { leased: true, processed: 0 };
      }

      for (const run of runs) {
        await this.processRun(run);
        processed += 1;
      }
    } finally {
      await this.repository.releaseWorkerLease();
    }

    return { leased: true, processed };
  }

  private async processRun(run: VerificationRunRow): Promise<void> {
    // No receipt on record → no_document verdict, no extraction attempt.
    if (!run.receipt_file_path) {
      await this.repository.completeVerificationRun({
        runId: run.id,
        overallVerdict: "no_document",
        model: serverEnv.GEMINI_MODEL,
        receiptHash: null,
        checks: [],
      });
      return;
    }

    const download = await this.repository.downloadClaimEvidence(run.receipt_file_path);
    if (download.errorMessage || !download.data) {
      await this.repository.failVerificationRun({
        runId: run.id,
        error: `download failed: ${download.errorMessage ?? "no data"}`,
        retryable: false,
      });
      return;
    }

    const receiptHash = createHash("sha256").update(download.data.buffer).digest("hex");

    let extraction;
    try {
      extraction = await extractReceiptFromBuffer({
        buffer: download.data.buffer,
        mimeType: download.data.mimeType,
        documentType: "invoice",
        allowedCategoryNames: [],
        now: new Date(),
      });
    } catch (error) {
      const retryable = isRetryableGeminiError(error);
      logger.warn("claims.verification.extraction_error", {
        runId: run.id,
        claimId: run.claim_id,
        retryable,
        errorMessage: error instanceof Error ? error.message : "unknown extraction error",
      });
      await this.repository.failVerificationRun({
        runId: run.id,
        error: error instanceof Error ? error.message : "extraction error",
        retryable,
      });
      return;
    }

    if (!extraction.ok) {
      // Empty/unparseable model output is not transient — mark extraction_failed.
      await this.repository.failVerificationRun({
        runId: run.id,
        error: `extraction ${extraction.reason}`,
        retryable: false,
      });
      return;
    }

    const view: ReceiptExtractionView = {
      billNo: extraction.normalized.billNo,
      billNoRaw: extraction.raw.billNo,
      transactionDate: extraction.normalized.transactionDate,
      dateAsPrinted: extraction.raw.dateAsPrinted ?? null,
      vendorName: extraction.normalized.vendorName,
      gstNumber: extraction.normalized.gstNumber,
      totalAmount: extraction.normalized.totalAmount,
      cgstAmount: extraction.normalized.cgstAmount,
      sgstAmount: extraction.normalized.sgstAmount,
      igstAmount: extraction.normalized.igstAmount,
      foreignCurrencyCode: extraction.normalized.foreignCurrencyCode,
      foreignTotalAmount: extraction.normalized.foreignTotalAmount,
      confidenceScore: extraction.normalized.confidenceScore,
    };

    const checks = compareClaim(run.submitted_values_snapshot, view);
    const overall = rollUpVerdict(checks, view.confidenceScore);

    const { errorMessage } = await this.repository.completeVerificationRun({
      runId: run.id,
      overallVerdict: overall,
      model: serverEnv.GEMINI_MODEL,
      receiptHash,
      checks: checks.map(toCheckInput),
    });

    if (errorMessage) {
      logger.error("claims.verification.complete_failed", {
        runId: run.id,
        claimId: run.claim_id,
        errorMessage,
      });
    }
  }
}
