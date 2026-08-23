-- ============================================================
-- 019_summary_gate.sql
-- Phase 9 tasks 9.9 + 9.10: persisted Chatting checklist overrides and
-- Gate A (two-side summary trigger). The original schema had no home for this
-- specified state: term_approvals is intentionally reserved for Gate B and an
-- ai_summaries row must not exist before parser output exists.
--
-- This brings the public table count from 42 to 43. The table is service-only:
-- FastAPI enforces participation/RBAC and calls the atomic routines below.
-- ============================================================

CREATE TABLE deal_summary_gates (
    deal_id                 uuid PRIMARY KEY REFERENCES deals(id) ON DELETE CASCADE,
    request_status          text NOT NULL DEFAULT 'idle'
                            CHECK (request_status IN ('idle', 'awaiting_confirmation', 'ready_for_generation')),
    requested_by            uuid REFERENCES profiles(id) ON DELETE RESTRICT,
    requester_side          text CHECK (requester_side IN ('creator', 'brand')),
    requested_at            timestamptz,
    confirmed_by            uuid REFERENCES profiles(id) ON DELETE RESTRICT,
    confirmed_at            timestamptz,
    generation_requested_at timestamptz,
    manual_overrides        jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (request_status = 'idle' AND requested_by IS NULL AND requester_side IS NULL
         AND requested_at IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL
         AND generation_requested_at IS NULL)
        OR request_status <> 'idle'
    )
);

ALTER TABLE deal_summary_gates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE deal_summary_gates FROM PUBLIC, anon, authenticated;
GRANT ALL ON deal_summary_gates TO service_role;

-- A row lock makes concurrent double taps deterministic. The service has already
-- checked role, side and field validity; these routines own only atomic state +
-- immutable audit history.
CREATE OR REPLACE FUNCTION apply_summary_gate_action(
    p_deal_id uuid,
    p_action text,
    p_actor_id uuid,
    p_actor_side text,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_gate deal_summary_gates%ROWTYPE;
BEGIN
    INSERT INTO deal_summary_gates (deal_id)
    VALUES (p_deal_id)
    ON CONFLICT (deal_id) DO NOTHING;

    SELECT * INTO v_gate FROM deal_summary_gates WHERE deal_id = p_deal_id FOR UPDATE;

    IF p_action = 'request' THEN
        IF v_gate.request_status = 'idle' THEN
            UPDATE deal_summary_gates
               SET request_status = 'awaiting_confirmation', requested_by = p_actor_id,
                   requester_side = p_actor_side, requested_at = now(), updated_at = now()
             WHERE deal_id = p_deal_id;
            INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
            VALUES (p_actor_id, 'summary_request_proposed', 'deal', p_deal_id,
                    jsonb_build_object('side', p_actor_side), p_ip_address);
            RETURN jsonb_build_object('outcome', 'requested');
        ELSIF v_gate.request_status = 'awaiting_confirmation'
              AND v_gate.requested_by = p_actor_id THEN
            RETURN jsonb_build_object('outcome', 'already_requested');
        END IF;
        RETURN jsonb_build_object('outcome', 'request_exists', 'requester_side', v_gate.requester_side);
    ELSIF p_action = 'confirm' THEN
        IF v_gate.request_status = 'ready_for_generation' THEN
            RETURN jsonb_build_object('outcome', 'already_confirmed', 'invoke_ai', false);
        ELSIF v_gate.request_status <> 'awaiting_confirmation' THEN
            RETURN jsonb_build_object('outcome', 'nothing_to_confirm');
        END IF;
        IF v_gate.requester_side = p_actor_side THEN
            RETURN jsonb_build_object('outcome', 'same_side');
        END IF;
        UPDATE deal_summary_gates
           SET request_status = 'ready_for_generation', confirmed_by = p_actor_id,
               confirmed_at = now(), generation_requested_at = now(), updated_at = now()
         WHERE deal_id = p_deal_id;
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (p_actor_id, 'summary_request_confirmed', 'deal', p_deal_id,
                jsonb_build_object('requested_by', v_gate.requested_by, 'requester_side', v_gate.requester_side), p_ip_address);
        RETURN jsonb_build_object('outcome', 'confirmed', 'invoke_ai', true);
    ELSIF p_action = 'not_yet' THEN
        IF v_gate.request_status <> 'awaiting_confirmation' THEN
            RETURN jsonb_build_object('outcome', 'nothing_to_decline');
        END IF;
        IF v_gate.requester_side = p_actor_side THEN
            RETURN jsonb_build_object('outcome', 'same_side');
        END IF;
        UPDATE deal_summary_gates
           SET request_status = 'idle', requested_by = NULL, requester_side = NULL,
               requested_at = NULL, confirmed_by = NULL, confirmed_at = NULL,
               generation_requested_at = NULL, updated_at = now()
         WHERE deal_id = p_deal_id;
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (p_actor_id, 'summary_request_not_yet', 'deal', p_deal_id,
                jsonb_build_object('requested_by', v_gate.requested_by), p_ip_address);
        RETURN jsonb_build_object('outcome', 'declined');
    END IF;
    RAISE EXCEPTION 'Unknown summary-gate action';
END;
$$;

CREATE OR REPLACE FUNCTION apply_checklist_override_action(
    p_deal_id uuid,
    p_field_key text,
    p_action text,
    p_actor_id uuid,
    p_actor_side text,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_gate deal_summary_gates%ROWTYPE;
    v_override jsonb;
    v_next jsonb;
BEGIN
    INSERT INTO deal_summary_gates (deal_id) VALUES (p_deal_id) ON CONFLICT (deal_id) DO NOTHING;
    SELECT * INTO v_gate FROM deal_summary_gates WHERE deal_id = p_deal_id FOR UPDATE;
    SELECT value INTO v_override
      FROM jsonb_array_elements(v_gate.manual_overrides) AS value
     WHERE value ->> 'field_key' = p_field_key
     LIMIT 1;

    IF p_action = 'propose' THEN
        IF v_override IS NOT NULL AND v_override ->> 'status' = 'confirmed' THEN
            RETURN jsonb_build_object('outcome', 'already_confirmed');
        ELSIF v_override IS NOT NULL AND v_override ->> 'proposed_by' = p_actor_id::text THEN
            RETURN jsonb_build_object('outcome', 'already_proposed');
        ELSIF v_override IS NOT NULL THEN
            RETURN jsonb_build_object('outcome', 'proposal_exists');
        END IF;
        v_next := v_gate.manual_overrides || jsonb_build_array(jsonb_build_object(
            'field_key', p_field_key, 'status', 'awaiting_confirmation', 'proposed_by', p_actor_id,
            'proposer_side', p_actor_side, 'proposed_at', now()
        ));
        UPDATE deal_summary_gates SET manual_overrides = v_next, updated_at = now() WHERE deal_id = p_deal_id;
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (p_actor_id, 'checklist_override_proposed', 'deal', p_deal_id,
                jsonb_build_object('field_key', p_field_key, 'side', p_actor_side), p_ip_address);
        RETURN jsonb_build_object('outcome', 'proposed');
    ELSIF p_action = 'confirm' THEN
        IF v_override IS NULL THEN
            RETURN jsonb_build_object('outcome', 'nothing_to_confirm');
        ELSIF v_override ->> 'status' = 'confirmed' THEN
            RETURN jsonb_build_object('outcome', 'already_confirmed');
        ELSIF v_override ->> 'proposer_side' = p_actor_side THEN
            RETURN jsonb_build_object('outcome', 'same_side');
        END IF;
        SELECT coalesce(jsonb_agg(CASE WHEN value ->> 'field_key' = p_field_key THEN
            value || jsonb_build_object('status', 'confirmed', 'confirmed_by', p_actor_id, 'confirmed_at', now())
            ELSE value END), '[]'::jsonb)
          INTO v_next FROM jsonb_array_elements(v_gate.manual_overrides) AS value;
        UPDATE deal_summary_gates SET manual_overrides = v_next, updated_at = now() WHERE deal_id = p_deal_id;
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (p_actor_id, 'checklist_override_confirmed', 'deal', p_deal_id,
                jsonb_build_object('field_key', p_field_key, 'proposed_by', v_override ->> 'proposed_by'), p_ip_address);
        RETURN jsonb_build_object('outcome', 'confirmed');
    END IF;
    RAISE EXCEPTION 'Unknown checklist-override action';
END;
$$;

REVOKE ALL ON FUNCTION apply_summary_gate_action(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_checklist_override_action(uuid, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_summary_gate_action(uuid, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION apply_checklist_override_action(uuid, text, text, uuid, text, text) TO service_role;
