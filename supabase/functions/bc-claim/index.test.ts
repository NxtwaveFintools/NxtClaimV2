import { assertEquals } from "std/assert/mod.ts";
import { __setAuthClientFactory } from "../_shared/auth.ts";
import { __setBcFetchImpl } from "../_shared/bcClient.ts";
import { __setCorsTestOverrides } from "../_shared/cors.ts";
import { __resetTokenCache, __setTestEnv } from "../_shared/bcAuth.ts";
import { __resetBcEnvCache } from "../_shared/bcEnv.ts";
import type { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { __setBcClaimAdminFactory, handler } from "./index.ts";
import type { BcClaimPayloadFromDb } from "./types.ts";

type SupaClient = ReturnType<typeof createClient>;

const TEST_BC_ENV: Record<string, string> = {
  BC_TENANT_ID: "test-tenant",
  BC_CLIENT_ID: "test-client",
  BC_CLIENT_SECRET: "test-secret",
  BC_ENVIRONMENT: "Sandbox_Test",
  BC_COMPANY_ID: "test-company-id",
  BC_COMPANY_NAME: "NxtWave",
};

/**
 * Auth-client stub for __setAuthClientFactory. requireFinanceApprover needs both:
 *   - auth.getUser → a valid user, and
 *   - .from("master_finance_approvers")...maybeSingle() → a row (or null).
 * Mirrors _shared/auth.test.ts fakeClient.
 */
function authClient(opts: { user?: { id: string } | null; approverRow?: { id: string } | null }) {
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
  } as unknown as SupaClient;
}

function approverFactory(): () => SupaClient {
  return () => authClient({ user: { id: "u1" }, approverRow: { id: "a1" } });
}

function nonApproverFactory(): () => SupaClient {
  return () => authClient({ user: { id: "u1" }, approverRow: null });
}

type RpcResult = { data?: unknown; error?: { code?: string; message?: string } | null };

/**
 * Admin-client stub for __setBcClaimAdminFactory.
 *   - .rpc(name, args) resolves to rpcMap[name] (defaults to { data: null, error: null }).
 *   - .storage.from().createSignedUrl() returns a fixed signed URL.
 *   - rpcCalls records every rpc name so tests can assert record_bc_claim_failure fired.
 */
function fakeAdmin(rpcMap: Record<string, RpcResult>): { client: SupaClient; rpcCalls: string[] } {
  const rpcCalls: string[] = [];
  const client = {
    rpc: (name: string, _args: unknown) => {
      rpcCalls.push(name);
      return Promise.resolve(rpcMap[name] ?? { data: null, error: null });
    },
    storage: {
      from: () => ({
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x" }, error: null }),
      }),
    },
  } as unknown as SupaClient;
  return { client, rpcCalls };
}

/** A scripted BC response. bcFetch reads .status from this and JSON-parses .body. */
function setBcResponse(status: number, body: unknown): void {
  __setBcFetchImpl((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    // bcFetch first asks bcAuth for a token via the same fetch impl.
    if (url.includes("login.microsoftonline.com")) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

function setupBcEnv(): void {
  __resetBcEnvCache();
  __resetTokenCache();
  for (const [k, v] of Object.entries(TEST_BC_ENV)) Deno.env.set(k, v);
  __setCorsTestOverrides({ allowedOrigins: new Set(["http://localhost"]) });
  __setTestEnv({
    tenantId: "test-tenant",
    clientId: "test-client",
    clientSecret: "test-secret",
    environment: "Sandbox_Test",
    companyId: "test-company-id",
    companyName: "NxtWave",
    fetchImpl: () =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
  });
}

function resetSeams(): void {
  __setAuthClientFactory(null);
  __setBcClaimAdminFactory(null);
  __setBcFetchImpl(null);
  __setCorsTestOverrides(null);
  __resetTokenCache();
  __resetBcEnvCache();
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/bc-claim", {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      Authorization: "Bearer t",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// Minimal valid non-vendor payload (isVendorPayment:false → no vendor fields needed).
function validDbPayload(): BcClaimPayloadFromDb {
  return {
    claim_id: "claim-1",
    payment_mode_name: "Reimbursement",
    submission_type: "Self",
    employee_id: "EMP1",
    on_behalf_employee_code: null,
    employee_name: "Test Employee",
    program_code: "PROG1",
    sub_product_code: "SP1",
    responsible_department_code: "RD1",
    beneficiary_department_code: "BD1",
    region_code: "RG1",
    bill_no: null,
    transaction_date: "2026-05-20",
    purpose: "Test purpose",
    receipt_file_path: null,
    bank_statement_file_path: null,
    bc_code: "GL1000",
    basic_amount: 100,
    total_amount: 118,
    foreign_basic_amount: 0,
    foreign_total_amount: 0,
  };
}

const NONVENDOR_BODY = { claimId: "claim-1", isVendorPayment: false };

Deno.test("bc-claim — non-approver → 403 FORBIDDEN", async () => {
  setupBcEnv();
  __setAuthClientFactory(nonApproverFactory());
  try {
    const res = await handler(postReq(NONVENDOR_BODY));
    const body = await res.json();
    assertEquals(res.status, 403);
    assertEquals(body.error.code, "FORBIDDEN");
  } finally {
    resetSeams();
  }
});

Deno.test("bc-claim — payload P0001 → 404 CLAIM_NOT_FOUND", async () => {
  setupBcEnv();
  __setAuthClientFactory(approverFactory());
  const { client } = fakeAdmin({
    get_bc_claim_payload: { error: { code: "P0001" } },
  });
  __setBcClaimAdminFactory(() => client);
  try {
    const res = await handler(postReq(NONVENDOR_BODY));
    const body = await res.json();
    assertEquals(res.status, 404);
    assertEquals(body.error.code, "CLAIM_NOT_FOUND");
  } finally {
    resetSeams();
  }
});

Deno.test("bc-claim — payload P0002 → 409 ALREADY_SUBMITTED", async () => {
  setupBcEnv();
  __setAuthClientFactory(approverFactory());
  const { client } = fakeAdmin({
    get_bc_claim_payload: {
      error: { code: "P0002", message: "ALREADY_SUBMITTED: abc-123" },
    },
  });
  __setBcClaimAdminFactory(() => client);
  try {
    const res = await handler(postReq(NONVENDOR_BODY));
    const body = await res.json();
    assertEquals(res.status, 409);
    assertEquals(body.error.code, "ALREADY_SUBMITTED");
    assertEquals(body.error.bcClaimDetailsId, "abc-123");
  } finally {
    resetSeams();
  }
});

Deno.test("bc-claim — payload P0003 → 422 MISSING_MAPPING", async () => {
  setupBcEnv();
  __setAuthClientFactory(approverFactory());
  const { client } = fakeAdmin({
    get_bc_claim_payload: { error: { code: "P0003", message: "MISSING_MAPPING: gl" } },
  });
  __setBcClaimAdminFactory(() => client);
  try {
    const res = await handler(postReq(NONVENDOR_BODY));
    const body = await res.json();
    assertEquals(res.status, 422);
    assertEquals(body.error.code, "MISSING_MAPPING");
  } finally {
    resetSeams();
  }
});

Deno.test("bc-claim — payload P0005 → 409 INVALID_CLAIM_STATE", async () => {
  setupBcEnv();
  __setAuthClientFactory(approverFactory());
  const { client } = fakeAdmin({
    get_bc_claim_payload: {
      error: { code: "P0005", message: "INVALID_CLAIM_STATE: draft" },
    },
  });
  __setBcClaimAdminFactory(() => client);
  try {
    const res = await handler(postReq(NONVENDOR_BODY));
    const body = await res.json();
    assertEquals(res.status, 409);
    assertEquals(body.error.code, "INVALID_CLAIM_STATE");
  } finally {
    resetSeams();
  }
});

Deno.test("bc-claim — payload unknown code → 500 INTERNAL_ERROR", async () => {
  setupBcEnv();
  __setAuthClientFactory(approverFactory());
  const { client } = fakeAdmin({
    get_bc_claim_payload: { error: { code: "XX000", message: "boom" } },
  });
  __setBcClaimAdminFactory(() => client);
  try {
    const res = await handler(postReq(NONVENDOR_BODY));
    const body = await res.json();
    assertEquals(res.status, 500);
    assertEquals(body.error.code, "INTERNAL_ERROR");
  } finally {
    resetSeams();
  }
});

Deno.test("bc-claim — start_bc_claim_attempt 23505 → 409 ALREADY_IN_FLIGHT", async () => {
  setupBcEnv();
  __setAuthClientFactory(approverFactory());
  const { client } = fakeAdmin({
    get_bc_claim_payload: { data: validDbPayload(), error: null },
    start_bc_claim_attempt: { error: { code: "23505" } },
  });
  __setBcClaimAdminFactory(() => client);
  try {
    const res = await handler(postReq(NONVENDOR_BODY));
    const body = await res.json();
    assertEquals(res.status, 409);
    assertEquals(body.error.code, "ALREADY_IN_FLIGHT");
  } finally {
    resetSeams();
  }
});

Deno.test("bc-claim — BC non-2xx → 502 BC_FETCH_FAILED + records failure", async () => {
  setupBcEnv();
  __setAuthClientFactory(approverFactory());
  const { client, rpcCalls } = fakeAdmin({
    get_bc_claim_payload: { data: validDbPayload(), error: null },
    start_bc_claim_attempt: { data: "bc-details-1", error: null },
    record_bc_claim_failure: { error: null },
  });
  __setBcClaimAdminFactory(() => client);
  setBcResponse(400, { error: "bad request" });
  try {
    const res = await handler(postReq(NONVENDOR_BODY));
    const body = await res.json();
    assertEquals(res.status, 502);
    assertEquals(body.error.code, "BC_FETCH_FAILED");
    assertEquals(rpcCalls.includes("record_bc_claim_failure"), true);
  } finally {
    resetSeams();
  }
});

Deno.test(
  "bc-claim — complete_bc_claim error after BC success → 500 RPC_FAILED_AFTER_BC_SUCCESS",
  async () => {
    setupBcEnv();
    __setAuthClientFactory(approverFactory());
    const { client } = fakeAdmin({
      get_bc_claim_payload: { data: validDbPayload(), error: null },
      start_bc_claim_attempt: { data: "bc-details-1", error: null },
      complete_bc_claim: { error: { code: "23000", message: "fk fail" } },
    });
    __setBcClaimAdminFactory(() => client);
    setBcResponse(201, { id: "bc-201" });
    try {
      const res = await handler(postReq(NONVENDOR_BODY));
      const body = await res.json();
      assertEquals(res.status, 500);
      assertEquals(body.error.code, "RPC_FAILED_AFTER_BC_SUCCESS");
      assertEquals(body.error.bcClaimDetailsId, "bc-details-1");
    } finally {
      resetSeams();
    }
  },
);

Deno.test("bc-claim — happy path → 200 success with bcClaimDetailsId", async () => {
  setupBcEnv();
  __setAuthClientFactory(approverFactory());
  const { client } = fakeAdmin({
    get_bc_claim_payload: { data: validDbPayload(), error: null },
    start_bc_claim_attempt: { data: "bc-details-1", error: null },
    complete_bc_claim: { error: null },
  });
  __setBcClaimAdminFactory(() => client);
  setBcResponse(201, { id: "bc-201" });
  try {
    const res = await handler(postReq(NONVENDOR_BODY));
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals(body.success, true);
    assertEquals(body.bcClaimDetailsId, "bc-details-1");
  } finally {
    resetSeams();
  }
});

// ── New coverage cases ────────────────────────────────────────────────────────

Deno.test("bc-claim — method not POST → 405 INVALID_BODY", async () => {
  setupBcEnv();
  // Method check is before auth, so no auth factory needed.
  try {
    const req = new Request("http://localhost/bc-claim", {
      method: "GET",
      headers: { Origin: "http://localhost" },
    });
    const res = await handler(req);
    const body = await res.json();
    assertEquals(res.status, 405);
    assertEquals(body.error.code, "INVALID_BODY");
  } finally {
    resetSeams();
  }
});

Deno.test("bc-claim — malformed JSON body → 400 INVALID_BODY", async () => {
  setupBcEnv();
  __setAuthClientFactory(approverFactory());
  // adminFactory is called before body parse, so we must set it.
  const { client } = fakeAdmin({});
  __setBcClaimAdminFactory(() => client);
  try {
    const req = new Request("http://localhost/bc-claim", {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        Authorization: "Bearer t",
        "content-type": "application/json",
      },
      body: "{not json",
    });
    const res = await handler(req);
    const body = await res.json();
    assertEquals(res.status, 400);
    assertEquals(body.error.code, "INVALID_BODY");
  } finally {
    resetSeams();
  }
});

Deno.test("bc-claim — invalid schema (missing required fields) → 400 INVALID_BODY", async () => {
  setupBcEnv();
  __setAuthClientFactory(approverFactory());
  // adminFactory is called before body parse, so we must set it.
  const { client } = fakeAdmin({});
  __setBcClaimAdminFactory(() => client);
  try {
    // {} fails InputSchema: claimId and isVendorPayment are required.
    const res = await handler(postReq({}));
    const body = await res.json();
    assertEquals(res.status, 400);
    assertEquals(body.error.code, "INVALID_BODY");
  } finally {
    resetSeams();
  }
});

Deno.test(
  "bc-claim — bcFetch throws (network error) → 502 BC_FETCH_FAILED + records failure",
  async () => {
    setupBcEnv();
    __setAuthClientFactory(approverFactory());
    const { client, rpcCalls } = fakeAdmin({
      get_bc_claim_payload: { data: validDbPayload(), error: null },
      start_bc_claim_attempt: { data: "bc-details-2", error: null },
      record_bc_claim_failure: { error: null },
    });
    __setBcClaimAdminFactory(() => client);
    // Token URL succeeds; claims URL throws.
    __setBcFetchImpl((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("login.microsoftonline.com")) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error("simulated network timeout"));
    });
    try {
      const res = await handler(postReq(NONVENDOR_BODY));
      const body = await res.json();
      assertEquals(res.status, 502);
      assertEquals(body.error.code, "BC_FETCH_FAILED");
      assertEquals(body.error.status, 0);
      assertEquals(rpcCalls.includes("record_bc_claim_failure"), true);
    } finally {
      resetSeams();
    }
  },
);

Deno.test("bc-claim — vendor happy path → 200 success", async () => {
  setupBcEnv();
  __setAuthClientFactory(approverFactory());
  const { client } = fakeAdmin({
    get_bc_claim_payload: { data: validDbPayload(), error: null },
    start_bc_claim_attempt: { data: "bc-details-3", error: null },
    complete_bc_claim: { error: null },
  });
  __setBcClaimAdminFactory(() => client);
  setBcResponse(201, { id: "bc-vendor-201" });
  const vendorBody = {
    claimId: "claim-1",
    isVendorPayment: true,
    bcVendorCode: "V1",
    bcVendorName: "Vendor",
    currencyCode: "USD",
    gstGroupCode: "G1",
    hsnSacCode: "H1",
  };
  try {
    const res = await handler(postReq(vendorBody));
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals(body.success, true);
  } finally {
    resetSeams();
  }
});

Deno.test("bc-claim — start_bc_claim_attempt non-23505 error → 500 INTERNAL_ERROR", async () => {
  setupBcEnv();
  __setAuthClientFactory(approverFactory());
  const { client } = fakeAdmin({
    get_bc_claim_payload: { data: validDbPayload(), error: null },
    start_bc_claim_attempt: { data: null, error: { code: "XX000", message: "boom" } },
  });
  __setBcClaimAdminFactory(() => client);
  try {
    const res = await handler(postReq(NONVENDOR_BODY));
    const body = await res.json();
    assertEquals(res.status, 500);
    assertEquals(body.error.code, "INTERNAL_ERROR");
  } finally {
    resetSeams();
  }
});
