/** @jest-environment node */

import fs from "node:fs";
import path from "node:path";
import { logger } from "@/core/infra/logging/logger";

type GetActiveDepartmentsServiceClass =
  typeof import("@/core/domain/departments/GetActiveDepartmentsService").GetActiveDepartmentsService;
type SupabaseDepartmentRepositoryClass =
  typeof import("@/modules/departments/repositories/SupabaseDepartmentRepository").SupabaseDepartmentRepository;

function loadEnvForTests(): void {
  const envFiles = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), ".env.local")];

  for (const envFile of envFiles) {
    if (!fs.existsSync(envFile)) continue;

    const raw = fs.readFileSync(envFile, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (!key || process.env[key]) continue;

      process.env[key] = value.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
}

describe("GetActiveDepartmentsService (seeded integration)", () => {
  let GetActiveDepartmentsService: GetActiveDepartmentsServiceClass;
  let SupabaseDepartmentRepository: SupabaseDepartmentRepositoryClass;

  beforeAll(async () => {
    loadEnvForTests();

    const missing = [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ].filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(`Missing required env vars for integration test: ${missing.join(", ")}`);
    }

    ({ GetActiveDepartmentsService } =
      await import("@/core/domain/departments/GetActiveDepartmentsService"));
    ({ SupabaseDepartmentRepository } =
      await import("@/modules/departments/repositories/SupabaseDepartmentRepository"));
  });

  test("returns active departments with nested hod and founder users", async () => {
    const repository = new SupabaseDepartmentRepository();
    const service = new GetActiveDepartmentsService({ repository, logger });

    const result = await service.execute();

    expect(result.errorCode).toBeNull();
    expect(result.errorMessage).toBeNull();
    expect(Array.isArray(result.departments)).toBe(true);
    expect(result.departments.length).toBeGreaterThan(0);

    const financeDepartment = result.departments.find((item) => item.name === "Finance");
    expect(financeDepartment).toBeDefined();
    expect(financeDepartment?.hod.email).toBe("akhilesh.jhawar@nxtwave.in");
    expect(financeDepartment?.founder.email).toBe("rahul@nxtwave.co.in");
  });

  test("ensures department routing payload is complete for all active rows", async () => {
    const repository = new SupabaseDepartmentRepository();
    const service = new GetActiveDepartmentsService({ repository, logger });

    const result = await service.execute();

    expect(result.errorCode).toBeNull();
    expect(result.errorMessage).toBeNull();
    expect(result.departments.length).toBeGreaterThan(0);

    for (const department of result.departments) {
      expect(department.id).toBeTruthy();
      expect(department.name).toBeTruthy();
      expect(department.isActive).toBe(true);
      expect(department.hod.id).toBeTruthy();
      expect(department.hod.email).toContain("@");
      expect(department.founder.id).toBeTruthy();
      expect(department.founder.email).toContain("@");
    }
  });
});
