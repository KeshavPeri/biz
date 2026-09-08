-- ============================================================
-- 044_participant_add_approval.sql
-- B3-004: backend-owned, unanimous participant admission.
-- The electorate is snapshotted into independently constrained rows.
-- ============================================================

DO $$ BEGIN
    CREATE TYPE participant_add_decision_enum AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE participant_add_requests
    ADD COLUMN IF NOT EXISTS proposed_role participant_role_enum,
    ADD COLUMN IF NOT EXISTS decided_at timestamptz;

CREATE TABLE IF NOT EXISTS participant_add_decisions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id          uuid NOT NULL REFERENCES participant_add_requests(id) ON DELETE CASCADE,
    approver_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    decision            participant_add_decision_enum NOT NULL DEFAULT 'pending',
    decided_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_participant_add_decision_approver UNIQUE (request_id, approver_profile_id),
    CONSTRAINT participant_add_decision_time_check CHECK (
        (decision = 'pending' AND decided_at IS NULL)
        OR (decision <> 'pending' AND decided_at IS NOT NULL)
    )
);

-- The legacy table was authenticated-client writable and stored approvals only
-- in unconstrained JSON. Any old pending row cannot prove a frozen electorate,
-- so terminalize it before the one-pending invariant is installed. Reapplying
-- this migration preserves only pending rows whose normalized electorate still
-- exactly matches the current roster and whose requester approval is present.
UPDATE participant_add_requests request
   SET status = 'rejected', decided_at = COALESCE(request.decided_at, now())
 WHERE request.status = 'pending'
   AND (
       request.proposed_role IS NULL
       OR request.proposed_role NOT IN ('brand_admin', 'brand_maker', 'brand_checker')
       OR NOT EXISTS (
           SELECT 1
             FROM participant_add_decisions decision
            WHERE decision.request_id = request.id
       )
       OR NOT EXISTS (
           SELECT 1
             FROM participant_add_decisions decision
            WHERE decision.request_id = request.id
              AND decision.approver_profile_id = request.requested_by
              AND decision.decision = 'approved'
       )
       OR EXISTS (
           SELECT 1
             FROM deal_participants participant
            WHERE participant.deal_id = request.deal_id
              AND NOT EXISTS (
                  SELECT 1
                    FROM participant_add_decisions decision
                   WHERE decision.request_id = request.id
                     AND decision.approver_profile_id = participant.profile_id
              )
       )
       OR EXISTS (
           SELECT 1
             FROM participant_add_decisions decision
            WHERE decision.request_id = request.id
              AND NOT EXISTS (
                  SELECT 1
                    FROM deal_participants participant
                   WHERE participant.deal_id = request.deal_id
                     AND participant.profile_id = decision.approver_profile_id
              )
       )
   );

ALTER TABLE participant_add_requests
    DROP CONSTRAINT IF EXISTS participant_add_pending_role_check;
ALTER TABLE participant_add_requests
    ADD CONSTRAINT participant_add_pending_role_check CHECK (
        status <> 'pending'
        OR (
            proposed_role IS NOT NULL
            AND proposed_role IN ('brand_admin', 'brand_maker', 'brand_checker')
        )
    ) NOT VALID;
ALTER TABLE participant_add_requests
    VALIDATE CONSTRAINT participant_add_pending_role_check;

CREATE UNIQUE INDEX IF NOT EXISTS uq_participant_add_pending_deal
    ON participant_add_requests(deal_id)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_participant_add_requests_deal_created
    ON participant_add_requests(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_participant_add_decisions_request
    ON participant_add_decisions(request_id, created_at);

ALTER TABLE participant_add_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS participant_add_requests_read_participant ON participant_add_requests;
DROP POLICY IF EXISTS participant_add_requests_insert_participant ON participant_add_requests;
DROP POLICY IF EXISTS participant_add_requests_update_participant ON participant_add_requests;
DROP POLICY IF EXISTS participant_add_decisions_read_participant ON participant_add_decisions;
REVOKE ALL ON participant_add_requests FROM anon, authenticated, service_role;
REVOKE ALL ON participant_add_decisions FROM anon, authenticated, service_role;
GRANT SELECT ON participant_add_requests TO service_role;
GRANT SELECT ON participant_add_decisions TO service_role;

CREATE OR REPLACE FUNCTION participant_add_terms_unlocked(p_deal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT NOT EXISTS (
        SELECT 1
          FROM deal_summary_gates g
         WHERE g.deal_id = p_deal_id
           AND g.request_status <> 'idle'
    ) AND NOT EXISTS (
        SELECT 1
          FROM ai_summaries s
         WHERE s.deal_id = p_deal_id
           AND s.status IN ('pending_approval', 'approved')
    );
$$;

CREATE OR REPLACE FUNCTION apply_participant_add_request(
    p_request_id uuid,
    p_deal_id uuid,
    p_actor_id uuid,
    p_proposed_profile_id uuid,
    p_proposed_role text,
    p_reason text,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deal deals%ROWTYPE;
    v_existing participant_add_requests%ROWTYPE;
    v_actor_role participant_role_enum;
    v_member_role text;
    v_count integer;
BEGIN
    IF p_request_id IS NULL OR p_deal_id IS NULL OR p_actor_id IS NULL OR p_proposed_profile_id IS NULL THEN
        RAISE EXCEPTION 'PARTICIPANT_ADD_INVALID';
    END IF;
    IF p_proposed_role NOT IN ('brand_admin', 'brand_maker', 'brand_checker') THEN
        RAISE EXCEPTION 'PARTICIPANT_ADD_ROLE_INVALID';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) < 1 OR length(btrim(p_reason)) > 500 THEN
        RAISE EXCEPTION 'PARTICIPANT_ADD_REASON_INVALID';
    END IF;

    SELECT * INTO v_deal FROM deals WHERE id = p_deal_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PARTICIPANT_ADD_NOT_FOUND'; END IF;

    SELECT * INTO v_existing FROM participant_add_requests WHERE id = p_request_id;
    IF FOUND THEN
        IF v_existing.deal_id = p_deal_id
           AND v_existing.requested_by = p_actor_id
           AND v_existing.proposed_profile_id = p_proposed_profile_id
           AND v_existing.proposed_role::text = p_proposed_role
           AND v_existing.reason = btrim(p_reason) THEN
            RETURN jsonb_build_object('request_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
        END IF;
        RAISE EXCEPTION 'PARTICIPANT_ADD_IDEMPOTENCY_CONFLICT';
    END IF;

    SELECT participant_role INTO v_actor_role
      FROM deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PARTICIPANT_ADD_FORBIDDEN'; END IF;
    IF v_deal.stage <> 'chatting' OR NOT participant_add_terms_unlocked(p_deal_id) THEN
        RAISE EXCEPTION 'PARTICIPANT_ADD_TERMS_LOCKED';
    END IF;
    IF p_proposed_profile_id = v_deal.creator_id THEN
        RAISE EXCEPTION 'PARTICIPANT_ADD_CANDIDATE_INVALID';
    END IF;
    IF EXISTS (SELECT 1 FROM deal_participants WHERE deal_id = p_deal_id AND profile_id = p_proposed_profile_id) THEN
        RAISE EXCEPTION 'PARTICIPANT_ADD_ALREADY_PRESENT';
    END IF;

    SELECT bm.brand_role::text INTO v_member_role
      FROM brand_members bm
     WHERE bm.brand_id = v_deal.brand_id
       AND bm.profile_id = p_proposed_profile_id
       AND bm.status = 'active'
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PARTICIPANT_ADD_CANDIDATE_INVALID'; END IF;
    IF p_proposed_role = 'brand_admin' AND v_member_role <> 'admin' THEN
        RAISE EXCEPTION 'PARTICIPANT_ADD_ROLE_MISMATCH';
    END IF;

    IF EXISTS (SELECT 1 FROM participant_add_requests WHERE deal_id = p_deal_id AND status = 'pending') THEN
        RAISE EXCEPTION 'PARTICIPANT_ADD_PENDING_EXISTS';
    END IF;

    INSERT INTO participant_add_requests (
        id, deal_id, proposed_profile_id, requested_by, reason, proposed_role, status, approvals
    ) VALUES (
        p_request_id, p_deal_id, p_proposed_profile_id, p_actor_id, btrim(p_reason),
        p_proposed_role::participant_role_enum, 'pending', '{}'::jsonb
    );

    INSERT INTO participant_add_decisions (request_id, approver_profile_id, decision, decided_at)
    SELECT p_request_id, dp.profile_id,
           CASE WHEN dp.profile_id = p_actor_id THEN 'approved'::participant_add_decision_enum
                ELSE 'pending'::participant_add_decision_enum END,
           CASE WHEN dp.profile_id = p_actor_id THEN now() ELSE NULL END
      FROM deal_participants dp
     WHERE dp.deal_id = p_deal_id
     ORDER BY dp.profile_id
     FOR SHARE;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count < 1 THEN RAISE EXCEPTION 'PARTICIPANT_ADD_FORBIDDEN'; END IF;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES
      (p_actor_id, 'participant_add_requested', 'participant_add_request', p_request_id,
       jsonb_build_object('deal_id', p_deal_id, 'proposed_role', p_proposed_role), p_ip_address),
      (p_actor_id, 'participant_add_decided', 'participant_add_request', p_request_id,
       jsonb_build_object('deal_id', p_deal_id, 'decision', 'approved', 'proposed_role', p_proposed_role), p_ip_address);

    RETURN jsonb_build_object('request_id', p_request_id, 'status', 'pending', 'idempotent', false);
END;
$$;

CREATE OR REPLACE FUNCTION apply_participant_add_decision(
    p_deal_id uuid,
    p_request_id uuid,
    p_actor_id uuid,
    p_decision text,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deal deals%ROWTYPE;
    v_request participant_add_requests%ROWTYPE;
    v_decision participant_add_decisions%ROWTYPE;
    v_member_role text;
    v_pending integer;
BEGIN
    IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'PARTICIPANT_ADD_DECISION_INVALID'; END IF;
    SELECT * INTO v_deal FROM deals WHERE id = p_deal_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PARTICIPANT_ADD_NOT_FOUND'; END IF;
    SELECT * INTO v_request
      FROM participant_add_requests
     WHERE id = p_request_id AND deal_id = p_deal_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PARTICIPANT_ADD_NOT_FOUND'; END IF;
    SELECT * INTO v_decision
      FROM participant_add_decisions
     WHERE request_id = p_request_id AND approver_profile_id = p_actor_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PARTICIPANT_ADD_FORBIDDEN'; END IF;

    IF v_decision.decision::text = p_decision THEN
        RETURN jsonb_build_object('request_id', p_request_id, 'status', v_request.status, 'idempotent', true);
    END IF;
    IF v_decision.decision <> 'pending' OR v_request.status <> 'pending' THEN
        RAISE EXCEPTION 'PARTICIPANT_ADD_DECISION_CONFLICT';
    END IF;
    -- Exact repeats above remain idempotent, but every new vote must recheck the
    -- safe admission window before writing either the decision or its audit.
    IF v_deal.stage <> 'chatting' OR NOT participant_add_terms_unlocked(p_deal_id) THEN
        RAISE EXCEPTION 'PARTICIPANT_ADD_TERMS_LOCKED';
    END IF;

    UPDATE participant_add_decisions
       SET decision = p_decision::participant_add_decision_enum, decided_at = now()
     WHERE id = v_decision.id;
    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (p_actor_id, 'participant_add_decided', 'participant_add_request', p_request_id,
            jsonb_build_object('deal_id', p_deal_id, 'decision', p_decision,
                               'proposed_role', v_request.proposed_role::text), p_ip_address);

    IF p_decision = 'rejected' THEN
        UPDATE participant_add_requests SET status = 'rejected', decided_at = now() WHERE id = p_request_id;
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (p_actor_id, 'participant_add_rejected', 'participant_add_request', p_request_id,
                jsonb_build_object('deal_id', p_deal_id, 'proposed_role', v_request.proposed_role::text), p_ip_address);
        RETURN jsonb_build_object('request_id', p_request_id, 'status', 'rejected', 'idempotent', false);
    END IF;

    SELECT count(*) INTO v_pending
      FROM participant_add_decisions
     WHERE request_id = p_request_id AND decision <> 'approved';
    IF v_pending > 0 THEN
        RETURN jsonb_build_object('request_id', p_request_id, 'status', 'pending', 'idempotent', false);
    END IF;

    IF EXISTS (SELECT 1 FROM deal_participants WHERE deal_id = p_deal_id AND profile_id = v_request.proposed_profile_id) THEN
        RAISE EXCEPTION 'PARTICIPANT_ADD_ALREADY_PRESENT';
    END IF;
    SELECT bm.brand_role::text INTO v_member_role
      FROM brand_members bm
     WHERE bm.brand_id = v_deal.brand_id
       AND bm.profile_id = v_request.proposed_profile_id
       AND bm.status = 'active'
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PARTICIPANT_ADD_CANDIDATE_INVALID'; END IF;
    IF v_request.proposed_role = 'brand_admin' AND v_member_role <> 'admin' THEN
        RAISE EXCEPTION 'PARTICIPANT_ADD_ROLE_MISMATCH';
    END IF;

    INSERT INTO deal_participants (deal_id, profile_id, participant_role)
    VALUES (p_deal_id, v_request.proposed_profile_id, v_request.proposed_role);
    UPDATE participant_add_requests SET status = 'approved', decided_at = now() WHERE id = p_request_id;
    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (p_actor_id, 'participant_added', 'participant_add_request', p_request_id,
            jsonb_build_object('deal_id', p_deal_id, 'proposed_role', v_request.proposed_role::text), p_ip_address);
    RETURN jsonb_build_object('request_id', p_request_id, 'status', 'approved', 'idempotent', false);
END;
$$;

-- A pending roster change makes Gate A unsafe. Lock order stays deal then gate.
CREATE OR REPLACE FUNCTION participant_add_pending_for_deal(p_deal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM participant_add_requests
         WHERE deal_id = p_deal_id AND status = 'pending'
    );
$$;

-- Serialize Gate A against roster changes at the same deal lock. The trigger is
-- intentionally below the RPCs so a migration reapply is deterministic.
CREATE OR REPLACE FUNCTION guard_summary_gate_participant_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM 1 FROM deals WHERE id = NEW.deal_id FOR UPDATE;
    IF NEW.request_status <> 'idle'
       AND EXISTS (
           SELECT 1 FROM participant_add_requests
            WHERE deal_id = NEW.deal_id AND status = 'pending'
       ) THEN
        RAISE EXCEPTION 'PARTICIPANT_ADD_PENDING_BLOCKS_GATE_A';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_summary_gate_participant_request ON deal_summary_gates;
CREATE TRIGGER trg_summary_gate_participant_request
BEFORE INSERT OR UPDATE OF request_status ON deal_summary_gates
FOR EACH ROW EXECUTE FUNCTION guard_summary_gate_participant_request();

REVOKE ALL ON FUNCTION participant_add_terms_unlocked(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_participant_add_request(uuid, uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_participant_add_decision(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION participant_add_pending_for_deal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION guard_summary_gate_participant_request() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_participant_add_request(uuid, uuid, uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION apply_participant_add_decision(uuid, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION participant_add_pending_for_deal(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION participant_add_terms_unlocked(uuid) TO service_role;
