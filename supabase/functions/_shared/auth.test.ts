// supabase/functions/_shared/auth.test.ts
import { assertEquals } from "std/assert/mod.ts";
import {
  requireAuthenticatedUser,
  requireFinanceApprover,
  __setAuthClientFactory,
} from "./auth.ts";

function buildReq(authHeader?: string): Request {
  return new Request("https://x.test", {
    headers: authHeader ? { Authorization: authHeader } : {},
  });
}

function fakeClient(opts: { user?: { id: string } | null; approverRow?: { id: string } | null }) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve(
          opts.user
            ? { data: { user: opts.user }, error: null }
            : { data: { user: null }, error: { message: "invalid" } },
        ),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: opts.approverRow ?? null, error: null }),
          }),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>;
}

Deno.test("requireAuthenticatedUser — missing header → UNAUTHENTICATED", async () => {
  __setAuthClientFactory(() => fakeClient({ user: { id: "u1" } }));
  const r = await requireAuthenticatedUser(buildReq());
  assertEquals(r, { ok: false, status: 401, code: "UNAUTHENTICATED" });
  __setAuthClientFactory(null);
});

Deno.test("requireAuthenticatedUser — invalid jwt → UNAUTHENTICATED", async () => {
  __setAuthClientFactory(() => fakeClient({ user: null }));
  const r = await requireAuthenticatedUser(buildReq("Bearer bad"));
  assertEquals(r, { ok: false, status: 401, code: "UNAUTHENTICATED" });
  __setAuthClientFactory(null);
});

Deno.test("requireAuthenticatedUser — valid jwt → ok + userId", async () => {
  __setAuthClientFactory(() => fakeClient({ user: { id: "u42" } }));
  const r = await requireAuthenticatedUser(buildReq("Bearer ok"));
  assertEquals(r, { ok: true, userId: "u42" });
  __setAuthClientFactory(null);
});

Deno.test("requireFinanceApprover — valid user but not approver → FORBIDDEN", async () => {
  __setAuthClientFactory(() => fakeClient({ user: { id: "u1" }, approverRow: null }));
  const r = await requireFinanceApprover(buildReq("Bearer ok"));
  assertEquals(r, { ok: false, status: 403, code: "FORBIDDEN" });
  __setAuthClientFactory(null);
});

Deno.test("requireFinanceApprover — valid user is approver → ok", async () => {
  __setAuthClientFactory(() => fakeClient({ user: { id: "u1" }, approverRow: { id: "a1" } }));
  const r = await requireFinanceApprover(buildReq("Bearer ok"));
  assertEquals(r, { ok: true, userId: "u1" });
  __setAuthClientFactory(null);
});
