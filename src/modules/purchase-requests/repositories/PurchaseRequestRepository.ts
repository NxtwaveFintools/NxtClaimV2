import { createHash } from "node:crypto";
import { logger } from "@/core/infra/logging/logger";
import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import { PURCHASE_REQUEST_ATTACHMENT_BUCKET } from "@/modules/purchase-requests/constants";

export type ApiKeyRecord = {
  id: string;
  companyId: string;
};

export type InsertPurchaseRequestInput = {
  apiKeyId: string;
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
};

export type AttachmentRecord = {
  id: string;
  storagePath: string;
};

export type InsertAttachmentInput = {
  fileName: string;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
};

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function toRow(input: InsertPurchaseRequestInput) {
  return {
    api_key_id: input.apiKeyId,
    pr_id: input.prId,
    request_date: input.requestDate,
    vendor_code: input.vendorCode,
    vendor_name: input.vendorName,
    vendor_gstin: input.vendorGstin,
    company_gstin: input.companyGstin,
    department: input.department,
    pr_type: input.prType,
    vendor_invoice_number: input.vendorInvoiceNumber,
    document_date: input.documentDate,
    direct_unit_cost: input.directUnitCost,
    gst_percentage: input.gstPercentage,
    gst_amount: input.gstAmount,
    purchase_request_amount: input.purchaseRequestAmount,
    description: input.description,
    bank_account_number: input.bankAccountNumber,
    bank_ifsc: input.bankIfsc,
    bank_name: input.bankName,
  };
}

export class PurchaseRequestRepository {
  async findActiveApiKeyByRawKey(
    rawKey: string,
  ): Promise<{ data: ApiKeyRecord | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("api_keys")
      .select("id, company_id")
      .eq("key_hash", hashApiKey(rawKey))
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }
    if (!data) {
      return { data: null, errorMessage: null };
    }

    return {
      data: { id: data.id as string, companyId: data.company_id as string },
      errorMessage: null,
    };
  }

  async countRequestsInLastHour(
    apiKeyId: string,
  ): Promise<{ data: number; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { count, error } = await client
      .from("purchase_requests")
      .select("id", { count: "exact", head: true })
      .eq("api_key_id", apiKeyId)
      .gte("created_at", oneHourAgo);

    if (error) {
      return { data: 0, errorMessage: error.message };
    }

    return { data: count ?? 0, errorMessage: null };
  }

  async findByPrId(prId: string): Promise<{
    data: { id: string; attachments: AttachmentRecord[] } | null;
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("purchase_requests")
      .select("id, purchase_request_attachments(id, storage_path)")
      .eq("pr_id", prId)
      .maybeSingle();

    if (error) {
      return { data: null, errorMessage: error.message };
    }
    if (!data) {
      return { data: null, errorMessage: null };
    }

    const attachmentRows = (data.purchase_request_attachments ?? []) as Array<{
      id: string;
      storage_path: string;
    }>;

    return {
      data: {
        id: data.id as string,
        attachments: attachmentRows.map((row) => ({ id: row.id, storagePath: row.storage_path })),
      },
      errorMessage: null,
    };
  }

  async uploadAttachment(
    storagePath: string,
    fileBuffer: Buffer,
    contentType: string,
  ): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { error } = await client.storage
      .from(PURCHASE_REQUEST_ATTACHMENT_BUCKET)
      .upload(storagePath, fileBuffer, {
        cacheControl: "3600",
        upsert: false,
        contentType,
      });

    return { errorMessage: error?.message ?? null };
  }

  async removeAttachments(storagePaths: string[]): Promise<void> {
    if (storagePaths.length === 0) return;
    const client = getServiceRoleSupabaseClient();
    const { error } = await client.storage
      .from(PURCHASE_REQUEST_ATTACHMENT_BUCKET)
      .remove(storagePaths);
    if (error) {
      // Best-effort cleanup -- callers don't (and can't cheaply) roll back on this, but
      // a silent failure here means the object stays in the billable bucket forever
      // with zero trace, so at least log it.
      logger.error("purchase_request.attachment_storage_removal_failed", {
        errorMessage: error.message,
        storagePaths,
      });
    }
  }

  async insert(
    input: InsertPurchaseRequestInput,
  ): Promise<{ data: { id: string } | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("purchase_requests")
      .insert(toRow(input))
      .select("id")
      .single();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    return { data: { id: data.id as string }, errorMessage: null };
  }

  /** Overwrites an existing PR (re-submission with the same pr_id) and resets it to pending_analysis. */
  async update(
    id: string,
    input: InsertPurchaseRequestInput,
  ): Promise<{ data: { id: string } | null; errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("purchase_requests")
      .update({ ...toRow(input), status: "pending_analysis", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .single();

    if (error) {
      return { data: null, errorMessage: error.message };
    }

    return { data: { id: data.id as string }, errorMessage: null };
  }

  async insertAttachments(
    purchaseRequestId: string,
    attachments: InsertAttachmentInput[],
  ): Promise<{ errorMessage: string | null }> {
    const client = getServiceRoleSupabaseClient();
    const { error } = await client.from("purchase_request_attachments").insert(
      attachments.map((attachment) => ({
        purchase_request_id: purchaseRequestId,
        file_name: attachment.fileName,
        storage_path: attachment.storagePath,
        content_type: attachment.contentType,
        size_bytes: attachment.sizeBytes,
      })),
    );

    return { errorMessage: error?.message ?? null };
  }

  /**
   * Deletes specific attachment rows by id. On a resubmission this MUST target the
   * old rows' ids rather than `purchase_request_id` -- the new attachments inserted
   * moments earlier share the same purchase_request_id (it's an update, not a new
   * row), so a purchase_request_id-scoped delete would wipe them out too.
   */
  async deleteAttachmentsByIds(ids: string[]): Promise<{ errorMessage: string | null }> {
    if (ids.length === 0) return { errorMessage: null };
    const client = getServiceRoleSupabaseClient();
    const { error } = await client.from("purchase_request_attachments").delete().in("id", ids);

    return { errorMessage: error?.message ?? null };
  }
}
