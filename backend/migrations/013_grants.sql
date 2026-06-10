-- ============================================================
-- 013_grants.sql
-- Standard Supabase role grants on the public schema.
--
-- Supabase normally pre-configures these via ALTER DEFAULT PRIVILEGES on the
-- `postgres` role, so every new table in `public` is automatically usable by
-- anon/authenticated/service_role. That default appears to be missing on this
-- project, so 001-012 created tables with no grants at all — even
-- service_role got "permission denied for table X" (42501).
--
-- These grants are table-level only; RLS (012) remains the real lock for
-- anon/authenticated. service_role bypasses RLS by role attribute, but still
-- needs the table-level grant to be allowed in at all.
-- ============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
