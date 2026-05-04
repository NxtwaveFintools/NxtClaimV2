import { getServiceRoleSupabaseClient } from "@/core/infra/supabase/server-client";
import { getEmailDomain } from "@/lib/email-domain";

export async function isAllowedEmailDomainInDb(email: string): Promise<{
  isAllowed: boolean;
  errorMessage: string | null;
}> {
  const domain = getEmailDomain(email);

  if (!domain) {
    return { isAllowed: false, errorMessage: null };
  }

  const client = getServiceRoleSupabaseClient();
  const { data, error } = await client
    .from("allowed_auth_domains")
    .select("id")
    .eq("domain", domain)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    return {
      isAllowed: false,
      errorMessage: error.message,
    };
  }

  return {
    isAllowed: Boolean(data?.id),
    errorMessage: null,
  };
}
