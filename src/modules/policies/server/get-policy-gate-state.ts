import { cache } from "react";
import type { ActivePolicyState } from "@/core/domain/policies/PolicyService";
import { PolicyService } from "@/core/domain/policies/PolicyService";
import { logger } from "@/core/infra/logging/logger";
import { getCachedCurrentUser } from "@/modules/auth/server/get-current-user";
import { SupabasePolicyRepository } from "@/modules/policies/repositories/SupabasePolicyRepository";

export type PolicyGateState = {
  shouldGate: boolean;
  policy: ActivePolicyState["policy"] | null;
  accepted: boolean;
  acceptedAt: string | null;
  errorMessage: string | null;
};

const policyRepository = new SupabasePolicyRepository();
const policyService = new PolicyService({ repository: policyRepository, logger });

export const getPolicyGateState = cache(async (): Promise<PolicyGateState> => {
  const currentUserResult = await getCachedCurrentUser();

  if (currentUserResult.errorMessage || !currentUserResult.user?.id) {
    return {
      shouldGate: false,
      policy: null,
      accepted: true,
      acceptedAt: null,
      errorMessage: null,
    };
  }

  const policyStateResult = await policyService.getActivePolicy(currentUserResult.user.id);

  if (policyStateResult.errorCode === "POLICY_NOT_FOUND") {
    return {
      shouldGate: true,
      policy: null,
      accepted: false,
      acceptedAt: null,
      errorMessage: policyStateResult.errorMessage,
    };
  }

  if (policyStateResult.errorMessage || !policyStateResult.data) {
    return {
      shouldGate: true,
      policy: null,
      accepted: false,
      acceptedAt: null,
      errorMessage: policyStateResult.errorMessage ?? "Unable to verify policy acceptance state.",
    };
  }

  return {
    shouldGate: true,
    policy: policyStateResult.data.policy,
    accepted: policyStateResult.data.accepted,
    acceptedAt: policyStateResult.data.acceptedAt,
    errorMessage: null,
  };
});
