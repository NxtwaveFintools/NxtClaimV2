# Vendor Business Central Fixes

This document summarizes the Business Central vendor-payment fix for the HSN/SAC reference search failure in the Finance modal.

## Background

Finance users submit vendor payments to Business Central from the vendor path in the Business Central claim modal. After selecting a vendor, the modal lets the user choose reference codes:

- Currency
- GST Group
- HSN/SAC

The HSN/SAC field is search-as-you-type because the Business Central HSN/SAC table can contain many records. The modal sends:

```text
GET /functions/v1/bc-reference?type=hsnSacCodes&query=998
```

The server-side `bc-reference` Edge Function then queries Business Central OData.

Relevant files changed:

- `supabase/functions/bc-reference/index.ts`
- `supabase/functions/bc-reference/index.test.ts`

Related files inspected but not changed:

- `supabase/functions/_shared/bcSearch.ts`
- `supabase/functions/_shared/bcClient.ts`
- `supabase/functions/bc-vendor-search/index.ts`
- `src/modules/claims/ui/bc-claim-modal.tsx`

## 1. HSN/SAC Search Failure

### Problem

Searching HSN/SAC with query `998` failed in the vendor payment modal.

The `bc-reference` Edge Function returned:

```json
{
  "error": "BC_REFERENCE_FETCH_FAILED",
  "type": "hsnSacCodes",
  "status": 501,
  "detail": {
    "error": {
      "code": "BadRequest_MethodNotImplemented",
      "message": "The 'OR' operator is not supported on distinct fields on an OData filter."
    }
  }
}
```

### Root Cause

The HSN/SAC lookup built one Business Central OData `$filter` containing `or` across different fields:

```text
contains(Code,'998') or contains(Description,'998')
```

Business Central supports some `or` patterns, but this endpoint rejects `or` across distinct fields. That means a single filter combining `Code` and `Description` is not valid for this lookup.

The failure was server-side. The modal only passed `type=hsnSacCodes` and `query=998`, so the modal did not need a code change.

## 2. New HSN/SAC Search Behavior

### Before

For a non-empty query, `bc-reference` made one OData request with a combined filter:

```text
/hsnSAC?$select=Code,Description&$top=20&$filter=(contains(Code,'998') or contains(Description,'998'))
```

This is the pattern Business Central rejected.

### After

For a non-empty HSN/SAC query, `bc-reference` now performs separate OData requests:

```text
/hsnSAC?$select=Code,Description&$top=20&$filter=contains(Code,'998')
```

```text
/hsnSAC?$select=Code,Description&$top=20&$filter=contains(Description,'998')
```

The Edge Function merges the two result sets in memory and returns one normalized response to the modal:

```json
{
  "value": [
    {
      "code": "998314",
      "description": "IT Services"
    }
  ]
}
```

No generated HSN/SAC query URL contains an OData `or` filter.

## 3. Server-Side Merge and Ordering

The new helper `fetchHsnSacCodes(query)` handles HSN/SAC lookup separately from currencies and GST groups.

For non-empty query:

1. Sanitize the query using existing `sanitizeBcSearchQuery()`.
2. Escape the query using existing `escapeOdataLiteral()`.
3. Fetch code matches from Business Central.
4. Fetch description matches from Business Central.
5. Normalize BC rows from `{ Code, Description }` to `{ code, description }`.
6. Merge results server-side.
7. Deduplicate by stable `code`.
8. Cap the final response to 20 records.

Ordering is now deterministic:

1. Exact code matches.
2. Code-prefix matches.
3. Other code matches.
4. Description matches.

Example for query `998`:

```text
998     -> exact code match
9980    -> code-prefix match
1998    -> other code match
DESC1   -> description-only match
```

If the same code appears in both code search and description search, the code-search version wins.

## 4. Empty Query Behavior

Empty query behavior is preserved.

When the request has no HSN/SAC query:

```text
GET /functions/v1/bc-reference?type=hsnSacCodes
```

The Edge Function still fetches the first 20 records:

```text
/hsnSAC?$select=Code,Description&$top=20
```

No `$filter` is added for the empty-query path.

## 5. Description Field Fallback

The implementation handles Business Central environments where the HSN/SAC entity does not support a usable `Description` field.

If the description search fails with an unsupported-field or unsupported-filter style response, the Edge Function logs the failure and returns code-search results instead of failing the entire lookup.

Examples treated as safe fallback cases:

- HTTP `400` or `501`
- `BadRequest_MethodNotImplemented`
- field-not-found style messages
- messages indicating a field or filter is not supported

If selecting `Code,Description` itself fails because `Description` does not exist, the Edge Function retries the code search with:

```text
/hsnSAC?$select=Code&$top=20&$filter=contains(Code,'998')
```

In that fallback case, returned descriptions are empty strings:

```json
{
  "value": [
    {
      "code": "998",
      "description": ""
    }
  ]
}
```

If the code-search path fails, the lookup still returns a clear `BC_REFERENCE_FETCH_FAILED` response because code search is required for a usable HSN/SAC lookup.

## 6. Caching Behavior

Existing in-memory caching is preserved.

For HSN/SAC, the cache key includes both:

- reference type
- sanitized query string

Example cache keys:

```text
hsnSacCodes::998
hsnSacCodes::997
```

This prevents one HSN/SAC search response from poisoning another query's results.

Currencies and GST group lookups continue to use their reference type as the cache key because they ignore `query` and return the full list.

## 7. Other Reference Lookups

The following reference lookups were inspected:

- `currencies`
- `gstGroupCodes`
- `hsnSacCodes`

Only `hsnSacCodes` used the affected cross-field OData `or` search pattern. Currencies and GST groups still return their full lists and do not build search filters.

Vendor search was also inspected. It already performs separate Business Central requests for vendor number and vendor name searches. Its remaining `or` usage is only within the same field for case variants, not across distinct fields, so it was not changed.

## 8. Tests Added or Updated

Updated:

```text
supabase/functions/bc-reference/index.test.ts
```

Coverage added:

- HSN/SAC query does not generate an OData URL containing `or`.
- HSN/SAC query uses separate `Code` and `Description` OData requests.
- Results from code and description search are merged.
- Duplicate HSN/SAC codes are removed.
- Exact code matches and code-prefix matches come before description matches.
- Final HSN/SAC response is capped to 20 results.
- Empty HSN/SAC query still returns the first 20 records.
- Cache key includes HSN/SAC query string.
- Description-search failure falls back to code-search results.
- Missing `Description` field triggers a retry with `$select=Code`.
- Currency lookup still ignores `query`.

Related vendor-search tests were also run to confirm vendor search behavior remained unchanged.

## 9. Verification Commands Run

Format check:

```powershell
npm exec --package deno -- deno fmt --check supabase/functions/bc-reference/index.ts supabase/functions/bc-reference/index.test.ts
```

Result:

```text
Checked 2 files
```

Edge Function tests:

```powershell
npm exec --package deno -- deno test --config supabase/functions/deno.json --allow-net --allow-env supabase/functions/bc-reference/index.test.ts supabase/functions/bc-vendor-search/index.test.ts
```

Result:

```text
20 passed | 0 failed
```

Modal regression test attempted:

```powershell
npm run test:unit -- tests/unit/claims/bc-claim-modal.search-cancellation.test.tsx
```

Result:

```text
Failed: unable to find the expected HSN/SAC combobox button.
```

No modal code was changed as part of this fix. The failure is documented as a separate existing frontend test issue, not part of the HSN/SAC OData fix.

## 10. Deployment Notes

Only the `bc-reference` Edge Function needs to be redeployed for this fix.

Supabase deploy command:

```powershell
supabase functions deploy bc-reference
```

If the project is not linked:

```powershell
supabase link --project-ref <project-ref>
supabase functions deploy bc-reference
```

No Next.js/Vercel deploy is required for this specific HSN/SAC search fix because the modal request shape did not change.

## 11. Current Expected Outcome

Searching HSN/SAC code `998` in the Business Central vendor payment modal should no longer fail with:

```text
BadRequest_MethodNotImplemented:
The 'OR' operator is not supported on distinct fields on an OData filter.
```

The modal should receive a successful response from `bc-reference` containing up to 20 normalized HSN/SAC options, with code matches prioritized before description matches.
