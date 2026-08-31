-- ============================================================
-- 036_live_post_gate.sql
-- Workplan 9.14-A: verified live-post history and atomic stage gates
-- Depends on: 035_private_deliverable_label_lifecycle_lock.sql
-- ============================================================

-- Existing proof values have no trustworthy verification/version provenance.
-- Fail closed rather than silently blessing or rewriting them.
DO $$
DECLARE
    v_historical_values bigint;
BEGIN
    SELECT count(*) INTO v_historical_values
      FROM public.deliverables
     WHERE live_post_url IS NOT NULL OR post_metadata IS NOT NULL;
    IF v_historical_values > 0 THEN
        RAISE EXCEPTION 'LIVE_POST_MIGRATION_BLOCKED historical_values=%', v_historical_values;
    END IF;
END;
$$;

CREATE TABLE public.live_post_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deliverable_id uuid NOT NULL REFERENCES public.deliverables(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK (version > 0),
    submitted_url text NOT NULL CHECK (length(submitted_url) BETWEEN 1 AND 2048),
    final_url text NOT NULL CHECK (length(final_url) BETWEEN 1 AND 2048),
    final_host text NOT NULL CHECK (
        length(final_host) BETWEEN 3 AND 253
        AND final_host = lower(final_host)
        AND final_host !~ '[/:@]'
    ),
    preview_title text CHECK (preview_title IS NULL OR length(preview_title) BETWEEN 1 AND 200),
    preview_site_name text CHECK (preview_site_name IS NULL OR length(preview_site_name) BETWEEN 1 AND 120),
    preview_description text CHECK (preview_description IS NULL OR length(preview_description) BETWEEN 1 AND 500),
    status text NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'flagged', 'confirmed')),
    submitted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    verified_at timestamptz NOT NULL DEFAULT now(),
    flagged_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    flagged_at timestamptz,
    flag_reason text CHECK (flag_reason IS NULL OR length(flag_reason) BETWEEN 3 AND 500),
    confirmed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    confirmed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (deliverable_id, version),
    CONSTRAINT live_post_decision_consistent CHECK (
        (status = 'verified'
         AND flagged_by IS NULL AND flagged_at IS NULL AND flag_reason IS NULL
         AND confirmed_by IS NULL AND confirmed_at IS NULL)
        OR
        (status = 'flagged'
         AND flagged_by IS NOT NULL AND flagged_at IS NOT NULL AND flag_reason IS NOT NULL
         AND confirmed_by IS NULL AND confirmed_at IS NULL)
        OR
        (status = 'confirmed'
         AND flagged_by IS NULL AND flagged_at IS NULL AND flag_reason IS NULL
         AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
    )
);

CREATE INDEX live_post_submissions_deliverable_history
    ON public.live_post_submissions (deliverable_id, version DESC);

ALTER TABLE public.deliverables
    ADD COLUMN current_live_post_submission_id uuid
        REFERENCES public.live_post_submissions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX deliverables_current_live_post_binding_unique
    ON public.deliverables (current_live_post_submission_id)
    WHERE current_live_post_submission_id IS NOT NULL;

ALTER TABLE public.live_post_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_post_submissions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.live_post_submissions TO service_role;

-- Participant delivery reads stay deliberately column-limited. URLs, preview
-- evidence and lifecycle decisions flow only through the authenticated API.
REVOKE SELECT ON public.deliverables FROM PUBLIC, anon, authenticated;
GRANT SELECT (
    id, deal_id, sequence, content_format, platform, posting_date,
    posting_window_start, posting_window_end, location, revision_max,
    revision_current, status, created_at, updated_at,
    content_ops_attention, content_ops_reason
) ON public.deliverables TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.deliverables
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.deliverables TO service_role;

CREATE FUNCTION public.submit_verified_live_post(
    p_deal_id uuid,
    p_deliverable_id uuid,
    p_actor_id uuid,
    p_expected_version integer,
    p_submitted_url text,
    p_final_url text,
    p_final_host text,
    p_preview_title text,
    p_preview_site_name text,
    p_preview_description text,
    p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal public.deals%ROWTYPE;
    v_deliverable public.deliverables%ROWTYPE;
    v_current public.live_post_submissions%ROWTYPE;
    v_created public.live_post_submissions%ROWTYPE;
    v_actual_version integer := 0;
    v_remaining integer;
    v_transitioned boolean := false;
BEGIN
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_POST_DEAL_NOT_FOUND'; END IF;

    -- Identity/role checks precede stage, object and state details.
    IF v_deal.creator_id <> p_actor_id OR NOT EXISTS (
        SELECT 1 FROM public.deal_participants
         WHERE deal_id = p_deal_id AND profile_id = p_actor_id
           AND participant_role::text = 'creator'
    ) THEN RAISE EXCEPTION 'LIVE_POST_CREATOR_ONLY'; END IF;

    SELECT * INTO v_deliverable FROM public.deliverables
     WHERE id = p_deliverable_id AND deal_id = p_deal_id
       AND source_summary_id IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_POST_DELIVERABLE_NOT_FOUND'; END IF;

    IF v_deliverable.current_live_post_submission_id IS NOT NULL THEN
        SELECT * INTO v_current FROM public.live_post_submissions
         WHERE id = v_deliverable.current_live_post_submission_id FOR UPDATE;
        IF NOT FOUND OR v_current.deliverable_id <> p_deliverable_id THEN
            RAISE EXCEPTION 'LIVE_POST_BINDING_INVALID';
        END IF;
        v_actual_version := v_current.version;
    END IF;

    -- An identical network retry after a successful commit never creates a new
    -- version or duplicate transition, even if the deal has since advanced.
    IF v_actual_version = p_expected_version + 1
       AND v_current.submitted_url = btrim(p_submitted_url)
       AND v_current.final_url = p_final_url
       AND v_current.status IN ('verified', 'confirmed') THEN
        RETURN jsonb_build_object(
            'submission_id', v_current.id, 'version', v_current.version,
            'status', v_current.status, 'stage', v_deal.stage::text,
            'transitioned', false, 'idempotent', true
        );
    END IF;

    IF p_expected_version IS NULL OR p_expected_version < 0
       OR v_actual_version <> p_expected_version THEN
        RAISE EXCEPTION 'LIVE_POST_STALE_VERSION';
    END IF;
    IF v_deal.stage::text = 'creating' THEN
        IF v_actual_version <> 0 OR v_deliverable.status::text <> 'approved'
           OR v_deliverable.content_ops_attention THEN
            RAISE EXCEPTION 'LIVE_POST_NOT_APPROVED';
        END IF;
    ELSIF v_deal.stage::text = 'posted' THEN
        IF v_actual_version = 0 OR v_current.status <> 'flagged'
           OR v_deliverable.status::text <> 'posted' THEN
            RAISE EXCEPTION 'LIVE_POST_NOT_FLAGGED';
        END IF;
    ELSE
        RAISE EXCEPTION 'LIVE_POST_WRONG_STAGE';
    END IF;

    IF length(btrim(p_submitted_url)) NOT BETWEEN 1 AND 2048
       OR length(p_final_url) NOT BETWEEN 1 AND 2048
       OR p_final_url NOT LIKE 'https://%'
       OR length(p_final_host) NOT BETWEEN 3 AND 253
       OR p_final_host <> lower(p_final_host)
       OR p_final_host ~ '[/:@]'
       OR (p_preview_title IS NOT NULL AND length(p_preview_title) NOT BETWEEN 1 AND 200)
       OR (p_preview_site_name IS NOT NULL AND length(p_preview_site_name) NOT BETWEEN 1 AND 120)
       OR (p_preview_description IS NOT NULL AND length(p_preview_description) NOT BETWEEN 1 AND 500) THEN
        RAISE EXCEPTION 'LIVE_POST_INVALID_EVIDENCE';
    END IF;

    INSERT INTO public.live_post_submissions (
        deliverable_id, version, submitted_url, final_url, final_host,
        preview_title, preview_site_name, preview_description, submitted_by
    ) VALUES (
        p_deliverable_id, p_expected_version + 1, btrim(p_submitted_url),
        p_final_url, p_final_host, p_preview_title, p_preview_site_name,
        p_preview_description, p_actor_id
    ) RETURNING * INTO v_created;

    UPDATE public.deliverables
       SET current_live_post_submission_id = v_created.id,
           live_post_url = v_created.final_url,
           post_metadata = jsonb_strip_nulls(jsonb_build_object(
               'version', v_created.version,
               'verified_at', v_created.verified_at,
               'title', v_created.preview_title,
               'site_name', v_created.preview_site_name,
               'description', v_created.preview_description
           )),
           status = 'posted',
           updated_at = now()
     WHERE id = p_deliverable_id;

    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'live_post_verified', 'deliverable', p_deliverable_id,
        jsonb_build_object(
            'deal_id', p_deal_id, 'submission_id', v_created.id,
            'version', v_created.version, 'host', v_created.final_host,
            'outcome', 'verified', 'replacement', p_expected_version > 0
        ), p_ip_address
    );

    SELECT count(*) INTO v_remaining
      FROM public.deliverables d
      LEFT JOIN public.live_post_submissions s ON s.id = d.current_live_post_submission_id
     WHERE d.deal_id = p_deal_id
       AND d.source_summary_id IS NOT NULL
       AND (
           d.status::text <> 'posted'
           OR s.id IS NULL
           OR s.status NOT IN ('verified', 'confirmed')
       );

    IF v_remaining = 0 AND v_deal.stage::text = 'creating' THEN
        v_transitioned := public.apply_stage_transition(
            p_deal_id, 'creating', 'posted', 'gated', p_actor_id, false,
            'deal_posted', p_actor_id,
            jsonb_build_object(
                'deliverable_count', (
                    SELECT count(*) FROM public.deliverables
                     WHERE deal_id = p_deal_id AND source_summary_id IS NOT NULL
                ),
                'submission_id', v_created.id, 'version', v_created.version,
                'host', v_created.final_host, 'outcome', 'all_posts_verified'
            ), p_ip_address
        );
        IF NOT v_transitioned THEN RAISE EXCEPTION 'LIVE_POST_STAGE_RACE'; END IF;
    END IF;

    RETURN jsonb_build_object(
        'submission_id', v_created.id, 'version', v_created.version,
        'status', v_created.status,
        'stage', CASE WHEN v_transitioned THEN 'posted' ELSE v_deal.stage::text END,
        'transitioned', v_transitioned, 'idempotent', false
    );
END;
$$;

CREATE FUNCTION public.flag_live_post(
    p_deal_id uuid,
    p_deliverable_id uuid,
    p_actor_id uuid,
    p_expected_version integer,
    p_reason text,
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
    v_deliverable public.deliverables%ROWTYPE;
    v_current public.live_post_submissions%ROWTYPE;
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
    IF v_deal.stage::text <> 'posted' THEN RAISE EXCEPTION 'LIVE_POST_WRONG_STAGE'; END IF;
    IF length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'LIVE_POST_INVALID_REASON'; END IF;

    SELECT * INTO v_deliverable FROM public.deliverables
     WHERE id = p_deliverable_id AND deal_id = p_deal_id
       AND source_summary_id IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_POST_DELIVERABLE_NOT_FOUND'; END IF;
    SELECT * INTO v_current FROM public.live_post_submissions
     WHERE id = v_deliverable.current_live_post_submission_id FOR UPDATE;
    IF NOT FOUND OR v_current.deliverable_id <> p_deliverable_id THEN
        RAISE EXCEPTION 'LIVE_POST_BINDING_INVALID';
    END IF;
    IF v_current.version <> p_expected_version THEN RAISE EXCEPTION 'LIVE_POST_STALE_VERSION'; END IF;
    IF v_current.status = 'flagged' AND v_current.flag_reason = btrim(p_reason)
       AND v_current.flagged_by = p_actor_id THEN
        RETURN jsonb_build_object(
            'submission_id', v_current.id, 'version', v_current.version,
            'status', 'flagged', 'stage', 'posted', 'idempotent', true
        );
    END IF;
    IF v_current.status <> 'verified' THEN RAISE EXCEPTION 'LIVE_POST_NOT_FLAGGABLE'; END IF;

    UPDATE public.live_post_submissions
       SET status = 'flagged', flagged_by = p_actor_id,
           flagged_at = now(), flag_reason = btrim(p_reason)
     WHERE id = v_current.id
     RETURNING * INTO v_current;

    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'live_post_flagged', 'deliverable', p_deliverable_id,
        jsonb_build_object(
            'deal_id', p_deal_id, 'submission_id', v_current.id,
            'version', v_current.version, 'host', v_current.final_host,
            'outcome', 'flagged'
        ), p_ip_address
    );
    RETURN jsonb_build_object(
        'submission_id', v_current.id, 'version', v_current.version,
        'status', 'flagged', 'stage', 'posted', 'idempotent', false
    );
END;
$$;

CREATE FUNCTION public.confirm_live_posts(
    p_deal_id uuid,
    p_actor_id uuid,
    p_versions jsonb,
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
            'versions', v_versions
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
        jsonb_build_object('versions', v_versions, 'outcome', 'all_posts_confirmed'),
        p_ip_address
    );
    IF NOT v_transitioned THEN RAISE EXCEPTION 'LIVE_POST_STAGE_RACE'; END IF;
    RETURN jsonb_build_object(
        'transitioned', true, 'idempotent', false, 'stage', 'payment',
        'versions', v_versions
    );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_verified_live_post(
    uuid, uuid, uuid, integer, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.flag_live_post(uuid, uuid, uuid, integer, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_live_posts(uuid, uuid, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.submit_verified_live_post(
    uuid, uuid, uuid, integer, text, text, text, text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.flag_live_post(uuid, uuid, uuid, integer, text, text)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_live_posts(uuid, uuid, jsonb, text)
    TO service_role;
