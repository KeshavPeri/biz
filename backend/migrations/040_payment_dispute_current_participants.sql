-- ============================================================
-- 040_payment_dispute_current_participants.sql
-- Workplan 9.16-A review correction: notify current participants only
-- Depends on: 039_payment_disputes.sql
-- ============================================================

-- 039 is already applied in development. Replace only the dispute transaction
-- definition so stale/inactive deal_participant rows cannot receive new notices.
-- Existing dispute, payment, audit and notification rows remain untouched.
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
        SELECT DISTINCT dp.profile_id
          FROM public.deal_participants dp
         WHERE dp.deal_id = p_deal_id
           AND (
                (
                    dp.participant_role::text = 'creator'
                    AND dp.profile_id = v_deal.creator_id
                )
                OR
                (
                    dp.participant_role::text IN (
                        'brand_admin', 'brand_maker', 'brand_checker'
                    )
                    AND EXISTS (
                        SELECT 1
                          FROM public.brand_members bm
                         WHERE bm.brand_id = v_deal.brand_id
                           AND bm.profile_id = dp.profile_id
                           AND bm.status::text = 'active'
                    )
                )
           )
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

REVOKE ALL ON FUNCTION public.raise_payment_dispute(uuid, uuid, text, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.raise_payment_dispute(uuid, uuid, text, jsonb, text)
    TO service_role;
