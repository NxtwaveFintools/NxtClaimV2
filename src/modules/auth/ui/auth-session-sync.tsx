"use client";

import { useEffect, useRef } from "react";
import type { Session } from "@supabase/supabase-js";
import { ROUTES } from "@/core/config/route-registry";
import { getBrowserSupabaseClient } from "@/core/infra/supabase/browser-client";
import { isSupabaseTerminalSessionError } from "@/core/infra/supabase/auth-error-utils";

async function persistServerSession(accessToken: string, refreshToken: string): Promise<boolean> {
  const response = await fetch(ROUTES.authApi.session, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accessToken,
      refreshToken,
    }),
    keepalive: true,
  }).catch(() => null);

  return Boolean(response?.ok);
}

async function clearServerSession(): Promise<void> {
  await fetch(ROUTES.authApi.logout, {
    method: "POST",
    keepalive: true,
  }).catch(() => null);
}

export function AuthSessionSync() {
  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastSyncedRefreshTokenRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();

    const syncSession = async (session: Session | null): Promise<void> => {
      const accessToken = session?.access_token;
      const refreshToken = session?.refresh_token;

      if (!accessToken || !refreshToken) {
        return;
      }

      if (lastSyncedRefreshTokenRef.current === refreshToken) {
        return;
      }

      if (inFlightRef.current) {
        return inFlightRef.current;
      }

      inFlightRef.current = (async () => {
        const ok = await persistServerSession(accessToken, refreshToken);
        if (ok) {
          lastSyncedRefreshTokenRef.current = refreshToken;
        }
      })().finally(() => {
        inFlightRef.current = null;
      });

      return inFlightRef.current;
    };

    const initialize = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        if (isSupabaseTerminalSessionError(error)) {
          lastSyncedRefreshTokenRef.current = null;
          await clearServerSession();
          await supabase.auth.signOut({ scope: "local" }).catch(() => null);
        }

        return;
      }

      await syncSession(data.session);
    };

    void initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        void syncSession(session);
      }

      if (event === "SIGNED_OUT") {
        lastSyncedRefreshTokenRef.current = null;
        void clearServerSession();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
