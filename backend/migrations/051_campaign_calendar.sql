-- 051_campaign_calendar.sql
-- Workplan 11.3: source-bound rights materialization and participant-safe calendar projection.
-- Additive migration; the implementation below is deliberately kept in one versioned boundary.

ALTER TABLE public.usage_rights
    ADD COLUMN source_summary_id uuid REFERENCES public.ai_summaries(id) ON DELETE RESTRICT;
ALTER TABLE public.blackout_windows
    ADD COLUMN source_summary_id uuid REFERENCES public.ai_summaries(id) ON DELETE RESTRICT;

ALTER TABLE public.usage_rights
    ADD CONSTRAINT usage_rights_canonical_shape CHECK (
        source_summary_id IS NULL OR (
            (NOT has_usage_rights AND COALESCE(cardinality(channels), 0) = 0
             AND duration_days IS NULL AND NOT is_perpetual
             AND start_date IS NULL AND end_date IS NULL)
            OR
            (has_usage_rights AND COALESCE(cardinality(channels), 0) BETWEEN 1 AND 50
             AND start_date IS NOT NULL
             AND (
                 (is_perpetual AND duration_days IS NULL AND end_date IS NULL)
                 OR
                 (NOT is_perpetual AND duration_days BETWEEN 1 AND 36500
                  AND end_date = start_date + (duration_days - 1))
             ))
        )
    ) NOT VALID;
ALTER TABLE public.blackout_windows
    ADD CONSTRAINT blackout_windows_canonical_shape CHECK (
        source_summary_id IS NULL OR (
            (NOT has_blackout AND timing IS NULL AND duration_days IS NULL
             AND start_date IS NULL AND end_date IS NULL)
            OR
            (has_blackout AND timing IS NOT NULL AND duration_days BETWEEN 1 AND 3650
             AND start_date IS NULL AND end_date IS NULL)
        )
    ) NOT VALID;

CREATE UNIQUE INDEX usage_rights_one_canonical_per_deal
    ON public.usage_rights (deal_id) WHERE source_summary_id IS NOT NULL;
CREATE UNIQUE INDEX blackout_windows_one_canonical_per_deal
    ON public.blackout_windows (deal_id) WHERE source_summary_id IS NOT NULL;
CREATE INDEX usage_rights_canonical_source_lookup
    ON public.usage_rights (source_summary_id) WHERE source_summary_id IS NOT NULL;
CREATE INDEX blackout_windows_canonical_source_lookup
    ON public.blackout_windows (source_summary_id) WHERE source_summary_id IS NOT NULL;

DROP POLICY IF EXISTS "usage_rights_participant" ON public.usage_rights;
DROP POLICY IF EXISTS "blackout_windows_participant" ON public.blackout_windows;
DROP POLICY IF EXISTS "usage_rights_participant_read" ON public.usage_rights;
DROP POLICY IF EXISTS "blackout_windows_participant_read" ON public.blackout_windows;
-- Canonical source rows are exposed only through bounded projections. In
-- particular, a stale brand member must not retain raw-table visibility merely
-- because an old deal_participants row still exists.
REVOKE ALL ON public.usage_rights, public.blackout_windows
    FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.usage_rights, public.blackout_windows
    FROM service_role;
GRANT SELECT ON public.usage_rights, public.blackout_windows TO service_role;

CREATE OR REPLACE FUNCTION public.materialize_canonical_calendar_terms(
    p_deal_id uuid,
    p_source_summary_id uuid,
    p_actor_id uuid,
    p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_deal public.deals%ROWTYPE;
    v_terms jsonb;
    v_contract_id uuid;
    v_start_date date;
    v_usage boolean;
    v_duration integer;
    v_perpetual boolean;
    v_channels text[];
    v_blackout boolean;
    v_blackout_duration integer;
    v_timing public.blackout_timing_enum;
    v_usage_count integer;
    v_blackout_count integer;
    v_match boolean;
BEGIN
    IF p_actor_id IS NULL OR p_source_summary_id IS NULL OR p_ip_address IS NULL
       OR length(p_ip_address) NOT BETWEEN 1 AND 255 THEN
        RAISE EXCEPTION 'CALENDAR_TERMS_INVALID_REQUEST';
    END IF;

    SELECT * INTO v_deal
      FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CALENDAR_TERMS_NOT_FOUND'; END IF;

    -- Authorize before disclosing stage, source, or conflict information.
    IF NOT EXISTS (
        SELECT 1 FROM public.deal_participants
         WHERE deal_id = p_deal_id AND profile_id = p_actor_id
    ) THEN RAISE EXCEPTION 'CALENDAR_TERMS_NOT_PARTICIPANT'; END IF;
    IF v_deal.stage::text NOT IN ('approval', 'creating') THEN
        RAISE EXCEPTION 'CALENDAR_TERMS_WRONG_STAGE';
    END IF;

    SELECT s.structured_terms, c.id
      INTO v_terms, v_contract_id
      FROM public.ai_summaries s
      JOIN public.contracts c
       ON c.generated_from_summary_id = s.id
       AND c.deal_id = s.deal_id
       AND c.version = 1
       AND c.status::text = 'executed'
     WHERE s.id = p_source_summary_id
       AND s.deal_id = p_deal_id
       AND s.status::text = 'approved'
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 1;
    IF v_contract_id IS NULL
       OR NOT public.payment_tracking_valid_terms_extraction(v_terms) THEN
        RAISE EXCEPTION 'CALENDAR_TERMS_UNTRUSTED_SOURCE';
    END IF;

    SELECT min(a.created_at AT TIME ZONE 'UTC')::date
      INTO v_start_date
      FROM public.audit_log a
     WHERE a.entity_type = 'deal'
       AND a.entity_id = p_deal_id
       AND a.action = 'contract_executed'
       AND a.metadata->>'contract_id' = v_contract_id::text;
    IF v_start_date IS NULL THEN
        RAISE EXCEPTION 'CALENDAR_TERMS_UNTRUSTED_SOURCE';
    END IF;

    IF v_terms #>> '{usage_rights,status}' <> 'found'
       OR jsonb_typeof(v_terms #> '{usage_rights,value}') <> 'boolean'
       OR v_terms #>> '{blackout_window,status}' <> 'found'
       OR jsonb_typeof(v_terms #> '{blackout_window,value}') <> 'boolean' THEN
        RAISE EXCEPTION 'CALENDAR_TERMS_UNTRUSTED_SOURCE';
    END IF;
    v_usage := (v_terms #>> '{usage_rights,value}')::boolean;
    v_blackout := (v_terms #>> '{blackout_window,value}')::boolean;
    IF v_usage THEN
        IF v_terms #>> '{usage_rights_duration,status}' <> 'found'
           OR v_terms #>> '{usage_rights_channels,status}' <> 'found' THEN
            RAISE EXCEPTION 'CALENDAR_TERMS_UNTRUSTED_SOURCE';
        END IF;
        v_duration := (v_terms #>> '{usage_rights_duration,value,duration_days}')::integer;
        v_perpetual := (v_terms #>> '{usage_rights_duration,value,is_perpetual}')::boolean;
        SELECT array_agg(value ORDER BY ordinal)
          INTO v_channels
          FROM jsonb_array_elements_text(v_terms #> '{usage_rights_channels,value}')
               WITH ORDINALITY AS channel(value, ordinal);
    ELSE
        v_duration := NULL; v_perpetual := false; v_channels := ARRAY[]::text[];
    END IF;
    IF v_blackout THEN
        IF v_terms #>> '{blackout_duration_timing,status}' <> 'found' THEN
            RAISE EXCEPTION 'CALENDAR_TERMS_UNTRUSTED_SOURCE';
        END IF;
        v_blackout_duration := (v_terms #>> '{blackout_duration_timing,value,duration_days}')::integer;
        v_timing := (v_terms #>> '{blackout_duration_timing,value,timing}')::public.blackout_timing_enum;
    ELSE
        v_blackout_duration := NULL; v_timing := NULL;
    END IF;

    SELECT count(*) INTO v_usage_count FROM public.usage_rights WHERE deal_id = p_deal_id;
    SELECT count(*) INTO v_blackout_count FROM public.blackout_windows WHERE deal_id = p_deal_id;
    IF v_usage_count > 0 OR v_blackout_count > 0 THEN
        SELECT v_usage_count = 1 AND v_blackout_count = 1
           AND EXISTS (
               SELECT 1 FROM public.usage_rights u
                WHERE u.deal_id = p_deal_id
                  AND u.source_summary_id = p_source_summary_id
                  AND u.has_usage_rights = v_usage
                  AND u.channels IS NOT DISTINCT FROM v_channels
                  AND u.duration_days IS NOT DISTINCT FROM v_duration
                  AND u.is_perpetual = v_perpetual
                  AND u.start_date IS NOT DISTINCT FROM CASE WHEN v_usage THEN v_start_date ELSE NULL END
                  AND u.end_date IS NOT DISTINCT FROM CASE
                      WHEN v_usage AND NOT v_perpetual THEN v_start_date + (v_duration - 1)
                      ELSE NULL END
           ) AND EXISTS (
               SELECT 1 FROM public.blackout_windows b
                WHERE b.deal_id = p_deal_id
                  AND b.source_summary_id = p_source_summary_id
                  AND b.has_blackout = v_blackout
                  AND b.timing IS NOT DISTINCT FROM v_timing
                  AND b.duration_days IS NOT DISTINCT FROM v_blackout_duration
                  AND b.start_date IS NULL AND b.end_date IS NULL
           ) INTO v_match;
        IF v_match THEN
            RETURN jsonb_build_object(
                'outcome', 'existing', 'idempotent', true, 'deal_id', p_deal_id,
                'source_summary_id', p_source_summary_id
            );
        END IF;
        RAISE EXCEPTION 'CALENDAR_TERMS_EXISTING_CONFLICT';
    END IF;

    INSERT INTO public.usage_rights (
        deal_id, has_usage_rights, channels, duration_days, is_perpetual,
        start_date, end_date, source_summary_id
    ) VALUES (
        p_deal_id, v_usage, v_channels, v_duration, v_perpetual,
        CASE WHEN v_usage THEN v_start_date ELSE NULL END,
        CASE WHEN v_usage AND NOT v_perpetual THEN v_start_date + (v_duration - 1) ELSE NULL END,
        p_source_summary_id
    );
    INSERT INTO public.blackout_windows (
        deal_id, has_blackout, timing, duration_days, start_date, end_date, source_summary_id
    ) VALUES (
        p_deal_id, v_blackout, v_timing, v_blackout_duration, NULL, NULL, p_source_summary_id
    );
    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'canonical_calendar_terms_materialized', 'deal', p_deal_id,
        jsonb_build_object('source_summary_id', p_source_summary_id,
                           'has_usage_rights', v_usage, 'has_blackout', v_blackout),
        p_ip_address
    );
    RETURN jsonb_build_object(
        'outcome', 'created', 'idempotent', false, 'deal_id', p_deal_id,
        'source_summary_id', p_source_summary_id
    );
EXCEPTION WHEN unique_violation OR check_violation THEN
    RAISE EXCEPTION 'CALENDAR_TERMS_EXISTING_CONFLICT';
END;
$function$;

REVOKE ALL ON FUNCTION public.materialize_canonical_calendar_terms(uuid, uuid, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materialize_canonical_calendar_terms(uuid, uuid, uuid, text)
    TO service_role;

CREATE OR REPLACE FUNCTION public.campaign_calendar_snapshot(
    p_viewer uuid,
    p_as_of timestamptz,
    p_start date,
    p_end date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_result jsonb;
BEGIN
    IF p_viewer IS NULL OR p_as_of IS NULL OR p_start IS NULL OR p_end IS NULL
       OR p_end < p_start OR p_end - p_start NOT BETWEEN 0 AND 41 THEN
        RAISE EXCEPTION 'CAMPAIGN_CALENDAR_INVALID_WINDOW';
    END IF;

    WITH
    viewer AS (
        SELECT CASE WHEN p.account_type::text = 'creator' THEN 'creator' ELSE 'brand' END AS kind
          FROM public.profiles p
         WHERE p.id = p_viewer AND p.account_type::text IN ('creator', 'brand')
    ),
    eligible_deals AS (
        SELECT d.id, d.deal_name, d.creator_id, d.brand_id, v.kind
         FROM public.deals d CROSS JOIN viewer v
         WHERE d.deleted_at IS NULL
           AND d.stage::text IN ('creating', 'posted', 'payment', 'closed')
           AND EXISTS (
               SELECT 1 FROM public.deal_participants dp
                WHERE dp.deal_id = d.id AND dp.profile_id = p_viewer
                  AND (
                      (v.kind = 'creator' AND d.creator_id = p_viewer
                       AND dp.participant_role::text = 'creator')
                      OR
                      (v.kind = 'brand'
                       AND dp.participant_role::text IN ('brand_admin','brand_maker','brand_checker')
                       AND EXISTS (
                           SELECT 1 FROM public.brand_members bm
                            WHERE bm.brand_id = d.brand_id AND bm.profile_id = p_viewer
                              AND bm.status::text = 'active'
                       ))
                  )
           )
    ),
    eligible_guard AS (
        SELECT 1 / CASE WHEN count(*) <= 500 THEN 1 ELSE 0 END AS ok FROM eligible_deals
    ),
    deliverable_sources AS (
        SELECT ed.id AS deal_id,
               count(d.id)::integer AS row_count,
               count(DISTINCT d.source_summary_id)::integer AS source_count,
               min(d.source_summary_id::text)::uuid AS source_summary_id,
               min(d.sequence)::integer AS first_sequence,
               max(d.sequence)::integer AS last_sequence,
               bool_and(d.source_summary_id IS NOT NULL AND (
                   (d.posting_date IS NOT NULL AND d.posting_window_start IS NULL AND d.posting_window_end IS NULL)
                   OR (d.posting_date IS NULL AND d.posting_window_start IS NOT NULL
                       AND d.posting_window_end IS NOT NULL AND d.posting_window_start <= d.posting_window_end)
               )) AS rows_valid
          FROM eligible_deals ed CROSS JOIN eligible_guard eg
          LEFT JOIN public.deliverables d ON d.deal_id = ed.id
         WHERE eg.ok = 1
         GROUP BY ed.id
    ),
    trusted_sources AS (
        SELECT ds.*, s.structured_terms, c.id AS contract_id,
               execution_evidence.execution_count,
               execution_evidence.execution_at,
               (execution_evidence.execution_at AT TIME ZONE 'UTC')::date AS execution_date,
               transition_evidence.transition_at,
               CASE WHEN ds.row_count BETWEEN 1 AND 100
                          AND ds.source_count = 1
                          AND ds.first_sequence = 1 AND ds.last_sequence = ds.row_count
                          AND ds.rows_valid
                          AND s.status::text = 'approved'
                          AND public.payment_tracking_valid_terms_extraction(s.structured_terms)
                          AND s.structured_terms #>> '{deliverable_count,status}' = 'found'
                          AND (s.structured_terms #>> '{deliverable_count,value}')::integer = ds.row_count
                          AND EXISTS (
                              SELECT 1 FROM public.contracts c
                               WHERE c.deal_id = ds.deal_id
                                 AND c.generated_from_summary_id = ds.source_summary_id
                                 AND c.version = 1
                                 AND c.status::text = 'executed'
                          )
                     THEN true ELSE false END AS trusted
          FROM deliverable_sources ds
          LEFT JOIN public.ai_summaries s ON s.id = ds.source_summary_id AND s.deal_id = ds.deal_id
          LEFT JOIN public.contracts c
            ON c.deal_id = ds.deal_id
           AND c.generated_from_summary_id = ds.source_summary_id
           AND c.version = 1
           AND c.status::text = 'executed'
          LEFT JOIN LATERAL (
              SELECT count(*)::integer AS execution_count, min(a.created_at) AS execution_at
                FROM public.audit_log a
               WHERE a.entity_type = 'deal'
                 AND a.entity_id = ds.deal_id
                 AND a.action = 'contract_executed'
                 AND a.metadata->>'contract_id' = c.id::text
          ) execution_evidence ON true
          LEFT JOIN LATERAL (
              SELECT min(t.created_at) AS transition_at
                FROM public.deal_stage_transitions t
               WHERE t.deal_id = ds.deal_id
                 AND t.from_stage::text = 'approval'
                 AND t.to_stage::text = 'creating'
          ) transition_evidence ON true
    ),
    rights_shape AS (
        SELECT ts.deal_id, ts.source_summary_id, ts.structured_terms, ts.trusted,
               ts.contract_id, ts.execution_count, ts.execution_at,
               ts.execution_date, ts.transition_at,
               count(DISTINCT u.id) FILTER (WHERE u.source_summary_id IS NOT NULL)::integer AS usage_count,
               count(DISTINCT b.id) FILTER (WHERE b.source_summary_id IS NOT NULL)::integer AS blackout_count,
               (array_agg(u.id ORDER BY u.id) FILTER (WHERE u.source_summary_id IS NOT NULL))[1] AS usage_id,
               (array_agg(u.source_summary_id ORDER BY u.id) FILTER (WHERE u.source_summary_id IS NOT NULL))[1] AS usage_source,
               (array_agg(u.has_usage_rights ORDER BY u.id) FILTER (WHERE u.source_summary_id IS NOT NULL))[1] AS has_usage,
               (array_agg(u.duration_days ORDER BY u.id) FILTER (WHERE u.source_summary_id IS NOT NULL))[1] AS usage_duration,
               (array_agg(u.is_perpetual ORDER BY u.id) FILTER (WHERE u.source_summary_id IS NOT NULL))[1] AS is_perpetual,
               (array_agg(u.start_date ORDER BY u.id) FILTER (WHERE u.source_summary_id IS NOT NULL))[1] AS rights_start,
               (array_agg(u.end_date ORDER BY u.id) FILTER (WHERE u.source_summary_id IS NOT NULL))[1] AS rights_end,
               (array_agg(b.id ORDER BY b.id) FILTER (WHERE b.source_summary_id IS NOT NULL))[1] AS blackout_id,
               (array_agg(b.source_summary_id ORDER BY b.id) FILTER (WHERE b.source_summary_id IS NOT NULL))[1] AS blackout_source,
               (array_agg(b.has_blackout ORDER BY b.id) FILTER (WHERE b.source_summary_id IS NOT NULL))[1] AS has_blackout,
               (array_agg(b.timing::text ORDER BY b.id) FILTER (WHERE b.source_summary_id IS NOT NULL))[1] AS blackout_timing,
               (array_agg(b.duration_days ORDER BY b.id) FILTER (WHERE b.source_summary_id IS NOT NULL))[1] AS blackout_duration
          FROM trusted_sources ts
          LEFT JOIN public.usage_rights u ON u.deal_id = ts.deal_id
          LEFT JOIN public.blackout_windows b ON b.deal_id = ts.deal_id
         GROUP BY ts.deal_id, ts.source_summary_id, ts.structured_terms, ts.trusted,
                  ts.contract_id, ts.execution_count, ts.execution_at,
                  ts.execution_date, ts.transition_at
    ),
    source_facts AS (
        SELECT rs.*,
               CASE
                   WHEN NOT rs.trusted THEN false
                   WHEN rs.usage_count = 0 AND rs.blackout_count = 0
                        AND rs.contract_id IS NOT NULL
                        AND rs.execution_count = 1
                        AND rs.execution_at IS NOT NULL
                        AND rs.transition_at IS NOT NULL
                        AND rs.execution_at <= rs.transition_at THEN true
                   WHEN rs.usage_count = 1 AND rs.blackout_count = 1
                        AND rs.usage_source = rs.source_summary_id
                        AND rs.blackout_source = rs.source_summary_id THEN true
                   ELSE false
               END AS rights_trusted,
               CASE WHEN rs.usage_count = 1 THEN rs.has_usage
                    ELSE (rs.structured_terms #>> '{usage_rights,value}')::boolean END AS effective_usage,
               CASE WHEN rs.usage_count = 1 THEN rs.is_perpetual
                    ELSE COALESCE((rs.structured_terms #>> '{usage_rights_duration,value,is_perpetual}')::boolean, false) END AS effective_perpetual,
               CASE WHEN rs.usage_count = 1 THEN rs.rights_end
                    WHEN (rs.structured_terms #>> '{usage_rights,value}')::boolean
                         AND NOT (rs.structured_terms #>> '{usage_rights_duration,value,is_perpetual}')::boolean
                    THEN rs.execution_date
                         + ((rs.structured_terms #>> '{usage_rights_duration,value,duration_days}')::integer - 1)
                    ELSE NULL END AS effective_rights_end,
               CASE WHEN rs.blackout_count = 1 THEN rs.has_blackout
                    ELSE (rs.structured_terms #>> '{blackout_window,value}')::boolean END AS effective_blackout,
               CASE WHEN rs.blackout_count = 1 THEN rs.blackout_timing
                    ELSE rs.structured_terms #>> '{blackout_duration_timing,value,timing}' END AS effective_timing,
               CASE WHEN rs.blackout_count = 1 THEN rs.blackout_duration
                    ELSE (rs.structured_terms #>> '{blackout_duration_timing,value,duration_days}')::integer END AS effective_blackout_duration
          FROM rights_shape rs
    ),
    scheduled_events AS (
        SELECT 'scheduled_post:' || d.id::text AS event_id, ed.id AS deal_id,
               ed.deal_name, 'scheduled_post'::text AS kind, d.status::text AS state,
               COALESCE(d.posting_date, d.posting_window_start) AS start_date,
               COALESCE(d.posting_date, d.posting_window_end) AS end_date,
               NULL::timestamptz AS occurred_at,
               left(initcap(replace(d.platform::text, '_', ' ')) || ' · ' ||
                    initcap(replace(d.content_format::text, '_', ' ')), 160) AS label,
               CASE WHEN ed.kind = 'creator' THEN pa.label ELSE NULL END AS creator_label,
               d.sequence AS sequence
          FROM eligible_deals ed
          JOIN source_facts sf ON sf.deal_id = ed.id AND sf.trusted AND sf.rights_trusted
          JOIN public.deliverables d ON d.deal_id = ed.id AND d.source_summary_id = sf.source_summary_id
          LEFT JOIN public.private_annotations pa
            ON ed.kind = 'creator' AND pa.profile_id = p_viewer
           AND pa.entity_type = 'deliverable' AND pa.entity_id = d.id
         WHERE COALESCE(d.posting_date, d.posting_window_end) >= p_start
           AND COALESCE(d.posting_date, d.posting_window_start) <= p_end
    ),
    actual_events AS (
        SELECT 'actual_post:' || s.id::text, ed.id, ed.deal_name, 'actual_post', 'confirmed',
               (s.confirmed_at AT TIME ZONE 'UTC')::date,
               (s.confirmed_at AT TIME ZONE 'UTC')::date, s.confirmed_at,
               'Post confirmed', CASE WHEN ed.kind = 'creator' THEN pa.label ELSE NULL END,
               d.sequence
          FROM eligible_deals ed
          JOIN source_facts sf ON sf.deal_id = ed.id AND sf.trusted AND sf.rights_trusted
          JOIN public.deliverables d ON d.deal_id = ed.id AND d.source_summary_id = sf.source_summary_id
          JOIN public.live_post_submissions s
            ON s.id = d.current_live_post_submission_id AND s.deliverable_id = d.id
           AND s.status = 'confirmed' AND s.confirmed_at IS NOT NULL
          LEFT JOIN public.private_annotations pa
            ON ed.kind = 'creator' AND pa.profile_id = p_viewer
           AND pa.entity_type = 'deliverable' AND pa.entity_id = d.id
         WHERE (s.confirmed_at AT TIME ZONE 'UTC')::date BETWEEN p_start AND p_end
    ),
    payment_shape AS (
        SELECT ed.id AS deal_id, count(p.id)::integer AS payment_count,
               (array_agg(p.id ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS payment_id,
               (array_agg(p.source_summary_id ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS source_summary_id,
               (array_agg(p.structure::text ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS structure,
               (array_agg(p.state::text ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS state,
               (array_agg(p.due_date ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS due_date
          FROM eligible_deals ed
          LEFT JOIN public.payments p ON p.deal_id = ed.id AND p.source_summary_id IS NOT NULL
         GROUP BY ed.id
    ),
    payment_events AS (
        SELECT 'payment_due:' || ps.payment_id::text, ed.id, ed.deal_name, 'payment_due',
               ps.state, ps.due_date, ps.due_date, NULL::timestamptz,
               'Payment due', NULL::text, 0
          FROM payment_shape ps JOIN eligible_deals ed ON ed.id = ps.deal_id
          JOIN source_facts sf ON sf.deal_id = ps.deal_id AND sf.trusted AND sf.rights_trusted
         WHERE ps.payment_count = 1 AND ps.structure = 'single'
           AND ps.source_summary_id = sf.source_summary_id
           AND ps.due_date BETWEEN p_start AND p_end
           AND EXISTS (SELECT 1 FROM public.ai_summaries s
                        WHERE s.id = ps.source_summary_id AND s.deal_id = ps.deal_id
                          AND s.status::text = 'approved')
        UNION ALL
        SELECT 'payment_due:' || m.id::text, ed.id, ed.deal_name, 'payment_due',
               m.state::text, m.due_date, m.due_date, NULL::timestamptz,
               left('Payment due · ' || m.trigger_description, 160), NULL::text, m.sequence
          FROM payment_shape ps JOIN eligible_deals ed ON ed.id = ps.deal_id
          JOIN source_facts sf ON sf.deal_id = ps.deal_id AND sf.trusted AND sf.rights_trusted
          JOIN public.payment_milestones m ON m.payment_id = ps.payment_id
         WHERE ps.payment_count = 1 AND ps.structure IN ('milestone','combination')
           AND ps.source_summary_id = sf.source_summary_id
           AND m.due_date BETWEEN p_start AND p_end
           AND EXISTS (SELECT 1 FROM public.ai_summaries s
                        WHERE s.id = ps.source_summary_id AND s.deal_id = ps.deal_id
                          AND s.status::text = 'approved')
    ),
    rights_events AS (
        SELECT 'rights_expiry:' || COALESCE(sf.usage_id, sf.source_summary_id)::text,
               ed.id, ed.deal_name, 'rights_expiry',
               CASE WHEN sf.effective_rights_end < (p_as_of AT TIME ZONE 'UTC')::date
                    THEN 'expired' ELSE 'active' END,
               sf.effective_rights_end, sf.effective_rights_end, NULL::timestamptz,
               'Usage rights expire', NULL::text, 0
          FROM source_facts sf JOIN eligible_deals ed ON ed.id = sf.deal_id
         WHERE sf.rights_trusted AND sf.effective_usage AND NOT sf.effective_perpetual
           AND sf.effective_rights_end BETWEEN p_start AND p_end
    ),
    all_events AS (
        SELECT * FROM scheduled_events UNION ALL SELECT * FROM actual_events
        UNION ALL SELECT * FROM payment_events UNION ALL SELECT * FROM rights_events
    ),
    event_guard AS (
        SELECT 1 / CASE WHEN count(*) <= 1000 AND count(*) = count(DISTINCT event_id)
                        THEN 1 ELSE 0 END AS ok FROM all_events
    ),
    blackout_raw AS (
        SELECT sf.deal_id,
               CASE side.kind WHEN 'before' THEN
                   COALESCE(d.posting_date, d.posting_window_start) - sf.effective_blackout_duration
                   ELSE COALESCE(d.posting_date, d.posting_window_end) + 1 END AS start_date,
               CASE side.kind WHEN 'before' THEN
                   COALESCE(d.posting_date, d.posting_window_start) - 1
                   ELSE COALESCE(d.posting_date, d.posting_window_end) + sf.effective_blackout_duration END AS end_date
          FROM source_facts sf
          JOIN public.deliverables d ON d.deal_id = sf.deal_id AND d.source_summary_id = sf.source_summary_id
          CROSS JOIN LATERAL (
              SELECT 'before'::text AS kind WHERE sf.effective_timing IN ('before','both')
              UNION ALL SELECT 'after'::text WHERE sf.effective_timing IN ('after','both')
          ) side
         WHERE sf.trusted AND sf.rights_trusted AND sf.effective_blackout
    ),
    blackout_days AS (
        SELECT DISTINCT r.deal_id, day::date AS blackout_date
          FROM blackout_raw r
          CROSS JOIN LATERAL generate_series(
              greatest(r.start_date, p_start)::timestamp,
              least(r.end_date, p_end)::timestamp,
              interval '1 day'
          ) day
         WHERE r.end_date >= p_start AND r.start_date <= p_end
           AND NOT EXISTS (
               SELECT 1 FROM public.deliverables posting
                WHERE posting.deal_id = r.deal_id
                  AND posting.source_summary_id IS NOT NULL
                  AND day::date BETWEEN COALESCE(posting.posting_date, posting.posting_window_start)
                                    AND COALESCE(posting.posting_date, posting.posting_window_end)
           )
    ),
    blackout_grouped AS (
        SELECT bd.*,
               sum(CASE WHEN prior_date IS NULL OR blackout_date > prior_date + 1 THEN 1 ELSE 0 END)
               OVER (PARTITION BY deal_id ORDER BY blackout_date) AS group_no
          FROM (
              SELECT d.*, lag(blackout_date) OVER (PARTITION BY deal_id ORDER BY blackout_date) AS prior_date
                FROM blackout_days d
          ) bd
    ),
    blackout_merged AS (
        SELECT deal_id, min(blackout_date) AS start_date, max(blackout_date) AS end_date
          FROM blackout_grouped
         GROUP BY deal_id, group_no
    ),
    blackout_ranges AS (
        SELECT 'blackout:' || bm.deal_id::text || ':' || bm.start_date::text || ':' || bm.end_date::text AS range_id,
               bm.deal_id, ed.deal_name, bm.start_date, bm.end_date,
               'Blackout period'::text AS label
          FROM blackout_merged bm JOIN eligible_deals ed ON ed.id = bm.deal_id
    ),
    range_guard AS (
        SELECT 1 / CASE WHEN count(*) <= 500 AND count(*) = count(DISTINCT range_id)
                        THEN 1 ELSE 0 END AS ok FROM blackout_ranges
    ),
    integrity AS (
        SELECT count(*) FILTER (WHERE NOT trusted OR NOT rights_trusted)::integer AS issue_count
          FROM source_facts
    ),
    unscheduled AS (
        SELECT count(*)::integer AS payment_due_count FROM (
            SELECT ps.payment_id FROM payment_shape ps
             WHERE ps.payment_count = 1 AND ps.structure = 'single' AND ps.due_date IS NULL
            UNION ALL
            SELECT m.id FROM payment_shape ps
              JOIN public.payment_milestones m ON m.payment_id = ps.payment_id
             WHERE ps.payment_count = 1 AND ps.structure IN ('milestone','combination')
               AND m.due_date IS NULL
        ) rows
    ),
    unscheduled_guard AS (
        SELECT 1 / CASE WHEN payment_due_count <= 1000 THEN 1 ELSE 0 END AS ok
          FROM unscheduled
    )
    SELECT jsonb_build_object(
        'version', 1, 'as_of', to_jsonb(p_as_of), 'viewer_kind', v.kind,
        'start_date', p_start, 'end_date', p_end,
        'unscheduled', jsonb_build_object(
            'payment_due_count', u.payment_due_count,
            'integrity_issue_count', i.issue_count
        ),
        'events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', e.event_id, 'deal_id', e.deal_id,
            'deal_name', COALESCE(NULLIF(left(regexp_replace(btrim(e.deal_name), '[[:cntrl:]]', ' ', 'g'), 160), ''), 'Untitled deal'),
            'kind', e.kind, 'state', left(e.state, 40),
            'start_date', e.start_date, 'end_date', e.end_date,
            'occurred_at', e.occurred_at, 'label', e.label,
            'creator_label', e.creator_label, 'source_deal_id', e.deal_id
        ) ORDER BY e.start_date, e.end_date, e.kind, e.deal_id, e.event_id)
        FROM all_events e), '[]'::jsonb),
        'ranges', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', r.range_id, 'deal_id', r.deal_id,
            'deal_name', COALESCE(NULLIF(left(regexp_replace(btrim(r.deal_name), '[[:cntrl:]]', ' ', 'g'), 160), ''), 'Untitled deal'),
            'kind', 'blackout', 'start_date', r.start_date, 'end_date', r.end_date,
            'label', r.label, 'source_deal_id', r.deal_id
        ) ORDER BY r.start_date, r.end_date, r.deal_id, r.range_id)
        FROM blackout_ranges r), '[]'::jsonb)
    ) INTO v_result
      FROM viewer v CROSS JOIN event_guard CROSS JOIN range_guard
      CROSS JOIN integrity i CROSS JOIN unscheduled u CROSS JOIN unscheduled_guard;
    IF v_result IS NULL THEN RAISE EXCEPTION 'CAMPAIGN_CALENDAR_UNAVAILABLE'; END IF;
    RETURN v_result;
EXCEPTION WHEN division_by_zero THEN
    RAISE EXCEPTION 'CAMPAIGN_CALENDAR_UNAVAILABLE';
END;
$function$;

REVOKE ALL ON FUNCTION public.campaign_calendar_snapshot(uuid, timestamptz, date, date)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_calendar_snapshot(uuid, timestamptz, date, date)
    TO service_role;

CREATE OR REPLACE FUNCTION public.get_campaign_calendar(p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_viewer uuid := auth.uid();
BEGIN
    IF v_viewer IS NULL THEN RAISE EXCEPTION 'CAMPAIGN_CALENDAR_UNAUTHENTICATED'; END IF;
    RETURN public.campaign_calendar_snapshot(v_viewer, statement_timestamp(), p_start, p_end);
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'CAMPAIGN_CALENDAR_%' THEN RAISE; END IF;
    RAISE EXCEPTION 'CAMPAIGN_CALENDAR_INVALID_REQUEST';
END;
$function$;

REVOKE ALL ON FUNCTION public.get_campaign_calendar(date, date)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_campaign_calendar(date, date) TO authenticated;
