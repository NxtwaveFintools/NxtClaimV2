import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "zod";
import { buildBcLineItems } from "./payloadBuilder.ts";
import { postBcLineItems } from "./bcPaymentsClient.ts";
import { CORS_HEADERS, corsPreflight } from "../_shared/cors.ts";
import type {
  BcClaimPayloadFromDb,
  BcPaymentError,
  BcPaymentDryRunResult,
  BcPaymentSuccess,
} from "./types.ts";

const InputSchema = z.object({
  claimId: z.string().min(1),
  isVendorPayment: z.boolean(),
  bcVendorId: z.string().min(1).optional().nullable(),
  bcVendorName: z.string().min(1).optional().nullable(),
  dryRun: z.boolean().optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return errResp({ code: "INVALID_INPUT", issues: "method" }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errResp({ code: "INVALID_INPUT", issues: "json" }, 400);
  }

  const parsed = InputSchema.safeParse(body);
  if (!parsed.success)
    return errResp({ code: "INVALID_INPUT", issues: parsed.error.flatten() }, 400);

  const { claimId, isVendorPayment, bcVendorId, bcVendorName, dryRun } = parsed.data;

  // Use the caller's JWT for SECURITY INVOKER lookups; service-role for writes.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Step 0 — finance-approver auth gate.
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return errResp({ code: "UNAUTHORIZED" }, 401);
  const actorUserId = userData.user.id;

  const { data: approverRow, error: approverErr } = await serviceClient
    .from("master_finance_approvers")
    .select("id")
    .eq("user_id", actorUserId)
    .eq("is_active", true)
    .maybeSingle();
  if (approverErr) return errResp({ code: "UNAUTHORIZED" }, 401);
  if (!approverRow) return errResp({ code: "UNAUTHORIZED" }, 401);

  // Step 3 — resolve payload + validate.
  const { data: payloadJson, error: payloadErr } = await serviceClient.rpc("get_bc_claim_payload", {
    p_claim_id: claimId,
  });
  if (payloadErr) return errResp({ code: "INVALID_INPUT", issues: payloadErr.message }, 400);

  const payload = payloadJson as Record<string, unknown>;
  if (typeof payload.error === "string") {
    return mapDbError(payload);
  }
  const dbPayload = payload as unknown as BcClaimPayloadFromDb;

  if (dbPayload.bc_payments_flag) return errResp({ code: "ALREADY_SENT", claimId }, 409);
  if (isVendorPayment && (!bcVendorId || !bcVendorName))
    return errResp({ code: "MISSING_VENDOR_SELECTION" }, 400);
  if (!isVendorPayment && !dbPayload.bc_code)
    return errResp(
      { code: "MISSING_BC_CODE", expenseCategoryId: dbPayload.expense_category_id },
      400,
    );

  let lines;
  try {
    lines = buildBcLineItems(dbPayload, { isVendorPayment, bcVendorId, bcVendorName });
  } catch (e) {
    return errResp({ code: "INVALID_INPUT", issues: (e as Error).message }, 400);
  }

  // Dry-run: stop here. No audit write, no BC call, no DB mutation.
  if (dryRun) {
    const result: BcPaymentDryRunResult = {
      ok: true,
      dryRun: true,
      claimId,
      wouldSend: lines,
      wouldAuditLog: { status: "PENDING", payload_json: lines },
    };
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  // Step 4 — PENDING audit row.
  const { data: auditRow, error: auditErr } = await serviceClient
    .from("bc_payment_audit_log")
    .insert({ claim_id: claimId, status: "PENDING", payload_json: lines })
    .select("id")
    .single();
  if (auditErr || !auditRow)
    return errResp({ code: "DB_UPDATE_FAILED", claimId, auditLogId: "" }, 500);
  const auditLogId = auditRow.id as string;

  // Step 5 — call BC.
  const bcResults = await postBcLineItems(lines);
  const failure = bcResults.find((r) => !r.ok);
  if (failure && !failure.ok) {
    await serviceClient
      .from("bc_payment_audit_log")
      .update({
        status: "FAILED",
        error_message: JSON.stringify(failure.body).slice(0, 1000),
        resolved_at: new Date().toISOString(),
      })
      .eq("id", auditLogId);
    return errResp({ code: "BC_API_ERROR", status: failure.status, body: failure.body }, 502);
  }

  const bcResponses = bcResults.map((r) => (r.ok ? r.response : null));

  // Step 6 — atomic DB finalisation.
  const { error: completeErr } = await serviceClient.rpc("complete_bc_payment", {
    p_claim_id: claimId,
    p_actor_user_id: actorUserId,
    p_is_vendor: isVendorPayment,
    p_vendor_id: isVendorPayment ? bcVendorId : null,
    p_vendor_name: isVendorPayment ? bcVendorName : null,
    p_audit_log_id: auditLogId,
    p_bc_response: bcResponses,
  });

  if (completeErr) {
    // Spec edge case 3: BC succeeded but DB update failed.
    // Leave audit row PENDING so monitoring detects it.
    return errResp({ code: "DB_UPDATE_FAILED", claimId, auditLogId }, 500);
  }

  const success: BcPaymentSuccess = { ok: true, claimId, bcResponses, auditLogId };
  return new Response(JSON.stringify(success), {
    status: 200,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
});

function errResp(err: BcPaymentError, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: err }), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

function mapDbError(p: Record<string, unknown>): Response {
  const e = p.error as string;
  if (e === "CLAIM_NOT_FOUND")
    return errResp({ code: "CLAIM_NOT_FOUND", claimId: String(p.claim_id) }, 404);
  if (e === "NOT_REIMBURSEMENT")
    return errResp({ code: "NOT_REIMBURSEMENT", paymentMode: String(p.payment_mode) }, 400);
  if (e === "EXPENSE_DETAILS_MISSING")
    return errResp({ code: "EXPENSE_DETAILS_MISSING", claimId: String(p.claim_id) }, 400);
  if (e === "MISSING_MAPPING")
    return errResp(
      { code: "MISSING_MAPPING", field: String(p.field), detail: JSON.stringify(p) },
      400,
    );
  return errResp({ code: "INVALID_INPUT", issues: p }, 400);
}
