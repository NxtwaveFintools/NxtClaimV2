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
  hod_user_id: string | null;
  founder_user_id: string | null;
};

export class SupabaseDepartmentRepository implements DepartmentRepository {
  async getActiveDepartmentsWithApprovers(): Promise<{
    data: ActiveDepartmentRouting[];
    errorMessage: string | null;
  }> {
    const client = getServiceRoleSupabaseClient();

    const { data, error } = await client
      .from("master_departments")
      .select("id, name, is_active, hod_user_id, founder_user_id")
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
          .flatMap((row) => [row.hod_user_id, row.founder_user_id])
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
        const hodUser = row.hod_user_id ? (usersById.get(row.hod_user_id) ?? null) : null;
        const founderUser = row.founder_user_id
          ? (usersById.get(row.founder_user_id) ?? null)
          : null;

        if (!hodUser || !founderUser) {
          return null;
        }

        return {
          id: row.id,
          name: row.name,
          isActive: row.is_active,
          hod: {
            id: hodUser.id,
            email: hodUser.email,
            fullName: hodUser.full_name,
            isActive: hodUser.is_active,
          },
          founder: {
            id: founderUser.id,
            email: founderUser.email,
            fullName: founderUser.full_name,
            isActive: founderUser.is_active,
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
