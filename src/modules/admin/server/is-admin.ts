import { cache } from "react";
import { unstable_cache } from "next/cache";
import { logger } from "@/core/infra/logging/logger";
import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import { getCachedRequestAuthUser } from "@/modules/auth/server/get-request-auth-user";
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

function readAdminRoleFromAppMetadata(appMetadata: unknown): boolean | null {
  if (!appMetadata || typeof appMetadata !== "object") {
    return null;
  }

  const metadata = appMetadata as Record<string, unknown>;

  const snakeCaseFlag = parseBooleanClaim(metadata.is_admin);
  if (snakeCaseFlag !== null) {
    return snakeCaseFlag;
  }

  const camelCaseFlag = parseBooleanClaim(metadata.isAdmin);
  if (camelCaseFlag !== null) {
    return camelCaseFlag;
  }

  const singleRole = parseStringRole(metadata.role);
  if (singleRole === "admin") {
    return true;
  }

  const roles = metadata.roles;
  if (Array.isArray(roles)) {
    const hasAdminRole = roles.some((role) => parseStringRole(role) === "admin");
    if (hasAdminRole) {
      return true;
    }
  }

  return null;
}

async function queryAdminMembershipFromDatabase(userId: string): Promise<boolean> {
  const supabase = getServiceRoleSupabaseClient();

  const { count, error } = await supabase
    .from("admins")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    logger.warn("admin.is_admin.query_failed", {
      userId,
      error: error.message,
      code: error.code,
    });
    return false;
  }

  const result = (count ?? 0) > 0;
  logger.debug("admin.is_admin.check_complete", { userId, count, result });
  return result;
}

function queryAdminMembershipFromDataCache(userId: string): Promise<boolean> {
  return unstable_cache(
    async () => queryAdminMembershipFromDatabase(userId),
    ["role-check", "is-admin", userId],
    {
      tags: [USER_ROLE_CACHE_TAG, getUserRoleCacheTag(userId)],
      revalidate: USER_ROLE_REVALIDATE_SECONDS,
    },
  )();
}

const getCachedAdminMembershipForUser = cache(async (userId: string): Promise<boolean> => {
  return queryAdminMembershipFromDataCache(userId);
});

/**
 * Returns true if the currently authenticated user exists in the `admins` table.
 * Uses React.cache() for request memoization and Next data cache for cross-request dedupe.
 */
export const isAdmin = cache(async (): Promise<boolean> => {
  try {
    const authState = await getCachedRequestAuthUser();
    if (authState.errorMessage || !authState.user) {
      return false;
    }

    const metadataRole = readAdminRoleFromAppMetadata(authState.user.app_metadata);
    if (metadataRole !== null) {
      return metadataRole;
    }

    return getCachedAdminMembershipForUser(authState.user.id);
  } catch {
    return false;
  }
});
