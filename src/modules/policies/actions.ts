"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROUTES } from "@/core/config/route-registry";
import { PolicyService } from "@/core/domain/policies/PolicyService";
import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import { logger } from "@/core/infra/logging/logger";
import { isAdmin } from "@/modules/admin/server/is-admin";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";
import { SupabasePolicyRepository } from "@/modules/policies/repositories/SupabasePolicyRepository";

const authRepository = new SupabaseServerAuthRepository();
const policyRepository = new SupabasePolicyRepository();
const policyService = new PolicyService({ repository: policyRepository, logger });

const POLICY_STORAGE_BUCKET = "policies";
const MAX_POLICY_FILE_SIZE_BYTES = 25 * 1024 * 1024;

const policyIdSchema = z.string().uuid("Invalid policy ID.");
const versionNameSchema = z.string().trim().min(1, "Version name is required.");

export type ActivePolicyActionState = {
  policy: {
    id: string;
    versionName: string;
    fileUrl: string;
    createdAt: string;
  } | null;
  accepted: boolean;
  acceptedAt: string | null;
};

async function requireAuthenticatedUser(): Promise<{ userId: string } | { unauthorized: true }> {
  const currentUserResult = await authRepository.getCurrentUser();

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return { unauthorized: true };
  }

  return { userId: currentUserResult.user.id };
}

async function requireAdminUser(): Promise<{ userId: string } | { forbidden: true }> {
  const [adminCheck, userResult] = await Promise.all([isAdmin(), authRepository.getCurrentUser()]);

  if (!adminCheck || userResult.errorMessage || !userResult.user?.id) {
    return { forbidden: true };
  }

  return { userId: userResult.user.id };
}

function sanitizeFileName(fileName: string): string {
  const normalized = fileName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_");
  if (!normalized) {
    return "policy.pdf";
  }

  return normalized.endsWith(".pdf") ? normalized : `${normalized}.pdf`;
}

function isPdfFile(file: File): boolean {
  if (file.type === "application/pdf") {
    return true;
  }

  return file.name.toLowerCase().endsWith(".pdf");
}

function getFileFromFormData(formData: FormData): File | null {
  const fileValue = formData.get("policyFile");

  if (!(fileValue instanceof File)) {
    return null;
  }

  if (fileValue.size <= 0) {
    return null;
  }

  return fileValue;
}

function revalidatePolicyPaths() {
  revalidatePath(ROUTES.dashboard);
  revalidatePath(ROUTES.claims.myClaims);
  revalidatePath(ROUTES.claims.new);
  revalidatePath(ROUTES.dashboardAnalytics);
  revalidatePath(ROUTES.admin.settings);
}

export async function getActivePolicyStateAction(): Promise<{
  ok: boolean;
  data?: ActivePolicyActionState;
  message?: string;
}> {
  const authGuard = await requireAuthenticatedUser();

  if ("unauthorized" in authGuard) {
    return { ok: false, message: "Unauthorized." };
  }

  const result = await policyService.getActivePolicy(authGuard.userId);

  if (result.errorCode === "POLICY_NOT_FOUND") {
    return {
      ok: true,
      data: {
        policy: null,
        accepted: false,
        acceptedAt: null,
      },
      message: result.errorMessage ?? "No active company policy was found.",
    };
  }

  if (result.errorMessage || !result.data) {
    return {
      ok: false,
      message: result.errorMessage ?? "Unable to load active company policy.",
    };
  }

  return {
    ok: true,
    data: {
      policy: {
        id: result.data.policy.id,
        versionName: result.data.policy.versionName,
        fileUrl: result.data.policy.fileUrl,
        createdAt: result.data.policy.createdAt,
      },
      accepted: result.data.accepted,
      acceptedAt: result.data.acceptedAt,
    },
  };
}

export async function acceptPolicyAction(policyId: string): Promise<{
  ok: boolean;
  acceptedAt?: string | null;
  message?: string;
}> {
  const authGuard = await requireAuthenticatedUser();

  if ("unauthorized" in authGuard) {
    return { ok: false, message: "Unauthorized." };
  }

  const parsedPolicyId = policyIdSchema.safeParse(policyId);
  if (!parsedPolicyId.success) {
    return { ok: false, message: parsedPolicyId.error.issues[0]?.message ?? "Invalid policy ID." };
  }

  const result = await policyService.acceptPolicy(authGuard.userId, parsedPolicyId.data);

  if (result.errorMessage) {
    return {
      ok: false,
      message: result.errorMessage,
    };
  }

  revalidatePolicyPaths();

  return { ok: true, acceptedAt: result.data?.acceptedAt ?? null };
}

export async function publishNewPolicyAction(formData: FormData): Promise<{
  ok: boolean;
  message?: string;
}> {
  const guard = await requireAdminUser();

  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const versionValue = formData.get("versionName");
  const versionParse = versionNameSchema.safeParse(
    typeof versionValue === "string" ? versionValue : "",
  );

  if (!versionParse.success) {
    return {
      ok: false,
      message: versionParse.error.issues[0]?.message ?? "Version name is required.",
    };
  }

  const policyFile = getFileFromFormData(formData);
  if (!policyFile) {
    return { ok: false, message: "Policy PDF file is required." };
  }

  if (!isPdfFile(policyFile)) {
    return { ok: false, message: "Only PDF files are supported." };
  }

  if (policyFile.size > MAX_POLICY_FILE_SIZE_BYTES) {
    return {
      ok: false,
      message: "PDF file is too large. Please upload a file up to 25MB.",
    };
  }

  const supabaseClient = getServiceRoleSupabaseClient();
  const policyFileName = sanitizeFileName(policyFile.name);
  const storagePath = `${guard.userId}/${Date.now()}_${policyFileName}`;
  const fileBuffer = Buffer.from(await policyFile.arrayBuffer());

  const { error: uploadError } = await supabaseClient.storage
    .from(POLICY_STORAGE_BUCKET)
    .upload(storagePath, fileBuffer, {
      cacheControl: "3600",
      upsert: false,
      contentType: "application/pdf",
    });

  if (uploadError) {
    return { ok: false, message: uploadError.message };
  }

  const { data: publicUrlResult } = supabaseClient.storage
    .from(POLICY_STORAGE_BUCKET)
    .getPublicUrl(storagePath);

  const policyFileUrl = publicUrlResult.publicUrl;

  const publishResult = await policyService.publishNewPolicy(policyFileUrl, versionParse.data);

  if (publishResult.errorMessage) {
    await supabaseClient.storage.from(POLICY_STORAGE_BUCKET).remove([storagePath]);

    return {
      ok: false,
      message: publishResult.errorMessage,
    };
  }

  revalidatePolicyPaths();

  return { ok: true };
}
