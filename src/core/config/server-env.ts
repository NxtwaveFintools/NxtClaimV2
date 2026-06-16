import { z } from "zod";
import { clientEnv } from "@/core/config/client-env";

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.5-flash"),
  // Shared secret the verification worker route checks against the pg_cron caller.
  // Optional: when unset the worker route rejects all calls (feature stays dark).
  CRON_SECRET: z.string().min(1).optional(),
});

const parsedServerEnv = serverEnvSchema.safeParse({
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  CRON_SECRET: process.env.CRON_SECRET,
});

if (!parsedServerEnv.success) {
  throw new Error(`Invalid server environment configuration: ${parsedServerEnv.error.message}`);
}

export const serverEnv = {
  ...clientEnv,
  ...parsedServerEnv.data,
};
