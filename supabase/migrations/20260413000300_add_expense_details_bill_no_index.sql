-- Add concurrent btree index for bill number filtering on expense details.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expense_details_bill_no
  ON public.expense_details USING btree (bill_no);

-- Rollback (manual):
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_expense_details_bill_no;
