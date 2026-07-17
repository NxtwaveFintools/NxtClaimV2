import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import { PURCHASE_REQUEST_ATTACHMENT_BUCKET } from "@/modules/purchase-requests/constants";
import type { PrAnalysisResponse } from "@/modules/purchase-requests/analysis/analysis-schema";

export type PurchaseRequestAttachmentForAnalysis = {
  id: string;
  fileName: string;
  storagePath: string;
  contentType: string;
};

export type PurchaseRequestLineForAnalysis = {
  lineNo: number;
  description: string;
  department: string;
  gstPercentage: number;
  gstAmount: number;
  gstGroupCode: string | null;
  programCode: string | null;
  responsibleDept: string | null;
  beneficiaryCode: string | null;
  regionCode: string | null;
  subproduct: string | null;
  qty: number | null;
  directUnitCostExclVat: number | null;
  lineAmountExcludingVat: number | null;
  cgstPercentage: number | null;
  cgstAmount: number | null;
  sgstPercentage: number | null;
  sgstAmount: number | null;
  igstPercentage: number | null;
  igstAmount: number | null;
  fixedAssetDescription: string | null;
  fixedAssetFaClassCode: string | null;
  fixedAssetFaSubclassCode: string | null;
  depreciationStartDate: string | null;
  noOfDepreciationYears: number | null;
  depreciationEndDate: string | null;
};

export type PurchaseRequestForAnalysis = {
  id: string;
  prId: string;
  requestDate: string;
  vendorCode: string;
  vendorName: string;
  vendorGstin: string;
  companyGstin: string;
  prType: "Invoice" | "Quotation";
  vendorInvoiceNumber: string;
  documentDate: string;
  purchaseRequestAmount: number;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  serviceStartDate: string | null;
  serviceEndDate: string | null;
  budgetPeriod: string | null;
  posAsInVendorState: boolean | null;
  totalAmountIncludingGst: number | null;
  attachments: PurchaseRequestAttachmentForAnalysis[];
  lines: PurchaseRequestLineForAnalysis[];
};

export type PurchaseRequestStatus = "pending_analysis" | "analyzing" | "analyzed";

export class PurchaseRequestAnalysisRepository {
  async getPurchaseRequestForAnalysis(
    purchaseRequestId: string,
  ): Promise<{ data: PurchaseRequestForAnalysis | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("purchase_requests")
      .select(
        "id, pr_id, request_date, vendor_code, vendor_name, vendor_gstin, company_gstin, pr_type, vendor_invoice_number, document_date, purchase_request_amount, bank_account_number, bank_ifsc, bank_name, service_start_date, service_end_date, budget_period, pos_as_in_vendor_state, total_amount_including_gst, purchase_request_attachments(id, file_name, storage_path, content_type), purchase_request_lines(line_no, description, department, gst_percentage, gst_amount, gst_group_code, program_code, responsible_dept, beneficiary_code, region_code, subproduct, qty, direct_unit_cost_excl_vat, line_amount_excluding_vat, cgst_percentage, cgst_amount, sgst_percentage, sgst_amount, igst_percentage, igst_amount, fixed_asset_description, fixed_asset_fa_class_code, fixed_asset_fa_subclass_code, depreciation_start_date, no_of_depreciation_years, depreciation_end_date)",
      )
      .eq("id", purchaseRequestId)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }
    if (!data) {
      return { data: null, errorMessage: "Purchase request not found." };
    }

    const attachmentRows = (data.purchase_request_attachments ?? []) as Array<{
      id: string;
      file_name: string;
      storage_path: string;
      content_type: string;
    }>;

    const lineRows = (data.purchase_request_lines ?? []) as Array<{
      line_no: number;
      description: string;
      department: string;
      gst_percentage: number;
      gst_amount: string | number;
      gst_group_code: string | null;
      program_code: string | null;
      responsible_dept: string | null;
      beneficiary_code: string | null;
      region_code: string | null;
      subproduct: string | null;
      qty: string | number | null;
      direct_unit_cost_excl_vat: string | number | null;
      line_amount_excluding_vat: string | number | null;
      cgst_percentage: string | number | null;
      cgst_amount: string | number | null;
      sgst_percentage: string | number | null;
      sgst_amount: string | number | null;
      igst_percentage: string | number | null;
      igst_amount: string | number | null;
      fixed_asset_description: string | null;
      fixed_asset_fa_class_code: string | null;
      fixed_asset_fa_subclass_code: string | null;
      depreciation_start_date: string | null;
      no_of_depreciation_years: number | null;
      depreciation_end_date: string | null;
    }>;

    const toNullableNumber = (value: string | number | null): number | null =>
      value === null ? null : Number(value);

    return {
      data: {
        id: data.id as string,
        prId: data.pr_id as string,
        requestDate: data.request_date as string,
        vendorCode: data.vendor_code as string,
        vendorName: data.vendor_name as string,
        vendorGstin: data.vendor_gstin as string,
        companyGstin: data.company_gstin as string,
        prType: data.pr_type as "Invoice" | "Quotation",
        vendorInvoiceNumber: data.vendor_invoice_number as string,
        documentDate: data.document_date as string,
        purchaseRequestAmount: Number(data.purchase_request_amount),
        bankAccountNumber: (data.bank_account_number as string | null) ?? null,
        bankIfsc: (data.bank_ifsc as string | null) ?? null,
        bankName: (data.bank_name as string | null) ?? null,
        serviceStartDate: (data.service_start_date as string | null) ?? null,
        serviceEndDate: (data.service_end_date as string | null) ?? null,
        budgetPeriod: (data.budget_period as string | null) ?? null,
        posAsInVendorState: (data.pos_as_in_vendor_state as boolean | null) ?? null,
        totalAmountIncludingGst: toNullableNumber(
          data.total_amount_including_gst as string | number | null,
        ),
        attachments: attachmentRows.map((row) => ({
          id: row.id,
          fileName: row.file_name,
          storagePath: row.storage_path,
          contentType: row.content_type,
        })),
        lines: lineRows.map((row) => ({
          lineNo: row.line_no,
          description: row.description,
          department: row.department,
          gstPercentage: Number(row.gst_percentage),
          gstAmount: Number(row.gst_amount),
          gstGroupCode: row.gst_group_code,
          programCode: row.program_code,
          responsibleDept: row.responsible_dept,
          beneficiaryCode: row.beneficiary_code,
          regionCode: row.region_code,
          subproduct: row.subproduct,
          qty: toNullableNumber(row.qty),
          directUnitCostExclVat: toNullableNumber(row.direct_unit_cost_excl_vat),
          lineAmountExcludingVat: toNullableNumber(row.line_amount_excluding_vat),
          cgstPercentage: toNullableNumber(row.cgst_percentage),
          cgstAmount: toNullableNumber(row.cgst_amount),
          sgstPercentage: toNullableNumber(row.sgst_percentage),
          sgstAmount: toNullableNumber(row.sgst_amount),
          igstPercentage: toNullableNumber(row.igst_percentage),
          igstAmount: toNullableNumber(row.igst_amount),
          fixedAssetDescription: row.fixed_asset_description,
          fixedAssetFaClassCode: row.fixed_asset_fa_class_code,
          fixedAssetFaSubclassCode: row.fixed_asset_fa_subclass_code,
          depreciationStartDate: row.depreciation_start_date,
          noOfDepreciationYears: row.no_of_depreciation_years,
          depreciationEndDate: row.depreciation_end_date,
        })),
      },
      errorMessage: null,
    };
  }

  async downloadAttachment(
    storagePath: string,
  ): Promise<{ data: Buffer | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client.storage
      .from(PURCHASE_REQUEST_ATTACHMENT_BUCKET)
      .download(storagePath);

    if (error || !data) {
      return { data: null, errorMessage: error?.message ?? "File not found in storage." };
    }

    return { data: Buffer.from(await data.arrayBuffer()), errorMessage: null };
  }

  async getLatestAnalysisId(
    purchaseRequestId: string,
  ): Promise<{ data: string | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("purchase_request_analyses")
      .select("analysis_id")
      .eq("purchase_request_id", purchaseRequestId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    return { data: (data?.analysis_id as string | undefined) ?? null, errorMessage: null };
  }

  async countPreviousAnalyses(
    purchaseRequestId: string,
  ): Promise<{ data: number; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { count, error } = await client
      .from("purchase_request_analyses")
      .select("id", { count: "exact", head: true })
      .eq("purchase_request_id", purchaseRequestId);

    if (error) {
      return { data: 0, errorMessage: error.message };
    }

    return { data: count ?? 0, errorMessage: null };
  }

  async insertAnalysis(input: {
    purchaseRequestId: string;
    analyzedAttachmentId: string | null;
    analysisId: string;
    model: string;
    response: PrAnalysisResponse;
  }): Promise<{ data: { id: string } | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("purchase_request_analyses")
      .insert({
        purchase_request_id: input.purchaseRequestId,
        analyzed_attachment_id: input.analyzedAttachmentId,
        analysis_id: input.analysisId,
        overall_status: input.response.overall_status,
        confidence_score: input.response.confidence_score,
        document_summary: input.response.document_summary,
        field_validations: input.response.field_validations,
        remarks: input.response.remarks,
        model: input.model,
      })
      .select("id")
      .single();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    return { data: { id: data.id as string }, errorMessage: null };
  }

  async updateStatus(
    purchaseRequestId: string,
    status: PurchaseRequestStatus,
  ): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { error } = await client
      .from("purchase_requests")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", purchaseRequestId);

    return { errorMessage: error?.message ?? null };
  }

  async getByAnalysisId(analysisId: string): Promise<{
    data: {
      overallStatus: string;
      confidenceScore: number;
      documentSummary: string;
      remarks: string;
    } | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("purchase_request_analyses")
      .select("overall_status, confidence_score, document_summary, remarks")
      .eq("analysis_id", analysisId)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }
    if (!data) {
      return { data: null, errorMessage: null };
    }

    return {
      data: {
        overallStatus: data.overall_status as string,
        confidenceScore: Number(data.confidence_score),
        documentSummary: data.document_summary as string,
        remarks: data.remarks as string,
      },
      errorMessage: null,
    };
  }

  /** Full row for building the BC callback payload -- everything BC needs about this analysis. */
  async getAnalysisForCallback(analysisId: string): Promise<{
    data: PurchaseRequestAnalysisForCallback | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("purchase_request_analyses")
      .select(
        "id, analysis_id, overall_status, confidence_score, document_summary, field_validations, remarks, created_at, bc_callback_status, bc_callback_attempts, bc_callback_sent_at, bc_callback_error, purchase_request_attachments(file_name), purchase_requests(pr_id, api_keys(callback_url, callback_api_key))",
      )
      .eq("analysis_id", analysisId)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }
    if (!data) {
      return { data: null, errorMessage: "Analysis not found." };
    }

    // Both are many-to-one embeds (this row's FK -> the other table's PK), so at
    // runtime PostgREST returns a single object (or null), not an array -- despite
    // what the untyped client's inferred TS shape suggests. Cast via unknown since
    // the two types don't structurally overlap.
    const attachment = data.purchase_request_attachments as unknown as {
      file_name: string;
    } | null;
    const purchaseRequest = data.purchase_requests as unknown as {
      pr_id: string;
      api_keys: { callback_url: string | null; callback_api_key: string | null } | null;
    } | null;
    if (!purchaseRequest) {
      return { data: null, errorMessage: "Analysis has no linked purchase request." };
    }

    return {
      data: {
        analysisRowId: data.id as string,
        prId: purchaseRequest.pr_id,
        analysisId: data.analysis_id as string,
        overallStatus: data.overall_status as string,
        confidenceScore: Number(data.confidence_score),
        documentSummary: data.document_summary as string,
        analyzedFileName: attachment?.file_name ?? null,
        fieldValidations: data.field_validations as PrAnalysisResponse["field_validations"],
        remarks: data.remarks as string,
        analyzedAt: data.created_at as string,
        bcCallbackStatus: data.bc_callback_status as "pending" | "sent" | "failed",
        bcCallbackAttempts: data.bc_callback_attempts as number,
        bcCallbackSentAt: data.bc_callback_sent_at as string | null,
        bcCallbackError: data.bc_callback_error as string | null,
        callbackUrl: purchaseRequest.api_keys?.callback_url ?? null,
        callbackApiKey: purchaseRequest.api_keys?.callback_api_key ?? null,
      },
      errorMessage: null,
    };
  }

  async updateCallbackStatus(
    analysisRowId: string,
    outcome:
      | { status: "sent"; attempts: number }
      | { status: "failed"; attempts: number; error: string },
  ): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { error } = await client
      .from("purchase_request_analyses")
      .update({
        bc_callback_status: outcome.status,
        bc_callback_attempts: outcome.attempts,
        bc_callback_sent_at: outcome.status === "sent" ? new Date().toISOString() : null,
        bc_callback_error: outcome.status === "failed" ? outcome.error : null,
      })
      .eq("id", analysisRowId);

    return { errorMessage: error?.message ?? null };
  }
}

export type PurchaseRequestAnalysisForCallback = {
  analysisRowId: string;
  prId: string;
  analysisId: string;
  overallStatus: string;
  confidenceScore: number;
  documentSummary: string;
  analyzedFileName: string | null;
  fieldValidations: PrAnalysisResponse["field_validations"];
  remarks: string;
  analyzedAt: string;
  bcCallbackStatus: "pending" | "sent" | "failed";
  bcCallbackAttempts: number;
  bcCallbackSentAt: string | null;
  bcCallbackError: string | null;
  callbackUrl: string | null;
  callbackApiKey: string | null;
};
