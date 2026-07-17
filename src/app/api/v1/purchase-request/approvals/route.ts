import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/core/infra/logging/logger";
import { PurchaseRequestRepository } from "@/modules/purchase-requests/repositories/PurchaseRequestRepository";
import { errorBody } from "@/modules/purchase-requests/responses";
import {
  findMissingApprovalsFields,
  hasAnyUpdatableApprovalField,
  purchaseRequestApprovalsBodySchema,
} from "@/modules/purchase-requests/validators/purchase-request-approvals-schema";

const repository = new PurchaseRequestRepository();

/**
 * Updates approval-sequence fields on an already-submitted PR, keyed by pr_id.
 * A separate system (not BC's initial PR submission) calls this as each step
 * of a multi-step approval chain completes. pr_id is a body field, not a URL
 * path segment -- real pr_id values (e.g. "PR/2627/00000257") contain slashes,
 * which would break path-based routing.
 */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const apiKey = request.headers.get("apikey");
  if (!apiKey) {
    logger.warn("purchase_request.approvals.missing_api_key");
    return NextResponse.json(errorBody("INVALID_API_KEY", "Invalid API key"), { status: 401 });
  }

  const { data: apiKeyRecord, errorMessage: apiKeyLookupError } =
    await repository.findActiveApiKeyByRawKey(apiKey);
  if (apiKeyLookupError) {
    logger.error("purchase_request.approvals.api_key_lookup_failed", {
      errorMessage: apiKeyLookupError,
    });
    return NextResponse.json(errorBody("INTERNAL_ERROR", "Error processing request"), {
      status: 500,
    });
  }
  if (!apiKeyRecord) {
    logger.warn("purchase_request.approvals.invalid_api_key");
    return NextResponse.json(errorBody("INVALID_API_KEY", "Invalid API key"), { status: 401 });
  }

  let rawBody: Record<string, unknown>;
  try {
    rawBody = await request.json();
  } catch {
    logger.warn("purchase_request.approvals.malformed_json");
    return NextResponse.json(errorBody("INVALID_JSON", "Malformed JSON body"), { status: 400 });
  }

  const missingFields = findMissingApprovalsFields(rawBody);
  if (missingFields.length > 0) {
    return NextResponse.json(
      errorBody("MISSING_REQUIRED_FIELDS", "Missing required fields", missingFields),
      { status: 400 },
    );
  }

  if (!hasAnyUpdatableApprovalField(rawBody)) {
    return NextResponse.json(
      errorBody(
        "VALIDATION_FAILED",
        "At least one of created_by/sequence_1_approval..sequence_5_approval must be provided",
      ),
      { status: 400 },
    );
  }

  const parseResult = purchaseRequestApprovalsBodySchema.safeParse(rawBody);
  if (!parseResult.success) {
    const details = parseResult.error.issues.map((issue) => issue.path.join("."));
    return NextResponse.json(
      errorBody("VALIDATION_FAILED", "One or more fields failed validation", details),
      { status: 400 },
    );
  }
  const body = parseResult.data;

  const { data: updated, errorMessage: updateError } = await repository.updateApprovalFields(
    body.pr_id,
    {
      createdBy: body.created_by ?? undefined,
      sequence1Approval: body.sequence_1_approval ?? undefined,
      sequence2Approval: body.sequence_2_approval ?? undefined,
      sequence3Approval: body.sequence_3_approval ?? undefined,
      sequence4Approval: body.sequence_4_approval ?? undefined,
      sequence5Approval: body.sequence_5_approval ?? undefined,
    },
  );

  if (updateError) {
    logger.error("purchase_request.approvals.update_failed", {
      errorMessage: updateError,
      prId: body.pr_id,
    });
    return NextResponse.json(errorBody("INTERNAL_ERROR", "Error processing request"), {
      status: 500,
    });
  }

  if (!updated) {
    logger.warn("purchase_request.approvals.pr_not_found", { prId: body.pr_id });
    return NextResponse.json(
      errorBody("PR_NOT_FOUND", `No purchase request found with pr_id "${body.pr_id}"`),
      { status: 404 },
    );
  }

  logger.info("purchase_request.approvals.updated", {
    prId: body.pr_id,
    requestId: updated.id,
    apiKeyId: apiKeyRecord.id,
    fieldsUpdated: Object.keys(rawBody).filter((key) => key !== "pr_id"),
  });

  return NextResponse.json({
    success: true,
    pr_id: body.pr_id,
    request_id: updated.id,
    message: "Approval fields updated successfully",
    timestamp: new Date().toISOString(),
  });
}
