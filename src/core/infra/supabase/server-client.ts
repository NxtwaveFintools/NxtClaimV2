import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/core/config/server-env";

export function getPublicServerSupabaseClient(): SupabaseClient {
  return createClient(serverEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function getServiceRoleSupabaseClient(): SupabaseClient {
  return createClient(serverEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
