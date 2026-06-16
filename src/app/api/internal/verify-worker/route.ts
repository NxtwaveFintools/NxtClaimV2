export const maxDuration = 60;

import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/core/config/server-env";
import { logger } from "@/core/infra/logging/logger";
import { VerificationWorker } from "@/modules/claims/verification/verification-worker";

/**
 * Machine-to-machine worker tick. Invoked by Supabase pg_cron via pg_net with the
 * shared CRON_SECRET. This is the ONLY route authenticated by a shared secret
 * (all human routes use withAuth). When CRON_SECRET is unset the route stays dark.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const configuredSecret = serverEnv.CRON_SECRET;
  if (!configuredSecret) {
    return NextResponse.json({ error: "worker not configured" }, { status: 503 });
  }

  const providedSecret = request.headers.get("x-cron-secret");
  if (providedSecret !== configuredSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await new VerificationWorker().processBatch();
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logger.error("claims.verification.worker_tick_failed", {
      errorMessage: error instanceof Error ? error.message : "unknown worker error",
    });
    return NextResponse.json({ error: "worker error" }, { status: 500 });
  }
}
