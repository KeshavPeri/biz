-- ============================================================
-- 025_chat_terms_summary.sql
-- Phase 10 workplan 10-B / B4-002: durable Gate-A generation identity and
-- backend-only atomic persistence for validated 22-field chat summaries.
-- Additive and legacy-safe: historical summaries retain nullable provenance.
-- ============================================================

ALTER TABLE deal_summary_gates
    ADD COLUMN IF NOT EXISTS generation_id uuid;

UPDATE deal_summary_gates
   SET generation_id = gen_random_uuid()
 WHERE request_status = 'ready_for_generation'
   AND generation_id IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'deal_summary_gates_generation_state_check'
           AND conrelid = 'deal_summary_gates'::regclass
    ) THEN
        ALTER TABLE deal_summary_gates
            ADD CONSTRAINT deal_summary_gates_generation_state_check
            CHECK (
                (request_status = 'ready_for_generation' AND generation_id IS NOT NULL)
                OR (request_status <> 'ready_for_generation' AND generation_id IS NULL)
            );
    END IF;
END;
$$;

ALTER TABLE ai_summaries
    ADD COLUMN IF NOT EXISTS generation_id uuid,
    ADD COLUMN IF NOT EXISTS schema_version text,
    ADD COLUMN IF NOT EXISTS prompt_version text,
    ADD COLUMN IF NOT EXISTS provider text,
    ADD COLUMN IF NOT EXISTS model text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'ai_summaries_generation_provenance_check'
           AND conrelid = 'ai_summaries'::regclass
    ) THEN
        ALTER TABLE ai_summaries
            ADD CONSTRAINT ai_summaries_generation_provenance_check
            CHECK (
                generation_id IS NULL
                OR (
                    schema_version IS NOT NULL AND btrim(schema_version) <> ''
                    AND prompt_version IS NOT NULL AND btrim(prompt_version) <> ''
                    AND provider IS NOT NULL AND btrim(provider) <> ''
                    AND model IS NOT NULL AND btrim(model) <> ''
                    AND status = 'pending_approval'
                )
            );
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_summaries_deal_generation
    ON ai_summaries(deal_id, generation_id)
    WHERE generation_id IS NOT NULL;

-- Participant assignment is a backend-owned deal action. The historical
-- self-insert policy allowed any authenticated user who learned a deal UUID to
-- enroll themselves and inherit every participant-readable row. Existing and
-- future legitimate participants continue to be inserted by FastAPI/service_role.
DROP POLICY IF EXISTS "deal_participants_insert_own" ON deal_participants;
REVOKE INSERT ON deal_participants FROM anon, authenticated;
GRANT ALL ON deal_participants TO service_role;

-- Replace the Gate-A routine additively so a confirmed event always returns its
-- durable identity. A later retry may re-enter generation safely; persistence
-- returns the existing row before any second insert can occur.
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
    v_generation_id uuid;
BEGIN
    INSERT INTO deal_summary_gates (deal_id)
    VALUES (p_deal_id)
    ON CONFLICT (deal_id) DO NOTHING;

    SELECT * INTO v_gate FROM deal_summary_gates WHERE deal_id = p_deal_id FOR UPDATE;

    IF p_action = 'request' THEN
        IF v_gate.request_status = 'idle' THEN
            UPDATE deal_summary_gates
               SET request_status = 'awaiting_confirmation', requested_by = p_actor_id,
                   requester_side = p_actor_side, requested_at = now(), updated_at = now(),
                   generation_id = NULL
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
            RETURN jsonb_build_object(
                'outcome', 'already_confirmed',
                'invoke_ai', true,
                'generation_id', v_gate.generation_id
            );
        ELSIF v_gate.request_status <> 'awaiting_confirmation' THEN
            RETURN jsonb_build_object('outcome', 'nothing_to_confirm');
        END IF;
        IF v_gate.requester_side = p_actor_side THEN
            RETURN jsonb_build_object('outcome', 'same_side');
        END IF;
        v_generation_id := gen_random_uuid();
        UPDATE deal_summary_gates
           SET request_status = 'ready_for_generation', confirmed_by = p_actor_id,
               confirmed_at = now(), generation_requested_at = now(), updated_at = now(),
               generation_id = v_generation_id
         WHERE deal_id = p_deal_id;
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (p_actor_id, 'summary_request_confirmed', 'deal', p_deal_id,
                jsonb_build_object('requested_by', v_gate.requested_by, 'requester_side', v_gate.requester_side,
                                   'generation_id', v_generation_id), p_ip_address);
        RETURN jsonb_build_object(
            'outcome', 'confirmed',
            'invoke_ai', true,
            'generation_id', v_generation_id
        );
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
               generation_requested_at = NULL, generation_id = NULL, updated_at = now()
         WHERE deal_id = p_deal_id;
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (p_actor_id, 'summary_request_not_yet', 'deal', p_deal_id,
                jsonb_build_object('requested_by', v_gate.requested_by), p_ip_address);
        RETURN jsonb_build_object('outcome', 'declined');
    END IF;
    RAISE EXCEPTION 'Unknown summary-gate action';
END;
$$;

CREATE OR REPLACE FUNCTION persist_chat_ai_summary(
    p_deal_id uuid,
    p_generation_id uuid,
    p_raw_output jsonb,
    p_structured_terms jsonb,
    p_schema_version text,
    p_prompt_version text,
    p_provider text,
    p_model text,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_deal deals%ROWTYPE;
    v_gate deal_summary_gates%ROWTYPE;
    v_summary ai_summaries%ROWTYPE;
BEGIN
    SELECT * INTO v_deal FROM deals WHERE id = p_deal_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'B4002_GENERATION_CONFLICT';
    END IF;
    IF v_deal.stage <> 'chatting' THEN
        RAISE EXCEPTION 'B4002_GENERATION_CONFLICT';
    END IF;

    SELECT * INTO v_gate FROM deal_summary_gates WHERE deal_id = p_deal_id FOR UPDATE;
    IF NOT FOUND OR v_gate.request_status <> 'ready_for_generation'
       OR v_gate.generation_id IS DISTINCT FROM p_generation_id THEN
        RAISE EXCEPTION 'B4002_GENERATION_CONFLICT';
    END IF;
    IF v_gate.confirmed_by IS NULL THEN
        RAISE EXCEPTION 'B4002_GENERATION_CONFLICT';
    END IF;
    IF jsonb_typeof(p_raw_output) <> 'object' OR jsonb_typeof(p_structured_terms) <> 'object'
       OR coalesce(btrim(p_schema_version), '') = ''
       OR coalesce(btrim(p_prompt_version), '') = ''
       OR coalesce(btrim(p_provider), '') = ''
       OR coalesce(btrim(p_model), '') = '' THEN
        RAISE EXCEPTION 'validated summary payload is incomplete';
    END IF;

    SELECT * INTO v_summary
      FROM ai_summaries
     WHERE deal_id = p_deal_id AND generation_id = p_generation_id;
    IF FOUND THEN
        RETURN jsonb_build_object(
            'id', v_summary.id, 'generation_id', v_summary.generation_id,
            'status', v_summary.status, 'schema_version', v_summary.schema_version,
            'prompt_version', v_summary.prompt_version, 'provider', v_summary.provider,
            'model', v_summary.model, 'generated_at', v_summary.generated_at,
            'idempotent', true
        );
    END IF;

    INSERT INTO ai_summaries (
        deal_id, generation_id, raw_output, structured_terms, status,
        schema_version, prompt_version, provider, model
    ) VALUES (
        p_deal_id, p_generation_id, p_raw_output, p_structured_terms, 'pending_approval',
        p_schema_version, p_prompt_version, p_provider, p_model
    ) RETURNING * INTO v_summary;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        v_gate.confirmed_by,
        'chat_terms_summary_persisted',
        'ai_summary',
        v_summary.id,
        jsonb_build_object(
            'deal_id', p_deal_id,
            'generation_id', p_generation_id,
            'schema_version', p_schema_version,
            'prompt_version', p_prompt_version,
            'provider', p_provider,
            'model', p_model
        ),
        p_ip_address
    );

    RETURN jsonb_build_object(
        'id', v_summary.id, 'generation_id', v_summary.generation_id,
        'status', v_summary.status, 'schema_version', v_summary.schema_version,
        'prompt_version', v_summary.prompt_version, 'provider', v_summary.provider,
        'model', v_summary.model, 'generated_at', v_summary.generated_at,
        'idempotent', false
    );
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON ai_summaries FROM anon, authenticated;
GRANT SELECT ON ai_summaries TO authenticated;
GRANT ALL ON ai_summaries TO service_role;

REVOKE ALL ON FUNCTION apply_summary_gate_action(uuid, text, uuid, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_summary_gate_action(uuid, text, uuid, text, text)
    TO service_role;
REVOKE ALL ON FUNCTION persist_chat_ai_summary(uuid, uuid, jsonb, jsonb, text, text, text, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION persist_chat_ai_summary(uuid, uuid, jsonb, jsonb, text, text, text, text, text)
    TO service_role;
