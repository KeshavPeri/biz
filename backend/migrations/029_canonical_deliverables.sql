-- ============================================================
-- 029_canonical_deliverables.sql
-- Workplan 9.13-B: canonical deliverables from approved terms
-- Depends on: 028_creative_briefs.sql
-- ============================================================

-- Historical rows stay readable but deliberately have no invented provenance.
-- Every new/updated row must be bound to the approved summary that created it.
ALTER TABLE deliverables
    ADD COLUMN source_summary_id uuid REFERENCES ai_summaries(id) ON DELETE RESTRICT;

ALTER TABLE deliverables
    ADD CONSTRAINT deliverables_source_required CHECK (source_summary_id IS NOT NULL) NOT VALID,
    ADD CONSTRAINT deliverables_sequence_positive CHECK (sequence > 0) NOT VALID,
    ADD CONSTRAINT deliverables_posting_timing_valid CHECK (
        (posting_date IS NOT NULL AND posting_window_start IS NULL AND posting_window_end IS NULL)
        OR (
            posting_date IS NULL
            AND posting_window_start IS NOT NULL
            AND posting_window_end IS NOT NULL
            AND posting_window_start <= posting_window_end
        )
    ) NOT VALID,
    ADD CONSTRAINT deliverables_revision_nonnegative CHECK (
        revision_max >= 0 AND revision_current >= 0
    ) NOT VALID,
    ADD CONSTRAINT deliverables_revision_within_max CHECK (
        revision_current <= revision_max
    ) NOT VALID;

-- Canonical rows cannot duplicate a sequence. Historical rows are excluded so
-- installation never rewrites or deletes older, possibly conflicting data.
CREATE UNIQUE INDEX deliverables_canonical_deal_sequence_unique
    ON deliverables (deal_id, sequence)
    WHERE source_summary_id IS NOT NULL;
CREATE INDEX deliverables_deal_sequence_ordered
    ON deliverables (deal_id, sequence);
CREATE INDEX deliverables_source_summary_lookup
    ON deliverables (source_summary_id);

-- Participants retain RLS-protected reads. All canonical writes pass through
-- the locked SECURITY DEFINER boundary below; neither app JWTs nor the ordinary
-- service-role table client can forge or rewrite the agreed plan.
DROP POLICY IF EXISTS "deliverables_insert_participant" ON deliverables;
DROP POLICY IF EXISTS "deliverables_update_participant" ON deliverables;
DROP POLICY IF EXISTS "deliverables_delete_participant" ON deliverables;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON deliverables FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON deliverables TO authenticated, service_role;

CREATE OR REPLACE FUNCTION materialize_canonical_deliverables(
    p_deal_id uuid,
    p_source_summary_id uuid,
    p_actor_id uuid,
    p_expected_count integer,
    p_items jsonb,
    p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal deals%ROWTYPE;
    v_summary ai_summaries%ROWTYPE;
    v_latest_summary_id uuid;
    v_summary_count integer;
    v_summary_revision_max integer;
    v_existing_count integer;
    v_matching_count integer;
BEGIN
    SELECT * INTO v_deal
      FROM deals
     WHERE id = p_deal_id AND deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DELIVERABLE_DEAL_NOT_FOUND';
    END IF;

    -- Authorization precedes stage/source errors even for this backend-only RPC.
    IF NOT EXISTS (
        SELECT 1 FROM deal_participants
         WHERE deal_id = p_deal_id AND profile_id = p_actor_id
    ) THEN
        RAISE EXCEPTION 'DELIVERABLE_NOT_PARTICIPANT';
    END IF;
    IF v_deal.stage::text NOT IN ('approval', 'creating') THEN
        RAISE EXCEPTION 'DELIVERABLE_WRONG_STAGE';
    END IF;

    SELECT id INTO v_latest_summary_id
      FROM ai_summaries
     WHERE deal_id = p_deal_id AND status = 'approved'
     ORDER BY generated_at DESC, id DESC
     LIMIT 1;
    IF v_latest_summary_id IS NULL OR v_latest_summary_id <> p_source_summary_id THEN
        RAISE EXCEPTION 'DELIVERABLE_STALE_SOURCE';
    END IF;

    SELECT * INTO v_summary
      FROM ai_summaries
     WHERE id = p_source_summary_id AND deal_id = p_deal_id AND status = 'approved'
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'DELIVERABLE_SOURCE_NOT_APPROVED';
    END IF;

    -- Approval-stage calls are reserved for the contract-execution seam. A
    -- participant cannot initialize early merely by reaching Approval.
    IF v_deal.stage::text = 'approval' AND NOT EXISTS (
        SELECT 1 FROM contracts
         WHERE deal_id = p_deal_id
           AND generated_from_summary_id = p_source_summary_id
           AND status = 'executed'
    ) THEN
        RAISE EXCEPTION 'DELIVERABLE_CONTRACT_NOT_EXECUTED';
    END IF;

    IF jsonb_typeof(p_items) <> 'array' OR p_expected_count IS NULL OR p_expected_count <= 0
       OR jsonb_array_length(p_items) <> p_expected_count THEN
        RAISE EXCEPTION 'DELIVERABLE_INVALID_SET';
    END IF;

    BEGIN
        v_summary_count := (v_summary.structured_terms -> 'deliverable_count' ->> 'value')::integer;
        v_summary_revision_max := (v_summary.structured_terms -> 'revision_rounds_max' ->> 'value')::integer;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'DELIVERABLE_INVALID_SUMMARY';
    END;
    IF v_summary_count <> p_expected_count OR v_summary_revision_max < 0 THEN
        RAISE EXCEPTION 'DELIVERABLE_INVALID_SUMMARY';
    END IF;

    -- The service performs the TermsExtraction + enum mapping. Repeat the
    -- transaction-critical shape/count/index checks at the database boundary.
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) AS item(value)
         WHERE jsonb_typeof(item.value) <> 'object'
            OR NOT item.value ?& ARRAY[
                'sequence', 'content_format', 'platform', 'posting_date',
                'posting_window_start', 'posting_window_end', 'location',
                'revision_max', 'revision_current', 'status'
            ]
            OR (item.value ->> 'sequence') IS NULL
            OR (item.value ->> 'content_format') IS NULL
            OR (item.value ->> 'platform') IS NULL
            OR (item.value ->> 'revision_max') IS NULL
            OR (item.value ->> 'revision_current') IS NULL
            OR (item.value ->> 'status') IS NULL
            OR (item.value ->> 'sequence')::integer NOT BETWEEN 1 AND p_expected_count
            OR (item.value ->> 'revision_max')::integer <> v_summary_revision_max
            OR (item.value ->> 'revision_current')::integer <> 0
            OR item.value ->> 'status' <> 'pending'
            OR NOT (
                ((item.value ->> 'posting_date') IS NOT NULL
                 AND (item.value ->> 'posting_window_start') IS NULL
                 AND (item.value ->> 'posting_window_end') IS NULL)
                OR
                ((item.value ->> 'posting_date') IS NULL
                 AND (item.value ->> 'posting_window_start') IS NOT NULL
                 AND (item.value ->> 'posting_window_end') IS NOT NULL
                 AND (item.value ->> 'posting_window_start')::date <= (item.value ->> 'posting_window_end')::date)
            )
    ) OR (
        SELECT count(DISTINCT (item.value ->> 'sequence')::integer)
          FROM jsonb_array_elements(p_items) AS item(value)
    ) <> p_expected_count THEN
        RAISE EXCEPTION 'DELIVERABLE_INVALID_SET';
    END IF;

    SELECT count(*) INTO v_existing_count
      FROM deliverables
     WHERE deal_id = p_deal_id;
    IF v_existing_count > 0 THEN
        SELECT count(*) INTO v_matching_count
          FROM deliverables d
          JOIN jsonb_array_elements(p_items) AS item(value)
            ON d.sequence = (item.value ->> 'sequence')::integer
         WHERE d.deal_id = p_deal_id
           AND d.source_summary_id = p_source_summary_id
           AND d.content_format::text = item.value ->> 'content_format'
           AND d.platform::text = item.value ->> 'platform'
           AND d.posting_date IS NOT DISTINCT FROM (item.value ->> 'posting_date')::date
           AND d.posting_window_start IS NOT DISTINCT FROM (item.value ->> 'posting_window_start')::date
           AND d.posting_window_end IS NOT DISTINCT FROM (item.value ->> 'posting_window_end')::date
           AND d.location IS NOT DISTINCT FROM item.value ->> 'location'
           AND d.revision_max = (item.value ->> 'revision_max')::integer
           AND d.revision_current = 0
           AND d.status = 'pending'
           AND d.approved_content_url IS NULL
           AND d.live_post_url IS NULL
           AND d.post_metadata IS NULL;
        IF v_existing_count = p_expected_count AND v_matching_count = p_expected_count THEN
            RETURN jsonb_build_object(
                'outcome', 'existing', 'idempotent', true,
                'deal_id', p_deal_id, 'source_summary_id', p_source_summary_id,
                'count', p_expected_count
            );
        END IF;
        RAISE EXCEPTION 'DELIVERABLE_EXISTING_CONFLICT';
    END IF;

    INSERT INTO deliverables (
        deal_id, sequence, content_format, platform,
        posting_date, posting_window_start, posting_window_end, location,
        revision_max, revision_current, approved_content_url, live_post_url,
        post_metadata, status, source_summary_id
    )
    SELECT
        p_deal_id,
        (item.value ->> 'sequence')::integer,
        (item.value ->> 'content_format')::content_format_enum,
        (item.value ->> 'platform')::platform_enum,
        (item.value ->> 'posting_date')::date,
        (item.value ->> 'posting_window_start')::date,
        (item.value ->> 'posting_window_end')::date,
        item.value ->> 'location',
        (item.value ->> 'revision_max')::integer,
        0,
        NULL, NULL, NULL, 'pending', p_source_summary_id
      FROM jsonb_array_elements(p_items) AS item(value)
     ORDER BY (item.value ->> 'sequence')::integer;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'canonical_deliverables_materialized', 'deal', p_deal_id,
        jsonb_build_object(
            'deal_id', p_deal_id,
            'source_summary_id', p_source_summary_id,
            'deliverable_count', p_expected_count
        ),
        p_ip_address
    );

    RETURN jsonb_build_object(
        'outcome', 'created', 'idempotent', false,
        'deal_id', p_deal_id, 'source_summary_id', p_source_summary_id,
        'count', p_expected_count
    );
END;
$$;

REVOKE ALL ON FUNCTION materialize_canonical_deliverables(uuid, uuid, uuid, integer, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION materialize_canonical_deliverables(uuid, uuid, uuid, integer, jsonb, text)
    TO service_role;
