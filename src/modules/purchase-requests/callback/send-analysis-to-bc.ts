import { logger } from "@/core/infra/logging/logger";
import {
  PurchaseRequestAnalysisRepository,
  type PurchaseRequestAnalysisForCallback,
} from "@/modules/purchase-requests/analysis/PurchaseRequestAnalysisRepository";

const repository = new PurchaseRequestAnalysisRepository();

const CALLBACK_MAX_ATTEMPTS = 3;
const CALLBACK_RETRY_DELAY_MS = 2_000;
const CALLBACK_TIMEOUT_MS = 15_000;

export type BcAnalysisCallbackPayload = {
  pr_id: string;
  analysis_id: string;
  overall_status: string;
  confidence_score: number;
  document_summary: string;
  analyzed_file_name: string | null;
  field_validations: PurchaseRequestAnalysisForCallback["fieldValidations"];
  remarks: string;
  analyzed_at: string;
};

export function buildBcCallbackPayload(
  analysis: PurchaseRequestAnalysisForCallback,
): BcAnalysisCallbackPayload {
  return {
    pr_id: analysis.prId,
    analysis_id: analysis.analysisId,
    overall_status: analysis.overallStatus,
    confidence_score: analysis.confidenceScore,
    document_summary: analysis.documentSummary,
    analyzed_file_name: analysis.analyzedFileName,
    field_validations: analysis.fieldValidations,
    remarks: analysis.remarks,
    analyzed_at: analysis.analyzedAt,
  };
}

function waitForMilliseconds(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

/**
 * POSTs the completed analysis result back to BC, using the callback URL/key configured
 * on the api_keys row BC originally submitted the PR with (each BC environment/company can
 * point at its own endpoint). BC hasn't shared any receiving endpoint yet, so keys start
 * with callback_url unset -- this no-ops (logs a warning and records bc_callback_status=
 * 'failed' with a clear reason) until an admin sets it on the relevant key. Every failed/
 * never-attempted delivery stays retryable via POST /api/internal/pr-callback-trigger.
 *
 * Runs after the analysis is already stored -- a callback failure never undoes or
 * revisits the analysis result itself, it only affects delivery tracking.
 */
export async function sendAnalysisResultToBc(analysisId: string): Promise<void> {
  const { data: analysis, errorMessage: fetchError } =
    await repository.getAnalysisForCallback(analysisId);
  if (fetchError || !analysis) {
    logger.error("purchase_request.bc_callback.fetch_failed", {
      analysisId,
      errorMessage: fetchError,
    });
    return;
  }

  if (!analysis.callbackUrl) {
    logger.warn("purchase_request.bc_callback.not_configured", {
      prId: analysis.prId,
      analysisId,
    });
    await repository.updateCallbackStatus(analysis.analysisRowId, {
      status: "failed",
      attempts: 0,
      error: "No callback_url configured on this PR's api_keys row.",
    });
    return;
  }

  const payload = buildBcCallbackPayload(analysis);
  let lastError = "Unknown error.";
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= CALLBACK_MAX_ATTEMPTS; attempt += 1) {
    attemptsMade = attempt;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);

    try {
      const response = await fetch(analysis.callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(analysis.callbackApiKey
            ? { Authorization: `Bearer ${analysis.callbackApiKey}` }
            : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.ok) {
        logger.info("purchase_request.bc_callback.sent", {
          prId: analysis.prId,
          analysisId,
          attempt,
          httpStatus: response.status,
        });
        await repository.updateCallbackStatus(analysis.analysisRowId, {
          status: "sent",
          attempts: attemptsMade,
        });
        return;
      }

      lastError = `BC responded ${response.status}: ${(await response.text()).slice(0, 500)}`;
      const retryable = response.status >= 500 || response.status === 429;
      if (!retryable || attempt === CALLBACK_MAX_ATTEMPTS) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown network error.";
      if (attempt === CALLBACK_MAX_ATTEMPTS) break;
    } finally {
      clearTimeout(timeout);
    }

    await waitForMilliseconds(CALLBACK_RETRY_DELAY_MS * attempt);
  }

  logger.error("purchase_request.bc_callback.failed", {
    prId: analysis.prId,
    analysisId,
    attempts: attemptsMade,
    errorMessage: lastError,
  });
  await repository.updateCallbackStatus(analysis.analysisRowId, {
    status: "failed",
    attempts: attemptsMade,
    error: lastError,
  });
}
