-- ============================================================
-- 041_platform_ops_dispute_resolution.sql
-- Workplan 9.16-C: authenticated platform-ops dispute resolution
-- Depends on: 040_payment_dispute_current_participants.sql
-- ============================================================

-- Operations access is an explicit, server-managed capability. Customer
-- account type, brand membership, JWT claims and request headers grant nothing.
CREATE TABLE public.platform_ops_members (
    profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
    is_active boolean NOT NULL DEFAULT true,
    provisioned_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    provisioned_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.enforce_platform_ops_membership_provenance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.profile_id IS DISTINCT FROM OLD.profile_id
       OR NEW.provisioned_by IS DISTINCT FROM OLD.provisioned_by
       OR NEW.provisioned_at IS DISTINCT FROM OLD.provisioned_at THEN
        RAISE EXCEPTION 'PLATFORM_OPS_MEMBERSHIP_PROVENANCE_IMMUTABLE';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER platform_ops_membership_provenance
BEFORE UPDATE ON public.platform_ops_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_platform_ops_membership_provenance();

ALTER TABLE public.platform_ops_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_ops_members FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.platform_ops_members TO service_role;

ALTER TABLE public.disputes
    ADD COLUMN resolution_outcome text,
    ADD COLUMN resolution_request_id uuid,
    ADD COLUMN resolution_fingerprint text;

ALTER TABLE public.notifications
    ADD COLUMN dispute_id uuid REFERENCES public.disputes(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX disputes_unique_resolution_request
    ON public.disputes (resolution_request_id)
    WHERE resolution_request_id IS NOT NULL;

CREATE INDEX disputes_ops_open_queue
    ON public.disputes (created_at DESC, id DESC)
    WHERE status = 'open'::public.dispute_status_enum;

ALTER TABLE public.disputes DROP CONSTRAINT disputes_backend_resolution_evidence;
ALTER TABLE public.disputes
    ADD CONSTRAINT disputes_backend_resolution_evidence CHECK (
        request_fingerprint IS NULL OR (
            (status::text = 'open'
                AND resolution_note IS NULL
                AND resolved_at IS NULL
                AND resolved_by IS NULL
                AND resolution_outcome IS NULL
                AND resolution_request_id IS NULL
                AND resolution_fingerprint IS NULL)
            OR
            (status::text = 'resolved'
                AND resolved_at IS NOT NULL
                AND resolved_by IS NOT NULL
                AND resolution_outcome = 'resume_payment'
                AND resolution_request_id IS NOT NULL
                AND resolution_fingerprint ~ '^[0-9a-f]{64}$'
                AND resolution_note = btrim(resolution_note)
                AND length(resolution_note) BETWEEN 10 AND 1000
                AND resolution_note !~ '[[:cntrl:]]'
                AND resolution_note !~* '<[^>]*>|(^|[^[:alnum:]_])(https?|ftp|file|data|javascript|mailto):'
            )
        )
    );

CREATE OR REPLACE FUNCTION public.resolve_payment_dispute(
    p_dispute_id uuid,
    p_actor_id uuid,
    p_outcome text,
    p_resolution_note text,
    p_request_id uuid,
    p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal_id uuid;
    v_deal public.deals%ROWTYPE;
    v_payment public.payments%ROWTYPE;
    v_dispute public.disputes%ROWTYPE;
    v_fingerprint text;
    v_payment_count integer;
    v_recipient uuid;
    v_recipient_count integer := 0;
BEGIN
    -- Membership is checked before any dispute or deal lookup so a non-ops
    -- caller cannot use response differences to enumerate internal records.
    IF NOT EXISTS (
        SELECT 1 FROM public.platform_ops_members
         WHERE profile_id = p_actor_id AND is_active
    ) THEN
        RAISE EXCEPTION 'PLATFORM_OPS_FORBIDDEN';
    END IF;

    IF p_outcome IS DISTINCT FROM 'resume_payment'
       OR p_request_id IS NULL
       OR p_resolution_note IS NULL
       OR p_resolution_note <> btrim(p_resolution_note)
       OR length(p_resolution_note) NOT BETWEEN 10 AND 1000
       OR p_resolution_note ~ '[[:cntrl:]]'
       OR p_resolution_note ~* '<[^>]*>|(^|[^[:alnum:]_])(https?|ftp|file|data|javascript|mailto):' THEN
        RAISE EXCEPTION 'PLATFORM_OPS_DISPUTE_INVALID_REQUEST';
    END IF;

    -- This initial read does not lock the dispute. The row locks below always
    -- follow deal -> canonical payment -> dispute, matching payment mutations.
    SELECT deal_id INTO v_deal_id FROM public.disputes WHERE id = p_dispute_id;
    IF v_deal_id IS NULL THEN RAISE EXCEPTION 'PLATFORM_OPS_DISPUTE_NOT_FOUND'; END IF;

    SELECT * INTO v_deal FROM public.deals
     WHERE id = v_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PLATFORM_OPS_DISPUTE_NOT_FOUND'; END IF;

    SELECT count(*) INTO v_payment_count FROM public.payments
     WHERE deal_id = v_deal.id AND source_summary_id IS NOT NULL;
    IF v_payment_count <> 1 THEN RAISE EXCEPTION 'PLATFORM_OPS_DISPUTE_STATE_INCONSISTENT'; END IF;
    SELECT * INTO v_payment FROM public.payments
     WHERE deal_id = v_deal.id AND source_summary_id IS NOT NULL FOR UPDATE;

    SELECT * INTO v_dispute FROM public.disputes
     WHERE id = p_dispute_id AND deal_id = v_deal.id FOR UPDATE;
    IF NOT FOUND OR v_dispute.request_fingerprint IS NULL
       OR v_dispute.prior_payment_state IS NULL THEN
        RAISE EXCEPTION 'PLATFORM_OPS_DISPUTE_NOT_FOUND';
    END IF;

    v_fingerprint := encode(
        extensions.digest(
            jsonb_build_object(
                'version', 1,
                'dispute_id', p_dispute_id,
                'actor_id', p_actor_id,
                'outcome', p_outcome,
                'resolution_note', p_resolution_note,
                'request_id', p_request_id
            )::text,
            'sha256'
        ),
        'hex'
    );

    IF v_dispute.status::text = 'resolved' THEN
        IF v_dispute.resolved_by = p_actor_id
           AND v_dispute.resolution_outcome = p_outcome
           AND v_dispute.resolution_request_id = p_request_id
           AND v_dispute.resolution_fingerprint = v_fingerprint THEN
            RETURN jsonb_build_object(
                'outcome', 'resolved', 'dispute_id', v_dispute.id, 'idempotent', true
            );
        END IF;
        RAISE EXCEPTION 'PLATFORM_OPS_DISPUTE_RESOLUTION_CONFLICT';
    END IF;

    IF v_dispute.status::text <> 'open'
       OR v_deal.stage::text <> 'payment'
       OR NOT v_deal.is_disputed
       OR v_payment.state::text <> 'disputed'
       OR EXISTS (
            SELECT 1 FROM public.disputes
             WHERE deal_id = v_deal.id AND status::text = 'open' AND id <> v_dispute.id
       ) THEN
        RAISE EXCEPTION 'PLATFORM_OPS_DISPUTE_STATE_INCONSISTENT';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.disputes
         WHERE resolution_request_id = p_request_id AND id <> v_dispute.id
    ) THEN
        RAISE EXCEPTION 'PLATFORM_OPS_DISPUTE_RESOLUTION_CONFLICT';
    END IF;

    BEGIN
        UPDATE public.disputes
           SET status = 'resolved',
               resolution_note = p_resolution_note,
               resolved_at = now(),
               resolved_by = p_actor_id,
               resolution_outcome = p_outcome,
               resolution_request_id = p_request_id,
               resolution_fingerprint = v_fingerprint
         WHERE id = v_dispute.id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'PLATFORM_OPS_DISPUTE_RESOLUTION_CONFLICT';
    END;

    -- Resume exactly the immutable pre-dispute aggregate state. No other
    -- payment, milestone, receipt, amount, stage or transition fact changes.
    UPDATE public.payments SET state = v_dispute.prior_payment_state
     WHERE id = v_payment.id;
    UPDATE public.deals SET is_disputed = false WHERE id = v_deal.id;

    FOR v_recipient IN
        SELECT DISTINCT dp.profile_id
          FROM public.deal_participants dp
         WHERE dp.deal_id = v_deal.id
           AND (
                (dp.participant_role::text = 'creator' AND dp.profile_id = v_deal.creator_id)
                OR
                (dp.participant_role::text IN ('brand_admin','brand_maker','brand_checker')
                 AND EXISTS (
                    SELECT 1 FROM public.brand_members bm
                     WHERE bm.brand_id = v_deal.brand_id
                       AND bm.profile_id = dp.profile_id
                       AND bm.status::text = 'active'
                 ))
           )
    LOOP
        INSERT INTO public.notifications (profile_id, tier, title, body, deal_id, dispute_id)
        VALUES (
            v_recipient,
            'important',
            'Payment dispute resolved',
            'Payment tracking has resumed for this deal.',
            v_deal.id,
            v_dispute.id
        );
        v_recipient_count := v_recipient_count + 1;
    END LOOP;

    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id,
        'payment_dispute_resolved',
        'dispute',
        v_dispute.id,
        jsonb_build_object(
            'dispute_id', v_dispute.id,
            'deal_id', v_deal.id,
            'outcome', p_outcome,
            'restored_payment_state', v_dispute.prior_payment_state,
            'participant_recipient_count', v_recipient_count
        ),
        p_ip_address
    );

    RETURN jsonb_build_object(
        'outcome', 'resolved', 'dispute_id', v_dispute.id, 'idempotent', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_payment_dispute(uuid, uuid, text, text, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_payment_dispute(uuid, uuid, text, text, uuid, text)
    TO service_role;

-- Add operations recipients to the already-atomic participant raise path.
CREATE OR REPLACE FUNCTION public.raise_payment_dispute(
    p_deal_id uuid,
    p_actor_id uuid,
    p_description text,
    p_evidence jsonb,
    p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal public.deals%ROWTYPE;
    v_payment public.payments%ROWTYPE;
    v_dispute public.disputes%ROWTYPE;
    v_role public.participant_role_enum;
    v_side text;
    v_fingerprint text;
    v_open_count integer;
    v_payment_count integer;
    v_item jsonb;
    v_recipient uuid;
    v_evidence_count integer;
    v_ops_recipient_count integer := 0;
BEGIN
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_DISPUTE_DEAL_NOT_FOUND'; END IF;

    SELECT participant_role INTO v_role FROM public.deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role IS NULL THEN RAISE EXCEPTION 'PAYMENT_DISPUTE_NOT_PARTICIPANT'; END IF;
    IF v_role::text = 'creator' THEN
        IF v_deal.creator_id <> p_actor_id THEN RAISE EXCEPTION 'PAYMENT_DISPUTE_NOT_AUTHORIZED'; END IF;
        v_side := 'creator';
    ELSE
        IF v_role::text NOT IN ('brand_admin','brand_maker','brand_checker')
           OR NOT EXISTS (
                SELECT 1 FROM public.brand_members
                 WHERE brand_id = v_deal.brand_id
                   AND profile_id = p_actor_id
                   AND status::text = 'active'
           ) THEN RAISE EXCEPTION 'PAYMENT_DISPUTE_NOT_AUTHORIZED'; END IF;
        v_side := 'brand';
    END IF;

    IF v_deal.stage::text <> 'payment' THEN RAISE EXCEPTION 'PAYMENT_DISPUTE_NOT_AVAILABLE'; END IF;
    IF p_description IS NULL
       OR p_description <> btrim(p_description)
       OR length(p_description) NOT BETWEEN 10 AND 2000
       OR p_description ~ '[[:cntrl:]]'
       OR p_description ~* '<[^>]*>|(^|[^[:alnum:]_])(https?|file|data):'
       OR NOT public.dispute_valid_evidence(p_evidence) THEN
        RAISE EXCEPTION 'PAYMENT_DISPUTE_INVALID_REQUEST';
    END IF;

    SELECT count(*) INTO v_payment_count FROM public.payments
     WHERE deal_id = p_deal_id AND source_summary_id IS NOT NULL;
    IF v_payment_count <> 1 THEN RAISE EXCEPTION 'PAYMENT_DISPUTE_STATE_INCONSISTENT'; END IF;
    SELECT * INTO v_payment FROM public.payments
     WHERE deal_id = p_deal_id AND source_summary_id IS NOT NULL FOR UPDATE;

    v_fingerprint := encode(
        extensions.digest(
            jsonb_build_object(
                'version', 1, 'actor_id', p_actor_id,
                'description', p_description, 'evidence', p_evidence
            )::text,
            'sha256'
        ),
        'hex'
    );

    SELECT count(*) INTO v_open_count FROM public.disputes
     WHERE deal_id = p_deal_id AND status::text = 'open';
    IF v_open_count > 1 THEN RAISE EXCEPTION 'PAYMENT_DISPUTE_STATE_INCONSISTENT'; END IF;
    IF v_open_count = 1 THEN
        SELECT * INTO v_dispute FROM public.disputes
         WHERE deal_id = p_deal_id AND status::text = 'open' FOR UPDATE;
        IF NOT v_deal.is_disputed OR v_payment.state::text <> 'disputed' THEN
            RAISE EXCEPTION 'PAYMENT_DISPUTE_STATE_INCONSISTENT';
        END IF;
        IF v_dispute.raised_by = p_actor_id
           AND v_dispute.request_fingerprint = v_fingerprint THEN
            RETURN jsonb_build_object(
                'outcome', 'opened', 'dispute_id', v_dispute.id, 'idempotent', true
            );
        END IF;
        RETURN jsonb_build_object(
            'outcome', 'already_open', 'dispute_id', v_dispute.id, 'idempotent', false
        );
    END IF;

    IF v_deal.is_disputed OR v_payment.state::text = 'disputed' THEN
        RAISE EXCEPTION 'PAYMENT_DISPUTE_STATE_INCONSISTENT';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(p_evidence)
    LOOP
        IF v_item->>'kind' = 'message' THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.messages
                 WHERE id = (v_item->>'id')::uuid AND deal_id = p_deal_id AND deleted_at IS NULL
            ) THEN RAISE EXCEPTION 'PAYMENT_DISPUTE_INVALID_EVIDENCE'; END IF;
        ELSE
            IF NOT EXISTS (
                SELECT 1 FROM public.live_post_submissions s
                JOIN public.deliverables d ON d.id = s.deliverable_id
                 WHERE s.id = (v_item->>'id')::uuid
                   AND d.deal_id = p_deal_id
                   AND d.source_summary_id IS NOT NULL
            ) THEN RAISE EXCEPTION 'PAYMENT_DISPUTE_INVALID_EVIDENCE'; END IF;
        END IF;
    END LOOP;

    INSERT INTO public.disputes (
        deal_id, raised_by, description, evidence, status,
        request_fingerprint, raiser_role, raiser_side, prior_payment_state
    ) VALUES (
        p_deal_id, p_actor_id, p_description, p_evidence, 'open',
        v_fingerprint, v_role, v_side, v_payment.state
    ) RETURNING * INTO v_dispute;

    UPDATE public.payments SET state = 'disputed' WHERE id = v_payment.id;
    UPDATE public.deals SET is_disputed = true, updated_at = now() WHERE id = p_deal_id;

    SELECT count(*) INTO v_ops_recipient_count
      FROM public.platform_ops_members WHERE is_active;

    v_evidence_count := jsonb_array_length(p_evidence);
    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'payment_dispute_raised', 'dispute', v_dispute.id,
        jsonb_build_object(
            'dispute_id', v_dispute.id,
            'deal_id', p_deal_id,
            'actor_id', p_actor_id,
            'actor_role', v_role,
            'actor_side', v_side,
            'prior_payment_state', v_payment.state,
            'evidence_count', v_evidence_count,
            'ops_recipient_count', v_ops_recipient_count,
            'outcome', 'dispute_opened'
        ),
        p_ip_address
    );

    FOR v_recipient IN
        SELECT DISTINCT dp.profile_id
          FROM public.deal_participants dp
         WHERE dp.deal_id = p_deal_id
           AND (
                (dp.participant_role::text = 'creator' AND dp.profile_id = v_deal.creator_id)
                OR
                (dp.participant_role::text IN ('brand_admin','brand_maker','brand_checker')
                 AND EXISTS (
                    SELECT 1 FROM public.brand_members bm
                     WHERE bm.brand_id = v_deal.brand_id
                       AND bm.profile_id = dp.profile_id
                       AND bm.status::text = 'active'
                 ))
           )
    LOOP
        INSERT INTO public.notifications (profile_id, tier, title, body, deal_id, dispute_id)
        VALUES (
            v_recipient,
            'critical',
            'Payment dispute raised',
            'Payment updates are paused while this dispute is reviewed.',
            p_deal_id,
            v_dispute.id
        );
    END LOOP;

    FOR v_recipient IN
        SELECT profile_id FROM public.platform_ops_members WHERE is_active
    LOOP
        INSERT INTO public.notifications (profile_id, tier, title, body, deal_id, dispute_id)
        VALUES (
            v_recipient,
            'critical',
            'Payment dispute needs review',
            'An open payment dispute is ready for operations review.',
            p_deal_id,
            v_dispute.id
        );
    END LOOP;

    RETURN jsonb_build_object(
        'outcome', 'opened', 'dispute_id', v_dispute.id, 'idempotent', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.raise_payment_dispute(uuid, uuid, text, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.raise_payment_dispute(uuid, uuid, text, jsonb, text)
    TO service_role;
