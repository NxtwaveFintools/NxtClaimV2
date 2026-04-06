import { revalidateTag } from "next/cache";

export const USER_ROLE_CACHE_TAG = "user-role";

export function getUserRoleCacheTag(userId: string): string {
  return `${USER_ROLE_CACHE_TAG}:${userId}`;
}

export function revalidateAllUserRoleChecks(): void {
  revalidateTag(USER_ROLE_CACHE_TAG, "max");
}

export function revalidateUserRoleChecks(userId: string): void {
  revalidateTag(USER_ROLE_CACHE_TAG, "max");
  revalidateTag(getUserRoleCacheTag(userId), "max");
}
