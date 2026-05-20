import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, beforeAll, it } from "@jest/globals";

const projectUrl = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const skip = !projectUrl || !anonKey;

// Domain SQLSTATEs the BC functions raise themselves. If anon ever sees one of
// these, it means the function body executed — i.e. the lockdown failed.
const DOMAIN_CODES = ["P0001", "P0002", "P0003", "P0004"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cases: Array<[string, Record<string, any>]> = [
  ["get_bc_claim_payload", { p_claim_id: "__anon_lockdown_probe__" }],
  [
    "start_bc_claim_attempt",
    { p_claim_id: "__anon_lockdown_probe__", p_is_vendor_payment: false, p_payload_json: {} },
  ],
  [
    "complete_bc_claim",
    {
      p_bc_details_id: "00000000-0000-0000-0000-000000000000",
      p_actor_user_id: "00000000-0000-0000-0000-000000000000",
      p_response_json: {},
    },
  ],
  [
    "record_bc_claim_failure",
    {
      p_bc_details_id: "00000000-0000-0000-0000-000000000000",
      p_actor_user_id: "00000000-0000-0000-0000-000000000000",
      p_response_json: {},
    },
  ],
];

(skip ? describe.skip : describe)("BC RPC anon lockdown (integration)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let anonClient: SupabaseClient<any>;

  beforeAll(() => {
    anonClient = createClient(projectUrl as string, anonKey as string);
  });

  it.each(cases)("anon cannot execute %s", async (fnName, args) => {
    const { error } = await anonClient.rpc(fnName, args);
    expect(error).not.toBeNull();
    // Must be a privilege/exposure denial, never the function's own domain error
    // (which would prove anon reached the function body).
    expect(DOMAIN_CODES).not.toContain(error!.code);
  });
});
