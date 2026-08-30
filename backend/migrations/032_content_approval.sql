-- ============================================================
-- 032_content_approval.sql
-- Workplan 9.13-D: exact-submission content approval with optional
-- maker-checker hold/release.
-- Depends on: 031_content_submission_hardening.sql
-- ============================================================

-- The visible request carries only safe identifiers. The immutable submitted
-- object identity and maker IP remain in this service-role-only payload table.
CREATE TABLE held_content_approval_payloads (
    request_id uuid PRIMARY KEY REFERENCES maker_checker_requests(id) ON DELETE CASCADE,
    deliverable_id uuid NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
    revision_id uuid NOT NULL REFERENCES revisions(id) ON DELETE RESTRICT,
    round_number integer NOT NULL CHECK (round_number > 0),
    submitted_object_path text NOT NULL,
    maker_ip_address text NOT NULL,
    requires_checker_snapshot boolean NOT NULL CHECK (requires_checker_snapshot),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE held_content_approval_payloads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON held_content_approval_payloads FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON held_content_approval_payloads TO service_role;

-- One live approval action can exist for an exact immutable submission. A
-- newer revision has a different id, so an older pending action remains as
-- historical evidence but cannot release the newer submission.
CREATE UNIQUE INDEX maker_checker_one_pending_content_revision
    ON maker_checker_requests ((action_payload ->> 'revision_id'))
    WHERE status = 'pending' AND action_type = 'content_approval';

CREATE OR REPLACE FUNCTION approve_content_submission(
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
    v_requires_checker boolean := false;
    v_checker_id uuid;
    v_existing maker_checker_requests%ROWTYPE;
    v_existing_payload held_content_approval_payloads%ROWTYPE;
    v_request maker_checker_requests%ROWTYPE;
BEGIN
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

    -- An exact live hold owns this submission under its captured rule even if
    -- configuration was disabled later. Resolve it before any direct-path or
    -- already-approved evaluation so a retry can never bypass the checker.
    SELECT * INTO v_existing
      FROM maker_checker_requests
     WHERE action_type = 'content_approval' AND status = 'pending'
       AND action_payload ->> 'revision_id' = p_revision_id::text
     FOR UPDATE;
    IF FOUND THEN
        SELECT * INTO v_existing_payload
          FROM held_content_approval_payloads WHERE request_id = v_existing.id;
        IF v_existing.deal_id <> p_deal_id
           OR v_existing_payload.deliverable_id <> p_deliverable_id
           OR v_existing_payload.revision_id <> p_revision_id
           OR v_existing_payload.round_number <> v_revision.round_number
           OR v_existing_payload.submitted_object_path <> v_revision.submitted_content_url THEN
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

    -- A retry after this same maker's successful direct or released approval is
    -- harmless. Every other non-active identity fails closed.
    IF v_revision.lifecycle = 'approved'
       AND v_revision.decided_by = p_actor_id
       AND v_deliverable.status::text = 'approved'
       AND v_deliverable.approved_content_url = v_revision.submitted_content_url THEN
        SELECT * INTO v_existing
          FROM maker_checker_requests
         WHERE action_type = 'content_approval' AND status = 'approved'
           AND initiated_by = p_actor_id
           AND action_payload ->> 'revision_id' = p_revision_id::text
         ORDER BY decided_at DESC, id DESC
         LIMIT 1;
        RETURN jsonb_build_object(
            'status', 'approved', 'requires_checker', FOUND,
            'request_id', CASE WHEN FOUND THEN v_existing.id ELSE NULL END,
            'revision_id', v_revision.id, 'round_number', v_revision.round_number,
            'idempotent', true
        );
    END IF;
    IF v_revision.lifecycle <> 'awaiting_review'
       OR v_deliverable.status::text <> 'submitted'
       OR v_revision.round_number <> v_deliverable.revision_current THEN
        RAISE EXCEPTION 'CONTENT_STALE_REVISION';
    END IF;

    SELECT requires_checker INTO v_requires_checker
      FROM maker_checker_config
     WHERE brand_id = v_deal.brand_id AND action_type = 'content_approval'
     FOR SHARE;
    IF NOT FOUND THEN v_requires_checker := false; END IF;

    IF NOT v_requires_checker THEN
        UPDATE revisions
           SET lifecycle = 'approved', decision = 'approved', comment = NULL,
               decided_by = p_actor_id, decided_at = now()
         WHERE id = v_revision.id;
        UPDATE deliverables
           SET status = 'approved', approved_content_url = v_revision.submitted_content_url,
               updated_at = now()
         WHERE id = v_deliverable.id;
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (
            p_actor_id, 'content_approved_direct', 'deliverable', v_deliverable.id,
            jsonb_build_object(
                'deal_id', p_deal_id, 'deliverable_id', v_deliverable.id,
                'revision_id', v_revision.id, 'round_number', v_revision.round_number,
                'requires_checker', false
            ),
            p_ip_address
        );
        RETURN jsonb_build_object(
            'status', 'approved', 'requires_checker', false,
            'revision_id', v_revision.id, 'round_number', v_revision.round_number,
            'idempotent', false
        );
    END IF;

    SELECT dp.profile_id INTO v_checker_id
      FROM deal_participants dp
      JOIN brand_members bm
        ON bm.brand_id = v_deal.brand_id AND bm.profile_id = dp.profile_id AND bm.status = 'active'
     WHERE dp.deal_id = p_deal_id AND dp.participant_role::text = 'brand_checker'
     ORDER BY dp.joined_at, dp.id
     LIMIT 1
     FOR SHARE OF dp, bm;
    IF v_checker_id IS NULL THEN RAISE EXCEPTION 'CONTENT_CHECKER_MISSING'; END IF;
    IF v_checker_id = p_actor_id THEN RAISE EXCEPTION 'CONTENT_SELF_APPROVAL'; END IF;

    INSERT INTO maker_checker_requests (
        deal_id, action_type, initiated_by, checker_id, status, action_payload
    ) VALUES (
        p_deal_id, 'content_approval', p_actor_id, v_checker_id, 'pending',
        jsonb_build_object(
            'deliverable_id', p_deliverable_id, 'revision_id', p_revision_id,
            'round_number', v_revision.round_number, 'requires_checker_snapshot', true
        )
    ) RETURNING * INTO v_request;

    INSERT INTO held_content_approval_payloads (
        request_id, deliverable_id, revision_id, round_number,
        submitted_object_path, maker_ip_address, requires_checker_snapshot
    ) VALUES (
        v_request.id, p_deliverable_id, p_revision_id, v_revision.round_number,
        v_revision.submitted_content_url, p_ip_address, true
    );

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'maker_checker.request_created', 'maker_checker_request', v_request.id,
        jsonb_build_object(
            'action_type', 'content_approval', 'checker_id', v_checker_id,
            'deal_id', p_deal_id, 'deliverable_id', p_deliverable_id,
            'revision_id', p_revision_id, 'round_number', v_revision.round_number,
            'requires_checker_snapshot', true
        ),
        p_ip_address
    );

    RETURN jsonb_build_object(
        'status', 'held', 'requires_checker', true,
        'request_id', v_request.id, 'checker_id', v_checker_id,
        'revision_id', v_revision.id, 'round_number', v_revision.round_number,
        'idempotent', false
    );
END;
$$;

CREATE OR REPLACE FUNCTION decide_content_approval_request(
    p_request_id uuid,
    p_checker_id uuid,
    p_decision text,
    p_comment text,
    p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request_hint maker_checker_requests%ROWTYPE;
    v_payload_hint held_content_approval_payloads%ROWTYPE;
    v_request maker_checker_requests%ROWTYPE;
    v_payload held_content_approval_payloads%ROWTYPE;
    v_deal deals%ROWTYPE;
    v_deliverable deliverables%ROWTYPE;
    v_revision revisions%ROWTYPE;
    v_new_status maker_checker_status_enum;
    v_comment text;
BEGIN
    IF p_decision NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'CONTENT_INVALID_DECISION'; END IF;
    v_comment := NULLIF(btrim(COALESCE(p_comment, '')), '');
    IF p_decision = 'reject' AND length(COALESCE(v_comment, '')) NOT BETWEEN 3 AND 1000 THEN
        RAISE EXCEPTION 'CONTENT_INVALID_COMMENT';
    END IF;
    IF p_decision = 'approve' AND v_comment IS NOT NULL AND length(v_comment) > 1000 THEN
        RAISE EXCEPTION 'CONTENT_INVALID_COMMENT';
    END IF;

    -- Read identifiers first, then take locks in the same deal → deliverable →
    -- revision → request order used by submission and maker initiation.
    SELECT * INTO v_request_hint FROM maker_checker_requests WHERE id = p_request_id;
    IF NOT FOUND OR v_request_hint.action_type <> 'content_approval' THEN
        RAISE EXCEPTION 'CONTENT_REQUEST_NOT_FOUND';
    END IF;
    SELECT * INTO v_payload_hint FROM held_content_approval_payloads WHERE request_id = p_request_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_REQUEST_PAYLOAD_MISSING'; END IF;

    SELECT * INTO v_deal FROM deals
     WHERE id = v_request_hint.deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_DEAL_NOT_FOUND'; END IF;
    SELECT * INTO v_deliverable FROM deliverables
     WHERE id = v_payload_hint.deliverable_id AND deal_id = v_deal.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_STALE_REQUEST'; END IF;
    SELECT * INTO v_revision FROM revisions
     WHERE id = v_payload_hint.revision_id AND deliverable_id = v_deliverable.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_STALE_REQUEST'; END IF;
    SELECT * INTO v_request FROM maker_checker_requests WHERE id = p_request_id FOR UPDATE;
    SELECT * INTO v_payload FROM held_content_approval_payloads WHERE request_id = p_request_id FOR SHARE;

    IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'CONTENT_REQUEST_ALREADY_DECIDED'; END IF;
    IF v_request.checker_id <> p_checker_id THEN RAISE EXCEPTION 'CONTENT_NOT_ASSIGNED_CHECKER'; END IF;
    IF v_request.initiated_by = p_checker_id THEN RAISE EXCEPTION 'CONTENT_SELF_APPROVAL'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM deal_participants dp
        JOIN brand_members bm
          ON bm.brand_id = v_deal.brand_id AND bm.profile_id = dp.profile_id AND bm.status = 'active'
        WHERE dp.deal_id = v_deal.id AND dp.profile_id = p_checker_id
          AND dp.participant_role::text = 'brand_checker'
    ) THEN RAISE EXCEPTION 'CONTENT_CHECKER_ROLE_REQUIRED'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM deal_participants dp
        JOIN brand_members bm
          ON bm.brand_id = v_deal.brand_id AND bm.profile_id = dp.profile_id AND bm.status = 'active'
        WHERE dp.deal_id = v_deal.id AND dp.profile_id = v_request.initiated_by
          AND dp.participant_role::text IN ('brand_admin', 'brand_maker')
    ) THEN RAISE EXCEPTION 'CONTENT_MAKER_ROLE_REQUIRED'; END IF;

    IF v_deal.stage::text <> 'creating'
       OR v_deliverable.status::text <> 'submitted'
       OR v_revision.lifecycle <> 'awaiting_review'
       OR v_revision.round_number <> v_deliverable.revision_current
       OR v_payload.deliverable_id <> v_deliverable.id
       OR v_payload.revision_id <> v_revision.id
       OR v_payload.round_number <> v_revision.round_number
       OR v_payload.submitted_object_path <> v_revision.submitted_content_url
       OR NOT v_payload.requires_checker_snapshot
       OR v_request.action_payload ->> 'deliverable_id' <> v_deliverable.id::text
       OR v_request.action_payload ->> 'revision_id' <> v_revision.id::text
       OR (v_request.action_payload ->> 'round_number')::integer <> v_revision.round_number
       OR (v_request.action_payload ->> 'requires_checker_snapshot')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'CONTENT_STALE_REQUEST';
    END IF;

    v_new_status := CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END;
    IF p_decision = 'approve' THEN
        UPDATE revisions
           SET lifecycle = 'approved', decision = 'approved', comment = NULL,
               decided_by = v_request.initiated_by, decided_at = now()
         WHERE id = v_revision.id;
        UPDATE deliverables
           SET status = 'approved', approved_content_url = v_payload.submitted_object_path,
               updated_at = now()
         WHERE id = v_deliverable.id;
    END IF;

    UPDATE maker_checker_requests
       SET status = v_new_status, comment = v_comment, decided_at = now()
     WHERE id = v_request.id;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_checker_id, 'maker_checker.' || v_new_status::text,
        'maker_checker_request', v_request.id,
        jsonb_build_object(
            'action_type', 'content_approval', 'initiated_by', v_request.initiated_by,
            'deal_id', v_deal.id, 'deliverable_id', v_deliverable.id,
            'revision_id', v_revision.id, 'round_number', v_revision.round_number,
            'content_approved', p_decision = 'approve'
        ),
        p_ip_address
    );

    RETURN jsonb_build_object(
        'status', v_new_status, 'request_id', v_request.id,
        'deal_id', v_deal.id, 'deliverable_id', v_deliverable.id,
        'revision_id', v_revision.id, 'round_number', v_revision.round_number,
        'maker_id', v_request.initiated_by,
        'content_approved', p_decision = 'approve'
    );
END;
$$;

REVOKE ALL ON FUNCTION approve_content_submission(uuid, uuid, uuid, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION decide_content_approval_request(uuid, uuid, text, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION approve_content_submission(uuid, uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION decide_content_approval_request(uuid, uuid, text, text, text) TO service_role;
