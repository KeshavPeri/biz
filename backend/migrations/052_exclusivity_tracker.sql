-- 052_exclusivity_tracker.sql
-- Canonical, source-bound exclusivity facts and backend-only materialization.

ALTER TABLE public.exclusivity_clauses
    ADD COLUMN source_summary_id uuid REFERENCES public.ai_summaries(id) ON DELETE RESTRICT;

ALTER TABLE public.exclusivity_clauses
    ADD CONSTRAINT exclusivity_clauses_canonical_shape CHECK (
        source_summary_id IS NULL OR (
            (NOT has_exclusivity
             AND category IS NULL
             AND duration_days IS NULL
             AND start_date IS NULL
             AND end_date IS NULL)
            OR
            (has_exclusivity
             AND category IS NOT NULL
             AND length(category) BETWEEN 1 AND 200
             AND category = btrim(category)
             AND category !~ '[[:cntrl:]]'
             AND duration_days IS NOT NULL
             AND duration_days BETWEEN 1 AND 36500
             AND start_date IS NOT NULL
             AND end_date IS NOT NULL
             AND end_date = start_date + (duration_days - 1))
        )
    ) NOT VALID;

CREATE UNIQUE INDEX exclusivity_clauses_one_canonical_per_deal
    ON public.exclusivity_clauses (deal_id) WHERE source_summary_id IS NOT NULL;
CREATE UNIQUE INDEX exclusivity_clauses_one_canonical_per_source
    ON public.exclusivity_clauses (source_summary_id) WHERE source_summary_id IS NOT NULL;

DROP POLICY IF EXISTS "exclusivity_clauses_participant" ON public.exclusivity_clauses;
DROP POLICY IF EXISTS "exclusivity_clauses_participant_read" ON public.exclusivity_clauses;
REVOKE ALL ON public.exclusivity_clauses FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.exclusivity_clauses FROM service_role;
GRANT SELECT ON public.exclusivity_clauses TO service_role;

CREATE OR REPLACE FUNCTION public.materialize_canonical_exclusivity(
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
    v_execution_date date;
    v_execution_count integer;
    v_has_exclusivity boolean;
    v_category text;
    v_duration integer;
    v_count integer;
    v_match boolean;
    v_row_id uuid;
BEGIN
    IF p_deal_id IS NULL OR p_source_summary_id IS NULL OR p_actor_id IS NULL
       OR p_ip_address IS NULL OR length(p_ip_address) NOT BETWEEN 1 AND 255 THEN
        RAISE EXCEPTION 'EXCLUSIVITY_INVALID_REQUEST';
    END IF;

    SELECT * INTO v_deal
      FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EXCLUSIVITY_NOT_FOUND'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.deal_participants
         WHERE deal_id = p_deal_id AND profile_id = p_actor_id
    ) THEN RAISE EXCEPTION 'EXCLUSIVITY_NOT_PARTICIPANT'; END IF;
    IF v_deal.stage::text NOT IN ('approval', 'creating') THEN
        RAISE EXCEPTION 'EXCLUSIVITY_WRONG_STAGE';
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
       AND s.status::text = 'approved';
    IF v_contract_id IS NULL
       OR NOT public.payment_tracking_valid_terms_extraction(v_terms) THEN
        RAISE EXCEPTION 'EXCLUSIVITY_UNTRUSTED_SOURCE';
    END IF;

    SELECT count(*), min(a.created_at AT TIME ZONE 'UTC')::date
      INTO v_execution_count, v_execution_date
      FROM public.audit_log a
     WHERE a.entity_type = 'deal'
       AND a.entity_id = p_deal_id
       AND a.action = 'contract_executed'
       AND a.metadata->>'contract_id' = v_contract_id::text;
    IF v_execution_count <> 1 OR v_execution_date IS NULL THEN
        RAISE EXCEPTION 'EXCLUSIVITY_UNTRUSTED_SOURCE';
    END IF;

    IF v_terms #>> '{exclusivity,status}' <> 'found'
       OR jsonb_typeof(v_terms #> '{exclusivity,value}') <> 'boolean' THEN
        RAISE EXCEPTION 'EXCLUSIVITY_UNTRUSTED_SOURCE';
    END IF;
    v_has_exclusivity := (v_terms #>> '{exclusivity,value}')::boolean;
    IF v_has_exclusivity THEN
        IF v_terms #>> '{exclusivity_duration_days,status}' <> 'found'
           OR jsonb_typeof(v_terms #> '{exclusivity_duration_days,value}') <> 'number'
           OR v_terms #>> '{exclusivity_category,status}' <> 'found'
           OR jsonb_typeof(v_terms #> '{exclusivity_category,value}') <> 'string' THEN
            RAISE EXCEPTION 'EXCLUSIVITY_UNTRUSTED_SOURCE';
        END IF;
        v_duration := (v_terms #>> '{exclusivity_duration_days,value}')::integer;
        v_category := v_terms #>> '{exclusivity_category,value}';
        IF v_duration NOT BETWEEN 1 AND 36500
           OR length(v_category) NOT BETWEEN 1 AND 200
           OR v_category <> btrim(v_category)
           OR v_category ~ '[[:cntrl:]]' THEN
            RAISE EXCEPTION 'EXCLUSIVITY_UNTRUSTED_SOURCE';
        END IF;
    ELSE
        v_duration := NULL;
        v_category := NULL;
    END IF;

    SELECT count(*) INTO v_count
      FROM public.exclusivity_clauses
     WHERE deal_id = p_deal_id AND source_summary_id IS NOT NULL;
    IF v_count > 0 THEN
        SELECT v_count = 1 AND EXISTS (
            SELECT 1 FROM public.exclusivity_clauses e
             WHERE e.deal_id = p_deal_id
               AND e.source_summary_id = p_source_summary_id
               AND e.has_exclusivity = v_has_exclusivity
               AND e.category IS NOT DISTINCT FROM v_category
               AND e.duration_days IS NOT DISTINCT FROM v_duration
               AND e.start_date IS NOT DISTINCT FROM CASE WHEN v_has_exclusivity THEN v_execution_date ELSE NULL END
               AND e.end_date IS NOT DISTINCT FROM CASE WHEN v_has_exclusivity THEN v_execution_date + (v_duration - 1) ELSE NULL END
        ) INTO v_match;
        IF NOT v_match THEN RAISE EXCEPTION 'EXCLUSIVITY_EXISTING_CONFLICT'; END IF;
        SELECT id INTO v_row_id FROM public.exclusivity_clauses
         WHERE deal_id = p_deal_id AND source_summary_id = p_source_summary_id;
        RETURN jsonb_build_object('outcome', 'existing', 'idempotent', true, 'row_id', v_row_id);
    END IF;

    INSERT INTO public.exclusivity_clauses (
        deal_id, has_exclusivity, category, duration_days, start_date, end_date, source_summary_id
    ) VALUES (
        p_deal_id, v_has_exclusivity, v_category, v_duration,
        CASE WHEN v_has_exclusivity THEN v_execution_date ELSE NULL END,
        CASE WHEN v_has_exclusivity THEN v_execution_date + (v_duration - 1) ELSE NULL END,
        p_source_summary_id
    ) RETURNING id INTO v_row_id;

    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'canonical_exclusivity_materialized', 'deal', p_deal_id,
        jsonb_build_object('source_summary_id', p_source_summary_id, 'has_exclusivity', v_has_exclusivity),
        p_ip_address
    );
    RETURN jsonb_build_object('outcome', 'created', 'idempotent', false, 'row_id', v_row_id);
EXCEPTION WHEN unique_violation OR check_violation THEN
    RAISE EXCEPTION 'EXCLUSIVITY_EXISTING_CONFLICT';
END;
$function$;

REVOKE ALL ON FUNCTION public.materialize_canonical_exclusivity(uuid, uuid, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materialize_canonical_exclusivity(uuid, uuid, uuid, text)
    TO service_role;
