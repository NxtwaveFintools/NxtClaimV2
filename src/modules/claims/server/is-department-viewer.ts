import { cache } from "react";
import { unstable_cache } from "next/cache";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { serverEnv } from "@/core/config/server-env";
import { logger } from "@/core/infra/logging/logger";
import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import { getUserRoleCacheTag, USER_ROLE_CACHE_TAG } from "@/modules/auth/server/user-role-cache";

const USER_ROLE_REVALIDATE_SECONDS = 60 * 60;

function parseBooleanClaim(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return null;
}

function parseStringRole(value: unknown): string | null {
  return typeof value === "string" ? value.trim().toLowerCase() : null;
}

function readDepartmentViewerRoleFromAppMetadata(appMetadata: unknown): boolean | null {
  if (!appMetadata || typeof appMetadata !== "object") {
    return null;
  }

  const metadata = appMetadata as Record<string, unknown>;

  const snakeCaseFlag = parseBooleanClaim(metadata.is_department_viewer);
  if (snakeCaseFlag !== null) {
    return snakeCaseFlag;
  }

  const camelCaseFlag = parseBooleanClaim(metadata.isDepartmentViewer);
  if (camelCaseFlag !== null) {
    return camelCaseFlag;
  }

  const validRoles = new Set(["department_viewer", "department-viewer", "dept_viewer"]);
  const singleRole = parseStringRole(metadata.role);
  if (singleRole && validRoles.has(singleRole)) {
    return true;
  }

  const roles = metadata.roles;
  if (Array.isArray(roles)) {
    const hasViewerRole = roles.some((role) => {
      const parsed = parseStringRole(role);
      return parsed ? validRoles.has(parsed) : false;
    });

    if (hasViewerRole) {
      return true;
    }
  }

  return null;
}

async function createRequestScopedSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            try {
              cookieStore.set(name, value, options);
            } catch {
              // Server components may not set cookies; safe to ignore.
            }
          });
        },
      },
    },
  );
}

async function queryDepartmentViewerMembershipFromDatabase(userId: string): Promise<boolean> {
  const supabase = getServiceRoleSupabaseClient();

  const { count, error } = await supabase
    .from("department_viewers")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) {
    logger.warn("department_viewer.is_department_viewer.query_failed", {
      userId,
      error: error.message,
      code: error.code,
    });
    return false;
  }

  const result = (count ?? 0) > 0;
  logger.debug("department_viewer.is_department_viewer.check_complete", {
    userId,
    count,
    result,
  });
  return result;
}

function queryDepartmentViewerMembershipFromDataCache(userId: string): Promise<boolean> {
  return unstable_cache(
    async () => queryDepartmentViewerMembershipFromDatabase(userId),
    ["role-check", "is-department-viewer", userId],
    {
      tags: [USER_ROLE_CACHE_TAG, getUserRoleCacheTag(userId)],
      revalidate: USER_ROLE_REVALIDATE_SECONDS,
    },
  )();
}

const getCachedDepartmentViewerMembershipForUser = cache(
  async (userId: string): Promise<boolean> => {
    return queryDepartmentViewerMembershipFromDataCache(userId);
  },
);

/**
 * Returns true if the currently authenticated user is assigned as a department
 * viewer (POC) for at least one active department.
 * Uses React.cache() for request memoization and Next data cache for cross-request dedupe.
 */
export const isDepartmentViewer = cache(async (): Promise<boolean> => {
  try {
    const supabase = await createRequestScopedSupabaseClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return false;
    }

    const metadataRole = readDepartmentViewerRoleFromAppMetadata(user.app_metadata);
    if (metadataRole !== null) {
      return metadataRole;
    }

    return getCachedDepartmentViewerMembershipForUser(user.id);
  } catch {
    return false;
  }
});

/**
 * Returns the list of department IDs the given user is assigned to view.
 * Used on the detail page to check if a user can view a specific claim
 * as a department POC.
 */
export async function getViewerDepartmentIds(userId: string): Promise<string[]> {
  try {
    const supabase = await createRequestScopedSupabaseClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user || user.id !== userId) {
      return [];
    }

    const { data, error } = await supabase
      .from("department_viewers")
      .select("department_id")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) {
      logger.warn("department_viewer.get_viewer_department_ids.query_failed", {
        userId,
        error: error.message,
        code: error.code,
      });
      return [];
    }

    return (data ?? []).map((row) => row.department_id as string);
  } catch {
    return [];
  }
}
