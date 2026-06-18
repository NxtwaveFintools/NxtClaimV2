-- Migration: fix_normalize_invoice_sentinels
-- normalize_invoice_no() (added in 20260617160000) checked sentinels on the RAW value
-- BEFORE stripping punctuation, so values like "N\A" (backslash), "N.A.", "n a" slipped
-- through and were treated as the fake invoice "NA" — producing false invoice_match
-- duplicate flags at finance review.
--
-- Fix: strip to alphanumerics FIRST, then map known "no invoice" tokens to NULL. This makes
-- every punctuation variant of NA/NIL/NONE/NULL collapse to NULL (= no invoice number).
--
-- The function is IMMUTABLE and backs the expression index idx_expense_details_norm_invoice,
-- which caches the OLD normalized values. Postgres will not refresh those on its own (it
-- trusts the IMMUTABLE contract), so the index MUST be rebuilt after the body changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_invoice_no(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN regexp_replace(upper(p_value), '[^A-Z0-9]', '', 'g')
         IN ('', 'NA', 'NIL', 'NONE', 'NULL', 'NAN') THEN NULL
    ELSE regexp_replace(upper(p_value), '[^A-Z0-9]', '', 'g')
  END;
$$;

ALTER FUNCTION public.normalize_invoice_no(text) OWNER TO postgres;

-- Rebuild the cached expression index so stored keys reflect the corrected normalization.
REINDEX INDEX public.idx_expense_details_norm_invoice;

COMMIT;
