/**
 * Pure guard for the BC integration: an active department without an active
 * row in master_department_responsible_mappings will cause get_bc_claim_payload
 * to fail with MISSING_MAPPING (P0003) when a finance approver tries to submit
 * a claim from that department to BC.
 *
 * Returns the sorted names of active departments that lack a mapping.
 * Returns an empty array when every active department is mapped.
 * Errors from the repository propagate unchanged.
 */

export interface DepartmentRow {
  name: string;
}

export interface DepartmentMappingRepo {
  findUnmappedActiveDepartments(): Promise<DepartmentRow[]>;
}

export async function findUnmappedActiveDepartmentNames(
  repo: DepartmentMappingRepo,
): Promise<string[]> {
  const rows = await repo.findUnmappedActiveDepartments();
  return rows.map((r) => r.name).sort((a, b) => a.localeCompare(b));
}
