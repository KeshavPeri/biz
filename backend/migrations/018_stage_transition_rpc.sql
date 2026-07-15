-- ============================================================
-- 018_stage_transition_rpc.sql
-- Phase 9 (Deal Engine) — task 9.8: atomic stage-transition apply.
--
-- The stage machine's *validation* lives in the FastAPI engine
-- (services/stage_engine.py). This function is the final APPLY step: it performs
-- the stage change, the transition-log row, and the audit row as ONE atomic unit
-- (a plpgsql function body runs in a single transaction), so a failure can never
-- leave a stage change with no log row.
--
-- It also closes the concurrency hole: the UPDATE is CONDITIONAL on the deal
-- still being in the expected `from` stage. If two transitions race, only the
-- first matches (RETURN true); the second sees 0 rows and RETURNS false, which
-- the engine maps to HTTP 409 — no double-apply.
--
-- Params are text and cast to the enums inside, to avoid PostgREST enum-binding
-- quirks when invoked via the service_role client's .rpc().
--
-- SECURITY: 013_grants auto-grants EXECUTE on new public routines to
-- anon/authenticated. That MUST be revoked here — otherwise a signed-in user
-- could call this directly and force arbitrary stage changes, bypassing every
-- guard in the engine. Only service_role (backend) may execute it.
-- ============================================================

CREATE OR REPLACE FUNCTION apply_stage_transition(
    p_deal_id         uuid,
    p_from_stage      text,
    p_to_stage        text,
    p_transition_type text,   -- 'auto' | 'gated'
    p_triggered_by    uuid,
    p_clear_expiry    boolean,
    p_audit_action    text,   -- NULL = do not write an audit row
    p_audit_actor     uuid,
    p_audit_metadata  jsonb,
    p_audit_ip        text
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    v_count integer;
BEGIN
    -- Conditional, forward-only apply: only moves the deal if it is STILL in the
    -- stage the engine validated against (guards concurrent double-transitions).
    UPDATE deals
       SET stage      = p_to_stage::deal_stage_enum,
           expires_at = CASE WHEN p_clear_expiry THEN NULL ELSE expires_at END,
           updated_at = now()
     WHERE id = p_deal_id
       AND stage = p_from_stage::deal_stage_enum
       AND deleted_at IS NULL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count = 0 THEN
        RETURN false;  -- already moved / not in the expected stage → engine → 409
    END IF;

    -- Append-only transition log (never skipped: same transaction as the UPDATE).
    INSERT INTO deal_stage_transitions (deal_id, from_stage, to_stage, transition_type, triggered_by)
    VALUES (
        p_deal_id,
        p_from_stage::deal_stage_enum,
        p_to_stage::deal_stage_enum,
        p_transition_type::transition_type_enum,
        p_triggered_by
    );

    -- Immutable audit row for the stage advance (rbac.md).
    IF p_audit_action IS NOT NULL THEN
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (p_audit_actor, p_audit_action, 'deal', p_deal_id, p_audit_metadata, p_audit_ip);
    END IF;

    RETURN true;
END;
$$;

-- Lock it to the backend only. REVOKE the auto-grant from 013, keep service_role.
REVOKE ALL ON FUNCTION apply_stage_transition(
    uuid, text, text, text, uuid, boolean, text, uuid, jsonb, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION apply_stage_transition(
    uuid, text, text, text, uuid, boolean, text, uuid, jsonb, text
) TO service_role;
