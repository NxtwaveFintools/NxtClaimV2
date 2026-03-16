import { ROUTES } from "@/core/config/route-registry";
import { AuthService } from "@/core/domain/auth/auth.service";
import { logger } from "@/core/infra/logging/logger";
import { SupabaseServerAuthRepository } from "@/modules/auth/repositories/supabase-server-auth.repository";

export async function resolveRootRoute(): Promise<string> {
  const service = new AuthService({
    repository: new SupabaseServerAuthRepository(),
    logger,
  });

  const result = await service.enforceDomainOnCurrentSession();
  if (!result.valid || !result.hasUser) {
    return ROUTES.login;
  }

  return ROUTES.dashboard;
}
