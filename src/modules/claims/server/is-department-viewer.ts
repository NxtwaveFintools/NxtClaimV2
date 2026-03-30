import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { serverEnv } from "@/core/config/server-env";
import { logger } from "@/core/infra/logging/logger";

/**
 * Returns true if the currently authenticated user is assigned as a department
 * viewer (POC) for at least one active department.
 * Wrapped in React.cache() so the DB query is deduplicated within a single request.
 */
export const isDepartmentViewer = cache(async (): Promise<boolean> => {
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
      .from("department_viewers")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (error) {
      logger.warn("department_viewer.is_department_viewer.query_failed", {
        userId: user.id,
        error: error.message,
        code: error.code,
      });
      return false;
    }

    const result = (count ?? 0) > 0;
    logger.debug("department_viewer.is_department_viewer.check_complete", {
      userId: user.id,
      count,
      result,
    });
    return result;
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
