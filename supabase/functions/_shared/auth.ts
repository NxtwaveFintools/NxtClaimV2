// supabase/functions/_shared/auth.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401; code: "UNAUTHENTICATED" }
  | { ok: false; status: 403; code: "FORBIDDEN" };

function getJwt(req: Request): string {
  return (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

// Test seam — overridable client factory.
type ClientFactory = () => ReturnType<typeof createClient>;
let clientFactory: ClientFactory = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
export function __setAuthClientFactory(fn: ClientFactory | null): void {
  clientFactory =
    fn ??
    (() => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!));
}

export async function requireAuthenticatedUser(req: Request): Promise<AuthResult> {
  const jwt = getJwt(req);
  if (!jwt) return { ok: false, status: 401, code: "UNAUTHENTICATED" };
  const admin = clientFactory();
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return { ok: false, status: 401, code: "UNAUTHENTICATED" };
  return { ok: true, userId: data.user.id };
}

export async function requireFinanceApprover(req: Request): Promise<AuthResult> {
  const base = await requireAuthenticatedUser(req);
  if (!base.ok) return base;
  const admin = clientFactory();
  const { data: row } = await admin
    .from("master_finance_approvers")
    .select("id")
    .eq("user_id", base.userId)
    .eq("is_active", true)
    .maybeSingle();
  if (!row) return { ok: false, status: 403, code: "FORBIDDEN" };
  return base;
}
