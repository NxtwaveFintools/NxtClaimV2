import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import type {
  ActivePolicyWithAcceptance,
  PolicyRecord,
  PolicyRepository,
} from "@/core/domain/policies/contracts";

type MasterPolicyRow = {
  id: string;
  version_name: string;
  file_url: string;
  is_active: boolean;
  created_at: string;
};

type AcceptanceJoinRow = {
  accepted_at: string;
};

const NO_ROW_CODE = "PGRST116";
const UNIQUE_VIOLATION_CODE = "23505";

function toPolicyRecord(row: MasterPolicyRow): PolicyRecord {
  return {
    id: row.id,
    versionName: row.version_name,
    fileUrl: row.file_url,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export class SupabasePolicyRepository implements PolicyRepository {
  private get client() {
    return getServiceRoleSupabaseClient();
  }

  async getActivePolicyWithAcceptance(userId: string): Promise<{
    data: ActivePolicyWithAcceptance | null;
    errorMessage: string | null;
  }> {
    const { data: activePolicy, error: activePolicyError } = await this.client
      .from("master_policies")
      .select("id, version_name, file_url, is_active, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activePolicyError && activePolicyError.code !== NO_ROW_CODE) {
      return { data: null, errorMessage: activePolicyError.message };
    }

    if (!activePolicy) {
      return {
        data: {
          policy: null,
          acceptedAt: null,
        },
        errorMessage: null,
      };
    }

    const { data: acceptance, error: acceptanceError } = await this.client
      .from("user_policy_acceptances")
      .select("accepted_at, master_policies!inner(id, is_active)")
      .eq("user_id", userId)
      .eq("policy_id", activePolicy.id)
      .eq("master_policies.is_active", true)
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (acceptanceError && acceptanceError.code !== NO_ROW_CODE) {
      return { data: null, errorMessage: acceptanceError.message };
    }

    const acceptanceRow = (acceptance ?? null) as AcceptanceJoinRow | null;

    return {
      data: {
        policy: toPolicyRecord(activePolicy as MasterPolicyRow),
        acceptedAt: acceptanceRow?.accepted_at ?? null,
      },
      errorMessage: null,
    };
  }

  async acceptPolicy(
    userId: string,
    policyId: string,
  ): Promise<{
    acceptedAt: string | null;
    errorMessage: string | null;
  }> {
    const { data: existingAcceptance, error: existingAcceptanceError } = await this.client
      .from("user_policy_acceptances")
      .select("accepted_at")
      .eq("user_id", userId)
      .eq("policy_id", policyId)
      .maybeSingle();

    if (existingAcceptanceError && existingAcceptanceError.code !== NO_ROW_CODE) {
      return {
        acceptedAt: null,
        errorMessage: existingAcceptanceError.message,
      };
    }

    if (existingAcceptance) {
      return {
        acceptedAt: (existingAcceptance as { accepted_at: string }).accepted_at,
        errorMessage: null,
      };
    }

    const { data: insertedAcceptance, error: insertError } = await this.client
      .from("user_policy_acceptances")
      .insert({
        user_id: userId,
        policy_id: policyId,
      })
      .select("accepted_at")
      .single();

    if (insertError) {
      if (insertError.code === UNIQUE_VIOLATION_CODE) {
        const { data: duplicateAcceptance, error: duplicateAcceptanceError } = await this.client
          .from("user_policy_acceptances")
          .select("accepted_at")
          .eq("user_id", userId)
          .eq("policy_id", policyId)
          .maybeSingle();

        if (duplicateAcceptanceError && duplicateAcceptanceError.code !== NO_ROW_CODE) {
          return {
            acceptedAt: null,
            errorMessage: duplicateAcceptanceError.message,
          };
        }

        return {
          acceptedAt: (duplicateAcceptance as { accepted_at: string } | null)?.accepted_at ?? null,
          errorMessage: null,
        };
      }

      return { acceptedAt: null, errorMessage: insertError.message };
    }

    return {
      acceptedAt: (insertedAcceptance as { accepted_at: string }).accepted_at,
      errorMessage: null,
    };
  }

  async publishPolicy(
    fileUrl: string,
    versionName: string,
  ): Promise<{
    data: PolicyRecord | null;
    errorMessage: string | null;
  }> {
    const { data: existingVersion, error: existingVersionError } = await this.client
      .from("master_policies")
      .select("id")
      .eq("version_name", versionName)
      .maybeSingle();

    if (existingVersionError && existingVersionError.code !== NO_ROW_CODE) {
      return { data: null, errorMessage: existingVersionError.message };
    }

    if (existingVersion) {
      return {
        data: null,
        errorMessage: "Policy version already exists. Use a new version name.",
      };
    }

    const { data: activeRows, error: activeRowsError } = await this.client
      .from("master_policies")
      .select("id")
      .eq("is_active", true);

    if (activeRowsError) {
      return { data: null, errorMessage: activeRowsError.message };
    }

    const previouslyActiveIds = (activeRows ?? []).map((row) => (row as { id: string }).id);

    if (previouslyActiveIds.length > 0) {
      const { error: deactivateError } = await this.client
        .from("master_policies")
        .update({ is_active: false })
        .in("id", previouslyActiveIds);

      if (deactivateError) {
        return { data: null, errorMessage: deactivateError.message };
      }
    }

    const { data: insertedPolicy, error: insertPolicyError } = await this.client
      .from("master_policies")
      .insert({
        version_name: versionName,
        file_url: fileUrl,
        is_active: true,
      })
      .select("id, version_name, file_url, is_active, created_at")
      .single();

    if (insertPolicyError) {
      if (previouslyActiveIds.length > 0) {
        await this.client
          .from("master_policies")
          .update({ is_active: true })
          .in("id", previouslyActiveIds);
      }

      return {
        data: null,
        errorMessage: insertPolicyError.message,
      };
    }

    return {
      data: toPolicyRecord(insertedPolicy as MasterPolicyRow),
      errorMessage: null,
    };
  }
}
