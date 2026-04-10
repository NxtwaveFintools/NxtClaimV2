CREATE INDEX IF NOT EXISTS idx_expense_details_product_id ON public.expense_details USING btree (product_id);
