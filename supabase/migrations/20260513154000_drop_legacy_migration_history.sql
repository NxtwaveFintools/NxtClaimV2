-- The custom migration runner (scripts/run-migrations.mjs) and its
-- bookkeeping table public._migration_history are no longer used.
-- The team switched to Supabase CLI's supabase_migrations.schema_migrations
-- as the canonical migration tracker in late April 2026.
--
-- This migration retires the legacy table so fresh DBs don't carry it
-- forward. The 33 historical entries (March 2026 migrations) are not
-- migrated to the new tracker; their effect is already captured in the
-- DB schema itself.

DROP TABLE IF EXISTS public._migration_history;
