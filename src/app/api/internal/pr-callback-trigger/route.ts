export const maxDuration = 60;

import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/core/config/server-env";
import { logger } from "@/core/infra/logging/logger";
import { PurchaseRequestAnalysisRepository } from "@/modules/purchase-requests/analysis/PurchaseRequestAnalysisRepository";
import { sendAnalysisResultToBc } from "@/modules/purchase-requests/callback/send-analysis-to-bc";
import { PurchaseRequestRepository } from "@/modules/purchase-requests/repositories/PurchaseRequestRepository";

const repository = new PurchaseRequestRepository();
const analysisRepository = new PurchaseRequestAnalysisRepository();

/**
 * Manual (re)send of a completed analysis result to BC. Not part of the BC integration
 * itself -- for local/debug use once the relevant api_keys row has callback_url set, to
 * retry a delivery that's stuck at bc_callback_status='failed' (including every delivery
 * today, since BC's receiving endpoint doesn't exist yet). Gated by the same shared-secret
 * pattern as /api/internal/verify-worker and /api/internal/pr-analysis-trigger.
 *
 * Accepts either { analysis_id } directly, or { pr_id } to resolve its latest analysis.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const configuredSecret = serverEnv.CRON_SECRET;
  if (!configuredSecret) {
    return NextResponse.json({ error: "trigger not configured" }, { status: 503 });
  }

  const providedSecret = request.headers.get("x-cron-secret");
  if (providedSecret !== configuredSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { pr_id?: unknown; analysis_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  let analysisId: string;

  if (typeof body.analysis_id === "string" && body.analysis_id.trim().length > 0) {
    analysisId = body.analysis_id;
  } else if (typeof body.pr_id === "string" && body.pr_id.trim().length > 0) {
    const { data: existing, errorMessage: lookupError } = await repository.findByPrId(body.pr_id);
    if (lookupError) {
      logger.error("purchase_request.callback_trigger.lookup_failed", {
        errorMessage: lookupError,
        prId: body.pr_id,
      });
      return NextResponse.json({ error: "lookup failed" }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: `pr_id ${body.pr_id} not found` }, { status: 404 });
    }

    const { data: latestAnalysisId, errorMessage: latestError } =
      await analysisRepository.getLatestAnalysisId(existing.id);
    if (latestError) {
      return NextResponse.json(
        { error: `analysis lookup failed: ${latestError}` },
        { status: 500 },
      );
    }
    if (!latestAnalysisId) {
      return NextResponse.json(
        { error: `pr_id ${body.pr_id} has no completed analysis yet` },
        { status: 404 },
      );
    }
    analysisId = latestAnalysisId;
  } else {
    return NextResponse.json({ error: "pr_id or analysis_id is required" }, { status: 400 });
  }

  await sendAnalysisResultToBc(analysisId);

  const { data: analysis, errorMessage: fetchError } =
    await analysisRepository.getAnalysisForCallback(analysisId);
  if (fetchError || !analysis) {
    return NextResponse.json(
      { error: `could not read back analysis ${analysisId}: ${fetchError ?? "not found"}` },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      analysis_id: analysisId,
      pr_id: analysis.prId,
      bc_callback_status: analysis.bcCallbackStatus,
      bc_callback_attempts: analysis.bcCallbackAttempts,
      bc_callback_sent_at: analysis.bcCallbackSentAt,
      bc_callback_error: analysis.bcCallbackError,
    },
    { status: 200 },
  );
}
