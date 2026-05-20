import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "zod";
import { bcFetch } from "../_shared/bcClient.ts";
import { getBcEnv } from "../_shared/bcEnv.ts";
import { corsPreflightResponse, resolveCors } from "../_shared/cors.ts";
import { log } from "../_shared/logger.ts";
import { requireFinanceApprover } from "../_shared/auth.ts";
import { buildBcClaimLineItem } from "./payloadBuilder.ts";
import type { BcClaimError, BcClaimPayloadFromDb } from "./types.ts";

/**
 * bc-claim — three-phase lifecycle.
 *
 *   1. Validate JWT (must map to an active finance approver).
 *   2. Validate request body via zod.
 *   3. get_bc_claim_payload(claimId) — surfaces CLAIM_NOT_FOUND / ALREADY_SUBMITTED /
 *      MISSING_MAPPING as SQLSTATEs P0001/P0002/P0003.
 *   4. Build the BC payload via payloadBuilder.
 *   5. start_bc_claim_attempt — INSERT a 'submitting' row. Partial UNIQUE on
 *      (claim_id) WHERE bc_status IN ('submitting','success') is the concurrency
 *      guard; unique_violation (23505) here means another submission is in flight
 *      or already succeeded.
 *   6. POST to BC.
 *   7a. On 2xx → complete_bc_claim flips the row to 'success' and links claim FK.
 *   7b. On non-2xx / timeout / invalid JSON → record_bc_claim_failure flips to 'failed'.
 *   7c. CATASTROPHIC: BC said 2xx but complete_bc_claim RPC then failed. The
 *       'submitting' row stays in the DB for the admin reconciliation tool.
 */

const InputSchema = z
  .object({
    claimId: z.string().min(1),
    isVendorPayment: z.boolean(),
    bcVendorCode: z.string().min(1).optional(),
    bcVendorName: z.string().min(1).optional(),
    currencyCode: z.string().min(1).optional(),
    gstGroupCode: z.string().min(1).optional(),
    hsnSacCode: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isVendorPayment) {
      for (const k of [
        "bcVendorCode",
        "bcVendorName",
        "currencyCode",
        "gstGroupCode",
        "hsnSacCode",
      ] as const) {
        if (!data[k] || data[k]!.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [k],
            message: `${k} is required when isVendorPayment is true`,
          });
        }
      }
    }
  });

function json(corsHeaders: Record<string, string>, body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function errResp(corsHeaders: Record<string, string>, err: BcClaimError, status: number): Response {
  return json(corsHeaders, { success: false, error: err }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  const cors = resolveCors(req);

  const t0 = Date.now();
  log("bc-claim", "info", "request_start", { method: req.method });

  if (req.method !== "POST") {
    return errResp(cors.headers, { code: "INVALID_BODY", details: ["method must be POST"] }, 405);
  }

  // Step 1 — JWT → finance approver (shared helper).
  const auth = await requireFinanceApprover(req);
  if (!auth.ok) {
    log("bc-claim", "warn", "auth_failed");
    return errResp(cors.headers, { code: auth.code }, auth.status);
  }
  const actorUserId = auth.userId;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Step 2 — body validation.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errResp(cors.headers, { code: "INVALID_BODY", details: ["body is not JSON"] }, 400);
  }
  const parsed = InputSchema.safeParse(rawBody);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return errResp(cors.headers, { code: "INVALID_BODY", details }, 400);
  }
  const input = parsed.data;

  // Step 3 — get_bc_claim_payload.
  const { data: dbPayloadRaw, error: payloadErr } = await admin.rpc("get_bc_claim_payload", {
    p_claim_id: input.claimId,
  });
  if (payloadErr) {
    const code = payloadErr.code;
    const msg = payloadErr.message ?? "";
    if (code === "P0001") {
      return errResp(cors.headers, { code: "CLAIM_NOT_FOUND", claimId: input.claimId }, 404);
    }
    if (code === "P0002") {
      const m = msg.match(/ALREADY_SUBMITTED:\s*(.+)$/);
      return errResp(
        cors.headers,
        { code: "ALREADY_SUBMITTED", bcClaimDetailsId: m?.[1]?.trim() ?? null },
        409,
      );
    }
    if (code === "P0003") {
      return errResp(cors.headers, { code: "MISSING_MAPPING", detail: msg }, 422);
    }
    return errResp(cors.headers, { code: "MISSING_MAPPING", detail: msg }, 500);
  }
  const db = dbPayloadRaw as unknown as BcClaimPayloadFromDb;
  log("bc-claim", "info", "payload_loaded", {
    claim_id: input.claimId,
    actor: actorUserId,
    is_vendor_payment: input.isVendorPayment,
  });

  // Step 3b — sign bill / bank-statement URLs (private "claims" bucket).
  // 10 years — matches the in-app expiry so a URL works the same whether the user
  // got it from the app or from BC remarks. Trade-off: a leaked URL exposes the
  // file for 10 years; acceptable since these URLs only render behind BC's auth
  // or our own authenticated routes.
  const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 365 * 10;
  const signPath = async (path: string | null): Promise<string | null> => {
    if (!path) return null;
    const { data, error } = await admin.storage
      .from("claims")
      .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
    if (error) {
      log("bc-claim", "warn", "sign_url_failed", {
        claim_id: input.claimId,
        path,
        detail: error.message,
      });
      return null;
    }
    return data.signedUrl;
  };
  const [billUrl, bankStatementUrl] = await Promise.all([
    signPath(db.receipt_file_path),
    signPath(db.bank_statement_file_path),
  ]);

  // Step 4 — build BC payload.
  const linePayload = buildBcClaimLineItem({
    db,
    isVendorPayment: input.isVendorPayment,
    vendor: input.isVendorPayment
      ? {
          code: input.bcVendorCode!,
          name: input.bcVendorName!,
          currencyCode: input.currencyCode!,
          gstGroupCode: input.gstGroupCode!,
          hsnSacCode: input.hsnSacCode!,
        }
      : undefined,
    fileUrls: { billUrl, bankStatementUrl },
  });

  // Step 5 — claim the in-flight slot.
  const { data: startData, error: startErr } = await admin.rpc("start_bc_claim_attempt", {
    p_claim_id: input.claimId,
    p_is_vendor_payment: input.isVendorPayment,
    p_payload_json: linePayload,
  });
  if (startErr) {
    if (startErr.code === "23505") {
      return errResp(cors.headers, { code: "ALREADY_IN_FLIGHT" }, 409);
    }
    return errResp(cors.headers, { code: "MISSING_MAPPING", detail: startErr.message }, 500);
  }
  const bcDetailsId = startData as string;
  log("bc-claim", "info", "attempt_started", {
    claim_id: input.claimId,
    bc_details_id: bcDetailsId,
  });

  // Step 6 — POST to BC.
  const env = getBcEnv();
  let bcResult;
  try {
    bcResult = await bcFetch("claims", "POST", `/companies(${env.companyId})/Claims`, linePayload);
    log("bc-claim", "info", "bc_post_outcome", {
      claim_id: input.claimId,
      bc_details_id: bcDetailsId,
      bc_status: bcResult.status,
      duration_ms: Date.now() - t0,
    });
  } catch (err) {
    log("bc-claim", "error", "bc_post_outcome", {
      claim_id: input.claimId,
      bc_details_id: bcDetailsId,
      bc_status: 0,
      duration_ms: Date.now() - t0,
      error: String(err).slice(0, 500),
    });
    await admin.rpc("record_bc_claim_failure", {
      p_bc_details_id: bcDetailsId,
      p_actor_user_id: actorUserId,
      p_response_json: { error: "network_or_timeout", detail: String(err) },
    });
    return errResp(
      cors.headers,
      {
        code: "BC_FETCH_FAILED",
        status: 0,
        body: { error: "network_or_timeout", detail: String(err) },
      },
      502,
    );
  }

  if (bcResult.status < 200 || bcResult.status >= 300) {
    log("bc-claim", "warn", "attempt_failed", {
      claim_id: input.claimId,
      bc_details_id: bcDetailsId,
      bc_status: bcResult.status,
    });
    await admin.rpc("record_bc_claim_failure", {
      p_bc_details_id: bcDetailsId,
      p_actor_user_id: actorUserId,
      p_response_json: bcResult.body,
    });
    return errResp(
      cors.headers,
      { code: "BC_FETCH_FAILED", status: bcResult.status, body: bcResult.body },
      502,
    );
  }

  // Step 7 — success path.
  const { error: completeErr } = await admin.rpc("complete_bc_claim", {
    p_bc_details_id: bcDetailsId,
    p_actor_user_id: actorUserId,
    p_response_json: bcResult.body,
  });
  if (completeErr) {
    // CATASTROPHIC — BC accepted but our RPC failed. Row stays 'submitting'.
    // Reconciliation cron / admin tool will pick this up. Frontend MUST NOT retry.
    log("bc-claim", "error", "catastrophic_rpc_failed_after_bc_success", {
      claim_id: input.claimId,
      bc_details_id: bcDetailsId,
      detail: completeErr.message,
    });
    return errResp(
      cors.headers,
      {
        code: "RPC_FAILED_AFTER_BC_SUCCESS",
        bcClaimDetailsId: bcDetailsId,
        detail: completeErr.message,
      },
      500,
    );
  }

  log("bc-claim", "info", "attempt_completed", {
    claim_id: input.claimId,
    bc_details_id: bcDetailsId,
    duration_ms: Date.now() - t0,
  });
  return json(cors.headers, { success: true, bcClaimDetailsId: bcDetailsId }, 200);
});
