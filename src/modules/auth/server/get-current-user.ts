import { cache } from "react";
import { getCachedRequestAuthUser } from "@/modules/auth/server/get-request-auth-user";

/**
 * React.cache()-wrapped getCurrentUser. Deduplicates multiple calls within
 * a single RSC render pass (e.g. outer page + inner Suspense boundary).
 */
export const getCachedCurrentUser = cache(async () => {
  const authState = await getCachedRequestAuthUser();

  if (authState.errorMessage || !authState.user) {
    return {
      user: null,
      errorMessage: authState.errorMessage,
    };
  }

  return {
    user: {
      id: authState.user.id,
      email: authState.user.email ?? null,
    },
    errorMessage: null,
  };
});
