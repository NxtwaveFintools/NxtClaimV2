import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import type {
  ActiveDepartmentRouting,
  DepartmentRepository,
} from "@/core/domain/departments/contracts";

type DepartmentJoinUser = {
  id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
} | null;

type DepartmentJoinRow = {
  id: string;
  name: string;
  is_active: boolean;
  approver1_id: string | null;
  approver2_id: string | null;
};

export class SupabaseDepartmentRepository implements DepartmentRepository {
  async getActiveDepartmentsWithApprovers(): Promise<{
    data: ActiveDepartmentRouting[];
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();

    const { data, error } = await client
      .from("master_departments")
      .select("id, name, is_active, approver1_id, approver2_id")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      return {
        data: [],
        errorMessage: error.message,
      };
    }

    const rows = (data ?? []) as DepartmentJoinRow[];
    const approverIds = Array.from(
      new Set(
        rows
          .flatMap((row) => [row.approver1_id, row.approver2_id])
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (approverIds.length === 0) {
      return {
        data: [],
        errorMessage: null,
      };
    }

    const { data: usersData, error: usersError } = await client
      .from("users")
      .select("id, email, full_name, is_active")
      .in("id", approverIds);

    if (usersError) {
      return {
        data: [],
        errorMessage: usersError.message,
      };
    }

    const usersById = new Map<string, DepartmentJoinUser>();
    for (const user of (usersData ?? []) as Exclude<DepartmentJoinUser, null>[]) {
      usersById.set(user.id, user);
    }

    const mapped = rows
      .map((row) => {
        const approver1User = row.approver1_id ? (usersById.get(row.approver1_id) ?? null) : null;
        const approver2User = row.approver2_id ? (usersById.get(row.approver2_id) ?? null) : null;

        if (!approver1User || !approver2User) {
          return null;
        }

        return {
          id: row.id,
          name: row.name,
          isActive: row.is_active,
          approver1: {
            id: approver1User.id,
            email: approver1User.email,
            fullName: approver1User.full_name,
            isActive: approver1User.is_active,
          },
          approver2: {
            id: approver2User.id,
            email: approver2User.email,
            fullName: approver2User.full_name,
            isActive: approver2User.is_active,
          },
        };
      })
      .filter((row): row is ActiveDepartmentRouting => row !== null);

    return {
      data: mapped,
      errorMessage: null,
    };
  }
}
