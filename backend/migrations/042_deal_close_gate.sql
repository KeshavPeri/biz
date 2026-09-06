-- ============================================================
-- 042_deal_close_gate.sql
-- Workplan 9.17-A: mutual close gate + terminal deal-thread lock
-- Depends on: 041_platform_ops_dispute_resolution.sql
-- ============================================================

CREATE TABLE public.deal_close_confirmations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id      uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
    side         text NOT NULL CHECK (side IN ('creator', 'brand')),
    actor_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    request_id   uuid NOT NULL,
    confirmed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (deal_id, side),
    UNIQUE (request_id)
);

CREATE INDEX deal_close_confirmations_deal_time
    ON public.deal_close_confirmations (deal_id, confirmed_at, id);

CREATE OR REPLACE FUNCTION public.enforce_deal_close_confirmation_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.deal_id IS DISTINCT FROM OLD.deal_id
       OR NEW.side IS DISTINCT FROM OLD.side
       OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
       OR NEW.request_id IS DISTINCT FROM OLD.request_id
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
        RAISE EXCEPTION 'DEAL_CLOSE_CONFIRMATION_IMMUTABLE';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER deal_close_confirmations_immutable
BEFORE UPDATE ON public.deal_close_confirmations
FOR EACH ROW EXECUTE FUNCTION public.enforce_deal_close_confirmation_identity();

ALTER TABLE public.deal_close_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.deal_close_confirmations FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.deal_close_confirmations TO service_role;

-- The status code keeps payment completeness independent from the dispute
-- mutation blocker. A valid dispute overlay is exactly the deal flag, one open
-- dispute, and the canonical payment's disputed state; partial overlays fail
-- closed instead of projecting a misleading close state.
CREATE OR REPLACE FUNCTION public.deal_close_status_code(p_deal_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal public.deals%ROWTYPE;
    v_payment public.payments%ROWTYPE;
    v_payment_count integer;
    v_milestone_count integer;
    v_bad_milestone_count integer;
    v_open_dispute_count integer;
    v_prior_payment_state text;
    v_effective_payment_state text;
    v_derived_payment_state text;
    v_disputed boolean;
    v_payment_complete boolean := false;
BEGIN
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN 'deal_not_found'; END IF;

    SELECT count(*) INTO v_payment_count FROM public.payments
     WHERE deal_id = p_deal_id AND source_summary_id IS NOT NULL;
    IF v_payment_count <> 1 THEN RETURN 'state_inconsistent'; END IF;
    SELECT * INTO v_payment FROM public.payments
     WHERE deal_id = p_deal_id AND source_summary_id IS NOT NULL;

    SELECT count(*) INTO v_open_dispute_count FROM public.disputes
     WHERE deal_id = p_deal_id AND status::text = 'open';
    IF v_open_dispute_count > 1 THEN RETURN 'state_inconsistent'; END IF;
    IF v_open_dispute_count = 1 THEN
        SELECT prior_payment_state::text INTO v_prior_payment_state
          FROM public.disputes
         WHERE deal_id = p_deal_id AND status::text = 'open';
    END IF;
    v_disputed := v_deal.is_disputed
        AND v_open_dispute_count = 1
        AND v_payment.state::text = 'disputed';
    IF (v_deal.is_disputed OR v_open_dispute_count = 1 OR v_payment.state::text = 'disputed')
       AND NOT v_disputed THEN
        RETURN 'state_inconsistent';
    END IF;
    IF v_disputed AND (
        v_prior_payment_state IS NULL OR v_prior_payment_state = 'disputed'
    ) THEN RETURN 'state_inconsistent'; END IF;
    v_effective_payment_state := CASE
        WHEN v_disputed THEN v_prior_payment_state
        ELSE v_payment.state::text
    END;

    SELECT count(*) INTO v_milestone_count FROM public.payment_milestones
     WHERE payment_id = v_payment.id AND sequence IS NOT NULL;

    IF v_payment.structure::text = 'single' THEN
        IF v_milestone_count <> 0
        THEN RETURN 'state_inconsistent'; END IF;
        v_payment_complete := v_effective_payment_state = 'paid_full'
           AND v_payment.creator_receipt_version IS NOT DISTINCT FROM v_payment.version
           AND v_payment.creator_receipt_confirmed_by IS NOT DISTINCT FROM v_deal.creator_id
           AND v_payment.creator_receipt_confirmed_at IS NOT NULL;
    ELSIF v_payment.structure::text IN ('milestone', 'combination') THEN
        IF v_milestone_count = 0 OR NOT EXISTS (
            SELECT 1
              FROM public.payment_milestones
             WHERE payment_id = v_payment.id AND sequence = 1
        ) OR EXISTS (
            SELECT 1
              FROM (
                  SELECT sequence, row_number() OVER (ORDER BY sequence)::integer AS expected
                    FROM public.payment_milestones
                   WHERE payment_id = v_payment.id AND sequence IS NOT NULL
              ) ordered
             WHERE ordered.sequence <> ordered.expected
        ) THEN RETURN 'state_inconsistent'; END IF;

        SELECT CASE
            WHEN bool_or(state::text = 'bad_debt') THEN 'bad_debt'
            WHEN bool_or(state::text = 'not_paid_delayed') THEN 'not_paid_delayed'
            WHEN bool_and(state::text = 'paid_full') THEN 'paid_full'
            WHEN bool_and(state::text = 'refunded') THEN 'refunded'
            WHEN bool_or(state::text IN ('paid_full','paid_partial','refunded')) THEN 'paid_partial'
            ELSE 'not_paid_in_window'
        END INTO v_derived_payment_state
          FROM public.payment_milestones
         WHERE payment_id = v_payment.id AND sequence IS NOT NULL;
        IF v_effective_payment_state IS DISTINCT FROM v_derived_payment_state THEN
            RETURN 'state_inconsistent';
        END IF;

        SELECT count(*) INTO v_bad_milestone_count
          FROM public.payment_milestones
         WHERE payment_id = v_payment.id
           AND sequence IS NOT NULL
           AND (
               state::text <> 'paid_full'
               OR creator_receipt_version IS DISTINCT FROM version
               OR creator_receipt_confirmed_by IS DISTINCT FROM v_deal.creator_id
               OR creator_receipt_confirmed_at IS NULL
           );
        v_payment_complete := v_derived_payment_state = 'paid_full'
            AND v_bad_milestone_count = 0
            AND v_payment.creator_receipt_version IS NULL
            AND v_payment.creator_receipt_confirmed_by IS NULL
            AND v_payment.creator_receipt_confirmed_at IS NULL;
    ELSE
        RETURN 'state_inconsistent';
    END IF;
    IF v_disputed THEN
        RETURN CASE WHEN v_payment_complete THEN 'disputed_complete' ELSE 'disputed_incomplete' END;
    END IF;
    RETURN CASE WHEN v_payment_complete THEN 'ready' ELSE 'payment_incomplete' END;
END;
$$;

-- Mutation callers deliberately receive one dispute blocker regardless of the
-- independently-derived payment completeness used by the read model.
CREATE OR REPLACE FUNCTION public.deal_close_guard_code(p_deal_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE public.deal_close_status_code(p_deal_id)
        WHEN 'ready' THEN 'ready'
        WHEN 'payment_incomplete' THEN 'DEAL_CLOSE_PAYMENT_INCOMPLETE'
        WHEN 'disputed_complete' THEN 'DEAL_CLOSE_DISPUTED'
        WHEN 'disputed_incomplete' THEN 'DEAL_CLOSE_DISPUTED'
        WHEN 'deal_not_found' THEN 'DEAL_CLOSE_DEAL_NOT_FOUND'
        ELSE 'DEAL_CLOSE_STATE_INCONSISTENT'
    END;
$$;

CREATE OR REPLACE FUNCTION public.get_deal_close_status_code(p_deal_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
    SELECT public.deal_close_status_code(p_deal_id);
$$;

-- Revision 1 replaced the projection wrapper with the richer status code.
DROP FUNCTION IF EXISTS public.get_deal_close_guard_code(uuid);

CREATE OR REPLACE FUNCTION public.enforce_payment_to_closed_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_guard text;
    v_confirmation_count integer;
BEGIN
    IF OLD.stage::text = 'payment' AND NEW.stage::text = 'closed' THEN
        v_guard := public.deal_close_guard_code(NEW.id);
        IF v_guard <> 'ready' THEN RAISE EXCEPTION '%', v_guard; END IF;
        SELECT count(*) INTO v_confirmation_count
          FROM public.deal_close_confirmations
         WHERE deal_id = NEW.id AND side IN ('creator', 'brand');
        IF v_confirmation_count <> 2 THEN RAISE EXCEPTION 'DEAL_CLOSE_CONFIRMATIONS_INCOMPLETE'; END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER deals_payment_to_closed_gate
BEFORE UPDATE OF stage ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_to_closed_gate();

CREATE OR REPLACE FUNCTION public.confirm_deal_close(
    p_deal_id uuid,
    p_actor_id uuid,
    p_request_id uuid,
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
    v_role text;
    v_side text;
    v_guard text;
    v_existing public.deal_close_confirmations%ROWTYPE;
    v_confirmation_count integer;
    v_transition_count integer;
    v_recipient uuid;
BEGIN
    IF p_request_id IS NULL THEN RAISE EXCEPTION 'DEAL_CLOSE_INVALID_REQUEST'; END IF;

    -- All payment/dispute/close writers use deal -> canonical payment order.
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DEAL_CLOSE_DEAL_NOT_FOUND'; END IF;

    SELECT participant_role::text INTO v_role FROM public.deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role IS NULL THEN RAISE EXCEPTION 'DEAL_CLOSE_NOT_PARTICIPANT'; END IF;
    IF EXISTS (
        SELECT 1 FROM public.platform_ops_members
         WHERE profile_id = p_actor_id AND is_active
    ) THEN RAISE EXCEPTION 'DEAL_CLOSE_NOT_AUTHORIZED'; END IF;
    IF v_role = 'creator' AND v_deal.creator_id = p_actor_id THEN
        v_side := 'creator';
    ELSIF v_role IN ('brand_admin', 'brand_maker') AND EXISTS (
        SELECT 1 FROM public.brand_members
         WHERE brand_id = v_deal.brand_id
           AND profile_id = p_actor_id
           AND status::text = 'active'
    ) THEN
        v_side := 'brand';
    ELSE
        RAISE EXCEPTION 'DEAL_CLOSE_NOT_AUTHORIZED';
    END IF;

    IF v_deal.stage::text NOT IN ('payment', 'closed') THEN
        RAISE EXCEPTION 'DEAL_CLOSE_NOT_AVAILABLE';
    END IF;

    SELECT * INTO v_existing FROM public.deal_close_confirmations
     WHERE request_id = p_request_id;
    IF FOUND AND (
        v_existing.deal_id <> p_deal_id
        OR v_existing.actor_id <> p_actor_id
        OR v_existing.side <> v_side
    ) THEN RAISE EXCEPTION 'DEAL_CLOSE_REQUEST_CONFLICT'; END IF;

    SELECT * INTO v_existing FROM public.deal_close_confirmations
     WHERE deal_id = p_deal_id AND side = v_side FOR UPDATE;
    IF FOUND THEN
        IF v_existing.request_id <> p_request_id OR v_existing.actor_id <> p_actor_id THEN
            RAISE EXCEPTION 'DEAL_CLOSE_REQUEST_CONFLICT';
        END IF;
        RETURN jsonb_build_object(
            'transitioned', v_deal.stage::text = 'closed',
            'stage', v_deal.stage,
            'idempotent', true,
            'notifications_handled', true
        );
    END IF;
    IF v_deal.stage::text = 'closed' THEN RAISE EXCEPTION 'DEAL_CLOSE_REQUEST_CONFLICT'; END IF;

    SELECT count(*) INTO v_confirmation_count FROM public.payments
     WHERE deal_id = p_deal_id AND source_summary_id IS NOT NULL;
    IF v_confirmation_count <> 1 THEN RAISE EXCEPTION 'DEAL_CLOSE_STATE_INCONSISTENT'; END IF;
    SELECT * INTO v_payment FROM public.payments
     WHERE deal_id = p_deal_id AND source_summary_id IS NOT NULL FOR UPDATE;
    PERFORM 1 FROM public.payment_milestones
     WHERE payment_id = v_payment.id AND sequence IS NOT NULL
     ORDER BY sequence FOR UPDATE;

    v_guard := public.deal_close_guard_code(p_deal_id);
    IF v_guard <> 'ready' THEN RAISE EXCEPTION '%', v_guard; END IF;

    BEGIN
        INSERT INTO public.deal_close_confirmations (deal_id, side, actor_id, request_id)
        VALUES (p_deal_id, v_side, p_actor_id, p_request_id);
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'DEAL_CLOSE_REQUEST_CONFLICT';
    END;

    SELECT count(*) INTO v_confirmation_count
      FROM public.deal_close_confirmations
     WHERE deal_id = p_deal_id;
    IF v_confirmation_count = 1 THEN
        RETURN jsonb_build_object(
            'transitioned', false,
            'stage', 'payment',
            'idempotent', false,
            'notifications_handled', true
        );
    END IF;
    IF v_confirmation_count <> 2 THEN RAISE EXCEPTION 'DEAL_CLOSE_STATE_INCONSISTENT'; END IF;

    UPDATE public.deals
       SET stage = 'closed', updated_at = now()
     WHERE id = p_deal_id AND stage::text = 'payment';
    IF NOT FOUND THEN RAISE EXCEPTION 'DEAL_CLOSE_CONCURRENT_CHANGE'; END IF;

    SELECT count(*) INTO v_transition_count FROM public.deal_stage_transitions
     WHERE deal_id = p_deal_id AND from_stage::text = 'payment' AND to_stage::text = 'closed';
    IF v_transition_count <> 0 THEN RAISE EXCEPTION 'DEAL_CLOSE_STATE_INCONSISTENT'; END IF;
    INSERT INTO public.deal_stage_transitions (
        deal_id, from_stage, to_stage, transition_type, triggered_by
    ) VALUES (p_deal_id, 'payment', 'closed', 'gated', p_actor_id);

    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id,
        'deal_closed',
        'deal',
        p_deal_id,
        jsonb_build_object(
            'deal_id', p_deal_id,
            'from_stage', 'payment',
            'to_stage', 'closed',
            'gate', 'mutual_close',
            'confirmation_count', 2,
            'outcome', 'closed'
        ),
        p_ip_address
    );

    FOR v_recipient IN
        SELECT DISTINCT dp.profile_id
          FROM public.deal_participants dp
         WHERE dp.deal_id = p_deal_id
           AND (
               dp.profile_id = v_deal.creator_id
               OR EXISTS (
                   SELECT 1 FROM public.brand_members bm
                    WHERE bm.brand_id = v_deal.brand_id
                      AND bm.profile_id = dp.profile_id
                      AND bm.status::text = 'active'
               )
           )
    LOOP
        INSERT INTO public.notifications (profile_id, tier, title, body, deal_id)
        VALUES (
            v_recipient,
            'important',
            'Deal closed',
            'Both sides confirmed close. This deal thread is now read-only.',
            p_deal_id
        );
    END LOOP;

    RETURN jsonb_build_object(
        'transitioned', true,
        'stage', 'closed',
        'idempotent', false,
        'notifications_handled', true
    );
END;
$$;

-- Lock the parent deal in SHARE mode before every client-visible thread mutation.
-- It conflicts with the close transaction's row update, so a send either lands
-- before Closed or resumes afterward and is rejected.
CREATE OR REPLACE FUNCTION public.enforce_terminal_message_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal_id uuid;
    v_stage text;
BEGIN
    v_deal_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.deal_id ELSE NEW.deal_id END;
    SELECT stage::text INTO v_stage FROM public.deals
     WHERE id = v_deal_id FOR SHARE;
    IF v_stage IN ('closed', 'declined', 'cancelled') THEN
        RAISE EXCEPTION 'DEAL_THREAD_READ_ONLY';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.deal_id <> NEW.deal_id THEN
        RAISE EXCEPTION 'DEAL_MESSAGE_PARENT_IMMUTABLE';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER messages_terminal_mutation_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_terminal_message_mutation();

CREATE OR REPLACE FUNCTION public.enforce_terminal_attachment_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_message_id uuid;
    v_stage text;
BEGIN
    v_message_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.message_id ELSE NEW.message_id END;
    SELECT d.stage::text INTO v_stage
      FROM public.messages m
      JOIN public.deals d ON d.id = m.deal_id
     WHERE m.id = v_message_id
     FOR SHARE OF d;
    IF v_stage IS NULL AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF v_stage IS NULL THEN RAISE EXCEPTION 'DEAL_ATTACHMENT_PARENT_MISSING'; END IF;
    IF v_stage IN ('closed', 'declined', 'cancelled') THEN
        RAISE EXCEPTION 'DEAL_THREAD_READ_ONLY';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.message_id <> NEW.message_id THEN
        RAISE EXCEPTION 'DEAL_ATTACHMENT_PARENT_IMMUTABLE';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER message_attachments_terminal_mutation_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.message_attachments
FOR EACH ROW EXECUTE FUNCTION public.enforce_terminal_attachment_mutation();

REVOKE ALL ON FUNCTION public.enforce_deal_close_confirmation_identity()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.deal_close_status_code(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.deal_close_guard_code(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_deal_close_status_code(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_payment_to_closed_gate()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_deal_close(uuid, uuid, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_terminal_message_mutation()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_terminal_attachment_mutation()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_deal_close_status_code(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_deal_close(uuid, uuid, uuid, text) TO service_role;
