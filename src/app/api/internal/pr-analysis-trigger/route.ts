export const maxDuration = 120;

import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/core/config/server-env";
import { logger } from "@/core/infra/logging/logger";
import { buildAnalysisId } from "@/modules/purchase-requests/analysis/build-analysis-id";
import { PurchaseRequestAnalysisRepository } from "@/modules/purchase-requests/analysis/PurchaseRequestAnalysisRepository";
import { runPurchaseRequestAnalysis } from "@/modules/purchase-requests/analysis/run-purchase-request-analysis";
import { PurchaseRequestRepository } from "@/modules/purchase-requests/repositories/PurchaseRequestRepository";

const repository = new PurchaseRequestRepository();
const analysisRepository = new PurchaseRequestAnalysisRepository();

/**
 * Manual re-run of AI analysis for an already-submitted PR. Not part of the BC
 * integration -- for local/debug use when the submission route's after() didn't
 * complete (e.g. dev server restarted mid-flight, leaving status stuck). Gated by
 * the same shared-secret pattern as /api/internal/verify-worker.
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

  let body: { pr_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "malformed JSON body" }, { status: 400 });
  }

  if (typeof body.pr_id !== "string" || body.pr_id.trim().length === 0) {
    return NextResponse.json({ error: "pr_id is required" }, { status: 400 });
  }

  const { data: existing, errorMessage: lookupError } = await repository.findByPrId(body.pr_id);
  if (lookupError) {
    logger.error("purchase_request.analysis_trigger.lookup_failed", {
      errorMessage: lookupError,
      prId: body.pr_id,
    });
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: `pr_id ${body.pr_id} not found` }, { status: 404 });
  }

  const { data: previousAnalysesCount, errorMessage: countError } =
    await analysisRepository.countPreviousAnalyses(existing.id);
  if (countError) {
    return NextResponse.json({ error: `count lookup failed: ${countError}` }, { status: 500 });
  }
  const analysisId = buildAnalysisId(body.pr_id, previousAnalysesCount + 1);

  await runPurchaseRequestAnalysis(existing.id, analysisId);

  const { data: result } = await analysisRepository.getByAnalysisId(analysisId);

  if (!result) {
    // runPurchaseRequestAnalysis swallows its own errors (reverts status, logs, never
    // throws) -- no row means the run failed silently. Surface that here instead of
    // returning 200 with a null result that looks identical to "ran fine, nothing to show".
    return NextResponse.json(
      { pr_id: body.pr_id, analysis_id: analysisId, error: "analysis failed -- see server logs" },
      { status: 500 },
    );
  }

  return NextResponse.json({ pr_id: body.pr_id, analysis_id: analysisId, result }, { status: 200 });
}
