import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { serverEnv } from "@/core/config/server-env";
import { logger } from "@/core/infra/logging/logger";

/**
 * Returns true if the currently authenticated user exists in the `admins` table.
 * Wrapped in React.cache() so the DB query is deduplicated within a single request.
 */
export const isAdmin = cache(async (): Promise<boolean> => {
  try {
    const cookieStore = await cookies();

    const supabase = createServerClient(
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

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return false;
    }

    const { count, error } = await supabase
      .from("admins")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (error) {
      logger.warn("admin.is_admin.query_failed", {
        userId: user.id,
        error: error.message,
        code: error.code,
      });
      return false;
    }

    const result = (count ?? 0) > 0;
    logger.debug("admin.is_admin.check_complete", { userId: user.id, count, result });
    return result;
  } catch {
    return false;
  }
});
