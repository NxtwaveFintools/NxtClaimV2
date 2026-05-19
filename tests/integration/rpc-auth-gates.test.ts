import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, beforeAll } from "@jest/globals";

const projectUrl = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

const skip = !projectUrl || !serviceKey;

(skip ? describe.skip : describe)("RPC auth gates (integration)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: SupabaseClient<any>;

  beforeAll(() => {
    client = createClient(projectUrl as string, serviceKey as string);
  });

  it("update_claim_by_finance rejects non-finance actor", async () => {
    const { error } = await client.rpc("update_claim_by_finance", {
      p_claim_id: "__fake_integration_test__",
      p_actor_id: "00000000-0000-0000-0000-000000000000",
      p_edit_reason: "integration test for auth gate",
      p_payload: {},
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toContain("p_actor_id is not an active finance approver");
  });

  it("update_claim_by_submitter rejects non-owner actor", async () => {
    const { data: claims } = await client
      .from("claims")
      .select("id")
      .eq("is_active", true)
      .limit(1);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimId = (claims as any)?.[0]?.id ?? "__fake_integration_test__";

    const { error } = await client.rpc("update_claim_by_submitter", {
      p_claim_id: claimId,
      p_actor_id: "00000000-0000-0000-0000-000000000000",
      p_payload: {
        detailType: "expense",
        detailId: "00000000-0000-0000-0000-000000000000",
      },
    });

    expect(error).not.toBeNull();
    expect(error?.message ?? "").toContain("p_actor_id is not the claim submitter");
  });
});

if (skip) {
  console.warn(
    "[rpc-auth-gates] Skipped. To run: set SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_ROLE_KEY env vars.",
  );
}
