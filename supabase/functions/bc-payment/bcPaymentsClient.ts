import { getBcAccessToken, __resetTokenCache } from "../_shared/bcAuth.ts";
import { getBcEnv } from "../_shared/bcEnv.ts";
import type { BcClaimLineItem } from "./types.ts";

export type BcPostResult =
  | { ok: true; response: unknown }
  | { ok: false; status: number; body: unknown };

export async function postBcLineItems(lines: BcClaimLineItem[]): Promise<BcPostResult[]> {
  const results: BcPostResult[] = [];
  for (const line of lines) {
    const r = await postOne(line);
    results.push(r);
    if (!r.ok) break; // do not send the second line if the first failed
  }
  return results;
}

async function postOne(line: BcClaimLineItem): Promise<BcPostResult> {
  const env = getBcEnv();
  // BC's custom Alletec Claim API endpoint shape.
  // Source: postman/sandbox/bc-claims-api.postman_collection.json (NxtClaim request).
  // Note: this URL does NOT include {tenantId} in the path, unlike the BC vendor
  // OData endpoint used by bc-vendor-search. Do not "unify" them.
  const url =
    `https://api.businesscentral.dynamics.com/v2.0/${env.environment}` +
    `/api/Alletec/Claim/v1.0/companies(${env.companyId})/Claims`;

  const send = async (token: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(line),
    });

  let token = await getBcAccessToken();
  let res = await send(token);

  if (res.status === 401) {
    __resetTokenCache();
    token = await getBcAccessToken();
    res = await send(token);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep as text */
    }
    return { ok: false, status: res.status, body };
  }

  const json = await res.json().catch(() => ({}));
  return { ok: true, response: json };
}
