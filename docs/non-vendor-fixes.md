# Non-Vendor Business Central Fixes

This document summarizes the Business Central submission fixes made during this work session for the NxtClaimV2 `bc-claim` integration.

## Background

Finance submits HOD-approved expense claims to Business Central through the `bc-claim` Supabase Edge Function. The recent failures were specific to Business Central payload serialization and evidence URL handling, especially for the non-vendor payment flow.

Relevant files changed:

- `supabase/functions/bc-claim/types.ts`
- `supabase/functions/bc-claim/payloadBuilder.ts`
- `supabase/functions/bc-claim/index.ts`
- `supabase/functions/bc-claim/payloadBuilder.test.ts`
- `supabase/functions/bc-claim/index.test.ts`
- `src/app/api/evidence/[id]/route.ts`
- `tests/unit/api/evidence.route.test.ts`

## 1. GST Subcategory Enum Wire Value Fix

### Problem

Business Central rejected the previous payload with:

```json
{
  "code": "Application_InvalidOptionEnumValue",
  "message": "'Ineligible-43/44' is not an option."
}
```

The app was sending:

```ts
gstSubcategory: "Ineligible-43/44";
```

Business Central expects the encoded AL option wire value:

```ts
Ineligible_x0020__x002D__x0020_43_x002F_44;
```

### Change

`BcGstSubcategory` in `types.ts` was expanded to explicitly list the BC option wire values:

```ts
export const BcGstSubcategory = {
  Blank: "_x0020_",
  Ineligible4344: "Ineligible_x0020__x002D__x0020_43_x002F_44",
  Ineligible175: "Ineligible_x0020__x002D__x0020_17_x0028_5_x0029_",
  IneligiblePos: "Ineligible_x0020__x002D__x0020_POS",
  NA: "N_x002F_A",
} as const;
```

`BcClaimLineItem.gstSubcategory` now uses the `BcGstSubcategory` type instead of the old hardcoded display value.

`payloadBuilder.ts` already used `BcGstSubcategory.Ineligible4344`, so both vendor and non-vendor payloads now serialize to the encoded Business Central value.

### Tests

`payloadBuilder.test.ts` now asserts that:

- Non-vendor payload does not send `Ineligible-43/44`.
- Non-vendor payload sends `Ineligible_x0020__x002D__x0020_43_x002F_44`.
- Vendor payload also sends the encoded value.
- Existing non-vendor fields still behave as expected, including `invoiceRequired: false`, `currencyCode: "INR"`, and omitted vendor-only fields.

## 2. Deno Test Import Resolution Adjustment

### Problem

The Node/Next TypeScript server flagged Deno test imports such as:

```ts
import { assertEquals } from "std/assert/mod.ts";
```

or direct URL imports as unresolved modules. Deno resolves these at runtime, but the regular TypeScript language service does not.

### Change

`payloadBuilder.test.ts` now imports Deno std from the pinned URL and includes a narrow suppression comment:

```ts
// @ts-ignore Deno resolves URL imports; the Node/Next TS server does not.
import { assertEquals, assert, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
```

This is test-only and does not affect production code.

## 3. Remarks Length Issue and Rollback

### Problem

Business Central later rejected payloads with:

```json
{
  "code": "Application_StringExceededLength",
  "message": "The length of the string is 1165, but it must be less than or equal to 1048 characters."
}
```

The root cause was the `remarks` field. It included:

- claim ID
- purpose
- full 10-year Supabase signed bill URL
- full 10-year Supabase signed bank statement URL

The signed URLs were long enough to push `remarks` beyond BC's 1048-character limit.

### Initial Approach

An initial fix capped remarks at 1048 characters and omitted evidence URLs when the full remarks string exceeded the limit.

### Final Decision

That approach was rolled back. The final implementation uses a proxy redirect route instead. This avoids storing long-lived signed Supabase URLs in Business Central and keeps BC remarks short.

## 4. Evidence Proxy URL Approach

### New Behavior

`bc-claim` no longer generates 10-year signed Supabase Storage URLs.

Instead, remarks now contain short NxtClaim evidence links:

```text
bill - https://nxt-claim.vercel.app/api/evidence/{claim_id}?type=bill
bank statement - https://nxt-claim.vercel.app/api/evidence/{claim_id}?type=bank_statement
```

For local testing, the link can use localhost:

```text
bill - http://localhost/api/evidence/{claim_id}?type=bill
```

### Payload Builder Changes

`payloadBuilder.ts` now has helpers for short evidence proxy URLs:

- `buildEvidenceProxyUrl(siteUrl, claimId, type)`
- `buildEvidenceUrls(db, siteUrl)`

`BuildInputs` now supports:

```ts
siteUrl?: string;
```

When `siteUrl` is provided, `buildBcClaimLineItem` builds proxy evidence URLs from the claim ID and evidence path presence. It does not embed Supabase signed URLs.

Existing `fileUrls` support remains available for tests and backwards compatibility, but `bc-claim/index.ts` now passes `siteUrl`.

### Edge Function Origin Selection

`bc-claim/index.ts` now selects the evidence link domain in this order:

1. The request `Origin` header, only when that origin is allowed by the function CORS config.
2. `NEXT_PUBLIC_SITE_URL`.
3. Fallback: `https://nxt-claim.vercel.app`.

This means:

- Local submissions can produce localhost evidence links.
- Deployed submissions produce deployed evidence links.
- Arbitrary untrusted origins are not copied into BC remarks.

## 5. New Evidence Redirect Route

### Route

Added:

```text
src/app/api/evidence/[id]/route.ts
```

### Supported URLs

```text
/api/evidence/{claim_id}?type=bill
/api/evidence/{claim_id}?type=bank_statement
```

### Behavior

The route:

1. Requires an active NxtClaim session using the existing cookie-based auth helper.
2. Redirects unauthenticated users to `/auth/login`.
3. Validates `type` as either `bill` or `bank_statement`.
4. Looks up `expense_details` by `claim_id` and `is_active = true`.
5. Chooses:
   - `receipt_file_path` for `type=bill`
   - `bank_statement_file_path` for `type=bank_statement`
6. Generates a 60-second signed URL from the private `claims` bucket.
7. Redirects the browser to the short-lived signed URL.

### Security Improvement

Previously, Business Central stored long-lived signed Supabase URLs.

Now, Business Central stores only a short NxtClaim URL. A real Supabase signed URL is generated only at click time and expires after 60 seconds.

## 6. Tests Added or Updated

### Supabase Edge Function Payload Tests

Updated:

```text
supabase/functions/bc-claim/payloadBuilder.test.ts
```

Coverage includes:

- Encoded GST subcategory value.
- Non-vendor payload still omits vendor-only fields.
- `buildEvidenceUrls` creates short proxy URLs only when storage paths exist.
- Claim IDs are URL-encoded in proxy links.
- `buildBcClaimLineItem` uses short proxy URLs when `siteUrl` is provided.
- Remarks no longer include Supabase Storage URLs when proxy URL mode is used.

### Supabase Edge Function Handler Tests

Updated:

```text
supabase/functions/bc-claim/index.test.ts
```

Coverage includes:

- Capturing RPC arguments passed to `start_bc_claim_attempt`.
- Verifying evidence proxy remarks use the allowed request origin.
- Example verified output:

```text
claim-1 - Test purpose
bill - http://localhost/api/evidence/claim-1?type=bill
```

### Next.js Evidence Route Tests

Added:

```text
tests/unit/api/evidence.route.test.ts
```

Coverage includes:

- Unauthenticated users are redirected to `/auth/login`.
- Authenticated users are redirected to a 60-second signed bill URL.
- Missing evidence paths return `404`.
- Invalid evidence `type` values return `400`.

## 7. Verification Commands Run

The following checks were run successfully:

```powershell
npm run typecheck
```

```powershell
npm exec --package deno -- deno test --config supabase/functions/deno.json supabase/functions/bc-claim/payloadBuilder.test.ts
```

Result:

```text
27 passed | 0 failed
```

```powershell
npm exec --package deno -- deno test --allow-env --config supabase/functions/deno.json supabase/functions/bc-claim/index.test.ts
```

Result:

```text
17 passed | 0 failed
```

```powershell
npm run test:unit -- tests/unit/api/evidence.route.test.ts
```

Result:

```text
4 passed | 0 failed
```

## 8. Deployment Notes

Both runtime surfaces must be deployed:

1. Deploy the Next/Vercel app so `/api/evidence/[id]` exists in production.
2. Deploy the Supabase `bc-claim` Edge Function so Business Central receives short proxy links instead of signed Supabase URLs.

Supabase deploy command:

```powershell
npx supabase functions deploy bc-claim
```

If the Supabase project is not linked:

```powershell
npx supabase link --project-ref <project-ref>
npx supabase functions deploy bc-claim
```

Ensure the Supabase Edge Function allowed origins include any origin used for testing, such as local development and the deployed app. The request origin is only used in BC evidence links when CORS allows it.

## 9. Current Expected Outcome

Non-vendor submissions should no longer fail with:

```text
Application_InvalidOptionEnumValue: 'Ineligible-43/44' is not an option
```

because GST subcategory now uses the encoded BC option value.

Submissions should also avoid the previous remarks URL length issue because BC remarks now contain short NxtClaim proxy URLs instead of long Supabase signed URLs.

When a finance user opens an evidence link from Business Central, NxtClaim handles authentication and redirects to a fresh 60-second Supabase signed URL.
