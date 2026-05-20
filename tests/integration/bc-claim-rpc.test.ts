import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { expect, it, beforeAll } from "@jest/globals";
import { describeRequiringTestEnv } from "./_support/require-test-env";

const projectUrl = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

const describeIf = describeRequiringTestEnv([
  { label: "SUPABASE_TEST_URL", value: projectUrl },
  { label: "SUPABASE_TEST_SERVICE_ROLE_KEY", value: serviceKey },
]);

describeIf("get_bc_claim_payload (integration)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: SupabaseClient<any>;

  beforeAll(() => {
    client = createClient(projectUrl as string, serviceKey as string);
  });

  it("returns the beneficiary's name for an On Behalf claim", async () => {
    const { data: claims, error: pickErr } = await client
      .from("claims")
      .select("id, on_behalf_of_id")
      .eq("submission_type", "On Behalf")
      .eq("is_active", true)
      // not yet BC-submitted — RPC raises ALREADY_SUBMITTED (P0002) if it has been
      .is("bc_claim_details_id", null)
      .limit(1);

    expect(pickErr).toBeNull();
    if (!claims || claims.length === 0) {
      console.warn(
        "No eligible On Behalf claims in test DB — skipping (fixture gap, not a product bug).",
      );
      return;
    }
    const claim = claims[0] as {
      id: string;
      on_behalf_of_id: string;
    };

    const { data: bene, error: beneErr } = await client
      .from("users")
      .select("full_name")
      .eq("id", claim.on_behalf_of_id)
      .single();
    expect(beneErr).toBeNull();
    const expectedName = (bene as { full_name: string | null } | null)?.full_name ?? "";
    expect(expectedName).toBeTruthy(); // guard against null/empty tautology

    const { data: payload, error: rpcErr } = await client.rpc("get_bc_claim_payload", {
      p_claim_id: claim.id,
    });

    expect(rpcErr).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = payload as any;
    expect(p.submission_type).toBe("On Behalf");
    expect(p.employee_name).toBe(expectedName);
  });
});
