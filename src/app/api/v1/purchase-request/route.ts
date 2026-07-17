// The 202 response itself returns well under 30s (submission spec's own
// timeout), but after() keeps this invocation alive to run AI analysis
// (attachment downloads + a Gemini call with retries) before it fully exits.
export const maxDuration = 120;

import { randomUUID } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { logger } from "@/core/infra/logging/logger";
import { buildAnalysisId } from "@/modules/purchase-requests/analysis/build-analysis-id";
import { PurchaseRequestAnalysisRepository } from "@/modules/purchase-requests/analysis/PurchaseRequestAnalysisRepository";
import { runPurchaseRequestAnalysis } from "@/modules/purchase-requests/analysis/run-purchase-request-analysis";
import {
  MAX_ATTACHMENT_SIZE_BYTES,
  MIN_ATTACHMENT_SIZE_BYTES,
  RATE_LIMIT_MAX_REQUESTS_PER_HOUR,
} from "@/modules/purchase-requests/constants";
import { PurchaseRequestRepository } from "@/modules/purchase-requests/repositories/PurchaseRequestRepository";
import { errorBody } from "@/modules/purchase-requests/responses";
import {
  insertSuffixBeforeExtension,
  sanitizeFileName,
} from "@/modules/purchase-requests/utils/sanitize-file-name";
import {
  findMissingRequiredFields,
  isSupportedAttachmentContentType,
  purchaseRequestBodySchema,
} from "@/modules/purchase-requests/validators/purchase-request-schema";

const repository = new PurchaseRequestRepository();
const analysisRepository = new PurchaseRequestAnalysisRepository();

/**
 * BC → Provision Portal PR submission. Validates and stores the PR + its
 * attachments, then kicks off AI analysis via after() so it starts immediately
 * without delaying this 202 response back to BC.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const apiKey = request.headers.get("apikey");
  if (!apiKey) {
    logger.warn("purchase_request.missing_api_key");
    return NextResponse.json(errorBody("INVALID_API_KEY", "Invalid API key"), { status: 401 });
  }

  const { data: apiKeyRecord, errorMessage: apiKeyLookupError } =
    await repository.findActiveApiKeyByRawKey(apiKey);
  if (apiKeyLookupError) {
    logger.error("purchase_request.api_key_lookup_failed", { errorMessage: apiKeyLookupError });
    return NextResponse.json(errorBody("INTERNAL_ERROR", "Error processing PR"), { status: 500 });
  }
  if (!apiKeyRecord) {
    logger.warn("purchase_request.invalid_api_key");
    return NextResponse.json(errorBody("INVALID_API_KEY", "Invalid API key"), { status: 401 });
  }

  const { data: recentRequestCount, errorMessage: rateLimitError } =
    await repository.countRequestsInLastHour(apiKeyRecord.id);
  if (rateLimitError) {
    logger.error("purchase_request.rate_limit_check_failed", { errorMessage: rateLimitError });
    return NextResponse.json(errorBody("INTERNAL_ERROR", "Error processing PR"), { status: 500 });
  }
  if (recentRequestCount >= RATE_LIMIT_MAX_REQUESTS_PER_HOUR) {
    logger.warn("purchase_request.rate_limit_exceeded", { apiKeyId: apiKeyRecord.id });
    return NextResponse.json(
      errorBody(
        "RATE_LIMIT_EXCEEDED",
        `Max ${RATE_LIMIT_MAX_REQUESTS_PER_HOUR} PRs per API key per hour exceeded`,
      ),
      { status: 429 },
    );
  }

  let rawBody: Record<string, unknown>;
  try {
    rawBody = await request.json();
  } catch {
    logger.warn("purchase_request.malformed_json");
    return NextResponse.json(errorBody("INVALID_JSON", "Malformed JSON body"), { status: 400 });
  }

  const missingFields = findMissingRequiredFields(rawBody);
  if (missingFields.length > 0) {
    return NextResponse.json(
      errorBody("MISSING_REQUIRED_FIELDS", "Missing required fields", missingFields),
      { status: 400 },
    );
  }

  const parseResult = purchaseRequestBodySchema.safeParse(rawBody);
  if (!parseResult.success) {
    const details = parseResult.error.issues.map((issue) => issue.path.join("."));
    return NextResponse.json(
      errorBody("VALIDATION_FAILED", "One or more fields failed validation", details),
      { status: 400 },
    );
  }
  const body = parseResult.data;

  const unsupportedTypeIndexes = body.attachments
    .map((attachment, index) =>
      isSupportedAttachmentContentType(attachment.content_type) ? -1 : index,
    )
    .filter((index) => index !== -1);
  if (unsupportedTypeIndexes.length > 0) {
    logger.warn("purchase_request.unsupported_attachment_type", {
      prId: body.pr_id,
      indexes: unsupportedTypeIndexes,
    });
    return NextResponse.json(
      errorBody(
        "UNSUPPORTED_FILE_TYPE",
        "Only PDF and image files are supported",
        unsupportedTypeIndexes.map((index) => `attachments[${index}]`),
      ),
      { status: 415 },
    );
  }

  const decodedAttachments = body.attachments.map((attachment) => ({
    fileName: attachment.file_name,
    contentType: attachment.content_type,
    buffer: Buffer.from(attachment.base64, "base64"),
  }));

  const oversizedIndexes = decodedAttachments
    .map((attachment, index) =>
      attachment.buffer.byteLength > MAX_ATTACHMENT_SIZE_BYTES ? index : -1,
    )
    .filter((index) => index !== -1);
  if (oversizedIndexes.length > 0) {
    logger.warn("purchase_request.attachment_too_large", {
      prId: body.pr_id,
      indexes: oversizedIndexes,
    });
    return NextResponse.json(
      errorBody(
        "ATTACHMENT_TOO_LARGE",
        "Attachment exceeds 10MB limit",
        oversizedIndexes.map((index) => `attachments[${index}]`),
      ),
      { status: 413 },
    );
  }

  // Catches empty/placeholder files (e.g. a 70-byte 1x1 test PNG) before they reach
  // Gemini, where a single unreadable attachment fails the whole multi-document
  // analysis with an opaque "document has no pages" error deep in the pipeline.
  const tooSmallIndexes = decodedAttachments
    .map((attachment, index) =>
      attachment.buffer.byteLength < MIN_ATTACHMENT_SIZE_BYTES ? index : -1,
    )
    .filter((index) => index !== -1);
  if (tooSmallIndexes.length > 0) {
    logger.warn("purchase_request.attachment_too_small", {
      prId: body.pr_id,
      indexes: tooSmallIndexes,
    });
    return NextResponse.json(
      errorBody(
        "ATTACHMENT_TOO_SMALL",
        `Attachment is smaller than the ${MIN_ATTACHMENT_SIZE_BYTES} byte minimum -- appears empty or corrupt`,
        tooSmallIndexes.map((index) => `attachments[${index}]`),
      ),
      { status: 400 },
    );
  }

  // Resubmitting an existing pr_id overwrites the PR in place (not blocked with 409) --
  // the new data/attachments replace the old and status resets to pending_analysis.
  const { data: existing, errorMessage: lookupError } = await repository.findByPrId(body.pr_id);
  if (lookupError) {
    logger.error("purchase_request.duplicate_check_failed", {
      errorMessage: lookupError,
      prId: body.pr_id,
    });
    return NextResponse.json(errorBody("INTERNAL_ERROR", "Error processing PR"), { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const sanitizedPrId = body.pr_id.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  // A submission ID (not just date + pr_id) keeps the path unique even when the same
  // pr_id is resubmitted the same day with identical file names -- otherwise the new
  // upload collides with the still-present old object (upsert:false) before cleanup.
  const submissionId = randomUUID();
  const uploads = decodedAttachments.map((attachment, index) => ({
    ...attachment,
    storagePath: `${today}/${sanitizedPrId}/${submissionId}/${index}-${insertSuffixBeforeExtension(sanitizeFileName(attachment.fileName), sanitizedPrId)}`,
  }));

  const uploadedPaths: string[] = [];
  for (const upload of uploads) {
    const { errorMessage: uploadError } = await repository.uploadAttachment(
      upload.storagePath,
      upload.buffer,
      upload.contentType,
    );
    if (uploadError) {
      await repository.removeAttachments(uploadedPaths);
      logger.error("purchase_request.attachment_upload_failed", {
        errorMessage: uploadError,
        prId: body.pr_id,
      });
      return NextResponse.json(errorBody("INTERNAL_ERROR", "Error processing PR"), { status: 500 });
    }
    uploadedPaths.push(upload.storagePath);
  }

  // New-spec field name wins when both the old and new name are sent for the
  // same concept (see ALIASED_REQUIRED_FIELD_PAIRS in the validator).
  const purchaseRequestAmount = body.purchase_requisition_amount ?? body.purchase_request_amount;

  const rowInput = {
    apiKeyId: apiKeyRecord.id,
    prId: body.pr_id,
    requestDate: body.request_date,
    vendorCode: body.vendor_code,
    vendorName: body.vendor_name,
    vendorGstin: body.vendor_gstin,
    companyGstin: body.company_gstin,
    prType: body.pr_type,
    vendorInvoiceNumber: body.vendor_invoice_number,
    documentDate: body.document_date,
    purchaseRequestAmount: purchaseRequestAmount as number,
    bankAccountNumber: body.bank_account_number || null,
    bankIfsc: body.bank_ifsc || null,
    bankName: body.bank_name || null,
    serviceStartDate: body.service_start_date ?? null,
    serviceEndDate: body.service_end_date ?? null,
    budgetPeriod: body.budget_period ?? null,
    posAsInVendorState: body.pos_as_in_vendor_state ?? null,
    totalAmountIncludingGst: body.total_amount_including_gst ?? null,
  };

  const { data: saved, errorMessage: saveError } = existing
    ? await repository.update(existing.id, rowInput)
    : await repository.insert(rowInput);

  if (saveError || !saved) {
    await repository.removeAttachments(uploadedPaths);
    logger.error("purchase_request.save_failed", {
      errorMessage: saveError,
      prId: body.pr_id,
      mode: existing ? "update" : "insert",
    });
    return NextResponse.json(errorBody("INTERNAL_ERROR", "Error processing PR"), { status: 500 });
  }

  const { errorMessage: insertAttachmentsError } = await repository.insertAttachments(
    saved.id,
    uploads.map((upload) => ({
      fileName: upload.fileName,
      storagePath: upload.storagePath,
      contentType: upload.contentType,
      sizeBytes: upload.buffer.byteLength,
    })),
  );

  if (insertAttachmentsError) {
    // Old attachment rows/files (if any) are left untouched -- only the new upload is rolled back.
    await repository.removeAttachments(uploadedPaths);
    logger.error("purchase_request.attachment_rows_failed", {
      errorMessage: insertAttachmentsError,
      prId: body.pr_id,
      requestId: saved.id,
    });
    return NextResponse.json(errorBody("INTERNAL_ERROR", "Error processing PR"), { status: 500 });
  }

  if (existing) {
    // New attachments are committed -- now it's safe to replace the old set wholesale
    // (a resubmission's attachment list supersedes the previous one, not merges with it).
    // Deleting by the old rows' own ids (not purchase_request_id) is required -- the
    // new rows just inserted above share the same purchase_request_id.
    const { errorMessage: deleteOldAttachmentsError } = await repository.deleteAttachmentsByIds(
      existing.attachments.map((attachment) => attachment.id),
    );
    if (deleteOldAttachmentsError) {
      // Don't delete the storage files if the DB rows are still there -- doing so would
      // leave stale rows pointing at files that no longer exist, breaking every future
      // analysis attempt for this PR with a download error. Leave both in place; the
      // next successful resubmission's delete will clean them up together.
      logger.error("purchase_request.old_attachment_cleanup_failed", {
        errorMessage: deleteOldAttachmentsError,
        prId: body.pr_id,
        requestId: saved.id,
      });
    } else {
      await repository.removeAttachments(
        existing.attachments.map((attachment) => attachment.storagePath),
      );
    }
  }

  // Delete-then-insert on every submission (not just resubmissions) -- simplest way
  // to satisfy UNIQUE(purchase_request_id, line_no) and to have a resubmission's
  // line set wholesale-replace the previous one, matching attachment semantics.
  const { errorMessage: deleteLinesError } = await repository.deleteLinesByPurchaseRequestId(
    saved.id,
  );
  if (deleteLinesError) {
    logger.error("purchase_request.line_delete_failed", {
      errorMessage: deleteLinesError,
      prId: body.pr_id,
      requestId: saved.id,
    });
    return NextResponse.json(errorBody("INTERNAL_ERROR", "Error processing PR"), { status: 500 });
  }

  const { errorMessage: insertLinesError } = await repository.insertLines(
    saved.id,
    body.lines.map((line) => ({
      lineNo: line.line_no,
      description: line.description,
      department: line.department,
      gstPercentage: line.gst_percentage,
      gstAmount: line.gst_amount,
      gstGroupCode: line.gst_group_code ?? null,
      programCode: line.program_code ?? null,
      responsibleDept: line.responsible_dept ?? null,
      beneficiaryCode: line.beneficiary_code ?? null,
      regionCode: line.region_code ?? null,
      subproduct: line.subproduct ?? null,
      qty: line.qty ?? null,
      directUnitCostExclVat: line.direct_unit_cost_excl_vat ?? null,
      lineAmountExcludingVat: line.line_amount_excluding_vat ?? null,
      cgstPercentage: line.cgst_percentage ?? null,
      cgstAmount: line.cgst_amount ?? null,
      sgstPercentage: line.sgst_percentage ?? null,
      sgstAmount: line.sgst_amount ?? null,
      igstPercentage: line.igst_percentage ?? null,
      igstAmount: line.igst_amount ?? null,
      fixedAssetDescription: line.fixed_asset_description ?? null,
      fixedAssetFaClassCode: line.fixed_asset_fa_class_code ?? null,
      fixedAssetFaSubclassCode: line.fixed_asset_fa_subclass_code ?? null,
      depreciationStartDate: line.depreciation_start_date ?? null,
      noOfDepreciationYears: line.no_of_depreciation_years ?? null,
      depreciationEndDate: line.depreciation_end_date ?? null,
    })),
  );
  if (insertLinesError) {
    logger.error("purchase_request.line_insert_failed", {
      errorMessage: insertLinesError,
      prId: body.pr_id,
      requestId: saved.id,
    });
    return NextResponse.json(errorBody("INTERNAL_ERROR", "Error processing PR"), { status: 500 });
  }

  // Pre-allocated here (not inside runPurchaseRequestAnalysis) so the exact same
  // analysis_id returned to BC below is the one the completed analysis row gets --
  // a real reference from the start, not a throwaway placeholder.
  const { data: previousAnalysesCount, errorMessage: countAnalysesError } =
    await analysisRepository.countPreviousAnalyses(saved.id);
  if (countAnalysesError) {
    logger.error("purchase_request.analysis_count_failed", {
      errorMessage: countAnalysesError,
      prId: body.pr_id,
      requestId: saved.id,
    });
    return NextResponse.json(errorBody("INTERNAL_ERROR", "Error processing PR"), { status: 500 });
  }
  const analysisId = buildAnalysisId(body.pr_id, previousAnalysesCount + 1);

  logger.info("purchase_request.received", {
    prId: body.pr_id,
    requestId: saved.id,
    analysisId,
    apiKeyId: apiKeyRecord.id,
    status: "pending_analysis",
    mode: existing ? "update" : "insert",
    attachmentCount: uploads.length,
  });

  after(() =>
    runPurchaseRequestAnalysis(saved.id, analysisId).catch((error: unknown) => {
      logger.error("purchase_request.analysis.unhandled_error", {
        purchaseRequestId: saved.id,
        prId: body.pr_id,
        analysisId,
        errorMessage: error instanceof Error ? error.message : "Unknown error.",
      });
    }),
  );

  return NextResponse.json(
    {
      success: true,
      request_id: saved.id,
      pr_id: body.pr_id,
      analysis_id: analysisId,
      status: "pending_analysis",
      message: "PR received and stored successfully",
      timestamp: new Date().toISOString(),
      attachments: uploads.map((upload) => ({
        file_name: upload.fileName,
        size_bytes: upload.buffer.byteLength,
        saved_path: upload.storagePath,
      })),
    },
    { status: 202 },
  );
}
