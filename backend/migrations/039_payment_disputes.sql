-- ============================================================
-- 039_payment_disputes.sql
-- Workplan 9.16-A: secure Payment dispute raise/read foundation
-- Depends on: 038_payment_tracking.sql
-- ============================================================

-- Historical records are inventory-only. They remain untouched and are not
-- silently promoted to the stricter provenance used by the backend path below.
DO $$
DECLARE
    v_disputes bigint;
    v_open bigint;
    v_flagged_payment bigint;
BEGIN
    SELECT count(*), count(*) FILTER (WHERE status::text = 'open')
      INTO v_disputes, v_open FROM public.disputes;
    SELECT count(*) INTO v_flagged_payment
      FROM public.deals WHERE stage::text = 'payment' AND is_disputed;
    RAISE NOTICE 'PAYMENT_DISPUTE_INVENTORY disputes=% open=% flagged_payment_deals=%',
        v_disputes, v_open, v_flagged_payment;
END;
$$;

ALTER TABLE public.disputes
    ADD COLUMN request_fingerprint text,
    ADD COLUMN raiser_role public.participant_role_enum,
    ADD COLUMN raiser_side text,
    ADD COLUMN prior_payment_state public.payment_state_enum,
    ADD COLUMN resolved_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.disputes
    ADD CONSTRAINT disputes_backend_provenance CHECK (
        request_fingerprint IS NULL OR (
            request_fingerprint ~ '^[0-9a-f]{64}$'
            AND raiser_role IS NOT NULL
            AND raiser_side IN ('creator', 'brand')
            AND prior_payment_state IS NOT NULL
            AND description = btrim(description)
            AND length(description) BETWEEN 10 AND 2000
            AND description !~ '[[:cntrl:]]'
            AND description !~* '<[^>]*>|(^|[^[:alnum:]_])(https?|file|data):'
        )
    ),
    ADD CONSTRAINT disputes_backend_resolution_evidence CHECK (
        request_fingerprint IS NULL OR (
            (status::text = 'open'
                AND resolution_note IS NULL
                AND resolved_at IS NULL
                AND resolved_by IS NULL)
            OR
            (status::text = 'resolved'
                AND resolved_at IS NOT NULL
                AND resolved_by IS NOT NULL)
        )
    );

-- Historical duplicate-open rows are preserved. New backend-created rows are
-- additionally protected by the deal lock in raise_payment_dispute; this index
-- is the last-resort convergence guard for those fully-provenanced rows.
CREATE UNIQUE INDEX disputes_one_backend_open_per_deal
    ON public.disputes (deal_id)
    WHERE status = 'open'::public.dispute_status_enum AND request_fingerprint IS NOT NULL;

CREATE INDEX disputes_deal_history
    ON public.disputes (deal_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.dispute_valid_evidence(p_evidence jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_item jsonb;
    v_seen text[] := ARRAY[]::text[];
    v_key text;
    v_uuid uuid;
    v_canonical jsonb;
BEGIN
    IF jsonb_typeof(p_evidence) <> 'array'
       OR jsonb_array_length(p_evidence) > 10 THEN
        RETURN false;
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_evidence)
    LOOP
        IF jsonb_typeof(v_item) <> 'object'
           OR NOT (v_item ?& ARRAY['kind','id']::text[])
           OR (SELECT count(*) FROM jsonb_object_keys(v_item)) <> 2
           OR jsonb_typeof(v_item->'kind') <> 'string'
           OR v_item->>'kind' NOT IN ('message', 'live_post')
           OR jsonb_typeof(v_item->'id') <> 'string' THEN
            RETURN false;
        END IF;
        BEGIN
            v_uuid := (v_item->>'id')::uuid;
        EXCEPTION WHEN OTHERS THEN
            RETURN false;
        END;
        v_key := (v_item->>'kind') || ':' || v_uuid::text;
        IF v_key = ANY(v_seen) THEN RETURN false; END IF;
        v_seen := array_append(v_seen, v_key);
    END LOOP;
    SELECT coalesce(jsonb_agg(value ORDER BY value->>'kind', value->>'id'), '[]'::jsonb)
      INTO v_canonical FROM jsonb_array_elements(p_evidence);
    RETURN v_canonical = p_evidence;
END;
$$;

ALTER TABLE public.disputes
    ADD CONSTRAINT disputes_backend_evidence CHECK (
        request_fingerprint IS NULL OR public.dispute_valid_evidence(evidence)
    );

CREATE OR REPLACE FUNCTION public.enforce_dispute_immutable_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.request_fingerprint IS NOT NULL AND (
        NEW.id IS DISTINCT FROM OLD.id
        OR NEW.deal_id IS DISTINCT FROM OLD.deal_id
        OR NEW.raised_by IS DISTINCT FROM OLD.raised_by
        OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.evidence IS DISTINCT FROM OLD.evidence
        OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
        OR NEW.raiser_role IS DISTINCT FROM OLD.raiser_role
        OR NEW.raiser_side IS DISTINCT FROM OLD.raiser_side
        OR NEW.prior_payment_state IS DISTINCT FROM OLD.prior_payment_state
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
        RAISE EXCEPTION 'PAYMENT_DISPUTE_IMMUTABLE_IDENTITY';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER disputes_immutable_identity
BEFORE UPDATE ON public.disputes
FOR EACH ROW EXECUTE FUNCTION public.enforce_dispute_immutable_identity();

-- Disputes are API-only. Participants cannot create, inspect, pivot or resolve
-- them through the anon-key database client.
DROP POLICY IF EXISTS "disputes_read_participant" ON public.disputes;
DROP POLICY IF EXISTS "disputes_insert_participant" ON public.disputes;
REVOKE ALL ON TABLE public.disputes FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.disputes TO service_role;

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
BEGIN
    -- Compatible ordering with every payment mutation: deal, then canonical payment.
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_DISPUTE_DEAL_NOT_FOUND'; END IF;

    SELECT participant_role INTO v_role FROM public.deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role IS NULL THEN RAISE EXCEPTION 'PAYMENT_DISPUTE_NOT_PARTICIPANT'; END IF;
    IF v_role::text = 'creator' THEN
        IF v_deal.creator_id <> p_actor_id THEN
            RAISE EXCEPTION 'PAYMENT_DISPUTE_NOT_AUTHORIZED';
        END IF;
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

    IF v_deal.stage::text <> 'payment' THEN
        RAISE EXCEPTION 'PAYMENT_DISPUTE_NOT_AVAILABLE';
    END IF;
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
                'version', 1,
                'actor_id', p_actor_id,
                'description', p_description,
                'evidence', p_evidence
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
                 WHERE id = (v_item->>'id')::uuid
                   AND deal_id = p_deal_id
                   AND deleted_at IS NULL
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
            'outcome', 'dispute_opened'
        ),
        p_ip_address
    );

    FOR v_recipient IN
        SELECT DISTINCT profile_id FROM public.deal_participants WHERE deal_id = p_deal_id
    LOOP
        INSERT INTO public.notifications (profile_id, tier, title, body, deal_id)
        VALUES (
            v_recipient,
            'critical',
            'Payment dispute raised',
            'Payment updates are paused while this dispute is reviewed.',
            p_deal_id
        );
    END LOOP;

    RETURN jsonb_build_object(
        'outcome', 'opened', 'dispute_id', v_dispute.id, 'idempotent', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.dispute_valid_evidence(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_dispute_immutable_identity()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.raise_payment_dispute(uuid, uuid, text, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.raise_payment_dispute(uuid, uuid, text, jsonb, text)
    TO service_role;
