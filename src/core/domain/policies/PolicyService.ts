import type {
  PolicyDomainLogger,
  PolicyRecord,
  PolicyRepository,
} from "@/core/domain/policies/contracts";

type Dependencies = {
  repository: PolicyRepository;
  logger: PolicyDomainLogger;
};

export type ActivePolicyState = {
  policy: PolicyRecord;
  accepted: boolean;
  acceptedAt: string | null;
};

type GetActivePolicyResult = {
  data: ActivePolicyState | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type AcceptPolicyResult = {
  data: { acceptedAt: string | null } | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type PublishPolicyResult = {
  data: PolicyRecord | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export class PolicyService {
  private readonly repository: PolicyRepository;
  private readonly logger: PolicyDomainLogger;

  constructor({ repository, logger }: Dependencies) {
    this.repository = repository;
    this.logger = logger;
  }

  async getActivePolicy(userId: string): Promise<GetActivePolicyResult> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
      return {
        data: null,
        errorCode: "INVALID_INPUT",
        errorMessage: "User ID is required.",
      };
    }

    const result = await this.repository.getActivePolicyWithAcceptance(normalizedUserId);

    if (result.errorMessage) {
      this.logger.error("PolicyService.getActivePolicy.failed", {
        userId: normalizedUserId,
        errorMessage: result.errorMessage,
      });

      return {
        data: null,
        errorCode: "FETCH_FAILED",
        errorMessage: result.errorMessage,
      };
    }

    if (!result.data?.policy) {
      this.logger.warn("PolicyService.getActivePolicy.missing_active_policy", {
        userId: normalizedUserId,
      });

      return {
        data: null,
        errorCode: "POLICY_NOT_FOUND",
        errorMessage: "No active company policy was found.",
      };
    }

    return {
      data: {
        policy: result.data.policy,
        accepted: Boolean(result.data.acceptedAt),
        acceptedAt: result.data.acceptedAt,
      },
      errorCode: null,
      errorMessage: null,
    };
  }

  async acceptPolicy(userId: string, policyId: string): Promise<AcceptPolicyResult> {
    const normalizedUserId = userId.trim();
    const normalizedPolicyId = policyId.trim();

    if (!normalizedUserId || !normalizedPolicyId) {
      return {
        data: null,
        errorCode: "INVALID_INPUT",
        errorMessage: "User ID and policy ID are required.",
      };
    }

    const result = await this.repository.acceptPolicy(normalizedUserId, normalizedPolicyId);

    if (result.errorMessage) {
      this.logger.error("PolicyService.acceptPolicy.failed", {
        userId: normalizedUserId,
        policyId: normalizedPolicyId,
        errorMessage: result.errorMessage,
      });

      return {
        data: null,
        errorCode: "ACCEPT_FAILED",
        errorMessage: result.errorMessage,
      };
    }

    this.logger.info("PolicyService.acceptPolicy.success", {
      userId: normalizedUserId,
      policyId: normalizedPolicyId,
    });

    return {
      data: { acceptedAt: result.acceptedAt },
      errorCode: null,
      errorMessage: null,
    };
  }

  async publishNewPolicy(fileUrl: string, version: string): Promise<PublishPolicyResult> {
    const normalizedVersion = version.trim();
    const normalizedFileUrl = fileUrl.trim();

    if (!normalizedVersion) {
      return {
        data: null,
        errorCode: "INVALID_INPUT",
        errorMessage: "Policy version name is required.",
      };
    }

    if (!normalizedFileUrl) {
      return {
        data: null,
        errorCode: "INVALID_INPUT",
        errorMessage: "Policy file URL is required.",
      };
    }

    const result = await this.repository.publishPolicy(normalizedFileUrl, normalizedVersion);

    if (result.errorMessage) {
      this.logger.error("PolicyService.publishNewPolicy.failed", {
        version: normalizedVersion,
        errorMessage: result.errorMessage,
      });

      return {
        data: null,
        errorCode: "PUBLISH_FAILED",
        errorMessage: result.errorMessage,
      };
    }

    this.logger.info("PolicyService.publishNewPolicy.success", {
      version: normalizedVersion,
      policyId: result.data?.id ?? null,
    });

    return {
      data: result.data,
      errorCode: null,
      errorMessage: null,
    };
  }
}
