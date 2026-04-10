CREATE INDEX IF NOT EXISTS idx_claims_status_approver_submitted ON public.claims USING btree (status, assigned_l1_approver_id, submitted_at DESC) WHERE is_active = true;
