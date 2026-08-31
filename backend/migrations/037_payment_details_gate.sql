-- ============================================================
-- 037_payment_details_gate.sql
-- Workplan 9.15-A: two-sided payment-information backend gate
-- Depends on: 036_live_post_gate.sql
--
-- Capture only. No invoice generation, payment verification or money movement.
-- ============================================================

-- The development inventory was empty before this migration was authored. If
-- another environment has historical rows, stop for explicit field/provenance
-- review rather than inventing placeholders or silently attributing an actor.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.deal_payment_details) THEN
        RAISE EXCEPTION 'PAYMENT_DETAILS_EXISTING_ROWS_REQUIRE_REVIEW';
    END IF;
END;
$$;

ALTER TABLE public.deal_payment_details
    ALTER COLUMN creator_legal_name DROP NOT NULL,
    ALTER COLUMN creator_bank_or_upi DROP NOT NULL,
    ALTER COLUMN brand_billing_name DROP NOT NULL,
    ALTER COLUMN brand_billing_address DROP NOT NULL,
    ADD COLUMN creator_version integer NOT NULL DEFAULT 0,
    ADD COLUMN brand_version integer NOT NULL DEFAULT 0,
    ADD COLUMN creator_updated_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    ADD COLUMN creator_updated_at timestamptz,
    ADD COLUMN brand_updated_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    ADD COLUMN brand_updated_at timestamptz;

ALTER TABLE public.deal_payment_details
    ADD CONSTRAINT deal_payment_details_creator_version_nonnegative
        CHECK (creator_version >= 0),
    ADD CONSTRAINT deal_payment_details_brand_version_nonnegative
        CHECK (brand_version >= 0),
    ADD CONSTRAINT deal_payment_details_creator_evidence_consistent CHECK (
        (creator_version = 0
            AND creator_legal_name IS NULL
            AND creator_bank_or_upi IS NULL
            AND creator_tax_id IS NULL
            AND creator_updated_by IS NULL
            AND creator_updated_at IS NULL)
        OR
        (creator_version > 0
            AND creator_legal_name IS NOT NULL
            AND creator_bank_or_upi IS NOT NULL
            AND creator_updated_by IS NOT NULL
            AND creator_updated_at IS NOT NULL)
    ),
    ADD CONSTRAINT deal_payment_details_brand_evidence_consistent CHECK (
        (brand_version = 0
            AND brand_billing_name IS NULL
            AND brand_billing_address IS NULL
            AND brand_gst IS NULL
            AND brand_updated_by IS NULL
            AND brand_updated_at IS NULL)
        OR
        (brand_version > 0
            AND brand_billing_name IS NOT NULL
            AND brand_billing_address IS NOT NULL
            AND brand_updated_by IS NOT NULL
            AND brand_updated_at IS NOT NULL)
    ),
    ADD CONSTRAINT deal_payment_details_creator_legal_name_valid CHECK (
        creator_legal_name IS NULL OR (
            creator_legal_name = btrim(creator_legal_name)
            AND length(creator_legal_name) BETWEEN 1 AND 200
            AND creator_legal_name !~ '[[:cntrl:]]'
        )
    ),
    ADD CONSTRAINT deal_payment_details_creator_instruction_valid CHECK (
        creator_bank_or_upi IS NULL OR (
            creator_bank_or_upi = btrim(creator_bank_or_upi)
            AND length(creator_bank_or_upi) BETWEEN 1 AND 500
            AND creator_bank_or_upi !~ '[[:cntrl:]]'
        )
    ),
    ADD CONSTRAINT deal_payment_details_creator_tax_id_valid CHECK (
        creator_tax_id IS NULL OR (
            creator_tax_id = btrim(creator_tax_id)
            AND length(creator_tax_id) BETWEEN 1 AND 64
            AND creator_tax_id !~ '[[:cntrl:]]'
        )
    ),
    ADD CONSTRAINT deal_payment_details_brand_billing_name_valid CHECK (
        brand_billing_name IS NULL OR (
            brand_billing_name = btrim(brand_billing_name)
            AND length(brand_billing_name) BETWEEN 1 AND 200
            AND brand_billing_name !~ '[[:cntrl:]]'
        )
    ),
    ADD CONSTRAINT deal_payment_details_brand_billing_address_valid CHECK (
        brand_billing_address IS NULL OR (
            brand_billing_address = btrim(brand_billing_address)
            AND length(brand_billing_address) BETWEEN 1 AND 1000
            AND brand_billing_address !~ '[[:cntrl:]]'
        )
    ),
    ADD CONSTRAINT deal_payment_details_brand_gst_valid CHECK (
        brand_gst IS NULL OR (
            brand_gst = btrim(brand_gst)
            AND length(brand_gst) BETWEEN 1 AND 64
            AND brand_gst !~ '[[:cntrl:]]'
        )
    );

-- The API projection is the only participant read path. SECURITY DEFINER RPCs
-- are the sole write path, including for service_role callers.
DROP POLICY IF EXISTS "deal_payment_details_participant" ON public.deal_payment_details;
REVOKE ALL ON public.deal_payment_details FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.deal_payment_details TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_payment_details_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.deal_id IS DISTINCT FROM OLD.deal_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'PAYMENT_DETAILS_IDENTITY_IMMUTABLE';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deal_payment_details_identity_immutable ON public.deal_payment_details;
CREATE TRIGGER deal_payment_details_identity_immutable
BEFORE UPDATE ON public.deal_payment_details
FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_details_identity();

CREATE OR REPLACE FUNCTION public.prevent_payment_details_direct_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF pg_trigger_depth() <= 1 THEN
        RAISE EXCEPTION 'PAYMENT_DETAILS_DIRECT_DELETE_FORBIDDEN';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS deal_payment_details_no_direct_delete ON public.deal_payment_details;
CREATE TRIGGER deal_payment_details_no_direct_delete
BEFORE DELETE ON public.deal_payment_details
FOR EACH ROW EXECUTE FUNCTION public.prevent_payment_details_direct_delete();

CREATE OR REPLACE FUNCTION public.update_creator_payment_details(
    p_deal_id uuid,
    p_actor_id uuid,
    p_expected_version integer,
    p_creator_legal_name text,
    p_creator_bank_or_upi text,
    p_creator_tax_id text,
    p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal public.deals%ROWTYPE;
    v_details public.deal_payment_details%ROWTYPE;
    v_actual_version integer := 0;
    v_legal_name text := btrim(p_creator_legal_name);
    v_instruction text := btrim(p_creator_bank_or_upi);
    v_tax_id text := NULLIF(btrim(p_creator_tax_id), '');
BEGIN
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_DETAILS_DEAL_NOT_FOUND'; END IF;
    IF v_deal.creator_id <> p_actor_id OR NOT EXISTS (
        SELECT 1 FROM public.deal_participants
         WHERE deal_id = p_deal_id AND profile_id = p_actor_id
           AND participant_role::text = 'creator'
    ) THEN RAISE EXCEPTION 'PAYMENT_DETAILS_CREATOR_ONLY'; END IF;
    IF v_deal.stage::text <> 'posted' THEN RAISE EXCEPTION 'PAYMENT_DETAILS_WRONG_STAGE'; END IF;

    IF p_expected_version IS NULL OR p_expected_version < 0 THEN
        RAISE EXCEPTION 'PAYMENT_DETAILS_INVALID_VERSION';
    END IF;
    IF v_legal_name IS NULL OR length(v_legal_name) NOT BETWEEN 1 AND 200
       OR v_legal_name ~ '[[:cntrl:]]'
       OR v_instruction IS NULL OR length(v_instruction) NOT BETWEEN 1 AND 500
       OR v_instruction ~ '[[:cntrl:]]'
       OR (v_tax_id IS NOT NULL AND (
           length(v_tax_id) NOT BETWEEN 1 AND 64 OR v_tax_id ~ '[[:cntrl:]]'
       )) THEN RAISE EXCEPTION 'PAYMENT_DETAILS_INVALID_FIELDS'; END IF;

    SELECT * INTO v_details FROM public.deal_payment_details
     WHERE deal_id = p_deal_id FOR UPDATE;
    IF FOUND THEN v_actual_version := v_details.creator_version; END IF;

    IF FOUND
       AND v_details.creator_legal_name IS NOT DISTINCT FROM v_legal_name
       AND v_details.creator_bank_or_upi IS NOT DISTINCT FROM v_instruction
       AND v_details.creator_tax_id IS NOT DISTINCT FROM v_tax_id
       AND p_expected_version IN (v_actual_version, v_actual_version - 1) THEN
        RETURN jsonb_build_object(
            'details_id', v_details.id, 'side', 'creator',
            'version', v_actual_version, 'complete', true, 'idempotent', true
        );
    END IF;
    IF p_expected_version <> v_actual_version THEN
        RAISE EXCEPTION 'PAYMENT_DETAILS_STALE_VERSION';
    END IF;

    IF v_details.id IS NULL THEN
        INSERT INTO public.deal_payment_details (
            deal_id, creator_legal_name, creator_bank_or_upi, creator_tax_id,
            creator_version, creator_updated_by, creator_updated_at
        ) VALUES (
            p_deal_id, v_legal_name, v_instruction, v_tax_id,
            1, p_actor_id, now()
        ) RETURNING * INTO v_details;
    ELSE
        UPDATE public.deal_payment_details
           SET creator_legal_name = v_legal_name,
               creator_bank_or_upi = v_instruction,
               creator_tax_id = v_tax_id,
               creator_version = v_actual_version + 1,
               creator_updated_by = p_actor_id,
               creator_updated_at = now()
         WHERE id = v_details.id
         RETURNING * INTO v_details;
    END IF;

    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'payment_details_updated', 'deal_payment_details', v_details.id,
        jsonb_build_object(
            'deal_id', p_deal_id, 'side', 'creator', 'actor_id', p_actor_id,
            'version', v_details.creator_version, 'complete', true, 'outcome', 'saved'
        ), p_ip_address
    );
    RETURN jsonb_build_object(
        'details_id', v_details.id, 'side', 'creator',
        'version', v_details.creator_version, 'complete', true, 'idempotent', false
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_brand_payment_details(
    p_deal_id uuid,
    p_actor_id uuid,
    p_expected_version integer,
    p_brand_billing_name text,
    p_brand_billing_address text,
    p_brand_gst text,
    p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal public.deals%ROWTYPE;
    v_details public.deal_payment_details%ROWTYPE;
    v_role text;
    v_actual_version integer := 0;
    v_billing_name text := btrim(p_brand_billing_name);
    v_billing_address text := btrim(p_brand_billing_address);
    v_gst text := NULLIF(btrim(p_brand_gst), '');
BEGIN
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_DETAILS_DEAL_NOT_FOUND'; END IF;
    SELECT participant_role::text INTO v_role FROM public.deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role IS NULL THEN RAISE EXCEPTION 'PAYMENT_DETAILS_NOT_PARTICIPANT'; END IF;
    IF v_role NOT IN ('brand_admin', 'brand_maker') OR NOT EXISTS (
        SELECT 1 FROM public.brand_members
         WHERE brand_id = v_deal.brand_id AND profile_id = p_actor_id
           AND status::text = 'active'
    ) THEN RAISE EXCEPTION 'PAYMENT_DETAILS_BRAND_ONLY'; END IF;
    IF v_deal.stage::text <> 'posted' THEN RAISE EXCEPTION 'PAYMENT_DETAILS_WRONG_STAGE'; END IF;

    IF p_expected_version IS NULL OR p_expected_version < 0 THEN
        RAISE EXCEPTION 'PAYMENT_DETAILS_INVALID_VERSION';
    END IF;
    IF v_billing_name IS NULL OR length(v_billing_name) NOT BETWEEN 1 AND 200
       OR v_billing_name ~ '[[:cntrl:]]'
       OR v_billing_address IS NULL OR length(v_billing_address) NOT BETWEEN 1 AND 1000
       OR v_billing_address ~ '[[:cntrl:]]'
       OR (v_gst IS NOT NULL AND (
           length(v_gst) NOT BETWEEN 1 AND 64 OR v_gst ~ '[[:cntrl:]]'
       )) THEN RAISE EXCEPTION 'PAYMENT_DETAILS_INVALID_FIELDS'; END IF;

    SELECT * INTO v_details FROM public.deal_payment_details
     WHERE deal_id = p_deal_id FOR UPDATE;
    IF FOUND THEN v_actual_version := v_details.brand_version; END IF;

    IF FOUND
       AND v_details.brand_billing_name IS NOT DISTINCT FROM v_billing_name
       AND v_details.brand_billing_address IS NOT DISTINCT FROM v_billing_address
       AND v_details.brand_gst IS NOT DISTINCT FROM v_gst
       AND p_expected_version IN (v_actual_version, v_actual_version - 1) THEN
        RETURN jsonb_build_object(
            'details_id', v_details.id, 'side', 'brand',
            'version', v_actual_version, 'complete', true, 'idempotent', true
        );
    END IF;
    IF p_expected_version <> v_actual_version THEN
        RAISE EXCEPTION 'PAYMENT_DETAILS_STALE_VERSION';
    END IF;

    IF v_details.id IS NULL THEN
        INSERT INTO public.deal_payment_details (
            deal_id, brand_billing_name, brand_billing_address, brand_gst,
            brand_version, brand_updated_by, brand_updated_at
        ) VALUES (
            p_deal_id, v_billing_name, v_billing_address, v_gst,
            1, p_actor_id, now()
        ) RETURNING * INTO v_details;
    ELSE
        UPDATE public.deal_payment_details
           SET brand_billing_name = v_billing_name,
               brand_billing_address = v_billing_address,
               brand_gst = v_gst,
               brand_version = v_actual_version + 1,
               brand_updated_by = p_actor_id,
               brand_updated_at = now()
         WHERE id = v_details.id
         RETURNING * INTO v_details;
    END IF;

    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'payment_details_updated', 'deal_payment_details', v_details.id,
        jsonb_build_object(
            'deal_id', p_deal_id, 'side', 'brand', 'actor_id', p_actor_id,
            'version', v_details.brand_version, 'complete', true, 'outcome', 'saved'
        ), p_ip_address
    );
    RETURN jsonb_build_object(
        'details_id', v_details.id, 'side', 'brand',
        'version', v_details.brand_version, 'complete', true, 'idempotent', false
    );
END;
$$;

-- Replace migration 036's four-argument contract; leaving it callable would
-- create a route around the payment-information gate.
REVOKE ALL ON FUNCTION public.confirm_live_posts(uuid, uuid, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.confirm_live_posts(uuid, uuid, jsonb, text);

CREATE FUNCTION public.confirm_live_posts(
    p_deal_id uuid,
    p_actor_id uuid,
    p_versions jsonb,
    p_creator_payment_version integer,
    p_brand_payment_version integer,
    p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal public.deals%ROWTYPE;
    v_role text;
    v_details public.deal_payment_details%ROWTYPE;
    v_count integer;
    v_input_count integer;
    v_transitioned boolean;
    v_versions jsonb;
BEGIN
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_POST_DEAL_NOT_FOUND'; END IF;
    SELECT participant_role::text INTO v_role FROM public.deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role IS NULL THEN RAISE EXCEPTION 'LIVE_POST_NOT_PARTICIPANT'; END IF;
    IF v_role NOT IN ('brand_admin', 'brand_maker') OR NOT EXISTS (
        SELECT 1 FROM public.brand_members
         WHERE brand_id = v_deal.brand_id AND profile_id = p_actor_id AND status::text = 'active'
    ) THEN RAISE EXCEPTION 'LIVE_POST_BRAND_ONLY'; END IF;
    IF v_deal.stage::text NOT IN ('posted', 'payment') THEN RAISE EXCEPTION 'LIVE_POST_WRONG_STAGE'; END IF;

    SELECT * INTO v_details FROM public.deal_payment_details
     WHERE deal_id = p_deal_id FOR UPDATE;
    IF NOT FOUND OR v_details.creator_version = 0 OR v_details.brand_version = 0 THEN
        RAISE EXCEPTION 'PAYMENT_DETAILS_INCOMPLETE';
    END IF;
    IF p_creator_payment_version IS NULL OR p_creator_payment_version <= 0
       OR p_brand_payment_version IS NULL OR p_brand_payment_version <= 0
       OR p_creator_payment_version <> v_details.creator_version
       OR p_brand_payment_version <> v_details.brand_version THEN
        RAISE EXCEPTION 'PAYMENT_DETAILS_STALE_CONFIRMATION';
    END IF;

    IF jsonb_typeof(p_versions) <> 'array' OR jsonb_array_length(p_versions) = 0 THEN
        RAISE EXCEPTION 'LIVE_POST_INVALID_SET';
    END IF;
    BEGIN
        SELECT count(*), count(DISTINCT deliverable_id)
          INTO v_input_count, v_count
          FROM jsonb_to_recordset(p_versions) AS x(deliverable_id uuid, version integer)
         WHERE deliverable_id IS NOT NULL AND version > 0;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'LIVE_POST_INVALID_SET';
    END;
    IF v_input_count <> jsonb_array_length(p_versions) OR v_count <> v_input_count THEN
        RAISE EXCEPTION 'LIVE_POST_INVALID_SET';
    END IF;

    SELECT count(*) INTO v_count FROM public.deliverables
     WHERE deal_id = p_deal_id AND source_summary_id IS NOT NULL;
    IF v_count <> v_input_count OR EXISTS (
        SELECT 1
          FROM public.deliverables d
          LEFT JOIN public.live_post_submissions s ON s.id = d.current_live_post_submission_id
          LEFT JOIN jsonb_to_recordset(p_versions) AS x(deliverable_id uuid, version integer)
            ON x.deliverable_id = d.id AND x.version = s.version
         WHERE d.deal_id = p_deal_id AND d.source_summary_id IS NOT NULL
           AND (
               x.deliverable_id IS NULL
               OR d.status::text <> 'posted'
               OR (v_deal.stage::text = 'posted' AND s.status <> 'verified')
               OR (v_deal.stage::text = 'payment' AND s.status <> 'confirmed')
           )
    ) THEN RAISE EXCEPTION 'LIVE_POST_STALE_SET'; END IF;

    SELECT jsonb_agg(
        jsonb_build_object('deliverable_id', d.id, 'submission_id', s.id, 'version', s.version)
        ORDER BY d.sequence
    ) INTO v_versions
      FROM public.deliverables d
      JOIN public.live_post_submissions s ON s.id = d.current_live_post_submission_id
     WHERE d.deal_id = p_deal_id AND d.source_summary_id IS NOT NULL;

    IF v_deal.stage::text = 'payment' THEN
        RETURN jsonb_build_object(
            'transitioned', false, 'idempotent', true, 'stage', 'payment',
            'versions', v_versions,
            'creator_payment_version', v_details.creator_version,
            'brand_payment_version', v_details.brand_version
        );
    END IF;

    UPDATE public.live_post_submissions s
       SET status = 'confirmed', confirmed_by = p_actor_id, confirmed_at = now()
     WHERE s.id IN (
        SELECT d.current_live_post_submission_id FROM public.deliverables d
         WHERE d.deal_id = p_deal_id AND d.source_summary_id IS NOT NULL
     );

    v_transitioned := public.apply_stage_transition(
        p_deal_id, 'posted', 'payment', 'gated', p_actor_id, false,
        'deal_payment_started', p_actor_id,
        jsonb_build_object(
            'versions', v_versions,
            'payment_detail_versions', jsonb_build_object(
                'creator', v_details.creator_version, 'brand', v_details.brand_version
            ),
            'outcome', 'all_posts_and_payment_details_confirmed'
        ), p_ip_address
    );
    IF NOT v_transitioned THEN RAISE EXCEPTION 'LIVE_POST_STAGE_RACE'; END IF;
    RETURN jsonb_build_object(
        'transitioned', true, 'idempotent', false, 'stage', 'payment',
        'versions', v_versions,
        'creator_payment_version', v_details.creator_version,
        'brand_payment_version', v_details.brand_version
    );
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_payment_details_identity()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_payment_details_direct_delete()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_creator_payment_details(
    uuid, uuid, integer, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_brand_payment_details(
    uuid, uuid, integer, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_live_posts(
    uuid, uuid, jsonb, integer, integer, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.update_creator_payment_details(
    uuid, uuid, integer, text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_brand_payment_details(
    uuid, uuid, integer, text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_live_posts(
    uuid, uuid, jsonb, integer, integer, text
) TO service_role;
