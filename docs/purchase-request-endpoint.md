# PR Submission Endpoint

`POST /api/v1/purchase-request`

First endpoint of the Dynamics 365 Business Central -> Provision Portal integration.
Validates and stores a PR + its attachments, then immediately kicks off AI document
analysis (see [AI Analysis](#ai-analysis) below). Does **not** implement the approval
workflow or BC dashboard sync — those are separate, later features.

## Auth

Header: `apikey: <raw key>`

Keys are issued with:

```
npm run create:pr-api-key -- --label "BC Prod" --company "niat"
```

This prints the raw key once. Only its sha256 hash is stored (`api_keys.key_hash`); it
cannot be recovered later — issue a new key if it's lost.

## Deviations from the original spec

- **Stack**: implemented as a Next.js route handler on Supabase Postgres/Storage
  (this app's actual stack), not a standalone Express/raw-pg service.
- **`request_id`**: returned as a UUID string, not an integer — every table in this
  codebase uses `gen_random_uuid()` primary keys; adding a second, inconsistent ID
  scheme just for this table wasn't worth it.
- **Attachments**: the request body takes an `attachments` array, not a single
  `attachment` object — a PR can carry multiple documents. Each entry has the same
  `file_name` / `content_type` / `base64` shape as the original spec's single
  attachment, and each is validated/limited individually (10MB each, `application/pdf`
  or `image/*` each). Stored as rows in `purchase_request_attachments` (one-to-many),
  files in a private Supabase Storage bucket (`purchase-request-attachments`) — not
  local disk, which doesn't persist across serverless deployments.
- **Required fields**: `request_date`, `vendor_code`, `vendor_name` are treated as
  required even though the spec's "Required fields" list (section 3) omits them,
  because the DB schema in section 7 marks all three `NOT NULL`. Without this they'd
  fail as a raw DB error instead of a clean 400.
- **`error_code` values not in the original spec**: `INVALID_JSON` (malformed body),
  `VALIDATION_FAILED` (field present but invalid — bad `pr_type`, out-of-range
  `gst_percentage`, invalid base64, etc.), `RATE_LIMIT_EXCEEDED` (429, for the
  100/hour/key limit the spec required but didn't give a status code for).
- **Audit log**: no separate audit-log table. `purchase_requests.status`/`created_at`
  plus a structured `logger.info("purchase_request.received", …)` call on every
  outcome serve as the audit trail, matching how the rest of this app logs.
- **Duplicate `pr_id`**: overwrites the existing row instead of the spec's `409
PR_ALREADY_EXISTS`. Resubmitting a `pr_id` replaces its data and its entire
  attachment set (old attachment files are deleted from storage) and resets `status`
  back to `pending_analysis`. `request_id` in the response is the same UUID as the
  original submission. The new attachment list supersedes the old one — it isn't
  merged, so a resubmission must include every attachment that should still exist.

## Example request

```bash
curl -X POST https://<host>/api/v1/purchase-request \
  -H "apikey: pr_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "pr_id": "PR-2024-001234",
    "request_date": "2026-07-11",
    "vendor_code": "V-001",
    "vendor_name": "ABC Vendor Pvt Ltd",
    "vendor_gstin": "18AAACL5055K1Z0",
    "company_gstin": "27ABCDE1234F2Z5",
    "department": "Operations",
    "pr_type": "Invoice",
    "vendor_invoice_number": "INV-2024-0157",
    "document_date": "2026-07-15",
    "direct_unit_cost": 7000,
    "gst_percentage": 12,
    "gst_amount": 840,
    "purchase_request_amount": 7840,
    "description": "Office supplies for Q3 2024",
    "attachments": [
      {
        "file_name": "INV-2024-0157.pdf",
        "content_type": "application/pdf",
        "base64": "JVBERi0xLjQK..."
      },
      {
        "file_name": "delivery-proof.jpg",
        "content_type": "image/jpeg",
        "base64": "/9j/4AAQSkZJRg..."
      }
    ]
  }'
```

### 202 success

```json
{
  "success": true,
  "request_id": "b3b6b1d0-....-....-....-............",
  "pr_id": "PR-2024-001234",
  "analysis_id": "AN-20260711-001234-00001",
  "status": "pending_analysis",
  "message": "PR received and stored successfully",
  "timestamp": "2026-07-11T10:30:45.000Z",
  "attachments": [
    {
      "file_name": "INV-2024-0157.pdf",
      "size_bytes": 245632,
      "saved_path": "2026-07-11/pr-2024-001234/0-inv-2024-0157-pr-2024-001234.pdf"
    },
    {
      "file_name": "delivery-proof.jpg",
      "size_bytes": 88210,
      "saved_path": "2026-07-11/pr-2024-001234/1-delivery-proof-pr-2024-001234.jpg"
    }
  ]
}
```

## Status codes

| Status | `error_code`              | When                                                                                                          |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 202    | —                         | Stored successfully                                                                                           |
| 400    | `INVALID_JSON`            | Body isn't valid JSON                                                                                         |
| 400    | `MISSING_REQUIRED_FIELDS` | A required top-level or `attachments[i].*` field is absent                                                    |
| 400    | `VALIDATION_FAILED`       | A field is present but invalid (bad enum, base64, empty array, length)                                        |
| 401    | `INVALID_API_KEY`         | Missing/unknown/inactive `apikey` header                                                                      |
| 400    | `ATTACHMENT_TOO_SMALL`    | Any attachment decodes to < 512 bytes -- empty/placeholder, not a real document (`details` lists the indexes) |
| 413    | `ATTACHMENT_TOO_LARGE`    | Any attachment decodes to > 10MB (`details` lists the indexes)                                                |
| 415    | `UNSUPPORTED_FILE_TYPE`   | Any `content_type` isn't `application/pdf` or `image/*` (`details` lists the indexes)                         |
| 429    | `RATE_LIMIT_EXCEEDED`     | > 100 requests for this key in the last hour                                                                  |
| 500    | `INTERNAL_ERROR`          | DB/storage failure                                                                                            |

## Test scenarios

1. Valid PR + multiple attachments (PDF + image) -> 202, one `purchase_requests` row, one `purchase_request_attachments` row per file, files in storage
2. Missing `pr_id` -> 400 `MISSING_REQUIRED_FIELDS`, `details: ["pr_id"]`
3. Missing `attachments` entirely -> 400 `MISSING_REQUIRED_FIELDS`, `details: ["attachments"]`
4. `attachments: []` (empty array) -> 400 `VALIDATION_FAILED`
5. `attachments[1]` missing `base64` -> 400 `MISSING_REQUIRED_FIELDS`, `details: ["attachments[1].base64"]`
6. `pr_type: "Estimate"` (not Invoice/Quotation) -> 400 `VALIDATION_FAILED`
7. `gst_percentage: 15` (not 5/12/18/28) -> 400 `VALIDATION_FAILED`
8. `pr_id` resubmitted with a different attachment set -> 202, same `request_id`, all old attachment rows/files replaced by the new set
9. `attachments[0]` decodes to > 10MB -> 413 `ATTACHMENT_TOO_LARGE`, `details: ["attachments[0]"]`
10. `attachments[2].content_type: "application/zip"` -> 415 `UNSUPPORTED_FILE_TYPE`, `details: ["attachments[2]"]`
11. `attachments[1]` decodes to < 512 bytes (e.g. a 70-byte placeholder image) -> 400 `ATTACHMENT_TOO_SMALL`, `details: ["attachments[1]"]`
12. Missing `apikey` header -> 401 `INVALID_API_KEY`
13. Wrong/inactive `apikey` -> 401 `INVALID_API_KEY`
14. Malformed JSON body -> 400 `INVALID_JSON`
15. 101st request for the same key within an hour -> 429 `RATE_LIMIT_EXCEEDED`

## AI Analysis

Second endpoint of the integration, but not a separate HTTP endpoint — it runs
automatically. Right after a PR is stored, the submission route schedules
`runPurchaseRequestAnalysis(purchaseRequestId)` via Next.js `after()`, so it starts
immediately without delaying the 202 response back to BC.

**Flow**: `purchase_requests.status` flips `pending_analysis` -> `analyzing` ->
`analyzed` (or back to `pending_analysis` if the run throws, so it isn't stranded).
All of a PR's attachments are downloaded and sent to Gemini in a single call, along
with `pr_data` (the only source of truth -- see the "No vendor_master/company_config"
deviation below). The model itself identifies which
ONE attachment is the actual invoice/quotation to validate (vs. supporting documents
like delivery proofs) and performs all 17 validation checks against it. The result is
inserted as a new row in `purchase_request_analyses` (append-only — re-running
analysis for the same PR adds another row, doesn't overwrite).

**Model**: hardcoded `PR_ANALYSIS_MODEL = "gemini-2.5-flash"` in
`analyze-purchase-request.ts` — deliberately **not** sourced from
`serverEnv.GEMINI_MODEL` (that env var is shared with receipt-parsing/bank-statement
verification and may need to move independently). Originally pinned to
`gemini-3.5-flash` per the spec's "Gemini 3.5 Flash only" requirement, but switched to
`gemini-2.5-flash` after `3.5-flash` returned sustained `503` "high demand" errors
from Google for 25+ minutes during testing (2026-07-13) — confirmed via server logs,
not a bug in this codebase's retry logic (which does retry 503s and generic network
failures 3x before giving up). Revisit `3.5-flash` once it's less capacity-constrained
if strict adherence to the original model choice matters later. Calls go through
`@google/genai`'s `generateContent` with `responseJsonSchema` constrained decoding —
the same approach `src/modules/claims/actions/parse-receipt.ts` uses for document
understanding, not the `@ai-sdk/google` streaming pattern the chatbot uses.

### Deviations from the original spec

- **Multi-attachment selection**: the original spec assumed one attachment per PR.
  Since PRs can now carry several, the system prompt has an appended
  "MULTI-ATTACHMENT HANDLING" section (the other 3800+ words are verbatim) instructing
  Gemini to pick the one invoice/quotation document and report it via a new
  `analyzed_file_name` output field. This is resolved by content inspection in the
  same Gemini call, not a separate classification pass or a BC-supplied flag.
- **`analysis_id`**: generated server-side (`AN-YYYYMMDD-<pr_id suffix>-<5-digit
sequence>`), not by the model — an LLM can't reliably produce a globally unique
  sequenced ID. Gemini's output schema omits `pr_id`/`analysis_id` entirely. Per the
  original spec's step 6 ("Return 202 response to BC with pr_id and analysis_id
  placeholder"), it's generated at submission time (before analysis runs) and
  returned in the 202 response — `runPurchaseRequestAnalysis` reuses that exact same
  ID rather than generating a new one, so it's a real pre-allocated reference, not a
  throwaway placeholder. Known edge case: two near-simultaneous submissions for the
  same `pr_id` (e.g. a BC webhook retry racing the original) could compute the same
  sequence number and collide on the `UNIQUE` constraint — the second analysis run
  fails safely (logged, status reverts to `pending_analysis`) rather than corrupting
  data, but doesn't complete. Not addressed further since it requires genuinely
  concurrent requests within milliseconds.
- **No `vendor_master` / `company_config` tables exist.** VC-08, VC-09, and
  VC-12–14 compare the document directly against `pr_data`'s own fields (what BC
  submitted on the PR) -- there is no independent, trusted master record to
  cross-check against. An earlier version of this service synthesized a fake
  `vendor_master`/`company_config` from `pr_data` and sent it to Gemini as if it
  were independent data; that caused a **false `statement_mismatch`** on every PR
  that simply didn't submit optional bank fields (the synthesized "master" was
  empty, so any bank details actually printed on the document looked like a
  conflict). Removed entirely -- the system prompt now instructs the model to skip
  VC-12/13/14 (not fail them) when `pr_data` doesn't include bank details, per the
  original spec's own "When PR Data is Incomplete" guidance. Wiring a real vendor/
  company master table later would strengthen fraud detection meaningfully (right
  now nothing catches a PR whose own submitted GSTIN/bank details are simply wrong)
  -- flagged as a gap, not silently glossed over.
- **No `statement_mismatch` outcome.** The original spec's status logic escalated a
  bank-details mismatch to a distinct `statement_mismatch` overall status. Changed so
  bank-detail checks (VC-12/13/14/15) behave like every other warning-severity check
  (VC-07, VC-17): reported in `field_validations`/`remarks`, but never on their own
  changing `overall_status` away from `verified`. Only a Hard Block failure can
  produce `mismatch`. `OVERALL_STATUSES` (and the DB `CHECK` constraint) now has 5
  values, not 6; historical rows with `statement_mismatch` were backfilled to
  `verified` (all of them had no other issue).
- **`field_validations` ordering.** Sorted failures-first (`mismatch` >
  `minor_variance` > `match_success`) so an approver sees what's wrong without
  scrolling past 15+ passing checks. The system prompt asks the model to order it
  this way too, but the actual guarantee is a deterministic sort applied in code
  after the response comes back (`sortFieldValidationsByFailureFirst` in
  `analyze-purchase-request.ts`) -- not something left to the model to get right
  every time.
- **Trigger mechanism**: runs inline via `after()` on submission (per explicit
  instruction), not the polling-worker pattern this app already uses for claims AI
  verification (`verification-worker.ts` + cron). There is therefore no automatic
  retry queue: if a run fails, status reverts to `pending_analysis` but nothing
  re-triggers it automatically. A future feature could add a worker to sweep PRs
  stuck in `pending_analysis`.
- **Route timeout**: `maxDuration` raised from 30s to 120s on the submission route,
  since `after()` keeps the invocation alive for attachment downloads + the Gemini
  call (with up to 3 retries on transient 503s) before it fully exits.

### `purchase_request_analyses` columns

| Column                   | Notes                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `analyzed_attachment_id` | FK to the attachment Gemini picked; null if none qualified                                                        |
| `analysis_id`            | `AN-YYYYMMDD-<pr_id suffix>-<sequence>`, unique                                                                   |
| `overall_status`         | `verified \| needs_review \| mismatch \| extraction_failed \| no_document`                                        |
| `confidence_score`       | 0–100, one decimal                                                                                                |
| `field_validations`      | JSONB array of exactly 17 check results, ordered failures-first (`mismatch` > `minor_variance` > `match_success`) |
| `model`                  | The `PR_ANALYSIS_MODEL` value used for this run (audit trail)                                                     |

### Manual re-trigger (debug/local use)

`POST /api/internal/pr-analysis-trigger` -- re-runs analysis for an already-submitted
PR without resubmitting it. Not part of the BC integration; gated by the same
shared-secret pattern as `/api/internal/verify-worker`.

```bash
curl -X POST http://localhost:3000/api/internal/pr-analysis-trigger \
  -H "x-cron-secret: <CRON_SECRET from .env.local>" \
  -H "Content-Type: application/json" \
  -d '{ "pr_id": "PR-2026-1022" }'
```

Requires `CRON_SECRET` in `.env.local` (route returns `503` if unset). Useful when
`after()` didn't complete in local dev -- e.g. the dev server was restarted between
submission and the analysis finishing, leaving `status` stuck at `analyzing`. That
scenario isn't a bug in the analysis logic itself: Next's docs confirm `after()` is
fully supported on a Node.js server (`next dev` included) and runs "even if the
response didn't complete successfully" -- but restarting the process kills any
in-flight or queued `after()` callback along with it, same as killing any other
background task. This route lets you resume/retest without needing to re-upload
attachments.

### Test scenarios

1. PR with 1 attachment (real invoice) -> `analyzed`, one `purchase_request_analyses` row, `overall_status` reflects actual match/mismatch
2. PR with multiple attachments (invoice + a delivery-proof image) -> Gemini's `analyzed_file_name` matches the invoice, `analyzed_attachment_id` resolves to the correct row
3. PR with zero attachments -> no Gemini call made; synthetic `no_document` result stored, all 17 checks marked `mismatch`/`confidence: 0`
4. Gemini call throws (quota/503 exhausted, or schema-invalid output) -> `purchase_requests.status` reverts to `pending_analysis`, no analysis row inserted, error logged
5. PR resubmitted (same `pr_id`) -> analysis re-runs on the new attachment set; a second `purchase_request_analyses` row is appended (history preserved, not overwritten)
