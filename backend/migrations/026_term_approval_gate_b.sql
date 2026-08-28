-- ============================================================
-- 026_term_approval_gate_b.sql
-- Workplan 10-C / B4-004, B3-020, B3-021: backend-owned,
-- append-only all-participant summary decisions and atomic Gate B.
-- ============================================================

-- Historical RLS allowed a participant to manufacture an approval directly.
-- Reads stay participant-scoped, but every write and RPC is backend-only.
DROP POLICY IF EXISTS "term_approvals_insert_own" ON term_approvals;
REVOKE INSERT, UPDATE, DELETE ON term_approvals FROM anon, authenticated;
GRANT SELECT ON term_approvals TO authenticated;
GRANT ALL ON term_approvals TO service_role;

-- Migration 013 granted table-wide UPDATE and the historical participant policy
-- did not constrain columns. Deal mutation is backend-owned today: no current
-- client edits a deal row, so remove authenticated UPDATE entirely. This closes
-- direct stage/party/ownership changes even for legitimate participants.
DROP POLICY IF EXISTS "deals_update_participant" ON deals;
REVOKE UPDATE ON deals FROM PUBLIC, anon, authenticated;
GRANT ALL ON deals TO service_role;

-- The client only stamps its own unread marker. Column privilege prevents a
-- same-user row from being pivoted to another deal, profile or operative role;
-- RLS still proves that the row being stamped belongs to auth.uid().
DROP POLICY IF EXISTS "deal_participants_update_own" ON deal_participants;
REVOKE UPDATE ON deal_participants FROM PUBLIC, anon, authenticated;
GRANT UPDATE (last_read_at) ON deal_participants TO authenticated;
CREATE POLICY "deal_participants_update_own"
    ON deal_participants FOR UPDATE TO authenticated
    USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());
GRANT ALL ON deal_participants TO service_role;

-- UUID ordering is not insertion ordering when two decisions share a timestamp.
-- A private monotonic sequence makes "latest decision" deterministic while
-- preserving every historical row.
ALTER TABLE term_approvals
    ADD COLUMN IF NOT EXISTS decision_sequence bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX IF NOT EXISTS uq_term_approvals_decision_sequence
    ON term_approvals(decision_sequence);

-- Migration 025 could require pending_approval because Gate B did not exist yet.
-- Keep its provenance guarantee while allowing the same immutable row to reach
-- the two terminal review states owned by this migration.
ALTER TABLE ai_summaries DROP CONSTRAINT IF EXISTS ai_summaries_generation_provenance_check;
ALTER TABLE ai_summaries
    ADD CONSTRAINT ai_summaries_generation_provenance_check
    CHECK (
        generation_id IS NULL
        OR (
            schema_version IS NOT NULL AND btrim(schema_version) <> ''
            AND prompt_version IS NOT NULL AND btrim(prompt_version) <> ''
            AND provider IS NOT NULL AND btrim(provider) <> ''
            AND model IS NOT NULL AND btrim(model) <> ''
        )
    );

-- Return the applicable fields that are not safely resolved. Conditional children
-- are inapplicable only when their validated parent is explicitly found=false.
CREATE OR REPLACE FUNCTION gate_b_unresolved_fields(p_terms jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_key text;
    v_status text;
    v_applicable boolean;
    v_unresolved text[] := ARRAY[]::text[];
    v_keys constant text[] := ARRAY[
        'payment_amount', 'payment_terms_type', 'payment_terms_from_date',
        'exclusivity', 'exclusivity_duration_days', 'exclusivity_category',
        'usage_rights', 'usage_rights_duration', 'usage_rights_channels',
        'whitelisting', 'blackout_window', 'blackout_duration_timing',
        'revision_rounds_max', 'creative_guidance',
        'content_format_per_deliverable', 'platform_per_deliverable',
        'posting_window_per_deliverable', 'sponsored_content_disclosure',
        'content_ownership', 'deliverable_count', 'location_per_deliverable',
        'milestone_schedule'
    ];
BEGIN
    IF jsonb_typeof(p_terms) <> 'object' THEN
        RETURN v_keys;
    END IF;

    FOREACH v_key IN ARRAY v_keys LOOP
        v_applicable := true;
        IF v_key IN ('exclusivity_duration_days', 'exclusivity_category')
           AND p_terms #>> '{exclusivity,status}' = 'found'
           AND p_terms #> '{exclusivity,value}' = 'false'::jsonb THEN
            v_applicable := false;
        ELSIF v_key IN ('usage_rights_duration', 'usage_rights_channels')
           AND p_terms #>> '{usage_rights,status}' = 'found'
           AND p_terms #> '{usage_rights,value}' = 'false'::jsonb THEN
            v_applicable := false;
        ELSIF v_key = 'blackout_duration_timing'
           AND p_terms #>> '{blackout_window,status}' = 'found'
           AND p_terms #> '{blackout_window,value}' = 'false'::jsonb THEN
            v_applicable := false;
        ELSIF v_key = 'payment_terms_from_date'
           AND p_terms #>> '{payment_terms_type,status}' = 'found'
           AND p_terms #>> '{payment_terms_type,value}' <> 'net_x_days' THEN
            v_applicable := false;
        ELSIF v_key = 'milestone_schedule'
           AND p_terms #>> '{payment_terms_type,status}' = 'found'
           AND p_terms #>> '{payment_terms_type,value}' NOT IN ('milestone', 'combination') THEN
            v_applicable := false;
        END IF;

        v_status := p_terms #>> ARRAY[v_key, 'status'];
        IF v_applicable AND v_status IS DISTINCT FROM 'found' THEN
            v_unresolved := array_append(v_unresolved, v_key);
        END IF;
    END LOOP;
    RETURN v_unresolved;
END;
$$;

CREATE OR REPLACE FUNCTION apply_term_approval_gate_b(
    p_deal_id uuid,
    p_summary_id uuid,
    p_actor_id uuid,
    p_decision text,
    p_comment text,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_deal deals%ROWTYPE;
    v_summary ai_summaries%ROWTYPE;
    v_gate deal_summary_gates%ROWTYPE;
    v_role participant_role_enum;
    v_latest term_approvals%ROWTYPE;
    v_approval term_approvals%ROWTYPE;
    v_comment text := NULLIF(btrim(coalesce(p_comment, '')), '');
    v_unresolved text[];
    v_required integer;
    v_approved integer;
BEGIN
    IF p_decision NOT IN ('approved', 'issue_raised') THEN
        RAISE EXCEPTION 'GATE_B_INVALID_DECISION';
    END IF;
    IF char_length(coalesce(p_comment, '')) > 1000 THEN
        RAISE EXCEPTION 'GATE_B_COMMENT_TOO_LONG';
    END IF;
    IF p_decision = 'issue_raised' AND v_comment IS NULL THEN
        RAISE EXCEPTION 'GATE_B_COMMENT_REQUIRED';
    END IF;

    SELECT * INTO v_deal FROM deals WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'GATE_B_DEAL_NOT_FOUND';
    END IF;
    SELECT participant_role INTO v_role
      FROM deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'GATE_B_NOT_PARTICIPANT';
    END IF;

    SELECT * INTO v_summary FROM ai_summaries WHERE id = p_summary_id FOR UPDATE;
    IF NOT FOUND OR v_summary.deal_id <> p_deal_id THEN
        RAISE EXCEPTION 'GATE_B_WRONG_SUMMARY';
    END IF;

    SELECT * INTO v_latest
     FROM term_approvals
     WHERE summary_id = p_summary_id AND profile_id = p_actor_id
     ORDER BY decision_sequence DESC
     LIMIT 1;

    -- A transport retry after an issue or a completed transition is idempotent,
    -- but a different/stale decision can never mutate historical state.
    IF v_summary.status <> 'pending_approval' OR v_deal.stage <> 'chatting' THEN
        IF v_latest.id IS NOT NULL
           AND v_latest.decision::text = p_decision
           AND coalesce(v_latest.comment, '') = coalesce(v_comment, '')
           AND ((v_summary.status = 'issue_raised' AND p_decision = 'issue_raised')
                OR (v_summary.status = 'approved' AND p_decision = 'approved')) THEN
            RETURN jsonb_build_object(
                'outcome', CASE WHEN v_summary.status = 'approved' THEN 'approved' ELSE 'issue_raised' END,
                'idempotent', true,
                'transitioned', v_summary.status = 'approved',
                'stage', v_deal.stage,
                'summary_id', v_summary.id
            );
        END IF;
        RAISE EXCEPTION 'GATE_B_STALE_SUMMARY';
    END IF;

    SELECT * INTO v_gate FROM deal_summary_gates WHERE deal_id = p_deal_id FOR UPDATE;
    IF NOT FOUND OR v_gate.request_status <> 'ready_for_generation'
       OR v_gate.generation_id IS DISTINCT FROM v_summary.generation_id THEN
        RAISE EXCEPTION 'GATE_B_STALE_SUMMARY';
    END IF;

    IF v_latest.id IS NOT NULL
       AND v_latest.decision::text = p_decision
       AND coalesce(v_latest.comment, '') = coalesce(v_comment, '') THEN
        RETURN jsonb_build_object(
            'outcome', 'decision_recorded', 'idempotent', true,
            'transitioned', false, 'stage', v_deal.stage,
            'summary_id', v_summary.id, 'approval_id', v_latest.id
        );
    END IF;

    IF p_decision = 'approved' THEN
        v_unresolved := gate_b_unresolved_fields(v_summary.structured_terms);
        IF cardinality(v_unresolved) > 0 THEN
            RAISE EXCEPTION 'GATE_B_UNRESOLVED_FIELDS:%', array_to_string(v_unresolved, ',');
        END IF;
    END IF;

    INSERT INTO term_approvals (summary_id, profile_id, decision, comment)
    VALUES (p_summary_id, p_actor_id, p_decision::term_approval_decision_enum, v_comment)
    RETURNING * INTO v_approval;

    IF p_decision = 'issue_raised' THEN
        UPDATE ai_summaries SET status = 'issue_raised' WHERE id = p_summary_id;
        UPDATE deal_summary_gates
           SET request_status = 'idle', requested_by = NULL, requester_side = NULL,
               requested_at = NULL, confirmed_by = NULL, confirmed_at = NULL,
               generation_requested_at = NULL, generation_id = NULL,
               manual_overrides = '[]'::jsonb, updated_at = now()
         WHERE deal_id = p_deal_id;
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (p_actor_id, 'term_summary_decision_recorded', 'ai_summary', p_summary_id,
                jsonb_build_object('deal_id', p_deal_id, 'approval_id', v_approval.id,
                                   'decision', p_decision, 'outcome', 'issue_raised'), p_ip_address);
        RETURN jsonb_build_object(
            'outcome', 'issue_raised', 'idempotent', false,
            'transitioned', false, 'stage', 'chatting',
            'summary_id', v_summary.id, 'approval_id', v_approval.id
        );
    END IF;

    SELECT count(*) INTO v_required FROM deal_participants WHERE deal_id = p_deal_id;
    WITH latest AS (
        SELECT DISTINCT ON (profile_id) profile_id, decision
         FROM term_approvals
         WHERE summary_id = p_summary_id
         ORDER BY profile_id, decision_sequence DESC
    )
    SELECT count(*) INTO v_approved
      FROM deal_participants dp
      JOIN latest l ON l.profile_id = dp.profile_id
     WHERE dp.deal_id = p_deal_id AND l.decision = 'approved';

    IF v_required > 0 AND v_approved = v_required THEN
        UPDATE ai_summaries SET status = 'approved' WHERE id = p_summary_id;
        UPDATE deals SET stage = 'approval', updated_at = now()
         WHERE id = p_deal_id AND stage = 'chatting' AND deleted_at IS NULL;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'GATE_B_CONCURRENT_TRANSITION';
        END IF;
        INSERT INTO deal_stage_transitions (deal_id, from_stage, to_stage, transition_type, triggered_by)
        VALUES (p_deal_id, 'chatting', 'approval', 'gated', p_actor_id);
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (p_actor_id, 'deal_summary_approved', 'deal', p_deal_id,
                jsonb_build_object('summary_id', p_summary_id, 'required_approvers', v_required), p_ip_address);
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (p_actor_id, 'term_summary_decision_recorded', 'ai_summary', p_summary_id,
                jsonb_build_object('deal_id', p_deal_id, 'approval_id', v_approval.id,
                                   'decision', p_decision, 'outcome', 'approved',
                                   'required_approvers', v_required), p_ip_address);
        RETURN jsonb_build_object(
            'outcome', 'approved', 'idempotent', false,
            'transitioned', true, 'stage', 'approval',
            'summary_id', v_summary.id, 'approval_id', v_approval.id
        );
    END IF;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (p_actor_id, 'term_summary_decision_recorded', 'ai_summary', p_summary_id,
            jsonb_build_object('deal_id', p_deal_id, 'approval_id', v_approval.id,
                               'decision', p_decision, 'outcome', 'pending',
                               'approved_approvers', v_approved, 'required_approvers', v_required), p_ip_address);
    RETURN jsonb_build_object(
        'outcome', 'decision_recorded', 'idempotent', false,
        'transitioned', false, 'stage', 'chatting',
        'summary_id', v_summary.id, 'approval_id', v_approval.id,
        'approved_approvers', v_approved, 'required_approvers', v_required
    );
END;
$$;

-- Realtime is a refresh hint only. RLS on term_approvals still limits delivery
-- to current deal participants, and the authenticated API remains authoritative.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
           AND tablename = 'term_approvals'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE term_approvals;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION gate_b_unresolved_fields(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION gate_b_unresolved_fields(jsonb) TO service_role;
REVOKE ALL ON FUNCTION apply_term_approval_gate_b(uuid, uuid, uuid, text, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_term_approval_gate_b(uuid, uuid, uuid, text, text, text)
    TO service_role;
