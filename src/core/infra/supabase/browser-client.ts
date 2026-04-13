"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientEnv } from "@/core/config/client-env";

let browserClient: SupabaseClient | null = null;

export function getBrowserSupabaseClient(): SupabaseClient {
  if (!browserClient) {
    browserClient = createBrowserClient(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
  }

  return browserClient;
}
