export type PolicyRecord = {
  id: string;
  versionName: string;
  fileUrl: string;
  isActive: boolean;
  createdAt: string;
};

export type ActivePolicyWithAcceptance = {
  policy: PolicyRecord | null;
  acceptedAt: string | null;
};

export type PolicyDomainLogger = {
  info(event: string, payload?: Record<string, unknown>): void;
  warn(event: string, payload?: Record<string, unknown>): void;
  error(event: string, payload?: Record<string, unknown>): void;
};

export interface PolicyRepository {
  getActivePolicyWithAcceptance(userId: string): Promise<{
    data: ActivePolicyWithAcceptance | null;
    errorMessage: string | null;
  }>;
  acceptPolicy(
    userId: string,
    policyId: string,
  ): Promise<{
    acceptedAt: string | null;
    errorMessage: string | null;
  }>;
  publishPolicy(
    fileUrl: string,
    versionName: string,
  ): Promise<{
    data: PolicyRecord | null;
    errorMessage: string | null;
  }>;
}
