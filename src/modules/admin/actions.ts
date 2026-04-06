"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logger } from "@/core/infra/logging/logger";
import { ROUTES } from "@/core/config/route-registry";
import { USER_ROLES } from "@/core/constants/auth";
import { AdminSoftDeleteClaimService } from "@/core/domain/admin/AdminSoftDeleteClaimService";
import { ManageMasterDataService } from "@/core/domain/admin/ManageMasterDataService";
import { ManageActorsService } from "@/core/domain/admin/ManageActorsService";
import { ManageAdminsService } from "@/core/domain/admin/ManageAdminsService";
import { ManageDepartmentViewersService } from "@/core/domain/admin/ManageDepartmentViewersService";
import type { MasterDataTableName } from "@/core/domain/admin/contracts";
import { isAdmin } from "@/modules/admin/server/is-admin";
import { SupabaseAdminRepository } from "@/modules/admin/repositories/SupabaseAdminRepository";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";
import {
  revalidateAllUserRoleChecks,
  revalidateUserRoleChecks,
} from "@/modules/auth/server/user-role-cache";

// ----------------------------------------------------------------
// Shared instances (singleton-per-request via module scope)
// ----------------------------------------------------------------

const adminRepository = new SupabaseAdminRepository();
const authRepository = new SupabaseServerAuthRepository();
const softDeleteService = new AdminSoftDeleteClaimService({ repository: adminRepository, logger });
const manageMasterDataService = new ManageMasterDataService({
  repository: adminRepository,
  logger,
});
const manageActorsService = new ManageActorsService({ repository: adminRepository, logger });
const manageAdminsService = new ManageAdminsService({ repository: adminRepository, logger });
const manageDepartmentViewersService = new ManageDepartmentViewersService({
  repository: adminRepository,
  logger,
});

// ----------------------------------------------------------------
// Shared Zod schemas
// ----------------------------------------------------------------

const idSchema = z.string().trim().min(1, "ID is required");

const masterDataTableSchema = z.enum([
  "master_expense_categories",
  "master_products",
  "master_locations",
  "master_payment_modes",
]);

const userRoleSchema = z.enum([
  USER_ROLES.employee,
  USER_ROLES.hod,
  USER_ROLES.founder,
  USER_ROLES.finance,
]);

// ----------------------------------------------------------------
// Admin guard helper
// ----------------------------------------------------------------

async function requireAdmin(): Promise<{ userId: string } | { forbidden: true }> {
  const [adminCheck, userResult] = await Promise.all([isAdmin(), authRepository.getCurrentUser()]);

  if (!adminCheck || userResult.errorMessage || !userResult.user) {
    return { forbidden: true };
  }

  return { userId: userResult.user.id };
}

function revalidateRoleChecksForUser(userId: string | null | undefined): void {
  if (userId) {
    revalidateUserRoleChecks(userId);
    return;
  }

  revalidateAllUserRoleChecks();
}

// ----------------------------------------------------------------
// Actions
// ----------------------------------------------------------------

export async function softDeleteClaimAction(
  claimId: string,
): Promise<{ ok: boolean; message?: string }> {
  const guard = await requireAdmin();
  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const parsed = idSchema.safeParse(claimId);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid claim ID." };
  }

  const result = await softDeleteService.execute({
    claimId: parsed.data,
    actorId: guard.userId,
  });

  if (!result.success) {
    return { ok: false, message: result.errorMessage ?? "Failed to soft-delete claim." };
  }

  revalidatePath(ROUTES.claims.myClaims);
  revalidatePath(ROUTES.claims.detail(parsed.data));

  return { ok: true };
}

export async function createMasterDataItemAction(
  tableName: MasterDataTableName,
  name: string,
): Promise<{ ok: boolean; message?: string }> {
  const guard = await requireAdmin();
  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const tableResult = masterDataTableSchema.safeParse(tableName);
  if (!tableResult.success) {
    return { ok: false, message: "Invalid master data table." };
  }

  const nameResult = z.string().trim().min(1, "Name is required").safeParse(name);
  if (!nameResult.success) {
    return { ok: false, message: nameResult.error.issues[0]?.message ?? "Invalid name." };
  }

  const result = await manageMasterDataService.createItem({
    tableName: tableResult.data,
    name: nameResult.data,
  });

  if (result.errorMessage) {
    return { ok: false, message: result.errorMessage };
  }

  revalidatePath(ROUTES.admin.settings);

  return { ok: true };
}

export async function updateMasterDataItemAction(
  tableName: MasterDataTableName,
  id: string,
  payload: { name?: string; isActive?: boolean },
): Promise<{ ok: boolean; message?: string }> {
  const guard = await requireAdmin();
  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const tableResult = masterDataTableSchema.safeParse(tableName);
  if (!tableResult.success) {
    return { ok: false, message: "Invalid master data table." };
  }

  const idResult = idSchema.safeParse(id);
  if (!idResult.success) {
    return { ok: false, message: "Invalid item ID." };
  }

  const payloadSchema = z
    .object({
      name: z.string().trim().min(1).optional(),
      isActive: z.boolean().optional(),
    })
    .refine((p) => p.name !== undefined || p.isActive !== undefined, {
      message: "At least one field to update is required.",
    });

  const payloadResult = payloadSchema.safeParse(payload);
  if (!payloadResult.success) {
    return {
      ok: false,
      message: payloadResult.error.issues[0]?.message ?? "Invalid payload.",
    };
  }

  const result = await manageMasterDataService.updateItem({
    tableName: tableResult.data,
    id: idResult.data,
    payload: payloadResult.data,
  });

  if (result.errorMessage) {
    return { ok: false, message: result.errorMessage };
  }

  revalidatePath(ROUTES.admin.settings);

  return { ok: true };
}

export async function updateDepartmentActorsAction(
  departmentId: string,
  hodUserId: string,
  founderUserId: string,
): Promise<{ ok: boolean; message?: string }> {
  const guard = await requireAdmin();
  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const schema = z.object({
    departmentId: idSchema,
    hodUserId: idSchema,
    founderUserId: idSchema,
  });

  const parsed = schema.safeParse({ departmentId, hodUserId, founderUserId });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const result = await manageActorsService.updateDepartmentActors(parsed.data);

  if (!result.success) {
    return { ok: false, message: result.errorMessage ?? "Failed to update department actors." };
  }

  revalidatePath(ROUTES.admin.settings);

  return { ok: true };
}

export async function updateDepartmentActorsByEmailAction(
  departmentId: string,
  hodEmail: string,
  founderEmail: string,
): Promise<{ ok: boolean; message?: string }> {
  const guard = await requireAdmin();
  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const schema = z.object({
    departmentId: idSchema,
    hodEmail: z.string().trim().email(),
    founderEmail: z.string().trim().email(),
  });

  const parsed = schema.safeParse({ departmentId, hodEmail, founderEmail });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const result = await manageActorsService.updateDepartmentActorsByEmail({
    departmentId: parsed.data.departmentId,
    hodEmail: parsed.data.hodEmail,
    founderEmail: parsed.data.founderEmail,
  });

  if (!result.success) {
    return { ok: false, message: result.errorMessage ?? "Failed to update department actors." };
  }

  revalidatePath(ROUTES.admin.settings);

  return { ok: true };
}

export async function createFinanceApproverAction(
  userId: string,
): Promise<{ ok: boolean; message?: string }> {
  const guard = await requireAdmin();
  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const parsed = idSchema.safeParse(userId);
  if (!parsed.success) {
    return { ok: false, message: "Invalid user ID." };
  }

  const result = await manageActorsService.createFinanceApprover({ userId: parsed.data });

  if (result.errorMessage) {
    return { ok: false, message: result.errorMessage };
  }

  revalidatePath(ROUTES.admin.settings);

  return { ok: true };
}

export async function addFinanceApproverByEmailAction(
  email: string,
): Promise<{ ok: boolean; message?: string }> {
  const guard = await requireAdmin();
  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const emailResult = z.string().trim().email("Invalid email address.").safeParse(email);
  if (!emailResult.success) {
    return { ok: false, message: emailResult.error.issues[0]?.message ?? "Invalid email." };
  }

  const result = await manageActorsService.addFinanceApproverByEmail({ email: emailResult.data });

  if (result.errorMessage) {
    return { ok: false, message: result.errorMessage };
  }

  revalidatePath(ROUTES.admin.settings);

  return { ok: true };
}

export async function updateFinanceApproverAction(
  id: string,
  payload: { isActive?: boolean; isPrimary?: boolean },
): Promise<{ ok: boolean; message?: string }> {
  const guard = await requireAdmin();
  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const idResult = idSchema.safeParse(id);
  if (!idResult.success) {
    return { ok: false, message: "Invalid finance approver ID." };
  }

  const payloadSchema = z
    .object({
      isActive: z.boolean().optional(),
      isPrimary: z.boolean().optional(),
    })
    .refine((p) => p.isActive !== undefined || p.isPrimary !== undefined, {
      message: "At least one field to update is required.",
    });

  const payloadResult = payloadSchema.safeParse(payload);
  if (!payloadResult.success) {
    return { ok: false, message: payloadResult.error.issues[0]?.message ?? "Invalid payload." };
  }

  const result = await manageActorsService.updateFinanceApprover({
    id: idResult.data,
    payload: payloadResult.data,
  });

  if (result.errorMessage) {
    return { ok: false, message: result.errorMessage };
  }

  revalidatePath(ROUTES.admin.settings);

  return { ok: true };
}

export async function updateUserRoleAction(
  userId: string,
  role: string,
): Promise<{ ok: boolean; message?: string }> {
  const guard = await requireAdmin();
  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const idResult = idSchema.safeParse(userId);
  if (!idResult.success) {
    return { ok: false, message: "Invalid user ID." };
  }

  const roleResult = userRoleSchema.safeParse(role);
  if (!roleResult.success) {
    return { ok: false, message: "Invalid role value." };
  }

  const result = await adminRepository.updateUserRole(idResult.data, roleResult.data);

  if (!result.success) {
    return { ok: false, message: result.errorMessage ?? "Failed to update user role." };
  }

  revalidateRoleChecksForUser(idResult.data);
  revalidatePath(ROUTES.admin.settings);

  return { ok: true };
}

export async function addAdminAction(email: string): Promise<{ ok: boolean; message?: string }> {
  const guard = await requireAdmin();
  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const parsed = z.string().trim().email("Invalid email address.").safeParse(email);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.flatten().formErrors[0] ?? "Invalid email address." };
  }

  const result = await manageAdminsService.addAdminByEmail(parsed.data);

  if (result.errorMessage) {
    return { ok: false, message: result.errorMessage };
  }

  revalidateRoleChecksForUser(result.data?.userId);
  revalidatePath(ROUTES.admin.settings);

  return { ok: true };
}

export async function removeAdminAction(
  adminId: string,
): Promise<{ ok: boolean; message?: string }> {
  const guard = await requireAdmin();
  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const parsed = idSchema.safeParse(adminId);
  if (!parsed.success) {
    return { ok: false, message: "Invalid admin record ID." };
  }

  const result = await manageAdminsService.removeAdmin(parsed.data);

  if (!result.success) {
    return { ok: false, message: result.errorMessage ?? "Failed to remove admin." };
  }

  revalidateAllUserRoleChecks();
  revalidatePath(ROUTES.admin.settings);

  return { ok: true };
}

// ----------------------------------------------------------------
// Department Viewer (POC) actions
// ----------------------------------------------------------------

export async function addDepartmentViewerAction(
  departmentId: string,
  email: string,
): Promise<{ ok: boolean; message?: string }> {
  const guard = await requireAdmin();
  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const parsedDeptId = idSchema.safeParse(departmentId);
  if (!parsedDeptId.success) {
    return { ok: false, message: "Invalid department ID." };
  }

  const parsedEmail = z.string().trim().email("Invalid email address.").safeParse(email);
  if (!parsedEmail.success) {
    return {
      ok: false,
      message: parsedEmail.error.flatten().formErrors[0] ?? "Invalid email address.",
    };
  }

  const result = await manageDepartmentViewersService.addViewerByEmail(
    parsedDeptId.data,
    parsedEmail.data,
  );

  if (result.errorMessage) {
    return { ok: false, message: result.errorMessage };
  }

  revalidateRoleChecksForUser(result.data?.userId);
  revalidatePath(ROUTES.admin.settings);
  return { ok: true };
}

export async function removeDepartmentViewerAction(
  viewerId: string,
): Promise<{ ok: boolean; message?: string }> {
  const guard = await requireAdmin();
  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const parsed = idSchema.safeParse(viewerId);
  if (!parsed.success) {
    return { ok: false, message: "Invalid viewer record ID." };
  }

  const result = await manageDepartmentViewersService.removeViewer(parsed.data);

  if (!result.success) {
    return { ok: false, message: result.errorMessage ?? "Failed to remove viewer." };
  }

  revalidateAllUserRoleChecks();
  revalidatePath(ROUTES.admin.settings);
  return { ok: true };
}
