import { z } from "zod";
import { clientEnv } from "@/core/config/client-env";

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const parsedServerEnv = serverEnvSchema.safeParse({
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
});

if (!parsedServerEnv.success) {
  throw new Error(`Invalid server environment configuration: ${parsedServerEnv.error.message}`);
}

export const serverEnv = {
  ...clientEnv,
  ...parsedServerEnv.data,
};
