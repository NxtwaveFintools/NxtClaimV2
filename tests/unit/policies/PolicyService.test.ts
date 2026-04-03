import { PolicyService } from "@/core/domain/policies/PolicyService";
import type { PolicyRecord, PolicyRepository } from "@/core/domain/policies/contracts";

const SAMPLE_POLICY: PolicyRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  versionName: "FIN-POL-002 v1.1",
  fileUrl: "https://cdn.nxtclaim.dev/policies/v1-1.pdf",
  isActive: true,
  createdAt: "2026-04-03T00:00:00.000Z",
};

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createRepository(overrides?: Partial<PolicyRepository>): PolicyRepository {
  return {
    getActivePolicyWithAcceptance: jest.fn(async () => ({
      data: {
        policy: SAMPLE_POLICY,
        acceptedAt: "2026-04-03T10:20:00.000Z",
      },
      errorMessage: null,
    })),
    acceptPolicy: jest.fn(async () => ({
      acceptedAt: "2026-04-03T10:20:00.000Z",
      errorMessage: null,
    })),
    publishPolicy: jest.fn(async () => ({
      data: SAMPLE_POLICY,
      errorMessage: null,
    })),
    ...overrides,
  };
}

describe("PolicyService", () => {
  test("getActivePolicy returns active policy with accepted state", async () => {
    const repository = createRepository();
    const service = new PolicyService({ repository, logger: createLogger() });

    const result = await service.getActivePolicy("user-1");

    expect(repository.getActivePolicyWithAcceptance).toHaveBeenCalledWith("user-1");
    expect(result.errorCode).toBeNull();
    expect(result.errorMessage).toBeNull();
    expect(result.data?.accepted).toBe(true);
    expect(result.data?.policy.versionName).toBe("FIN-POL-002 v1.1");
  });

  test("getActivePolicy returns POLICY_NOT_FOUND when no active policy exists", async () => {
    const repository = createRepository({
      getActivePolicyWithAcceptance: jest.fn(async () => ({
        data: { policy: null, acceptedAt: null },
        errorMessage: null,
      })),
    });
    const service = new PolicyService({ repository, logger: createLogger() });

    const result = await service.getActivePolicy("user-1");

    expect(result.data).toBeNull();
    expect(result.errorCode).toBe("POLICY_NOT_FOUND");
  });

  test("acceptPolicy validates required fields", async () => {
    const repository = createRepository();
    const service = new PolicyService({ repository, logger: createLogger() });

    const result = await service.acceptPolicy("", "");

    expect(result.errorCode).toBe("INVALID_INPUT");
    expect(repository.acceptPolicy).not.toHaveBeenCalled();
  });

  test("acceptPolicy propagates repository failures", async () => {
    const repository = createRepository({
      acceptPolicy: jest.fn(async () => ({
        acceptedAt: null,
        errorMessage: "insert failed",
      })),
    });
    const service = new PolicyService({ repository, logger: createLogger() });

    const result = await service.acceptPolicy("user-1", SAMPLE_POLICY.id);

    expect(result.errorCode).toBe("ACCEPT_FAILED");
    expect(result.errorMessage).toBe("insert failed");
  });

  test("publishNewPolicy validates version and file URL", async () => {
    const repository = createRepository();
    const service = new PolicyService({ repository, logger: createLogger() });

    const missingVersion = await service.publishNewPolicy(
      "https://cdn.nxtclaim.dev/policies/v1-2.pdf",
      "  ",
    );
    expect(missingVersion.errorCode).toBe("INVALID_INPUT");

    const missingFileUrl = await service.publishNewPolicy("  ", "FIN-POL-002 v1.2");
    expect(missingFileUrl.errorCode).toBe("INVALID_INPUT");

    expect(repository.publishPolicy).not.toHaveBeenCalled();
  });

  test("publishNewPolicy returns published record", async () => {
    const publishedPolicy: PolicyRecord = {
      ...SAMPLE_POLICY,
      id: "22222222-2222-4222-8222-222222222222",
      versionName: "FIN-POL-002 v1.2",
    };
    const repository = createRepository({
      publishPolicy: jest.fn(async () => ({
        data: publishedPolicy,
        errorMessage: null,
      })),
    });

    const service = new PolicyService({ repository, logger: createLogger() });
    const result = await service.publishNewPolicy(
      "https://cdn.nxtclaim.dev/policies/v1-2.pdf",
      "FIN-POL-002 v1.2",
    );

    expect(result.errorCode).toBeNull();
    expect(result.data?.id).toBe("22222222-2222-4222-8222-222222222222");
    expect(repository.publishPolicy).toHaveBeenCalledWith(
      "https://cdn.nxtclaim.dev/policies/v1-2.pdf",
      "FIN-POL-002 v1.2",
    );
  });
});
