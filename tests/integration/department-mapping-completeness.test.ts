import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { expect, it, beforeAll } from "@jest/globals";
import {
  findUnmappedActiveDepartmentNames,
  type DepartmentMappingRepo,
} from "@/lib/dept-mapping-guard";
import { describeRequiringTestEnv } from "./_support/require-test-env";

const projectUrl = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const describeIf = describeRequiringTestEnv([
  { label: "SUPABASE_TEST_URL", value: projectUrl },
  { label: "SUPABASE_TEST_SERVICE_ROLE_KEY", value: serviceKey },
]);

function makeSupabaseRepo(client: SupabaseClient): DepartmentMappingRepo {
  return {
    async findUnmappedActiveDepartments() {
      // PostgREST has no anti-join — two queries: collect mapped ids, then
      // return active departments whose id is not in that set.
      const { data: mapped, error: mappedErr } = await client
        .from("master_department_responsible_mappings")
        .select("department_id")
        .eq("is_active", true);
      if (mappedErr) throw mappedErr;
      const mappedIds = new Set((mapped ?? []).map((r) => r.department_id as string));

      const { data: allActive, error: deptErr } = await client
        .from("master_departments")
        .select("id, name")
        .eq("is_active", true);
      if (deptErr) throw deptErr;

      return (allActive ?? [])
        .filter((d) => !mappedIds.has(d.id as string))
        .map((d) => ({ name: d.name as string }));
    },
  };
}

describeIf("department mapping completeness (integration)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: SupabaseClient<any>;

  beforeAll(() => {
    client = createClient(projectUrl as string, serviceKey as string);
  });

  it("returns an empty list when all active departments are mapped", async () => {
    const repo = makeSupabaseRepo(client);
    const unmapped = await findUnmappedActiveDepartmentNames(repo);
    // If this fails, ops needs to backfill master_department_responsible_mappings
    // for each listed department.
    expect(unmapped).toEqual([]);
  });
});
