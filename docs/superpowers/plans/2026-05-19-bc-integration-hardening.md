# BC Integration Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the on-behalf submission_type bug, add a CI signal for unmapped active departments, and switch HSN/SAC lookup to search-as-you-type.

**Architecture:** Three independent units bundled into one stacked PR on `bc_int`:

1. A2 — PG enum for `claims.submission_type` + correct `"On Behalf"` literal everywhere
2. B1 — pure guard function (unit-tested with mocked repo) + integration test (real test DB)
3. C — `bc-reference` edge fn accepts `?query=` for HSN/SAC with `$top=20`; `bc-claim-modal` switches HSN to debounced search

**Tech Stack:** Supabase Postgres 15, Supabase Edge Functions (Deno), Next.js 15 (React 19), TypeScript 5, Jest (jsdom), Deno test (`std/assert`)

**Spec:** `docs/superpowers/specs/2026-05-19-bc-integration-hardening-design.md`

---

## File map

**Create:**

- `supabase/migrations/20260520000000_claim_submission_type_enum.sql` — enum migration + RPC fix (A2)
- `tests/integration/bc-claim-rpc.test.ts` — RPC-level on-behalf integration test (A2)
- `src/lib/dept-mapping-guard.ts` — pure guard function (B1)
- `tests/unit/lib/dept-mapping-guard.test.ts` — unit test with mocked repo (B1)
- `tests/integration/department-mapping-completeness.test.ts` — integration test against test DB (B1)

**Modify:**

- `supabase/functions/bc-claim/payloadBuilder.ts` — `"On_behalf"` → `"On Behalf"` (A2)
- `supabase/functions/bc-claim/types.ts` — `submission_type: "Self" | "On_behalf"` → `"Self" | "On Behalf"` (A2)
- `supabase/functions/bc-claim/payloadBuilder.test.ts` — fixture strings (A2)
- `supabase/functions/bc-reference/index.ts` — accept `?query=` for HSN, `$top=20`, cache key includes query (C)
- `supabase/functions/bc-reference/index.test.ts` — Deno tests for new query path (C)
- `src/modules/claims/ui/bc-claim-modal.tsx` — HSN debounced-search wiring (C)

---

## Task 1 — A2: write the failing on-behalf payload test (RED)

**Files:**

- Modify: `supabase/functions/bc-claim/payloadBuilder.test.ts`

- [ ] **Step 1: Add a test that asserts on-behalf claims send the beneficiary, not the submitter**

Append to `supabase/functions/bc-claim/payloadBuilder.test.ts`:

```typescript
Deno.test("On Behalf submission sends beneficiary employee_id, not submitter's", () => {
  const line = buildBcClaimLineItem({
    db: {
      ...baseDb,
      submission_type: "On Behalf",
      employee_id: "NW0001234", // submitter
      on_behalf_employee_code: "NW0009999", // beneficiary
      employee_name: "Beneficiary Person",
    },
    isVendorPayment: false,
  });
  assertEquals(line.employeeId, "NW0009999");
  assertEquals(line.employeeName, "Beneficiary Person");
});
```

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

```bash
cd supabase/functions
deno test --allow-env --allow-read bc-claim/payloadBuilder.test.ts
```

Expected: this one test fails because `submission_type` type asserts `"Self" | "On_behalf"`, so the value `"On Behalf"` causes a TypeScript error OR (if the type is loosened) the production code matches `"On_behalf"` and falls through to `db.employee_id`. Either way, expect FAIL.

---

## Task 2 — A2: fix the TypeScript types and payload builder (GREEN)

**Files:**

- Modify: `supabase/functions/bc-claim/types.ts`
- Modify: `supabase/functions/bc-claim/payloadBuilder.ts`

- [ ] **Step 1: Update the type union in types.ts**

In `supabase/functions/bc-claim/types.ts`, change the `BcClaimPayloadFromDb` interface:

```typescript
// BEFORE
submission_type: "Self" | "On_behalf";

// AFTER
submission_type: "Self" | "On Behalf";
```

- [ ] **Step 2: Update the string comparison in payloadBuilder.ts**

In `supabase/functions/bc-claim/payloadBuilder.ts`, change the `buildBcClaimLineItem` employeeId resolution:

```typescript
// BEFORE
const employeeId =
  db.submission_type === "On_behalf" && db.on_behalf_employee_code
    ? db.on_behalf_employee_code
    : db.employee_id;

// AFTER
const employeeId =
  db.submission_type === "On Behalf" && db.on_behalf_employee_code
    ? db.on_behalf_employee_code
    : db.employee_id;
```

- [ ] **Step 3: Update any other on-behalf fixtures in the test file**

In `supabase/functions/bc-claim/payloadBuilder.test.ts`, find every occurrence of `submission_type: "On_behalf"` and change to `submission_type: "On Behalf"`. There is one such fixture in the existing test "On_behalf submission uses on_behalf_employee_code for employeeId". Also rename that test title to "On Behalf submission uses on_behalf_employee_code for employeeId" for consistency.

- [ ] **Step 4: Run all deno tests and confirm GREEN**

```bash
cd supabase/functions
deno test --allow-env --allow-read bc-claim/payloadBuilder.test.ts
```

Expected: all tests pass (count = previous + 1).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/bc-claim/types.ts \
        supabase/functions/bc-claim/payloadBuilder.ts \
        supabase/functions/bc-claim/payloadBuilder.test.ts
git commit -m "$(cat <<'EOF'
fix(bc): use correct "On Behalf" literal in payload builder + types

Compare against the actual DB value ("On Behalf" with space, capital B)
instead of "On_behalf". Without this, every on-behalf claim sent to BC
falls through to the submitter's employee_id/name instead of the
beneficiary's.

This is one of two locations where the wrong literal was used; the SQL
RPC fix lands in the next commit.
EOF
)"
```

---

## Task 3 — A2: write the enum migration

**Files:**

- Create: `supabase/migrations/20260520000000_claim_submission_type_enum.sql`

- [ ] **Step 1: Create the migration file with the full transactional script**

Create `supabase/migrations/20260520000000_claim_submission_type_enum.sql` with this exact content:

```sql
-- Convert claims.submission_type from text → enum so the vocabulary is
-- schema-enforced (TypeScript types narrow to "Self" | "On Behalf"), and
-- fix get_bc_claim_payload to compare against the correct literal.
--
-- Pre-migration audit (verified 2026-05-19):
--   distinct values in 4,529 rows: only 'Self' (3,400) and 'On Behalf' (1,129)
--   no NULLs, no whitespace anomalies, no indexes on submission_type
--   views referencing the column: vw_admin_claims_dashboard, vw_enterprise_claims_dashboard
--   CHECK constraints: claims_submission_type_check (simple IN), claims_on_behalf_fields (cross-field)
--   only get_bc_claim_payload uses the wrong 'On_behalf' literal

BEGIN;

-- 1. Drop dependent views (must drop before ALTER COLUMN TYPE).
DROP VIEW public.vw_admin_claims_dashboard;
DROP VIEW public.vw_enterprise_claims_dashboard;

-- 2. Drop CHECK constraints (will recreate with enum-aware comparisons).
ALTER TABLE public.claims DROP CONSTRAINT IF EXISTS claims_submission_type_check;
ALTER TABLE public.claims DROP CONSTRAINT IF EXISTS claims_on_behalf_fields;

-- 3. Create enum type.
CREATE TYPE public.claim_submission_type AS ENUM ('Self', 'On Behalf');

-- 4. Alter column type. Cast via text to enum; rows already match enum members.
ALTER TABLE public.claims
  ALTER COLUMN submission_type TYPE public.claim_submission_type
  USING submission_type::text::public.claim_submission_type;

-- 5. Recreate cross-field check using the enum.
ALTER TABLE public.claims ADD CONSTRAINT claims_on_behalf_fields CHECK (
  (
    submission_type = 'Self'::claim_submission_type
    AND COALESCE(on_behalf_email, 'N/A') = 'N/A'
    AND COALESCE(on_behalf_employee_code, 'N/A') = 'N/A'
    AND on_behalf_of_id = submitted_by
  )
  OR
  (
    submission_type = 'On Behalf'::claim_submission_type
    AND COALESCE(on_behalf_email, 'N/A') <> 'N/A'
    AND COALESCE(on_behalf_employee_code, 'N/A') <> 'N/A'
    AND on_behalf_of_id IS NOT NULL
  )
);

-- 6. Recreate vw_admin_claims_dashboard (definition captured verbatim from pg_get_viewdef()).
CREATE VIEW public.vw_admin_claims_dashboard AS
 SELECT c.id AS claim_id,
    COALESCE(NULLIF(TRIM(BOTH FROM u.full_name), ''::text), NULLIF(TRIM(BOTH FROM split_part(u.email, '@'::text, 1)), ''::text), NULLIF(TRIM(BOTH FROM c.employee_id), ''::text), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''::text), 'N/A'::text) AS employee_name,
    COALESCE(NULLIF(TRIM(BOTH FROM c.employee_id), ''::text), NULLIF(TRIM(BOTH FROM c.on_behalf_employee_code), ''::text), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''::text), NULLIF(TRIM(BOTH FROM u.email), ''::text), 'N/A'::text) AS employee_id,
    c.employee_id AS claim_employee_id_raw,
    c.on_behalf_employee_code AS on_behalf_employee_code_raw,
    NULLIF(TRIM(BOTH FROM u.full_name), ''::text) AS submitter_name_raw,
    NULLIF(TRIM(BOTH FROM beneficiary.full_name), ''::text) AS beneficiary_name_raw,
    COALESCE(NULLIF(TRIM(BOTH FROM md.name), ''::text), 'Unknown Department'::text) AS department_name,
    COALESCE(NULLIF(TRIM(BOTH FROM mpm.name), ''::text),
        CASE
            WHEN c.detail_type = 'advance'::text THEN 'Advance'::text
            WHEN c.detail_type = 'expense'::text THEN 'Expense'::text
            ELSE 'Unknown'::text
        END) AS type_of_claim,
    COALESCE(ed.total_amount, ad.total_amount, 0::numeric)::numeric(14,2) AS amount,
    c.status,
    COALESCE(c.submitted_at, c.created_at) AS submitted_on,
    COALESCE(c.hod_action_at,
        CASE
            WHEN c.status = 'HOD approved - Awaiting finance approval'::claim_status THEN c.updated_at
            WHEN (c.status = ANY (ARRAY['Rejected - Resubmission Not Allowed'::claim_status, 'Rejected - Resubmission Allowed'::claim_status])) AND c.assigned_l2_approver_id IS NULL THEN c.updated_at
            ELSE NULL::timestamp with time zone
        END) AS hod_action_date,
    COALESCE(c.finance_action_at,
        CASE
            WHEN c.status = ANY (ARRAY['Finance Approved - Payment under process'::claim_status, 'Payment Done - Closed'::claim_status]) THEN c.updated_at
            WHEN (c.status = ANY (ARRAY['Rejected - Resubmission Not Allowed'::claim_status, 'Rejected - Resubmission Allowed'::claim_status])) AND c.assigned_l2_approver_id IS NOT NULL THEN c.updated_at
            ELSE NULL::timestamp with time zone
        END) AS finance_action_date,
    COALESCE(ed.location_id, ad.location_id) AS location_id,
    COALESCE(ed.product_id, ad.product_id) AS product_id,
    ed.expense_category_id,
    c.submitted_by,
    c.on_behalf_of_id,
    c.on_behalf_email,
    c.assigned_l1_approver_id,
    c.assigned_l2_approver_id,
    c.department_id,
    c.payment_mode_id,
    c.detail_type,
    c.submission_type,
    c.is_active,
    c.created_at,
    c.updated_at,
    c.deleted_by,
    c.deleted_at,
    NULLIF(TRIM(BOTH FROM deleted_by_user.full_name), ''::text) AS deleted_by_name,
        CASE
            WHEN c.deleted_by IS NULL THEN NULL::text
            WHEN (EXISTS ( SELECT 1
               FROM admins a
              WHERE a.user_id = c.deleted_by)) THEN 'admin'::text
            WHEN (EXISTS ( SELECT 1
               FROM master_finance_approvers f
              WHERE f.user_id = c.deleted_by AND f.is_active = true)) THEN 'finance'::text
            ELSE 'employee'::text
        END AS deleted_by_role,
    u.email AS submitter_email,
    hod.email AS hod_email,
    finance.email AS finance_email,
        CASE
            WHEN NULLIF(TRIM(BOTH FROM u.full_name), ''::text) IS NOT NULL AND NULLIF(TRIM(BOTH FROM u.email), ''::text) IS NOT NULL THEN ((TRIM(BOTH FROM u.full_name) || ' ('::text) || TRIM(BOTH FROM u.email)) || ')'::text
            WHEN NULLIF(TRIM(BOTH FROM u.full_name), ''::text) IS NOT NULL THEN TRIM(BOTH FROM u.full_name)
            WHEN NULLIF(TRIM(BOTH FROM u.email), ''::text) IS NOT NULL THEN TRIM(BOTH FROM u.email)
            ELSE c.employee_id
        END AS submitter_label,
        CASE
            WHEN c.detail_type = 'expense'::text THEN COALESCE(NULLIF(TRIM(BOTH FROM mec_name.name), ''::text), 'Uncategorized'::text)
            ELSE 'Advance'::text
        END AS category_name,
    COALESCE(ed.purpose, ad.purpose) AS purpose,
    ed.receipt_file_path,
    ed.bank_statement_file_path,
    ad.supporting_document_path,
    c.bc_claim_details_id,
    COALESCE(bcd.is_vendor_payment, false) AS is_vendor_payment
   FROM claims c
     LEFT JOIN users u ON u.id = c.submitted_by
     LEFT JOIN users beneficiary ON beneficiary.id = c.on_behalf_of_id
     LEFT JOIN users hod ON hod.id = c.assigned_l1_approver_id
     LEFT JOIN users finance ON finance.id = c.assigned_l2_approver_id
     LEFT JOIN users deleted_by_user ON deleted_by_user.id = c.deleted_by
     LEFT JOIN master_departments md ON md.id = c.department_id
     LEFT JOIN master_payment_modes mpm ON mpm.id = c.payment_mode_id
     LEFT JOIN expense_details ed ON ed.claim_id = c.id
     LEFT JOIN master_expense_categories mec_name ON mec_name.id = ed.expense_category_id
     LEFT JOIN advance_details ad ON ad.claim_id = c.id
     LEFT JOIN bc_claim_details bcd ON bcd.claim_id = c.id;

-- 7. Recreate vw_enterprise_claims_dashboard (definition captured verbatim from pg_get_viewdef()).
CREATE VIEW public.vw_enterprise_claims_dashboard AS
 SELECT c.id AS claim_id,
    COALESCE(NULLIF(TRIM(BOTH FROM u.full_name), ''::text), NULLIF(TRIM(BOTH FROM split_part(u.email, '@'::text, 1)), ''::text), NULLIF(TRIM(BOTH FROM c.employee_id), ''::text), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''::text), 'N/A'::text) AS employee_name,
    COALESCE(NULLIF(TRIM(BOTH FROM c.employee_id), ''::text), NULLIF(TRIM(BOTH FROM c.on_behalf_employee_code), ''::text), NULLIF(TRIM(BOTH FROM c.on_behalf_email), ''::text), NULLIF(TRIM(BOTH FROM u.email), ''::text), 'N/A'::text) AS employee_id,
    c.employee_id AS claim_employee_id_raw,
    c.on_behalf_employee_code AS on_behalf_employee_code_raw,
    NULLIF(TRIM(BOTH FROM u.full_name), ''::text) AS submitter_name_raw,
    NULLIF(TRIM(BOTH FROM beneficiary.full_name), ''::text) AS beneficiary_name_raw,
    COALESCE(NULLIF(TRIM(BOTH FROM md.name), ''::text), 'Unknown Department'::text) AS department_name,
    COALESCE(NULLIF(TRIM(BOTH FROM mpm.name), ''::text),
        CASE
            WHEN c.detail_type = 'advance'::text THEN 'Advance'::text
            WHEN c.detail_type = 'expense'::text THEN 'Expense'::text
            ELSE 'Unknown'::text
        END) AS type_of_claim,
    COALESCE(ed.total_amount, ad.total_amount, 0::numeric)::numeric(14,2) AS amount,
    c.status,
    COALESCE(c.submitted_at, c.created_at) AS submitted_on,
    COALESCE(c.hod_action_at,
        CASE
            WHEN c.status = 'HOD approved - Awaiting finance approval'::claim_status THEN c.updated_at
            WHEN (c.status = ANY (ARRAY['Rejected - Resubmission Not Allowed'::claim_status, 'Rejected - Resubmission Allowed'::claim_status])) AND c.assigned_l2_approver_id IS NULL THEN c.updated_at
            ELSE NULL::timestamp with time zone
        END) AS hod_action_date,
    COALESCE(c.finance_action_at,
        CASE
            WHEN c.status = ANY (ARRAY['Finance Approved - Payment under process'::claim_status, 'Payment Done - Closed'::claim_status]) THEN c.updated_at
            WHEN (c.status = ANY (ARRAY['Rejected - Resubmission Not Allowed'::claim_status, 'Rejected - Resubmission Allowed'::claim_status])) AND c.assigned_l2_approver_id IS NOT NULL THEN c.updated_at
            ELSE NULL::timestamp with time zone
        END) AS finance_action_date,
    COALESCE(ed.location_id, ad.location_id) AS location_id,
    COALESCE(ed.product_id, ad.product_id) AS product_id,
    ed.expense_category_id,
    c.submitted_by,
    c.on_behalf_of_id,
    c.on_behalf_email,
    c.assigned_l1_approver_id,
    c.assigned_l2_approver_id,
    c.department_id,
    c.payment_mode_id,
    c.detail_type,
    c.submission_type,
    c.is_active,
    c.created_at,
    c.updated_at,
    u.email AS submitter_email,
    hod.email AS hod_email,
    finance.email AS finance_email,
        CASE
            WHEN NULLIF(TRIM(BOTH FROM u.full_name), ''::text) IS NOT NULL AND NULLIF(TRIM(BOTH FROM u.email), ''::text) IS NOT NULL THEN ((TRIM(BOTH FROM u.full_name) || ' ('::text) || TRIM(BOTH FROM u.email)) || ')'::text
            WHEN NULLIF(TRIM(BOTH FROM u.full_name), ''::text) IS NOT NULL THEN TRIM(BOTH FROM u.full_name)
            WHEN NULLIF(TRIM(BOTH FROM u.email), ''::text) IS NOT NULL THEN TRIM(BOTH FROM u.email)
            ELSE c.employee_id
        END AS submitter_label,
        CASE
            WHEN c.detail_type = 'expense'::text THEN COALESCE(NULLIF(TRIM(BOTH FROM mec_name.name), ''::text), 'Uncategorized'::text)
            ELSE 'Advance'::text
        END AS category_name,
    COALESCE(ed.purpose, ad.purpose) AS purpose,
    ed.receipt_file_path,
    ed.bank_statement_file_path,
    ad.supporting_document_path,
    c.bc_claim_details_id,
    COALESCE(bcd.is_vendor_payment, false) AS is_vendor_payment
   FROM claims c
     LEFT JOIN users u ON u.id = c.submitted_by
     LEFT JOIN users beneficiary ON beneficiary.id = c.on_behalf_of_id
     LEFT JOIN users hod ON hod.id = c.assigned_l1_approver_id
     LEFT JOIN users finance ON finance.id = c.assigned_l2_approver_id
     LEFT JOIN master_departments md ON md.id = c.department_id
     LEFT JOIN master_payment_modes mpm ON mpm.id = c.payment_mode_id
     LEFT JOIN expense_details ed ON ed.claim_id = c.id AND ed.is_active = true
     LEFT JOIN master_expense_categories mec_name ON mec_name.id = ed.expense_category_id
     LEFT JOIN advance_details ad ON ad.claim_id = c.id AND ad.is_active = true
     LEFT JOIN bc_claim_details bcd ON bcd.claim_id = c.id
  WHERE c.is_active = true;

-- 8. Recreate get_bc_claim_payload using the corrected literal.
--    All other parts of the function body are unchanged from migration 20260519140000.
CREATE OR REPLACE FUNCTION public.get_bc_claim_payload(p_claim_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_already_submitted_id UUID;
  v_payment_mode_name    TEXT;
  v_result               JSONB;
BEGIN
  SELECT c.bc_claim_details_id, mpm.name
    INTO v_already_submitted_id, v_payment_mode_name
  FROM public.claims c
  JOIN public.master_payment_modes mpm ON mpm.id = c.payment_mode_id
  WHERE c.id = p_claim_id AND c.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_NOT_FOUND: %', p_claim_id USING ERRCODE = 'P0001';
  END IF;

  IF v_already_submitted_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_SUBMITTED: %', v_already_submitted_id USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_build_object(
    'claim_id',                     c.id,
    'payment_mode_name',            v_payment_mode_name,
    'submission_type',              c.submission_type,
    'employee_id',                  c.employee_id,
    'on_behalf_employee_code',      c.on_behalf_employee_code,
    'employee_name',
      CASE WHEN c.submission_type = 'On Behalf'::claim_submission_type
           THEN COALESCE(onbehalf.full_name, '')
           ELSE COALESCE(submitter.full_name, '')
      END,
    'program_code',                 ppm.program_code,
    'sub_product_code',             spm.sub_product_code,
    'responsible_department_code',  drm.responsible_department_code,
    'beneficiary_department_code',  drm.beneficiary_department_code,
    'region_code',                  elm.region_code,
    'bill_no',                      ed.bill_no,
    'transaction_date',             ed.transaction_date,
    'purpose',                      ed.purpose,
    'receipt_file_path',            ed.receipt_file_path,
    'bank_statement_file_path',     ed.bank_statement_file_path,
    'bc_code',                      ecm.bc_code,
    'basic_amount',                 ed.basic_amount,
    'total_amount',                 ed.total_amount,
    'foreign_basic_amount',         COALESCE(ed.foreign_basic_amount, 0),
    'foreign_total_amount',         COALESCE(ed.foreign_total_amount, 0)
  )
  INTO v_result
  FROM public.claims c
  JOIN public.expense_details ed                    ON ed.claim_id = c.id AND ed.is_active = true
  JOIN public.users submitter                       ON submitter.id = c.submitted_by
  LEFT JOIN public.users onbehalf                   ON onbehalf.id = c.on_behalf_of_id
  JOIN public.expense_category_bc_mappings ecm      ON ecm.expense_category_id = ed.expense_category_id AND ecm.is_active = true
  JOIN LATERAL (
    SELECT program_code FROM public.master_program_product_mappings
    WHERE product_id = ed.product_id AND is_active = true LIMIT 1
  ) ppm ON true
  JOIN LATERAL (
    SELECT sub_product_code FROM public.master_sub_product_mappings
    WHERE product_id = ed.product_id AND is_active = true LIMIT 1
  ) spm ON true
  JOIN LATERAL (
    SELECT responsible_department_code, beneficiary_department_code
    FROM public.master_department_responsible_mappings
    WHERE department_id = c.department_id AND is_active = true LIMIT 1
  ) drm ON true
  JOIN LATERAL (
    SELECT region_code FROM public.master_expense_location_mappings
    WHERE location_id = ed.location_id AND is_active = true LIMIT 1
  ) elm ON true
  WHERE c.id = p_claim_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'MISSING_MAPPING: one or more required mappings missing for claim %', p_claim_id
      USING ERRCODE = 'P0003';
  END IF;

  RETURN v_result;
END;
$$;

COMMIT;
```

- [ ] **Step 2: Dry-run the migration against NxtClaimTest**

```bash
./node_modules/.bin/supabase db push --dry-run --linked
```

Expected output includes:

```
Would push these migrations:
 • 20260520000000_claim_submission_type_enum.sql
```

- [ ] **Step 3: Apply the migration**

```bash
./node_modules/.bin/supabase db push --linked
```

Expected: `Finished supabase db push.` with no errors.

- [ ] **Step 4: Verify the column type changed and the views are intact**

```bash
./node_modules/.bin/supabase --version  # just to confirm CLI is current
```

Then via the Supabase MCP (or psql), run:

```sql
SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) AS column_type
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'claims' AND a.attname = 'submission_type';
```

Expected: `claim_submission_type`.

```sql
SELECT c.relname FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('vw_admin_claims_dashboard', 'vw_enterprise_claims_dashboard');
```

Expected: both view names returned.

- [ ] **Step 5: Commit the migration**

```bash
git add supabase/migrations/20260520000000_claim_submission_type_enum.sql
git commit -m "$(cat <<'EOF'
feat(db): convert claims.submission_type to enum + fix RPC literal

CREATE TYPE claim_submission_type AS ENUM ('Self', 'On Behalf'), alter the
column to it, recreate the cross-field CHECK with enum-aware comparisons,
and fix get_bc_claim_payload to use the correct 'On Behalf' literal.

Dependent views (vw_admin_claims_dashboard, vw_enterprise_claims_dashboard)
are dropped and recreated verbatim around the ALTER COLUMN.

Validated on 4,529 rows in NxtClaimTest: only 'Self' and 'On Behalf'
present, no NULLs, no indexes on the column.
EOF
)"
```

---

## Task 4 — A2: deploy bc-claim and add an integration test for the RPC

**Files:**

- Create: `tests/integration/bc-claim-rpc.test.ts`

- [ ] **Step 1: Deploy the edge function**

```bash
./node_modules/.bin/supabase functions deploy bc-claim
```

Expected: `Deployed Functions on project pltbwxddxtsavygijcnl: bc-claim`.

- [ ] **Step 2: Write the integration test (RED — will fail today without test claim, then GREEN after fixture)**

Create `tests/integration/bc-claim-rpc.test.ts`:

```typescript
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, beforeAll } from "@jest/globals";

const projectUrl = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

const skip = !projectUrl || !serviceKey;

(skip ? describe.skip : describe)("get_bc_claim_payload (integration)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: SupabaseClient<any>;

  beforeAll(() => {
    client = createClient(projectUrl as string, serviceKey as string);
  });

  it("returns the beneficiary's name for an On Behalf claim", async () => {
    // Pick any active On Behalf claim that has not been BC-submitted yet.
    const { data: claims, error: pickErr } = await client
      .from("claims")
      .select("id, on_behalf_of_id, on_behalf_employee_code")
      .eq("submission_type", "On Behalf")
      .eq("is_active", true)
      .is("bc_claim_details_id", null)
      .limit(1);

    expect(pickErr).toBeNull();
    expect(claims && claims.length).toBeGreaterThan(0);
    const claim = claims![0] as {
      id: string;
      on_behalf_of_id: string;
      on_behalf_employee_code: string;
    };

    // Look up the beneficiary's full_name independently to compare against.
    const { data: bene, error: beneErr } = await client
      .from("users")
      .select("full_name")
      .eq("id", claim.on_behalf_of_id)
      .single();
    expect(beneErr).toBeNull();
    const expectedName = (bene as { full_name: string | null } | null)?.full_name ?? "";

    const { data: payload, error: rpcErr } = await client.rpc("get_bc_claim_payload", {
      p_claim_id: claim.id,
    });

    expect(rpcErr).toBeNull();
    // RPC returns JSONB; supabase-js parses it as object.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = payload as any;
    expect(p.submission_type).toBe("On Behalf");
    expect(p.employee_name).toBe(expectedName);
    // employee_id resolution happens in the edge fn (not the RPC), so we don't assert it here.
  });
});
```

- [ ] **Step 3: Run the integration test against NxtClaimTest**

```bash
SUPABASE_TEST_URL="<NxtClaimTest URL>" \
SUPABASE_TEST_SERVICE_ROLE_KEY="<service role key>" \
npx jest --config jest.integration.config.js tests/integration/bc-claim-rpc.test.ts 2>&1 | tail -20
```

If the project uses `npm run test:integration`, prefer:

```bash
SUPABASE_TEST_URL="..." SUPABASE_TEST_SERVICE_ROLE_KEY="..." npm run test:integration -- tests/integration/bc-claim-rpc.test.ts
```

Expected: PASS. If FAIL, inspect the RPC return shape — likely a stale deploy of the edge fn or the migration didn't apply.

- [ ] **Step 4: Commit the integration test**

```bash
git add tests/integration/bc-claim-rpc.test.ts
git commit -m "$(cat <<'EOF'
test(integration): get_bc_claim_payload returns beneficiary for On Behalf

Picks any active On Behalf claim not yet BC-submitted, looks up the
beneficiary's full_name independently, and asserts the RPC payload
returns that name in employee_name (not the submitter's).

This regression test would have caught the original 'On_behalf' literal
bug at CI time.
EOF
)"
```

---

## Task 5 — B1: write the unit test for the dept mapping guard (RED)

**Files:**

- Create: `tests/unit/lib/dept-mapping-guard.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/lib/dept-mapping-guard.test.ts`:

```typescript
import { describe, expect, it } from "@jest/globals";
import {
  findUnmappedActiveDepartmentNames,
  type DepartmentMappingRepo,
} from "@/lib/dept-mapping-guard";

function makeRepo(rows: { name: string }[]): DepartmentMappingRepo {
  return {
    findUnmappedActiveDepartments: async () => rows,
  };
}

describe("findUnmappedActiveDepartmentNames", () => {
  it("returns empty array when repo returns no unmapped departments", async () => {
    const repo = makeRepo([]);
    const result = await findUnmappedActiveDepartmentNames(repo);
    expect(result).toEqual([]);
  });

  it("returns sorted department names when repo returns unmapped rows", async () => {
    const repo = makeRepo([{ name: "Tech" }, { name: "Marketing" }, { name: "Content" }]);
    const result = await findUnmappedActiveDepartmentNames(repo);
    expect(result).toEqual(["Content", "Marketing", "Tech"]);
  });

  it("rethrows repo errors instead of swallowing them", async () => {
    const repo: DepartmentMappingRepo = {
      findUnmappedActiveDepartments: async () => {
        throw new Error("db unreachable");
      },
    };
    await expect(findUnmappedActiveDepartmentNames(repo)).rejects.toThrow("db unreachable");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails (module does not exist yet)**

```bash
npx jest tests/unit/lib/dept-mapping-guard.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/dept-mapping-guard'".

---

## Task 6 — B1: implement the guard module (GREEN)

**Files:**

- Create: `src/lib/dept-mapping-guard.ts`

- [ ] **Step 1: Implement the minimal module**

Create `src/lib/dept-mapping-guard.ts`:

```typescript
/**
 * Pure guard for the BC integration: an active department without an active
 * row in master_department_responsible_mappings will cause get_bc_claim_payload
 * to fail with MISSING_MAPPING (P0003) when a finance approver tries to submit
 * a claim from that department to BC.
 *
 * This module is the testable seam — it takes a minimal repo interface so
 * unit tests can mock it. The integration test wires it up to a real Supabase
 * client and asserts no unmapped active departments exist in NxtClaimTest.
 */

export interface DepartmentRow {
  name: string;
}

export interface DepartmentMappingRepo {
  findUnmappedActiveDepartments(): Promise<DepartmentRow[]>;
}

export async function findUnmappedActiveDepartmentNames(
  repo: DepartmentMappingRepo,
): Promise<string[]> {
  const rows = await repo.findUnmappedActiveDepartments();
  return rows.map((r) => r.name).sort();
}
```

- [ ] **Step 2: Run the unit test and confirm GREEN**

```bash
npx jest tests/unit/lib/dept-mapping-guard.test.ts
```

Expected: 3 tests pass.

---

## Task 7 — B1: write the integration test (RED today, GREEN once ops backfills)

**Files:**

- Create: `tests/integration/department-mapping-completeness.test.ts`

- [ ] **Step 1: Write the integration test**

Create `tests/integration/department-mapping-completeness.test.ts`:

```typescript
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, beforeAll } from "@jest/globals";
import {
  findUnmappedActiveDepartmentNames,
  type DepartmentMappingRepo,
} from "@/lib/dept-mapping-guard";

const projectUrl = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const skip = !projectUrl || !serviceKey;

function makeSupabaseRepo(client: SupabaseClient): DepartmentMappingRepo {
  return {
    async findUnmappedActiveDepartments() {
      // LEFT JOIN to find active departments with no active responsible-mapping row.
      // Done as two queries because PostgREST doesn't expose anti-joins directly.
      const { data: mapped, error: mappedErr } = await client
        .from("master_department_responsible_mappings")
        .select("department_id")
        .eq("is_active", true);
      if (mappedErr) throw new Error(mappedErr.message);
      const mappedIds = new Set((mapped ?? []).map((r) => r.department_id as string));

      const { data: allActive, error: deptErr } = await client
        .from("master_departments")
        .select("id, name")
        .eq("is_active", true);
      if (deptErr) throw new Error(deptErr.message);

      return (allActive ?? [])
        .filter((d) => !mappedIds.has(d.id as string))
        .map((d) => ({ name: d.name as string }));
    },
  };
}

(skip ? describe.skip : describe)("department mapping completeness (integration)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: SupabaseClient<any>;

  beforeAll(() => {
    client = createClient(projectUrl as string, serviceKey as string);
  });

  it("every active department has an active BC mapping", async () => {
    const repo = makeSupabaseRepo(client);
    const unmapped = await findUnmappedActiveDepartmentNames(repo);
    expect(unmapped).toEqual([]); // If this fails, ops needs to backfill the listed departments.
  });
});
```

- [ ] **Step 2: Run the integration test (will fail RED today with 9 unmapped depts)**

```bash
SUPABASE_TEST_URL="<NxtClaimTest URL>" \
SUPABASE_TEST_SERVICE_ROLE_KEY="<service role key>" \
npm run test:integration -- tests/integration/department-mapping-completeness.test.ts 2>&1 | tail -30
```

Expected: FAIL, with the array of 9 department names in the diff. This is intentional and the desired state — failure is the CI signal for ops.

- [ ] **Step 3: Run the unit test suite to confirm no regressions**

```bash
npm run test:unit 2>&1 | tail -5
```

Expected: all suites pass (count = previous + 1).

- [ ] **Step 4: Commit guard + tests**

```bash
git add src/lib/dept-mapping-guard.ts \
        tests/unit/lib/dept-mapping-guard.test.ts \
        tests/integration/department-mapping-completeness.test.ts
git commit -m "$(cat <<'EOF'
test(claims): guard active departments have BC responsible mappings

Adds a pure guard module + unit test (mocked repo) + integration test
(real test DB). The integration test fails red until ops backfills the
9 currently-unmapped active departments — surfaces drift on every CI
integration run.
EOF
)"
```

---

## Task 8 — C: extend bc-reference to accept ?query= for HSN (RED)

**Files:**

- Modify: `supabase/functions/bc-reference/index.test.ts`

- [ ] **Step 1: Add failing Deno tests for the new query behavior**

Append to `supabase/functions/bc-reference/index.test.ts`:

```typescript
Deno.test("bc-reference — hsnSacCodes with no query returns first 20", async () => {
  setup();
  let capturedPath = "";
  __setBcFetchImpl(async (_kind, _method, path) => {
    capturedPath = path;
    return new Response(JSON.stringify({ value: [{ Code: "996", Description: "Services" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    const res = await handler(makeReq("hsnSacCodes"));
    assertEquals(res.status, 200);
    // Must include $top=20 and must NOT include $filter when no query was provided.
    assertEquals(capturedPath.includes("$top=20"), true);
    assertEquals(capturedPath.includes("$filter="), false);
  } finally {
    teardown();
  }
});

Deno.test(
  "bc-reference — hsnSacCodes with ?query=996 sends contains() filter OR-ed across case variants",
  async () => {
    setup();
    let capturedPath = "";
    __setBcFetchImpl(async (_kind, _method, path) => {
      capturedPath = path;
      return new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    try {
      const req = new Request("http://localhost/bc-reference?type=hsnSacCodes&query=996", {
        method: "GET",
      });
      const res = await handler(req);
      assertEquals(res.status, 200);
      // Expect $top=20, an encoded $filter, and contains() on Code or Description.
      assertEquals(capturedPath.includes("$top=20"), true);
      assertEquals(capturedPath.includes("%24filter="), true);
      // The filter expression (decoded) must mention contains on both Code and Description.
      const decoded = decodeURIComponent(capturedPath);
      assertEquals(decoded.includes("contains(Code,'996')"), true);
      assertEquals(decoded.includes("contains(Description,'996')"), true);
    } finally {
      teardown();
    }
  },
);

Deno.test("bc-reference — currencies ignores ?query= (full list always)", async () => {
  setup();
  let capturedPath = "";
  __setBcFetchImpl(async (_kind, _method, path) => {
    capturedPath = path;
    return new Response(JSON.stringify({ value: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  try {
    const req = new Request("http://localhost/bc-reference?type=currencies&query=USD", {
      method: "GET",
    });
    const res = await handler(req);
    assertEquals(res.status, 200);
    assertEquals(capturedPath.includes("$filter="), false);
    assertEquals(capturedPath.includes("$top="), false);
  } finally {
    teardown();
  }
});
```

- [ ] **Step 2: Run deno tests and confirm RED**

```bash
cd supabase/functions
deno test --allow-env --allow-read bc-reference/index.test.ts
```

Expected: the three new tests fail because the handler currently ignores `query` and doesn't set `$top` for any type.

---

## Task 9 — C: implement HSN query + $top=20 in bc-reference (GREEN)

**Files:**

- Modify: `supabase/functions/bc-reference/index.ts`

- [ ] **Step 1: Update the handler to accept ?query= and $top=20 for hsnSacCodes only**

In `supabase/functions/bc-reference/index.ts`, replace the body of the `handler` function from the `const url = new URL(req.url);` line onwards down to where `path` is constructed.

Replace:

```typescript
const url = new URL(req.url);
const type = url.searchParams.get("type") ?? "";

const entity = ENTITY_MAP[type];
if (!entity) {
  return json(cors.headers, { error: "UNKNOWN_TYPE", type, allowed: Object.keys(ENTITY_MAP) }, 400);
}

const cached = cache.get(type);
if (cached && cached.expiresAt > Date.now()) {
  log("bc-reference", "info", "cache_hit", { type });
  return json(cors.headers, cached.body, 200);
}

const path = `/${entity}?$select=Code,Description`;
```

With:

```typescript
const url = new URL(req.url);
const type = url.searchParams.get("type") ?? "";

const entity = ENTITY_MAP[type];
if (!entity) {
  return json(cors.headers, { error: "UNKNOWN_TYPE", type, allowed: Object.keys(ENTITY_MAP) }, 400);
}

// HSN/SAC alone supports an optional ?query= for search-as-you-type, since
// BC can hold 10k+ codes; currencies (~150) and GST groups (~30) always
// return the full list (small + rarely changes + worth caching in full).
const query = type === "hsnSacCodes" ? (url.searchParams.get("query") ?? "").trim() : "";

// Cache key includes the query so different searches don't poison each other.
const cacheKey = type === "hsnSacCodes" ? `${type}::${query}` : type;
const cached = cache.get(cacheKey);
if (cached && cached.expiresAt > Date.now()) {
  log("bc-reference", "info", "cache_hit", { type, query: query || undefined });
  return json(cors.headers, cached.body, 200);
}

let path = `/${entity}?$select=Code,Description`;
if (type === "hsnSacCodes") {
  path += "&$top=20";
  if (query) {
    // BC's contains(tolower(field), value) is unreliable; OR across case
    // variants instead (same workaround as bc-vendor-search).
    const variants = Array.from(
      new Set([
        query,
        query.toLowerCase(),
        query.toUpperCase(),
        query.charAt(0).toUpperCase() + query.slice(1).toLowerCase(),
      ]),
    ).map((v) => v.replace(/'/g, "''"));
    const filter = variants
      .map((v) => `(contains(Code,'${v}') or contains(Description,'${v}'))`)
      .join(" or ");
    path += `&$filter=${encodeURIComponent(filter)}`;
  }
}
```

Also find the `cache.set(type, ...)` line near the end of the handler and change it to use `cacheKey`:

```typescript
cache.set(cacheKey, { body: mapped, expiresAt: Date.now() + CACHE_TTL_MS });
```

- [ ] **Step 2: Run all bc-reference deno tests and confirm GREEN**

```bash
cd supabase/functions
deno test --allow-env --allow-read bc-reference/index.test.ts
```

Expected: all tests pass (previous tests still pass + 3 new ones pass).

- [ ] **Step 3: Deploy bc-reference**

```bash
cd /Users/arjun/Documents/NxtClaimV2
./node_modules/.bin/supabase functions deploy bc-reference
```

Expected: `Deployed Functions on project pltbwxddxtsavygijcnl: bc-reference`.

- [ ] **Step 4: Smoke-test the deployed endpoint**

Via curl with a logged-in user JWT (grab one from the app):

```bash
curl -s 'https://pltbwxddxtsavygijcnl.supabase.co/functions/v1/bc-reference?type=hsnSacCodes&query=996' \
     -H "Authorization: Bearer <JWT>" | head -c 500
```

Expected: JSON with `{ "value": [{ "code": "...", "description": "..." }, ...] }`, ≤20 entries, all containing "996" in Code or Description.

- [ ] **Step 5: Commit edge fn changes**

```bash
git add supabase/functions/bc-reference/index.ts \
        supabase/functions/bc-reference/index.test.ts
git commit -m "$(cat <<'EOF'
feat(bc-reference): hsnSacCodes supports ?query= for search-as-you-type

Adds $top=20 + an optional contains() filter (OR-ed across case variants,
matching the bc-vendor-search workaround for BC's flaky tolower()). Cache
key now includes the query string so different searches don't poison
each other. Currencies + GST groups still return the full list.

BC's HSN/SAC table can hold 10k+ rows; the previous full-list fetch made
the first dropdown open slow and risked OData payload limits.
EOF
)"
```

---

## Task 10 — C: wire HSN debounced search in bc-claim-modal (frontend)

**Files:**

- Modify: `src/modules/claims/ui/bc-claim-modal.tsx`

- [ ] **Step 1: Extend the fetchReference helper to accept a `params` arg**

In `src/modules/claims/ui/bc-claim-modal.tsx`, around line 96–126, replace the `fetchReference` callback signature and body to forward optional query params:

```typescript
const fetchReference = useCallback(
  async (
    type: ReferenceType,
    setter: (s: ReferenceState) => void,
    params?: Record<string, string>,
  ) => {
    setter({ status: "loading" });
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const search = new URLSearchParams({ type, ...(params ?? {}) }).toString();
      const url = `${supabaseUrl}/functions/v1/bc-reference?${search}`;
      const res = await fetch(url, {
        method: "GET",
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as Record<string, unknown>);
        const message =
          typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : `Failed to load (HTTP ${res.status})`;
        setter({ status: "error", message });
        return;
      }
      const parsed = (await res.json()) as { value: ReferenceOption[] };
      setter({ status: "loaded", options: parsed.value ?? [] });
    } catch (err) {
      setter({
        status: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  },
  [supabase],
);
```

- [ ] **Step 2: Stop pre-fetching HSN on vendor toggle; add HSN search state + debounced effect**

Find the `useEffect` near line 129 that pre-fetches reference data:

```typescript
useEffect(() => {
  if (paymentType !== "vendor") return;
  if (currencies.status === "idle") void fetchReference("currencies", setCurrencies);
  if (gstGroups.status === "idle") void fetchReference("gstGroupCodes", setGstGroups);
  if (hsnSacs.status === "idle") void fetchReference("hsnSacCodes", setHsnSacs);
}, [paymentType, currencies.status, gstGroups.status, hsnSacs.status, fetchReference]);
```

Replace with (drop the HSN pre-fetch line):

```typescript
useEffect(() => {
  if (paymentType !== "vendor") return;
  if (currencies.status === "idle") void fetchReference("currencies", setCurrencies);
  if (gstGroups.status === "idle") void fetchReference("gstGroupCodes", setGstGroups);
}, [paymentType, currencies.status, gstGroups.status, fetchReference]);
```

Add a debounced query state for HSN. Near the other state declarations at the top of the component (find `const [hsnSacs, setHsnSacs]` and add right after):

```typescript
const [hsnQuery, setHsnQuery] = useState("");
const debouncedHsnQuery = useDebouncedValue(hsnQuery, 300);
```

If `useDebouncedValue` isn't already imported at the top of the file (it's used by vendor search a few lines down), confirm its import — it should already be present. If not, mirror the vendor-search import.

Add a new effect that fires HSN fetches as the debounced query changes (place after the existing vendor-search effect around line 142):

```typescript
useEffect(() => {
  if (paymentType !== "vendor") return;
  const q = debouncedHsnQuery.trim();
  if (q.length === 0) {
    setHsnSacs({ status: "idle" });
    return;
  }
  void fetchReference("hsnSacCodes", setHsnSacs, { query: q });
}, [paymentType, debouncedHsnQuery, fetchReference]);
```

- [ ] **Step 3: Wire the HSN combobox UI to setHsnQuery and show helper text for empty query**

Find the HSN combobox / select around line 363 (search for `"hsnSacCodes"` to locate it). Wherever the HSN dropdown input is rendered, ensure:

- A search `<input>` field updates `hsnQuery` via `onChange={(e) => setHsnQuery(e.target.value)}`.
- When `hsnSacs.status === "idle"`, render helper text "Type to search HSN/SAC codes" instead of an empty results list.
- The retry callback at line 389 changes from `fetchReference("hsnSacCodes", setHsnSacs)` to `fetchReference("hsnSacCodes", setHsnSacs, { query: debouncedHsnQuery })` (only meaningful when query non-empty; otherwise leave the retry disabled).

The exact JSX change depends on the existing combobox component; preserve all other props and styling.

- [ ] **Step 4: Run app unit tests to catch any type or import regressions**

```bash
npm run test:unit 2>&1 | tail -5
```

Expected: all suites pass.

- [ ] **Step 5: Manual smoke test (optional but recommended)**

Start the dev server:

```bash
npm run dev
```

Open a finance-approver session, open the BC modal for an active claim, toggle Vendor on, scroll to the HSN/SAC field. Confirm:

- HSN list does NOT auto-load on toggle (network tab: no `/functions/v1/bc-reference?type=hsnSacCodes` request fires).
- Typing "996" → 300ms debounce → one request fires with `?query=996` → results render.
- Clearing the input → results clear, helper text returns.

- [ ] **Step 6: Commit frontend changes**

```bash
git add src/modules/claims/ui/bc-claim-modal.tsx
git commit -m "$(cat <<'EOF'
feat(bc-modal): HSN/SAC switches to debounced search-as-you-type

Stops pre-fetching the full HSN list on vendor toggle. Adds a 300ms
debounced query → ?query= against the updated bc-reference edge fn.
Empty query renders "Type to search HSN/SAC codes" helper text instead
of an empty dropdown. Mirrors the existing vendor-search pattern in
this same file.

Currencies + GST groups still pre-fetch as before (small, cacheable).
EOF
)"
```

---

## Task 11 — final verification + push

**Files:** none (verification + push only)

- [ ] **Step 1: Run the full app unit-test suite**

```bash
npm run test:unit 2>&1 | tail -5
```

Expected: all suites pass.

- [ ] **Step 2: Run the deno test suite**

```bash
cd supabase/functions
deno test --allow-env --allow-read bc-claim/payloadBuilder.test.ts bc-reference/index.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Confirm migration + edge functions are live**

Via the Supabase MCP (or psql), inspect the deployed RPC:

```sql
SELECT pg_get_functiondef(oid) ILIKE '%''On Behalf''::claim_submission_type%' AS uses_correct_literal
FROM pg_proc WHERE proname = 'get_bc_claim_payload' AND pronamespace = 'public'::regnamespace;
```

Expected: `uses_correct_literal = true`.

- [ ] **Step 4: Verify branch state and push**

```bash
git status                  # working tree should be clean
git log --oneline -8        # should show 6 new commits since the start of this plan
git push origin bc_int      # NO MERGE — push the feature branch only
```

Expected: `bc_int -> bc_int` push success. Do NOT merge into `development` or `main` (user instruction).

- [ ] **Step 5: Final smoke test in NxtClaimTest**

Pick one active On Behalf claim from the UI (use the dashboard filter `submission_type=On Behalf`). As a finance approver, run it through BC submission. Verify in `bc_claim_details` that `bc_payload_json->>'employeeId'` is the beneficiary's code (NOT the submitter's).

---

## Self-review checklist (run before handing off)

1. **Spec coverage:**
   - A2 migration → Task 3 ✓
   - A2 TS string fix → Tasks 1, 2 ✓
   - A2 RPC fix → Task 3 ✓
   - A2 integration test → Task 4 ✓
   - A2 deploy → Task 4 ✓
   - B1 unit test → Task 5 ✓
   - B1 guard module → Task 6 ✓
   - B1 integration test → Task 7 ✓
   - C edge fn (HSN query) → Tasks 8, 9 ✓
   - C edge fn deploy → Task 9 ✓
   - C frontend wiring → Task 10 ✓
   - Final push (no merge) → Task 11 ✓
2. **No placeholders:** every step has exact code, paths, commands, or git messages.
3. **Type consistency:** `findUnmappedActiveDepartmentNames`, `DepartmentMappingRepo`, `DepartmentRow` used consistently across Tasks 5–7; `fetchReference` signature consistent in Task 10.
