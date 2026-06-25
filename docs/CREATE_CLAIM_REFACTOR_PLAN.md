# Create Claim — Architectural Audit & Refactor Plan

> **Status:** READ-ONLY audit (Phase 4). No code changed. Awaiting approval before implementation.
> **Scope:** The end-to-end "Create a New Claim" vertical (expense + advance), Client → Server Action → Service → Repository → Supabase (Postgres + Storage).
> **Out of scope (per directive):** Performance/render/memoization/bundle concerns. Focus is structural integrity, modularity, validation, and data flow.

---

## 1. What Was Reviewed

**Client (UI):**

- [src/app/(dashboard)/claims/new/page.tsx](../src/app/%28dashboard%29/claims/new/page.tsx) — server component, hydration entry point.
- [src/modules/claims/ui/new-claim-form-client.tsx](../src/modules/claims/ui/new-claim-form-client.tsx) — **2,333-line monolithic client form** (the primary refactor target).
- [src/components/ui/form-input.tsx](../src/components/ui/form-input.tsx), `form-select.tsx` — Design System primitives.

**Server Action layer:**

- [src/modules/claims/actions.ts](../src/modules/claims/actions.ts) — **2,570 lines**; `submitClaimAction` (L667), `getClaimFormHydrationAction` (L546), file-upload helpers (L265–313), `extractSubmissionInput` (L448).
- [src/modules/claims/actions/parse-receipt.ts](../src/modules/claims/actions/parse-receipt.ts) — 889 lines; Google Gemini AI receipt/bank-statement parsing (hidden, file-select-triggered).

**Validation:**

- [src/modules/claims/validators/new-claim-schema.ts](../src/modules/claims/validators/new-claim-schema.ts) — `newClaimSubmitSchema` (Zod discriminated union).

**Domain Service:**

- [src/core/domain/claims/SubmitClaimService.ts](../src/core/domain/claims/SubmitClaimService.ts) — routing resolution, claim-ID generation, integrity checks; exposes **two** paths: `prepareSubmission()` (used) and `execute()` → `createClaimWithDetail` (**built but unused**).

**Repository:**

- [src/modules/claims/repositories/SupabaseClaimRepository.ts](../src/modules/claims/repositories/SupabaseClaimRepository.ts) — **4,183 lines**; the draft-based create methods (L2631–2920), duplicate detection (L2361), beneficiary provisioning (L2530).

**Database (verified live via MCP):**

- Tables: `claims`, `expense_details`, `advance_details` — columns, CHECK/UNIQUE/FK constraints, RLS policies, triggers, unique indexes.
- Functions: `create_claim_with_detail(jsonb)`, `set_expense_total_amount()`, `validate_claim_detail_consistency()`.
- Storage: bucket `claims` (private, 25 MB limit, MIME-restricted).

---

## 2. The Strong Foundation (Do NOT Touch)

These are well-architected and must be preserved:

1. **Layered architecture is genuinely clean.** UI → Server Action → Domain Service → Repository → DB is properly separated. `SubmitClaimService` is pure domain logic with injected `repository`/`logger` and has **no Supabase coupling**. Keep this seam.

2. **Database-level integrity is strong and should remain the source of truth.** Verified constraints worth preserving:
   - `claims_on_behalf_fields` CHECK — enforces Self/On-Behalf field consistency at the DB.
   - `expense_details_gst_fields` CHECK — GST amounts must be 0 when `is_gst_applicable=false`.
   - `chk_expense_location_details_requires_out_station` — `location_details` only allowed for Out Station.
   - `uq_expense_details_active_bill` — **partial UNIQUE index** on `(bill_no, transaction_date, total_amount) WHERE is_active=true`. This is the real duplicate guard.
   - `foreign_total_amount` is a `GENERATED ALWAYS AS (foreign_basic_amount + foreign_gst_amount)` column — correctly computed by the DB.
   - `set_expense_total_amount()` BEFORE trigger — authoritative `total_amount` computation.
   - `validate_claim_detail_consistency()` BEFORE trigger — enforces `detail_type` matches the detail table AND that a claim cannot have both expense and advance rows.

3. **The failure-rollback discipline exists and is mostly correct.** `submitClaimAction`'s `try/catch` (L1065) removes uploaded files and soft-deletes the draft (`rollbackClaimSubmissionDraft`, L2819). Because the unique index is partial on `is_active=true`, a rolled-back claim does **not** block resubmission. This is deliberate and good.

4. **Design System adoption is already high.** The form uses `FormInput`/`FormSelect` for virtually every text/select field. Raw `<input>` usage is limited to legitimate cases: hidden RHF registrations (L1292–1294, 1599) and styled `type="file"` pickers (L1609, 1653, 2141) — there is no `FormFile` primitive, so these are acceptable.

5. **Storage hardening is correct.** Bucket `claims` is **private** (`public=false`), enforces a **25 MB** size limit, and restricts MIME to `pdf/jpeg/png/webp` at the storage layer — defense that does not depend on the client.

6. **The unused atomic RPC `create_claim_with_detail` is a strong asset** (see §6/§7). It re-validates payment-mode↔detail-type mapping and inserts claim+detail in a single transaction. It should be _adopted and extended_, not discarded.

---

## 3. End-to-End Lifecycle & API Map

### 3.1 Page load (hydration)

`NewClaimPage` (server) awaits `getClaimFormHydrationAction()` ([actions.ts:546](../src/modules/claims/actions.ts)), which fires **7 parallel** reads (L562–578): current user, "is approver1" check, active departments, payment modes, expense categories, products, locations. Then `NewClaimFormClient` is dynamically imported.

### 3.2 Hidden AI calls (on file SELECT, not Submit)

When a user picks a receipt or bank statement, `parseReceiptAction` ([parse-receipt.ts](../src/modules/claims/actions/parse-receipt.ts)) runs — **one server action per file**, each calling **Google Gemini externally** with up to **3 internal retries** (`GEMINI_MAX_ATTEMPTS`). These are independent of submission and must be documented separately so they are not conflated with the submit count.

### 3.3 Submit — the exact API count

**Browser → Server:** exactly **1** round-trip — a single `submitClaimAction(FormData)` POST ([new-claim-form-client.tsx:834](../src/modules/claims/ui/new-claim-form-client.tsx)).

**Server → Supabase (Postgres + Storage):** a **sequence of separate, non-transactional round-trips**. Count varies by scenario:

| Step        | Call                                 | Self-Expense (no bank stmt) | Notes                                                                               |
| ----------- | ------------------------------------ | :-------------------------: | ----------------------------------------------------------------------------------- |
| Pre-flight  | `getCurrentUser()`                   |              1              | auth/session                                                                        |
| Pre-flight  | `activeDepartmentsService.execute()` |              1              |                                                                                     |
| Pre-flight  | `getActiveExpenseCategories()`       |              1              | only if category present (bank-stmt-required check, L808)                           |
| Pre-flight  | `existsExpenseByCompositeKey()`      |              1              | app-side duplicate pre-check (L821)                                                 |
| Service     | `getPaymentModeById()`               |              1              | inside `prepareSubmission`                                                          |
| Service     | `getDepartmentApprovers()`           |              1              | routing                                                                             |
| Write       | `createClaimDraft()`                 |              1              | INSERT `claims` (+ analytics trigger)                                               |
| Write       | `createExpenseDetailDraft()`         |              1              | INSERT `expense_details` (+ total/validate/analytics triggers)                      |
| Storage     | `uploadClaimFile(receipt)`           |              1              |                                                                                     |
| Write       | `updateExpenseDetailEvidencePaths()` |            **2**            | **two statements**: UPDATE `expense_details` **and** UPDATE `claims` (L2756, L2776) |
| Write       | `createClaimAuditLog()`              |              1              | INSERT audit                                                                        |
| Post-commit | `syncExpenseDuplicateFlags()`        |              1              | runs AFTER the claim is committed (L1121)                                           |
| **Total**   |                                      |           **~13**           |                                                                                     |

**Scenario deltas:**

- **+ Bank statement:** +1 storage upload (L984).
- **On-Behalf:** +`getActiveUserIdByEmail()` (**1–3** calls — lookup, possibly `auth.admin.createUser`, then re-lookup, L2530) **+** possibly `isUserApprover1InAnyDepartment()` for the beneficiary (L226). Note `getActiveUserIdByEmail` is also called **twice** overall: once in the action (L749) and `prepareSubmission` would call it again except the action pre-resolves `onBehalfOfId` so the service short-circuits (`resolveEffectiveUserId`, L470).
- **Advance:** replaces detail/upload/evidence steps with `createAdvanceDetailDraft` + optional `uploadClaimFile(supporting)` + `updateAdvanceDetailEvidencePath` (still 2 statements); no duplicate pre-check, no category check.

**Lifecycle boundaries:**

- **Client pre-flight:** RHF + Zod resolver validation, client MIME+size validation (`validateUploadFile`, L229), GST-applicability _derivation_ (L766), AI-metadata diffing (`buildExpenseAiMetadata`), then `FormData` assembly.
- **Server Action:** `extractSubmissionInput` → `newClaimSubmitSchema.safeParse` → file size re-check → auth → department/beneficiary resolution → `prepareSubmission` → **manual multi-step write orchestration** → audit → post-commit duplicate-flag sync.
- **DB:** BEFORE triggers (`set_expense_total_amount`, `validate_claim_detail_consistency`), CHECK constraints, partial unique index, AFTER `trg_*_refresh_analytics_snapshot` (fires on every insert/update — so a single expense submission triggers the analytics refresh **4+ times**: claim insert, detail insert, detail-evidence update, claim-touch update).

---

## 4. Validation Gap Analysis

| #       | Gap                                                                                  | Evidence                                                                                                                                                                                                                    | Risk                                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **4.1** | **`basicAmount` allows 0 in Zod but DB requires `> 0`.**                             | Zod `basicAmount: z.number().min(0)` ([schema:93](../src/modules/claims/validators/new-claim-schema.ts)) vs DB CHECK `basic_amount > 0` (`expense_details_claimed_amount_check`).                                           | A zero-amount expense passes both client and server validation, then fails at INSERT with a **raw Postgres error** surfaced to the user.                                                                                 |
| **4.2** | **`totalAmount` / advance `totalAmount` allow 0; DB requires `> 0`.**                | Zod advance `totalAmount: z.coerce.number().min(0)` ([schema:131](../src/modules/claims/validators/new-claim-schema.ts)) vs DB CHECK `total_amount > 0` (both tables) and the RPC's explicit `<= 0` guard.                  | Same raw-error leak; the friendly message lives only in the (unused) RPC.                                                                                                                                                |
| **4.3** | **Upload MIME type is validated CLIENT-only.**                                       | `validateUploadFile` checks `ALLOWED_UPLOAD_MIME_TYPES` ([client:222–239](../src/modules/claims/ui/new-claim-form-client.tsx)); the server action validates **size only** (`validateUploadFileSize`, L687) — no MIME check. | Mitigated by the storage bucket's `allowed_mime_types`, **but** that rejection happens _after_ the `claims` + `expense_details` rows are already inserted, forcing a rollback for what should be a pre-flight rejection. |
| **4.4** | **GST consistency relies on a client-side _derivation_, not validated server-side.** | Client derives `isGstApplicable` from amounts/gstNumber (L766–771); Zod has `isGstApplicable: z.boolean().default(false)` with no cross-field rule; DB CHECK `expense_details_gst_fields` is the only real guard.           | If the derived flag and the tax amounts ever disagree, the user gets a raw DB CHECK error instead of a field-level message.                                                                                              |
| **4.5** | **Redundant duplicate detection (app pre-check + DB index) with a domain mismatch.** | `existsExpenseByCompositeKey` is foreign-currency-aware (L2361) but the DB `uq_expense_details_active_bill` index keys on `(bill_no, transaction_date, total_amount)` only.                                                 | The app pre-check is a TOCTOU race (the index is the real guard); for foreign claims the two use _different_ dedup keys, so they can disagree at the edges.                                                              |

**What is correctly enforced on BOTH sides (good):** Self/On-Behalf field consistency (Zod `superRefine` L165 **and** DB CHECK `claims_on_behalf_fields`); Out-Station location-details requirement (Zod L242 + DB CHECK); non-INR requires `foreignBasicAmount` (Zod L253); receipt-file-required and bank-statement-required-by-category (both server-enforced, L799/L812).

---

## 5. Evidence-Backed Flaws & Deep-Rooted Causes

### 5.1 The submission is non-atomic, hand-orchestrated, and duplicates a finished transactional RPC

**Evidence:** `submitClaimAction` performs 4–7 sequential writes (`createClaimDraft` → `createExpenseDetailDraft` → upload(s) → `updateExpenseDetailEvidencePaths` → `createClaimAuditLog`, L952–1064) with a manual JS `try/catch` compensating transaction (L1065). Meanwhile a complete, single-transaction `create_claim_with_detail(jsonb)` RPC exists and is reachable via `SubmitClaimService.execute()` (L353) — but **nothing calls `execute()`**.

**Root cause:** The draft path was introduced to solve **file-path ordering** — the receipt must be uploaded _after_ a claim ID exists, then written back via `updateExpenseDetailEvidencePaths`. The RPC requires file paths up front, so it was bypassed rather than reworked. This is a classic "the abstraction didn't fit one constraint, so we forked the write path" smell. The constraint is actually soluble: **the claim ID is generated in app code** (`generateClaimId`, [SubmitClaimService:114](../src/core/domain/claims/SubmitClaimService.ts)) _before_ any DB write, so files can be uploaded first and their paths handed to a single atomic call.

### 5.2 `new-claim-form-client.tsx` is a 2,333-line monolith

**Evidence:** A single component owns: 6+ `useState` + `useRef` (L387–394), 8+ `useEffect` cross-field syncs (L496–635), the entire `FormData` assembly (L728–831), AI receipt application (`applyParsedReceiptToForm`, L892+), AI metadata diffing (`buildExpenseAiMetadata`, L306), both the expense and advance field trees, and all file-upload UI.

**Root cause:** The form grew feature-by-feature (AI parsing, foreign currency, GST, NIAT location rules, on-behalf, advance vs expense) without ever extracting sub-forms or hooks. Expense and advance share one component via runtime `detailType` branching instead of composition.

### 5.3 `actions.ts` (2,570) and `SupabaseClaimRepository.ts` (4,183) are god-files

**Evidence:** `actions.ts` holds ~25 exported server actions for the entire claims domain (submit, finance edit, own edit, delete, approvals, bulk ops). The repository holds every claims read/write. The submit path is a small slice buried in both.

**Root cause:** Module-per-domain without sub-module-per-use-case. Not urgent for _this_ feature, but it makes the submit path hard to isolate and test.

### 5.4 The two write paths have drifted — adopting the RPC naively would be a regression

**Evidence:** The RPC's `expense_details` INSERT omits `foreign_currency_code`, `foreign_basic_amount`, `foreign_gst_amount` entirely (verified in the live function body) — it would default everything to INR. `SubmitClaimService.buildCreateClaimPayload` (L417) likewise omits the foreign fields. The draft path, by contrast, _does_ persist them (`createExpenseDetailDraft`, L2698–2700).

**Root cause:** Foreign-currency support was added to the draft path only; the RPC was never updated. This is exactly why "just call the existing RPC" is unsafe (see §6/§7).

### 5.5 Minor: redundant client→server data that the DB ignores

**Evidence:** The client computes and sends `expense.foreignTotalAmount` (L790), but it is a `GENERATED ALWAYS` column — correctly dropped by `createExpenseDetailDraft` (the code comment at L2701 is **accurate**). Harmless, but it is dead payload that invites confusion. (Verified: `is_generated = ALWAYS`.)

---

## 6. Database & Storage Assessment

**Current state:** Solid. RLS is enabled on all three tables; the constraint/trigger surface (§2) is the real backbone of data integrity. Storage is private, size- and MIME-limited.

**Required architectural fixes:**

1. **Move to atomic, upload-first creation.** Target shape:
   1. Generate claim ID + resolve routing in the service (already done in `prepareSubmission`).
   2. Upload receipt/bank-statement to storage using the app-generated claim ID **first**.
   3. Call a **single transactional RPC** with all columns + file paths.
   4. Write the audit log (or fold it into the RPC).
      On failure, only orphaned _storage_ files need cleanup — no half-written DB rows.

2. **Before adopting the RPC, extend it** to accept and insert `foreign_currency_code`, `foreign_basic_amount`, `foreign_gst_amount`, `transaction_id`, `location_type/details`, and `ai_metadata` so it reaches parity with the draft path. **Adopting the current RPC as-is would silently drop foreign-currency data — a regression.** This is the single most important caveat in this plan.

3. **RLS create-time authz is app-only (defense-in-depth gap, not a live vuln).** Verified: the `claims` INSERT policy is `WITH CHECK (auth.uid() = submitted_by)`, but there is **no INSERT policy on `expense_details` or `advance_details`**, and the entire create path runs via `getServiceRoleSupabaseClient()`, which **bypasses RLS**. So the WITH CHECK on `claims` is effectively dead code for this path and all create-time authorization lives in application code. Acceptable for a server-write pattern, but it should be a conscious decision, and any future client-side insert would be blocked by the missing detail-table policies.

4. **Align Zod money floors with DB CHECKs** (`> 0`, not `>= 0`) so users get field-level errors instead of raw Postgres failures (§4.1/4.2).

---

## 7. Component Split Plan (UI Decomposition)

Target: break `new-claim-form-client.tsx` (2,333 lines) into a thin orchestrator + atomic pieces. **No behavior change** — pure extraction.

```
new-claim-form-client.tsx  (orchestrator: RHF context, submit wiring, ~250 lines)
├── hooks/
│   ├── use-claim-submission.ts        → FormData assembly (L728–831) + submitClaimAction call + toast/redirect
│   ├── use-receipt-ai-parse.ts        → parseReceiptAction calls, applyParsedReceiptToForm, buildExpenseAiMetadata
│   └── use-expense-derivations.ts     → the 8 cross-field useEffects (totals, foreign, GST, derive isGstApplicable)
└── sections/
    ├── ClaimSubmitterSection.tsx       → employee/HOD (hidden fields) + submission type + on-behalf
    ├── ClaimRoutingSection.tsx         → department + payment mode
    ├── ExpenseCoreFields.tsx           → bill no, purpose, category, product, transaction date, amounts
    ├── ExpenseGstFields.tsx            → GST number + cgst/sgst/igst
    ├── ExpenseForeignCurrencyFields.tsx→ foreign currency code + foreign amounts
    ├── ExpenseLocationFields.tsx       → location + NIAT Out-Station conditional
    ├── ClaimFileUploads.tsx            → receipt + bank-statement pickers (the raw file inputs)
    └── AdvanceFields.tsx               → advance-only tree (split expense vs advance by composition, not detailType branching)
```

**Principles:** each section consumes the RHF context via `useFormContext`; AI and FormData logic move into hooks (testable in isolation); the orchestrator only composes. Replace remaining raw inputs with primitives where a primitive exists; file pickers stay raw (no `FormFile` primitive — optionally introduce one later, out of scope now).

**`actions.ts` / repository:** out of scope to fully split now, but `submitClaimAction` and its helpers (`uploadClaimFile`, `extractSubmissionInput`, the draft-create calls) should be lifted into a dedicated `claims/server/submit-claim/` folder when the atomic rewrite lands, so the new path is isolated and unit-testable.

---

## 8. Impact & Edge-Case Analysis

1. **Crash/timeout between detail INSERT and evidence-path UPDATE.** The current order inserts an _active_ `claims` + `expense_details` row **before** uploading the receipt and writing its path. A serverless timeout in that window leaves an active claim with `receipt_file_path=NULL` (receipt is mandatory) **and** possibly an orphan file in storage with nothing pointing to it. The upload-first/atomic design (§6) eliminates this window.

2. **Orphan storage files on rollback are best-effort only.** `removeClaimFiles` uses `Promise.allSettled` with no retry/queue (L305). If storage deletion fails during rollback, the file leaks. DB rows are soft-deleted, not hard-deleted, so they linger as `is_active=false` (intended).

3. **On-Behalf failure orphans a login-capable account.** `getActiveUserIdByEmail` auto-provisions a Supabase auth user with a **hardcoded password `"password123"` and `email_confirm:true`** (L2552–2556). If the submission later fails, `rollbackClaimSubmissionDraft` rolls back the claim **but not the provisioned user**. Verified that **password login is live** (`signInWithPassword` in [src/app/api/auth/email-login/route.ts:63](../src/app/api/auth/email-login/route.ts)) — so a failed on-behalf attempt can leave a real, signed-in-capable account with a publicly-known password. **This is a genuine security finding, not just a tidiness issue.**

4. **Missing HOD / department routing.** `prepareSubmission` correctly returns `DEPARTMENT_ROUTING_MISSING` when `approver1_id`/escalation approver is absent (L209, L238), and `assigned_l1_approver_id` is `NOT NULL` at the DB — so misrouting fails loudly rather than corrupting data. Good. The beneficiary-is-HOD escalation logic (L219–236) is subtle and must be preserved verbatim during any refactor.

5. **Duplicate race.** Two identical submissions racing past the app pre-check are still caught by `uq_expense_details_active_bill`; the action maps that unique violation to a friendly `DUPLICATE_TRANSACTION` message (L1087). Correct. Foreign-currency duplicates rely on app logic only (the index keys on `total_amount`), so that edge is weaker.

6. **Header-size failure path.** The client has special handling for "Request Header Fields Too Large" (L851) — a symptom of large session cookies, unrelated to claim logic but worth keeping.

---

## 9. Remaining Risks (Brutally Honest)

- **The atomic rewrite touches the most load-bearing path in the app.** Routing resolution (HOD escalation), claim-ID format (DB regex `^(CLAIM|EA)-...`), the on-behalf CHECK, and the partial unique index all interact. A mistake here misroutes approvals or blocks all submissions. Any rewrite must be covered by tests that assert routing + duplicate + on-behalf + foreign-currency behavior _before_ switching paths.
- **RPC parity is non-optional.** If the RPC is adopted before adding the foreign-currency columns, every non-INR claim silently loses its foreign data. This is the highest-probability regression.
- **`password123` provisioning is a standing security exposure** regardless of this refactor. It should be triaged independently (random password / no password / invite flow) and is arguably more urgent than the structural cleanup.
- **Service-role-everywhere means RLS is not a safety net for writes.** Any bug in the app-side authorization checks is unguarded by the database on the create path.
- **The monolith split is low-risk but high-churn.** Pure extraction can still introduce subtle RHF context or `useEffect`-ordering bugs (the cross-field derivations are order-sensitive). Extract behind tests and verify field-by-field.
- **Analytics-snapshot triggers fire 4+ times per submission.** Flagged for structural awareness only (per directive, performance is out of scope) — but a future atomic single-transaction write would also collapse this naturally.

---

### Verification ledger (how claims above were confirmed)

- Schema/constraints/RLS/triggers/indexes/bucket: live `information_schema` + `pg_catalog` + `storage.buckets` queries via Supabase MCP.
- `foreign_total_amount` generated: `information_schema.columns.is_generated = 'ALWAYS'`, expr `foreign_basic_amount + foreign_gst_amount`.
- RPC / trigger bodies: `pg_get_functiondef`.
- Password login live: `signInWithPassword` in `email-login/route.ts`.
- All file:line references are from the current working tree on branch `fixReHodDash`.
