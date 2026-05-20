-- Migration: expense_details_foreign_currency
-- Adds foreign-currency support to expense_details.
-- DB-only scope: no RPC changes, no application code changes.
-- See: docs/superpowers/specs/2026-05-18-expense-details-foreign-currency-design.md

-- ─────────────────────────────────────────────────────────────
-- Step 1: Pre-flight assertion — refuse to migrate if data is dirty.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad_count INT;
BEGIN
  SELECT count(*) INTO v_bad_count
  FROM public.expense_details
  WHERE currency_code IS NULL OR currency_code <> 'INR';

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to migrate: % rows have currency_code that is NULL or not ''INR''. Clean up first.',
      v_bad_count;
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────
-- Step 2: Create enums (idempotent — fresh installs may already have them
--         from prior partial runs; remote already has them applied).
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE public.local_currency_code AS ENUM ('INR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.foreign_currency_code AS ENUM ('INR', 'USD', 'EUR', 'CHF');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────
-- Step 3: Tighten existing currency_code TEXT → local_currency_code enum.
--   ALTER TYPE with USING requires the default to be dropped first
--   (because the existing 'INR'::text default isn't directly castable),
--   then restored as the new type.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_details
  ALTER COLUMN currency_code DROP DEFAULT;

ALTER TABLE public.expense_details
  ALTER COLUMN currency_code TYPE public.local_currency_code
  USING currency_code::public.local_currency_code;

ALTER TABLE public.expense_details
  ALTER COLUMN currency_code SET DEFAULT 'INR'::public.local_currency_code;

-- ─────────────────────────────────────────────────────────────
-- Step 4: Add new foreign_* columns with defaults so existing rows
--         satisfy NOT NULL during ADD COLUMN. Defaults persist
--         after the migration — new INSERTs that omit these columns
--         will get 0 / 0 / 'INR' (intentional for this phase).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_details
  ADD COLUMN foreign_basic_amount   NUMERIC(14,2)                NOT NULL DEFAULT 0,
  ADD COLUMN foreign_gst_amount     NUMERIC(14,2)                NOT NULL DEFAULT 0,
  ADD COLUMN foreign_currency_code  public.foreign_currency_code NOT NULL DEFAULT 'INR'::public.foreign_currency_code;

-- ─────────────────────────────────────────────────────────────
-- Step 5: One-time backfill — historical rows get foreign side mirroring INR.
--         This UPDATE runs ONCE during migration. After it, the two sides
--         are independent at the DB level (no trigger, no constraint).
-- ─────────────────────────────────────────────────────────────
UPDATE public.expense_details
SET foreign_basic_amount  = basic_amount,
    foreign_gst_amount    = cgst_amount + sgst_amount + igst_amount,
    foreign_currency_code = 'INR'::public.foreign_currency_code;

-- ─────────────────────────────────────────────────────────────
-- Step 6: CHECK constraint on foreign_gst_amount (>= 0).
--         No CHECK on foreign_basic_amount in this phase — would conflict
--         with the DEFAULT 0 that new INSERTs rely on.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_details
  ADD CONSTRAINT expense_details_foreign_gst_nonneg_check
  CHECK (foreign_gst_amount >= 0);

-- ─────────────────────────────────────────────────────────────
-- Step 7: Add foreign_total_amount as a GENERATED STORED column.
--         Postgres maintains this automatically — callers must NOT
--         write to it.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.expense_details
  ADD COLUMN foreign_total_amount NUMERIC(14,2)
    GENERATED ALWAYS AS (foreign_basic_amount + foreign_gst_amount) STORED;
