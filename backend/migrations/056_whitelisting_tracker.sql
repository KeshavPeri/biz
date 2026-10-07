-- 056_whitelisting_tracker.sql
-- Canonical source-bound whitelisting arrangements and backend-only materialization.

ALTER TABLE public.whitelisting_arrangements
    ADD COLUMN source_summary_id uuid REFERENCES public.ai_summaries(id) ON DELETE RESTRICT,
    ADD COLUMN arrangement_sequence integer;

ALTER TABLE public.whitelisting_arrangements
    ADD CONSTRAINT whitelisting_arrangements_canonical_shape CHECK (
        source_summary_id IS NULL OR (
            (NOT has_whitelisting
             AND arrangement_sequence = 0
             AND platform IS NULL AND ad_account IS NULL AND budget IS NULL
             AND start_date IS NULL AND end_date IS NULL)
            OR
            (has_whitelisting
             AND arrangement_sequence BETWEEN 1 AND 50
             AND platform IS NOT NULL
             AND ad_account IS NOT NULL
             AND length(ad_account) BETWEEN 1 AND 200
             AND ad_account = btrim(
                 ad_account,
                 U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000'
             )
             AND NOT public.whitelisting_v3_credential_like(ad_account)
             AND (budget IS NULL OR budget >= 0)
             AND start_date IS NOT NULL AND end_date IS NOT NULL
             AND start_date <= end_date)
        )
    ) NOT VALID;

CREATE UNIQUE INDEX whitelisting_arrangements_canonical_deal_sequence
    ON public.whitelisting_arrangements (deal_id, arrangement_sequence)
    WHERE source_summary_id IS NOT NULL;
CREATE UNIQUE INDEX whitelisting_arrangements_canonical_source_sequence
    ON public.whitelisting_arrangements (source_summary_id, arrangement_sequence)
    WHERE source_summary_id IS NOT NULL;
CREATE INDEX whitelisting_arrangements_canonical_source
    ON public.whitelisting_arrangements (source_summary_id)
    WHERE source_summary_id IS NOT NULL;

DROP POLICY IF EXISTS "whitelisting_arrangements_participant" ON public.whitelisting_arrangements;
DROP POLICY IF EXISTS "whitelisting_arrangements_participant_read" ON public.whitelisting_arrangements;
REVOKE ALL ON public.whitelisting_arrangements FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.whitelisting_arrangements TO service_role;

CREATE OR REPLACE FUNCTION public.whitelisting_decimal_text(p_value numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
    v_text text := p_value::text;
BEGIN
    IF p_value = 0 THEN RETURN '0'; END IF;
    IF position('.' IN v_text) > 0 THEN
        v_text := rtrim(rtrim(v_text, '0'), '.');
    END IF;
    RETURN v_text;
END;
$function$;

-- Match str(Decimal(value).normalize()), which is the budget component of
-- whitelisting_arrangement_identity. Source values are non-negative.
CREATE OR REPLACE FUNCTION public.whitelisting_decimal_identity(p_value numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
    v_fixed text := public.whitelisting_decimal_text(p_value);
    v_significant text;
    v_fraction text;
    v_zero_count integer;
    v_mantissa text;
BEGIN
    IF p_value = 0 THEN RETURN '0'; END IF;
    IF position('.' IN v_fixed) = 0 THEN
        v_significant := rtrim(v_fixed, '0');
        IF length(v_significant) < length(v_fixed) THEN
            v_mantissa := substring(v_significant FROM 1 FOR 1);
            IF length(v_significant) > 1 THEN
                v_mantissa := v_mantissa || '.' || substring(v_significant FROM 2);
            END IF;
            RETURN v_mantissa || 'E+' || (length(v_fixed) - 1)::text;
        END IF;
        RETURN v_fixed;
    END IF;
    IF split_part(v_fixed, '.', 1) <> '0' THEN RETURN v_fixed; END IF;
    v_fraction := split_part(v_fixed, '.', 2);
    v_significant := ltrim(v_fraction, '0');
    v_zero_count := length(v_fraction) - length(v_significant);
    IF v_zero_count < 6 THEN RETURN v_fixed; END IF;
    v_mantissa := substring(v_significant FROM 1 FOR 1);
    IF length(v_significant) > 1 THEN
        v_mantissa := v_mantissa || '.' || substring(v_significant FROM 2);
    END IF;
    RETURN v_mantissa || 'E-' || (v_zero_count + 1)::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.whitelisting_expected_rows(
    p_deal_id uuid,
    p_source_summary_id uuid
)
RETURNS TABLE (
    has_whitelisting boolean,
    platform public.platform_enum,
    ad_account text,
    budget numeric,
    budget_text text,
    budget_currency text,
    start_date date,
    end_date date,
    arrangement_sequence integer
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_terms jsonb;
    v_contract_id uuid;
    v_enabled boolean;
BEGIN
    SELECT s.structured_terms, c.id INTO v_terms, v_contract_id
      FROM public.ai_summaries s
      JOIN public.contracts c ON c.generated_from_summary_id = s.id
       AND c.deal_id = s.deal_id AND c.version = 1 AND c.status::text = 'executed'
     WHERE s.id = p_source_summary_id AND s.deal_id = p_deal_id
       AND s.status::text = 'approved'
       AND s.schema_version = 'chat-terms-22.v3'
       AND s.prompt_version = 'chat-terms-extraction.v3';
    IF v_contract_id IS NULL THEN RAISE EXCEPTION 'WHITELISTING_UNTRUSTED_SOURCE'; END IF;

    PERFORM set_config('biz.terms_schema_version', 'chat-terms-22.v3', true);
    PERFORM set_config('biz.terms_prompt_version', 'chat-terms-extraction.v3', true);
    IF NOT public.payment_tracking_valid_terms_extraction(v_terms)
       OR v_terms #>> '{whitelisting,status}' <> 'found'
       OR jsonb_typeof(v_terms #> '{whitelisting,value,enabled}') <> 'boolean'
       OR jsonb_typeof(v_terms #> '{whitelisting,value,arrangements}') <> 'array' THEN
        RAISE EXCEPTION 'WHITELISTING_UNTRUSTED_SOURCE';
    END IF;
    v_enabled := (v_terms #>> '{whitelisting,value,enabled}')::boolean;
    IF NOT v_enabled THEN
        RETURN QUERY SELECT false, NULL::public.platform_enum, NULL::text,
            NULL::numeric, NULL::text, NULL::text, NULL::date, NULL::date, 0;
        RETURN;
    END IF;

    RETURN QUERY
    WITH mapped AS (
        SELECT CASE item->>'platform'
                   WHEN 'Instagram' THEN 'instagram'
                   WHEN 'TikTok' THEN 'tiktok'
                   WHEN 'YouTube' THEN 'youtube'
                   WHEN 'LinkedIn' THEN 'linkedin'
                   WHEN 'X/Twitter' THEN 'x'
                   WHEN 'Pinterest' THEN 'pinterest'
                   WHEN 'Threads' THEN 'threads'
                   WHEN 'Podcast platform' THEN 'podcast'
                   ELSE NULL
               END AS mapped_platform,
               item->>'platform' AS raw_platform,
               item->>'ad_account' AS source_account,
               (item->>'start_date')::date AS source_start,
               (item->>'end_date')::date AS source_end,
               CASE WHEN jsonb_typeof(item->'budget') = 'null' THEN NULL
                    ELSE (item #>> '{budget,amount}')::numeric END AS source_budget,
               item #>> '{budget,currency}' AS source_currency
          FROM jsonb_array_elements(v_terms #> '{whitelisting,value,arrangements}') item
    ), sequenced AS (
        SELECT *, row_number() OVER (
            ORDER BY public.disclosure_normalize_contract_text(raw_platform) COLLATE "C",
                     public.disclosure_normalize_contract_text(source_account) COLLATE "C",
                     source_start, source_end,
                     coalesce(public.whitelisting_decimal_identity(source_budget), '') COLLATE "C",
                     coalesce(source_currency, '') COLLATE "C",
                     raw_platform COLLATE "C", source_account COLLATE "C"
        )::integer AS source_sequence
          FROM mapped
    )
    SELECT true, mapped_platform::public.platform_enum, source_account, source_budget,
           public.whitelisting_decimal_text(source_budget), source_currency,
           source_start, source_end, source_sequence
      FROM sequenced
     ORDER BY source_sequence;
END;
$function$;

CREATE OR REPLACE FUNCTION public.project_whitelisting_exact(
    p_deal_id uuid,
    p_source_summary_id uuid
)
RETURNS TABLE (
    has_whitelisting boolean,
    platform public.platform_enum,
    ad_account text,
    source_budget_text text,
    budget_currency text,
    start_date date,
    end_date date,
    arrangement_sequence integer,
    canonical_present boolean,
    canonical_budget_text text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
    SELECT expected.has_whitelisting, expected.platform, expected.ad_account,
           expected.budget_text, expected.budget_currency,
           expected.start_date, expected.end_date, expected.arrangement_sequence,
           canonical.id IS NOT NULL,
           public.whitelisting_decimal_text(canonical.budget)
      FROM public.whitelisting_expected_rows(p_deal_id, p_source_summary_id) expected
      LEFT JOIN public.whitelisting_arrangements canonical
        ON canonical.deal_id = p_deal_id
       AND canonical.source_summary_id = p_source_summary_id
       AND canonical.arrangement_sequence = expected.arrangement_sequence
     ORDER BY expected.arrangement_sequence;
$function$;

CREATE OR REPLACE FUNCTION public.materialize_canonical_whitelisting(
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
    v_contract_id uuid;
    v_execution_count integer;
    v_enabled boolean;
    v_expected jsonb;
    v_expected_count integer;
    v_existing_count integer;
    v_matching_count integer;
    v_audit_count integer;
    v_audit_match_count integer;
BEGIN
    IF p_deal_id IS NULL OR p_source_summary_id IS NULL OR p_actor_id IS NULL
       OR p_ip_address IS NULL OR length(p_ip_address) NOT BETWEEN 1 AND 255 THEN
        RAISE EXCEPTION 'WHITELISTING_INVALID_REQUEST';
    END IF;

    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WHITELISTING_NOT_FOUND'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.deal_participants
         WHERE deal_id = p_deal_id AND profile_id = p_actor_id
    ) THEN RAISE EXCEPTION 'WHITELISTING_NOT_PARTICIPANT'; END IF;
    IF v_deal.stage::text NOT IN ('approval', 'creating') THEN
        RAISE EXCEPTION 'WHITELISTING_WRONG_STAGE';
    END IF;

    SELECT c.id INTO v_contract_id
      FROM public.ai_summaries s
      JOIN public.contracts c ON c.generated_from_summary_id = s.id
       AND c.deal_id = s.deal_id AND c.version = 1 AND c.status::text = 'executed'
     WHERE s.id = p_source_summary_id AND s.deal_id = p_deal_id
       AND s.status::text = 'approved'
       AND s.schema_version = 'chat-terms-22.v3'
       AND s.prompt_version = 'chat-terms-extraction.v3';
    IF v_contract_id IS NULL THEN RAISE EXCEPTION 'WHITELISTING_UNTRUSTED_SOURCE'; END IF;

    SELECT count(*) INTO v_execution_count FROM public.audit_log a
     WHERE a.entity_type = 'deal' AND a.entity_id = p_deal_id
       AND a.action = 'contract_executed'
       AND a.metadata->>'contract_id' = v_contract_id::text;
    IF v_execution_count <> 1 THEN RAISE EXCEPTION 'WHITELISTING_UNTRUSTED_SOURCE'; END IF;

    SELECT jsonb_agg(jsonb_build_object(
               'has_whitelisting', expected.has_whitelisting,
               'platform', expected.platform,
               'ad_account', expected.ad_account,
               'budget', expected.budget,
               'start_date', expected.start_date,
               'end_date', expected.end_date,
               'arrangement_sequence', expected.arrangement_sequence
           ) ORDER BY expected.arrangement_sequence)
      INTO v_expected
      FROM public.whitelisting_expected_rows(p_deal_id, p_source_summary_id) expected;

    IF v_expected IS NULL OR jsonb_typeof(v_expected) <> 'array' THEN
        RAISE EXCEPTION 'WHITELISTING_UNTRUSTED_SOURCE';
    END IF;
    v_expected_count := jsonb_array_length(v_expected);
    v_enabled := (v_expected->0->>'has_whitelisting')::boolean;
    IF (v_enabled AND v_expected_count NOT BETWEEN 1 AND 50)
       OR (NOT v_enabled AND v_expected_count <> 1)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_expected) item WHERE v_enabled AND item->>'platform' IS NULL)
    THEN RAISE EXCEPTION 'WHITELISTING_UNTRUSTED_SOURCE'; END IF;

    SELECT count(*)::integer INTO v_existing_count
      FROM public.whitelisting_arrangements
     WHERE deal_id = p_deal_id AND source_summary_id IS NOT NULL;
    SELECT count(*)::integer INTO v_audit_count FROM public.audit_log
     WHERE entity_type = 'deal' AND entity_id = p_deal_id
       AND action = 'canonical_whitelisting_materialized';
    SELECT count(*)::integer INTO v_audit_match_count FROM public.audit_log
     WHERE entity_type = 'deal' AND entity_id = p_deal_id
       AND action = 'canonical_whitelisting_materialized'
       AND metadata = jsonb_build_object(
           'source_summary_id', p_source_summary_id,
           'enabled', v_enabled,
           'row_count', v_expected_count
       );

    IF v_existing_count > 0 THEN
        SELECT count(*)::integer INTO v_matching_count
          FROM public.whitelisting_arrangements w
          JOIN jsonb_array_elements(v_expected) item
            ON w.has_whitelisting = (item->>'has_whitelisting')::boolean
           AND w.platform::text IS NOT DISTINCT FROM item->>'platform'
           AND w.ad_account IS NOT DISTINCT FROM item->>'ad_account'
           AND w.budget IS NOT DISTINCT FROM (item->>'budget')::numeric
           AND w.start_date IS NOT DISTINCT FROM (item->>'start_date')::date
           AND w.end_date IS NOT DISTINCT FROM (item->>'end_date')::date
           AND w.arrangement_sequence = (item->>'arrangement_sequence')::integer
         WHERE w.deal_id = p_deal_id AND w.source_summary_id = p_source_summary_id;
        IF v_existing_count = v_expected_count AND v_matching_count = v_expected_count
           AND v_audit_count = 1 AND v_audit_match_count = 1 THEN
            RETURN jsonb_build_object('outcome', 'existing', 'idempotent', true,
                'deal_id', p_deal_id, 'count', v_expected_count);
        END IF;
        RAISE EXCEPTION 'WHITELISTING_EXISTING_CONFLICT';
    ELSIF v_audit_count <> 0 THEN
        RAISE EXCEPTION 'WHITELISTING_EXISTING_CONFLICT';
    END IF;

    INSERT INTO public.whitelisting_arrangements (
        deal_id, has_whitelisting, platform, ad_account, budget,
        start_date, end_date, source_summary_id, arrangement_sequence
    )
    SELECT p_deal_id, (item->>'has_whitelisting')::boolean,
           (item->>'platform')::public.platform_enum, item->>'ad_account',
           (item->>'budget')::numeric, (item->>'start_date')::date,
           (item->>'end_date')::date, p_source_summary_id,
           (item->>'arrangement_sequence')::integer
      FROM jsonb_array_elements(v_expected) item
     ORDER BY (item->>'arrangement_sequence')::integer;

    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (p_actor_id, 'canonical_whitelisting_materialized', 'deal', p_deal_id,
        jsonb_build_object('source_summary_id', p_source_summary_id,
            'enabled', v_enabled, 'row_count', v_expected_count), p_ip_address);
    RETURN jsonb_build_object('outcome', 'created', 'idempotent', false,
        'deal_id', p_deal_id, 'count', v_expected_count);
EXCEPTION WHEN unique_violation OR check_violation OR foreign_key_violation THEN
    RAISE EXCEPTION 'WHITELISTING_EXISTING_CONFLICT';
END;
$function$;

REVOKE ALL ON FUNCTION public.materialize_canonical_whitelisting(uuid, uuid, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.materialize_canonical_whitelisting(uuid, uuid, uuid, text)
    TO service_role;
REVOKE ALL ON FUNCTION public.whitelisting_decimal_text(numeric)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.whitelisting_decimal_identity(numeric)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.whitelisting_expected_rows(uuid, uuid)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.project_whitelisting_exact(uuid, uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.project_whitelisting_exact(uuid, uuid)
    TO service_role;
