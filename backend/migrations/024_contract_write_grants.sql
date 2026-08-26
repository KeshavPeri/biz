-- ============================================================
-- 024_contract_write_grants.sql
-- Phase 9.12 defence in depth: signature use and maker-checker request/decision
-- are audited FastAPI actions. Authenticated clients may read the safe columns
-- granted by migration 023, but cannot bypass those services with direct writes.
-- ============================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON contract_signatures FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON maker_checker_requests FROM PUBLIC, anon, authenticated;

-- Keep the backend's full access explicit after narrowing client grants.
GRANT ALL ON contract_signatures, maker_checker_requests TO service_role;
