// CORS headers for browser-origin calls to BC Edge Functions.
// "*" is acceptable for sandbox; production should restrict to the app's origin
// (e.g., https://<your-domain>) once known.
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function corsPreflight(): Response {
  return new Response(null, { headers: CORS_HEADERS });
}

export function withCors(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json",
      ...extraHeaders,
    },
  });
}
