CREATE INDEX IF NOT EXISTS idx_claim_audit_logs_assigned_to_id ON public.claim_audit_logs USING btree (assigned_to_id, created_at DESC);
