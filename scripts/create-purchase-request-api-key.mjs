/**
 * Issues an API key for the BC -> Provision Portal PR submission endpoint
 * (POST /api/v1/purchase-request). Only the sha256 hash is stored in
 * api_keys.key_hash; the raw key is printed once and cannot be recovered.
 *
 * Usage:
 *   node --env-file=.env.local scripts/create-purchase-request-api-key.mjs --label "BC Prod" --company "niat" \
 *     [--callback-url "https://bc.example.com/webhook"] [--callback-api-key "secret"]
 *
 * callback-url/callback-api-key configure where completed PR analysis results are POSTed
 * back to (see sendAnalysisResultToBc). Omit them to create the key with no callback
 * configured -- update api_keys.callback_url/callback_api_key directly once BC shares
 * their receiving endpoint.
 */

import { randomBytes, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function parseArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : null;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`\n  Missing environment variable: ${name}`);
    console.error(
      `  Run with: node --env-file=.env.local scripts/create-purchase-request-api-key.mjs\n`,
    );
    process.exit(1);
  }
  return value;
}

async function main() {
  const label = parseArg("label");
  const companyId = parseArg("company");
  const callbackUrl = parseArg("callback-url");
  const callbackApiKey = parseArg("callback-api-key");

  if (!label || !companyId) {
    console.error("\n  Usage: --label <label> --company <company id>\n");
    process.exit(1);
  }

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(supabaseUrl, serviceRoleKey);

  const rawKey = `pr_live_${randomBytes(32).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  const { error } = await client.from("api_keys").insert({
    key_hash: keyHash,
    label,
    company_id: companyId,
    callback_url: callbackUrl,
    callback_api_key: callbackApiKey,
  });

  if (error) {
    console.error(`\n  Failed to create API key: ${error.message}\n`);
    process.exit(1);
  }

  console.log("\n  API key created. Store it now -- it will not be shown again.\n");
  console.log(`  apikey: ${rawKey}\n`);
}

main();
