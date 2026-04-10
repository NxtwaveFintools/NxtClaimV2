CREATE INDEX IF NOT EXISTS idx_claims_assigned_l2_approver_id ON public.claims USING btree (assigned_l2_approver_id);
