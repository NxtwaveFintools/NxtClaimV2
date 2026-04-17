"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ROUTES } from "@/core/config/route-registry";
import { CreateDepartmentService } from "@/core/domain/admin/CreateDepartmentService";
import { logger } from "@/core/infra/logging/logger";
import { SupabaseAdminRepository } from "@/modules/admin/repositories/SupabaseAdminRepository";
import { isAdmin } from "@/modules/admin/server/is-admin";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";

const adminRepository = new SupabaseAdminRepository();
const authRepository = new SupabaseServerAuthRepository();
const createDepartmentService = new CreateDepartmentService({
  repository: adminRepository,
  logger,
});

const addDepartmentSchema = z.object({
  name: z.string().trim().min(1, "Department name is required."),
  hod_email: z.string().trim().email("A valid HOD email is required."),
  founder_email: z.string().trim().email("A valid Founder email is required."),
});

export type AddDepartmentPayload = {
  name: string;
  hod_email: string;
  founder_email: string;
};

async function requireAdmin(): Promise<{ userId: string } | { forbidden: true }> {
  const [adminCheck, userResult] = await Promise.all([isAdmin(), authRepository.getCurrentUser()]);

  if (!adminCheck || userResult.errorMessage || !userResult.user) {
    return { forbidden: true };
  }

  return { userId: userResult.user.id };
}

export async function addDepartmentAction(
  payload: AddDepartmentPayload,
): Promise<{ ok: boolean; message?: string }> {
  const guard = await requireAdmin();
  if ("forbidden" in guard) {
    return { ok: false, message: "Forbidden: admin access required." };
  }

  const parsed = addDepartmentSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const result = await createDepartmentService.createDepartment({
    name: parsed.data.name,
    hodEmail: parsed.data.hod_email,
    founderEmail: parsed.data.founder_email,
  });

  if (result.errorMessage) {
    return { ok: false, message: result.errorMessage };
  }

  revalidatePath(ROUTES.admin.settings);
  return { ok: true };
}
