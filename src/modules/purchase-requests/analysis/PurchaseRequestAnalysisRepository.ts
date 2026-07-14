import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import { PURCHASE_REQUEST_ATTACHMENT_BUCKET } from "@/modules/purchase-requests/constants";
import type { PrAnalysisResponse } from "@/modules/purchase-requests/analysis/analysis-schema";

export type PurchaseRequestAttachmentForAnalysis = {
  id: string;
  fileName: string;
  storagePath: string;
  contentType: string;
};

export type PurchaseRequestForAnalysis = {
  id: string;
  prId: string;
  requestDate: string;
  vendorCode: string;
  vendorName: string;
  vendorGstin: string;
  companyGstin: string;
  department: string | null;
  prType: "Invoice" | "Quotation";
  vendorInvoiceNumber: string;
  documentDate: string;
  directUnitCost: number;
  gstPercentage: number;
  gstAmount: number;
  purchaseRequestAmount: number;
  description: string;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  attachments: PurchaseRequestAttachmentForAnalysis[];
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
        "id, pr_id, request_date, vendor_code, vendor_name, vendor_gstin, company_gstin, department, pr_type, vendor_invoice_number, document_date, direct_unit_cost, gst_percentage, gst_amount, purchase_request_amount, description, bank_account_number, bank_ifsc, bank_name, purchase_request_attachments(id, file_name, storage_path, content_type)",
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

    return {
      data: {
        id: data.id as string,
        prId: data.pr_id as string,
        requestDate: data.request_date as string,
        vendorCode: data.vendor_code as string,
        vendorName: data.vendor_name as string,
        vendorGstin: data.vendor_gstin as string,
        companyGstin: data.company_gstin as string,
        department: (data.department as string | null) ?? null,
        prType: data.pr_type as "Invoice" | "Quotation",
        vendorInvoiceNumber: data.vendor_invoice_number as string,
        documentDate: data.document_date as string,
        directUnitCost: Number(data.direct_unit_cost),
        gstPercentage: Number(data.gst_percentage),
        gstAmount: Number(data.gst_amount),
        purchaseRequestAmount: Number(data.purchase_request_amount),
        description: data.description as string,
        bankAccountNumber: (data.bank_account_number as string | null) ?? null,
        bankIfsc: (data.bank_ifsc as string | null) ?? null,
        bankName: (data.bank_name as string | null) ?? null,
        attachments: attachmentRows.map((row) => ({
          id: row.id,
          fileName: row.file_name,
          storagePath: row.storage_path,
          contentType: row.content_type,
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
}
