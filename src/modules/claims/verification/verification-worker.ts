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
  compareBankStatement,
  compareClaim,
  rollUpVerdict,
  type BankStatementView,
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
    lane: check.lane,
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

/** A placeholder statement check when the bank statement couldn't be read. */
function unavailableStatementCheck(reason: string): FieldCheck {
  return {
    field: "statement_amount",
    lane: "bank_statement",
    submittedValue: null,
    extractedRaw: null,
    extractedNormalized: null,
    verdict: "unavailable",
    hardness: "hard",
    confidence: null,
    toleranceApplied: null,
    mismatchReason: reason,
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
    const hasReceipt = Boolean(run.receipt_file_path);
    const hasBank = Boolean(run.bank_statement_file_path);

    // Neither document on record → nothing to verify.
    if (!hasReceipt && !hasBank) {
      await this.repository.completeVerificationRun({
        runId: run.id,
        overallVerdict: "no_document",
        model: serverEnv.GEMINI_MODEL,
        receiptHash: null,
        bankHash: null,
        invoiceDuplicateStatus: "unavailable",
        invoiceDuplicateClaimIds: [],
        amountDateDuplicateStatus: "unavailable",
        amountDateDuplicateClaimIds: [],
        checks: [],
      });
      return;
    }

    const checks: FieldCheck[] = [];
    let receiptHash: string | null = null;
    let bankHash: string | null = null;
    let confidence = 0;
    // Extracted values for finance-stage dedup (set once the receipt extraction succeeds).
    let dedupInputs: {
      extractedBillNo: string | null;
      transactionDate: string | null;
      totalAmount: number;
    } | null = null;

    // ---- Lane 1: receipt (primary — its failure fails the whole run) ----
    if (hasReceipt) {
      const download = await this.repository.downloadClaimEvidence(run.receipt_file_path as string);
      if (download.errorMessage || !download.data) {
        await this.repository.failVerificationRun({
          runId: run.id,
          error: `receipt download failed: ${download.errorMessage ?? "no data"}`,
          retryable: false,
        });
        return;
      }
      receiptHash = createHash("sha256").update(download.data.buffer).digest("hex");

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
      confidence = view.confidenceScore;
      checks.push(...compareClaim(run.submitted_values_snapshot, view));
      dedupInputs = {
        extractedBillNo: extraction.raw.billNo,
        transactionDate: extraction.normalized.transactionDate,
        totalAmount: extraction.normalized.totalAmount,
      };
    }

    // ---- Lane 2: bank statement (supplementary — never fails the run) ----
    // If the statement can't be read, we record an "unavailable" statement check and
    // still complete with the receipt verdict, so a bad/slow statement read never loses
    // Lane 1's result. Finance can re-run. (Auto-retry of just Lane 2 is a future refinement.)
    if (hasBank) {
      const snapshot = run.submitted_values_snapshot;
      const dl = await this.repository.downloadClaimEvidence(
        run.bank_statement_file_path as string,
      );
      if (dl.errorMessage || !dl.data) {
        checks.push(unavailableStatementCheck("could not download bank statement"));
      } else {
        bankHash = createHash("sha256").update(dl.data.buffer).digest("hex");
        let bankExtraction = null;
        try {
          bankExtraction = await extractReceiptFromBuffer({
            buffer: dl.data.buffer,
            mimeType: dl.data.mimeType,
            documentType: "bank_statement",
            allowedCategoryNames: [],
            now: new Date(),
            bankStatementMatch: {
              vendorName: snapshot.vendor_name,
              transactionDate: snapshot.transaction_date,
              billNo: snapshot.bill_no,
              foreignCurrencyCode: snapshot.foreign_currency_code,
              foreignTotalAmount: snapshot.foreign_total_amount,
              categoryName: null,
            },
          });
        } catch (error) {
          logger.warn("claims.verification.bank_extraction_error", {
            runId: run.id,
            claimId: run.claim_id,
            errorMessage: error instanceof Error ? error.message : "unknown bank extraction error",
          });
        }

        if (bankExtraction && bankExtraction.ok) {
          const bankView: BankStatementView = {
            matchedAmount: bankExtraction.normalized.basicAmount,
            statementDate: bankExtraction.normalized.transactionDate,
            dateAsPrinted: bankExtraction.raw.dateAsPrinted ?? null,
            reference: bankExtraction.normalized.billNo,
            description: bankExtraction.normalized.vendorName,
            confidenceScore: bankExtraction.normalized.confidenceScore,
          };
          checks.push(...compareBankStatement(snapshot, bankView));
          if (!hasReceipt) {
            confidence = bankView.confidenceScore;
          }
        } else {
          checks.push(unavailableStatementCheck("could not read bank statement"));
        }
      }
    }

    const overall = rollUpVerdict(checks, confidence);

    // Finance-stage duplicate detection on the extracted values (degrades to unavailable).
    let invoiceDuplicate: { status: string; claimIds: string[] } = {
      status: "unavailable",
      claimIds: [],
    };
    let amountDateDuplicate: { status: string; claimIds: string[] } = {
      status: "unavailable",
      claimIds: [],
    };
    if (dedupInputs) {
      const dup = await this.repository.detectDuplicate({
        claimId: run.claim_id,
        extractedBillNo: dedupInputs.extractedBillNo,
        submittedBillNo: run.submitted_values_snapshot.bill_no,
        transactionDate: dedupInputs.transactionDate,
        totalAmount: dedupInputs.totalAmount,
      });
      invoiceDuplicate = dup.data.invoice;
      amountDateDuplicate = dup.data.amountDate;
    }

    const { errorMessage } = await this.repository.completeVerificationRun({
      runId: run.id,
      overallVerdict: overall,
      model: serverEnv.GEMINI_MODEL,
      receiptHash,
      bankHash,
      invoiceDuplicateStatus: invoiceDuplicate.status,
      invoiceDuplicateClaimIds: invoiceDuplicate.claimIds,
      amountDateDuplicateStatus: amountDateDuplicate.status,
      amountDateDuplicateClaimIds: amountDateDuplicate.claimIds,
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
