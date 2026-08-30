-- ============================================================
-- 033_content_approval_hardening.sql
-- Security review repair for workplan 9.13-D.
-- Depends on: 032_content_approval.sql
-- ============================================================

-- Keep private submitted object references out of every authenticated direct
-- deliverables projection. Participant-safe reads remain available through the
-- explicit non-path columns and the FastAPI deliverable projection.
REVOKE SELECT ON deliverables FROM PUBLIC, anon, authenticated;
GRANT SELECT (
    id, deal_id, sequence, content_format, platform, posting_date,
    posting_window_start, posting_window_end, location, revision_max,
    revision_current, status, created_at, updated_at,
    content_ops_attention, content_ops_reason
) ON deliverables TO authenticated;
GRANT SELECT ON deliverables TO service_role;

-- Development already received migration 032 before review. Preserve that
-- implementation privately, revoke every direct caller, and place a hardened
-- wrapper at the stable RPC name. Fresh installs also get the corrected 032
-- implementation, so this wrapper is defense in depth rather than a fork.
ALTER FUNCTION approve_content_submission(uuid, uuid, uuid, uuid, text)
    RENAME TO approve_content_submission_032_impl;
REVOKE ALL ON FUNCTION approve_content_submission_032_impl(uuid, uuid, uuid, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION approve_content_submission(
    p_deal_id uuid,
    p_deliverable_id uuid,
    p_revision_id uuid,
    p_actor_id uuid,
    p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal deals%ROWTYPE;
    v_role text;
    v_deliverable deliverables%ROWTYPE;
    v_revision revisions%ROWTYPE;
    v_existing maker_checker_requests%ROWTYPE;
    v_payload held_content_approval_payloads%ROWTYPE;
BEGIN
    -- Match the implementation's lock order so checker decisions, revision
    -- requests, and maker retries cannot deadlock or race this precondition.
    SELECT * INTO v_deal FROM deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_DEAL_NOT_FOUND'; END IF;
    SELECT participant_role::text INTO v_role
      FROM deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role IS NULL THEN RAISE EXCEPTION 'CONTENT_NOT_PARTICIPANT'; END IF;
    IF v_role NOT IN ('brand_admin', 'brand_maker') OR NOT EXISTS (
        SELECT 1 FROM brand_members
         WHERE brand_id = v_deal.brand_id AND profile_id = p_actor_id AND status = 'active'
    ) THEN RAISE EXCEPTION 'CONTENT_REVIEWER_ONLY'; END IF;
    IF v_deal.stage::text <> 'creating' THEN RAISE EXCEPTION 'CONTENT_WRONG_STAGE'; END IF;

    SELECT * INTO v_deliverable FROM deliverables
     WHERE id = p_deliverable_id AND deal_id = p_deal_id
       AND source_summary_id IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_DELIVERABLE_NOT_FOUND'; END IF;
    SELECT * INTO v_revision FROM revisions
     WHERE id = p_revision_id AND deliverable_id = p_deliverable_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_REVISION_NOT_FOUND'; END IF;

    SELECT * INTO v_existing
      FROM maker_checker_requests
     WHERE action_type = 'content_approval' AND status = 'pending'
       AND action_payload ->> 'revision_id' = p_revision_id::text
     FOR UPDATE;
    IF FOUND THEN
        SELECT * INTO v_payload
          FROM held_content_approval_payloads WHERE request_id = v_existing.id;
        IF v_existing.deal_id <> p_deal_id
           OR v_payload.deliverable_id <> p_deliverable_id
           OR v_payload.revision_id <> p_revision_id
           OR v_payload.round_number <> v_revision.round_number
           OR v_payload.submitted_object_path <> v_revision.submitted_content_url THEN
            RAISE EXCEPTION 'CONTENT_PENDING_APPROVAL_EXISTS';
        END IF;
        IF v_revision.lifecycle <> 'awaiting_review'
           OR v_deliverable.status::text <> 'submitted'
           OR v_revision.round_number <> v_deliverable.revision_current THEN
            RAISE EXCEPTION 'CONTENT_STALE_REQUEST';
        END IF;
        IF v_existing.initiated_by = p_actor_id THEN
            RETURN jsonb_build_object(
                'status', 'held', 'requires_checker', true,
                'request_id', v_existing.id, 'checker_id', v_existing.checker_id,
                'revision_id', v_revision.id, 'round_number', v_revision.round_number,
                'idempotent', true
            );
        END IF;
        RAISE EXCEPTION 'CONTENT_PENDING_APPROVAL_EXISTS';
    END IF;

    RETURN approve_content_submission_032_impl(
        p_deal_id, p_deliverable_id, p_revision_id, p_actor_id, p_ip_address
    );
END;
$$;

REVOKE ALL ON FUNCTION approve_content_submission(uuid, uuid, uuid, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION approve_content_submission(uuid, uuid, uuid, uuid, text) TO service_role;
