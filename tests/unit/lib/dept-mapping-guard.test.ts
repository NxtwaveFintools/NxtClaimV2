import { describe, expect, it } from "@jest/globals";
import {
  findUnmappedActiveDepartmentNames,
  type DepartmentMappingRepo,
} from "@/lib/dept-mapping-guard";

function makeRepo(rows: { name: string }[]): DepartmentMappingRepo {
  return {
    findUnmappedActiveDepartments: async () => rows,
  };
}

describe("findUnmappedActiveDepartmentNames", () => {
  it("returns empty array when repo returns no unmapped departments", async () => {
    const repo = makeRepo([]);
    const result = await findUnmappedActiveDepartmentNames(repo);
    expect(result).toEqual([]);
  });

  it("returns sorted department names when repo returns unmapped rows", async () => {
    const repo = makeRepo([{ name: "Tech" }, { name: "Marketing" }, { name: "Content" }]);
    const result = await findUnmappedActiveDepartmentNames(repo);
    expect(result).toEqual(["Content", "Marketing", "Tech"]);
  });

  it("rethrows repo errors instead of swallowing them", async () => {
    const repo: DepartmentMappingRepo = {
      findUnmappedActiveDepartments: async () => {
        throw new Error("db unreachable");
      },
    };
    await expect(findUnmappedActiveDepartmentNames(repo)).rejects.toThrow("db unreachable");
  });
});
