-- Workplan 11.4-F1: allow the exact v3 source pair through existing canonical
-- materializers while validating its new whitelisting value. This migration
-- deliberately creates no whitelisting rows and changes no table authority.

DO $migration$
BEGIN
    IF to_regprocedure('public.payment_tracking_valid_terms_extraction_v2(jsonb)') IS NULL THEN
        ALTER FUNCTION public.payment_tracking_valid_terms_extraction(jsonb)
            RENAME TO payment_tracking_valid_terms_extraction_v2;
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.whitelisting_v3_credential_like(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
    WITH normalized AS (
        SELECT public.disclosure_normalize_contract_text(coalesce(p_value, '')) AS value
    )
    SELECT p_value IS NULL
        OR p_value ~ '[[:cntrl:]]'
        OR p_value ~ U&'[\00AD\061C\200B-\200F\202A-\202E\2060-\2064\2066-\206F\FEFF]'
        OR value ~ '(^|[^[:alnum:]_])(password|passwd|passcode|pwd|token|access[ _-]?token|refresh[ _-]?token|api[ _-]?key|secret[ _-]?key|recovery[ _-]?code|backup[ _-]?code|authorization|auth|bearer)[[:space:]]*[:=][[:space:]]*[^[:space:]]+'
        OR value ~ '(^|[^[:alnum:]_])bearer([[:space:]]*[:=])?[[:space:]]+[[:alnum:]_.~+/-]{8,}'
        OR value ~ '(^|[^[:alnum:]_])(password|passwd|passcode|pwd|access[ _-]?token|refresh[ _-]?token|api[ _-]?key|secret[ _-]?key|recovery[ _-]?code|backup[ _-]?code)[[:space:]]+[^[:space:]]{4,}'
        OR value ~ '(^|[^[:alnum:]_])(gh[pousr]_[[:alnum:]]{10,}|sk-[[:alnum:]_-]{16,}|xox[baprs]-[[:alnum:]-]{10,}|eyj[[:alnum:]_-]{10,}\.[[:alnum:]_-]{10,}\.[[:alnum:]_-]{5,}|akia[[:alnum:]]{16})([^[:alnum:]_]|$)'
        OR value ~ '(^|[^[:alnum:]_])(login|email|user|username)[[:space:]]*[:=][[:space:]]*[^/|;[:space:]][^/|;]*[/|;][[:space:]]*[^[:space:]]+'
        OR (
            value ~ '(^|[^[:alnum:]_])(login|email|user|username)(([[:space:]]*[:=][[:space:]]*)|[[:space:]]+)[^[:space:]]+'
            AND value ~ '(^|[^[:alnum:]_])(password|passwd|passcode|pwd)(([[:space:]]*[:=][[:space:]]*)|[[:space:]]+)[^[:space:]]+'
        )
      FROM normalized;
$function$;

CREATE OR REPLACE FUNCTION public.payment_tracking_valid_terms_extraction(p_terms jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_schema text := current_setting('biz.terms_schema_version', true);
    v_prompt text := current_setting('biz.terms_prompt_version', true);
    v_whitelisting jsonb;
    v_arrangement jsonb;
    v_budget jsonb;
    v_evidence jsonb;
    v_evidence_item jsonb;
    v_enabled boolean;
    v_result boolean;
BEGIN
    IF coalesce(v_schema, '') = '' AND coalesce(v_prompt, '') = '' THEN
        RETURN public.payment_tracking_valid_terms_extraction_v1(p_terms);
    END IF;
    IF (v_schema = 'chat-terms-22.v1' AND v_prompt = 'chat-terms-extraction.v1')
       OR (v_schema = 'chat-terms-22.v2' AND v_prompt = 'chat-terms-extraction.v2') THEN
        RETURN public.payment_tracking_valid_terms_extraction_v2(p_terms);
    END IF;
    IF v_schema <> 'chat-terms-22.v3' OR v_prompt <> 'chat-terms-extraction.v3' THEN
        RETURN false;
    END IF;
    v_evidence := p_terms #> '{whitelisting,evidence}';
    IF jsonb_typeof(v_evidence) <> 'array' THEN RETURN false; END IF;
    FOR v_evidence_item IN SELECT value FROM jsonb_array_elements(v_evidence)
    LOOP
        IF jsonb_typeof(v_evidence_item->'quote') <> 'string'
           OR public.whitelisting_v3_credential_like(v_evidence_item->>'quote')
        THEN RETURN false; END IF;
    END LOOP;
    IF p_terms #>> '{whitelisting,status}' <> 'found' THEN
        PERFORM set_config('biz.terms_schema_version', 'chat-terms-22.v2', true);
        PERFORM set_config('biz.terms_prompt_version', 'chat-terms-extraction.v2', true);
        v_result := public.payment_tracking_valid_terms_extraction_v2(p_terms);
        PERFORM set_config('biz.terms_schema_version', v_schema, true);
        PERFORM set_config('biz.terms_prompt_version', v_prompt, true);
        RETURN v_result;
    END IF;

    v_whitelisting := p_terms #> '{whitelisting,value}';
    IF NOT public.payment_tracking_json_exact_keys(
        v_whitelisting, ARRAY['enabled','arrangements']::text[]
    ) OR jsonb_typeof(v_whitelisting->'enabled') <> 'boolean'
      OR jsonb_typeof(v_whitelisting->'arrangements') <> 'array'
      OR jsonb_array_length(v_whitelisting->'arrangements') > 50
    THEN RETURN false; END IF;
    v_enabled := (v_whitelisting->>'enabled')::boolean;
    IF (v_enabled AND jsonb_array_length(v_whitelisting->'arrangements') = 0)
       OR (NOT v_enabled AND jsonb_array_length(v_whitelisting->'arrangements') <> 0)
    THEN RETURN false; END IF;

    FOR v_arrangement IN SELECT value FROM jsonb_array_elements(v_whitelisting->'arrangements')
    LOOP
        IF NOT public.payment_tracking_json_exact_keys(
            v_arrangement, ARRAY['platform','ad_account','start_date','end_date','budget']::text[]
        ) OR jsonb_typeof(v_arrangement->'platform') <> 'string'
          OR v_arrangement->>'platform' NOT IN (
              'Instagram','TikTok','YouTube','LinkedIn','X/Twitter','Pinterest',
              'Threads','Podcast platform'
          )
          OR NOT public.payment_tracking_json_text(v_arrangement->'ad_account', 1, 200)
          OR public.whitelisting_v3_credential_like(v_arrangement->>'ad_account')
          OR jsonb_typeof(v_arrangement->'start_date') <> 'string'
          OR jsonb_typeof(v_arrangement->'end_date') <> 'string'
          OR v_arrangement->>'start_date' !~ '^\d{4}-\d{2}-\d{2}$'
          OR v_arrangement->>'end_date' !~ '^\d{4}-\d{2}-\d{2}$'
          OR (v_arrangement->>'start_date')::date > (v_arrangement->>'end_date')::date
        THEN RETURN false; END IF;
        v_budget := v_arrangement->'budget';
        IF jsonb_typeof(v_budget) <> 'null' THEN
            IF NOT public.payment_tracking_json_exact_keys(v_budget, ARRAY['amount','currency']::text[])
               OR jsonb_typeof(v_budget->'amount') <> 'number'
               OR (v_budget->>'amount')::numeric < 0
               OR jsonb_typeof(v_budget->'currency') <> 'string'
               OR v_budget->>'currency' !~ '^[A-Z]{3}$'
               OR p_terms #>> '{payment_amount,status}' <> 'found'
               OR v_budget->>'currency' <> p_terms #>> '{payment_amount,value,currency}'
            THEN RETURN false; END IF;
        END IF;
    END LOOP;

    IF (
        SELECT count(*) FROM jsonb_array_elements(v_whitelisting->'arrangements') item
    ) <> (
        SELECT count(DISTINCT (
            public.disclosure_normalize_contract_text(item->>'platform'),
            public.disclosure_normalize_contract_text(item->>'ad_account'),
            item->>'start_date', item->>'end_date',
            CASE WHEN jsonb_typeof(item->'budget') = 'null' THEN NULL
                 ELSE (item #>> '{budget,amount}')::numeric END,
            item #>> '{budget,currency}'
        )) FROM jsonb_array_elements(v_whitelisting->'arrangements') item
    ) THEN RETURN false; END IF;

    PERFORM set_config('biz.terms_schema_version', 'chat-terms-22.v2', true);
    PERFORM set_config('biz.terms_prompt_version', 'chat-terms-extraction.v2', true);
    v_result := public.payment_tracking_valid_terms_extraction_v2(
        jsonb_set(p_terms, '{whitelisting,value}', to_jsonb(v_enabled), false)
    );
    PERFORM set_config('biz.terms_schema_version', v_schema, true);
    PERFORM set_config('biz.terms_prompt_version', v_prompt, true);
    RETURN v_result;
EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('biz.terms_schema_version', coalesce(v_schema, ''), true);
    PERFORM set_config('biz.terms_prompt_version', coalesce(v_prompt, ''), true);
    RETURN false;
END;
$function$;

-- The following audited functions already obtain and lock the exact approved
-- source. Extend only their provenance allowlists; all authorization,
-- idempotency, materialization, and error behavior remains byte-for-byte.
DO $migration$
DECLARE
    v_name text;
    v_definition text;
    v_updated text;
BEGIN
    FOREACH v_name IN ARRAY ARRAY[
        'materialize_payment_tracking_locked(uuid,uuid,date,text)',
        'materialize_canonical_calendar_terms_versioned(uuid,uuid,uuid,text,text,text)',
        'materialize_canonical_exclusivity_versioned(uuid,uuid,uuid,text,text,text)'
    ] LOOP
        SELECT pg_get_functiondef(to_regprocedure('public.' || v_name)) INTO STRICT v_definition;
        v_updated := replace(
            v_definition,
            $$OR (v_schema_version = 'chat-terms-22.v2' AND v_prompt_version = 'chat-terms-extraction.v2')$$,
            $$OR (v_schema_version = 'chat-terms-22.v2' AND v_prompt_version = 'chat-terms-extraction.v2')
        OR (v_schema_version = 'chat-terms-22.v3' AND v_prompt_version = 'chat-terms-extraction.v3')$$
        );
        v_updated := replace(
            v_updated,
            $$OR (p_schema_version = 'chat-terms-22.v2' AND p_prompt_version = 'chat-terms-extraction.v2')$$,
            $$OR (p_schema_version = 'chat-terms-22.v2' AND p_prompt_version = 'chat-terms-extraction.v2')
        OR (p_schema_version = 'chat-terms-22.v3' AND p_prompt_version = 'chat-terms-extraction.v3')$$
        );
        IF v_updated = v_definition AND v_definition NOT LIKE '%chat-terms-22.v3%' THEN
            RAISE EXCEPTION 'WHITELISTING_V3_WRAPPER_DRIFT: %', v_name;
        END IF;
        IF v_updated <> v_definition THEN EXECUTE v_updated; END IF;
    END LOOP;

    SELECT pg_get_functiondef(
        'public.materialize_canonical_disclosures(uuid,uuid,uuid,text)'::regprocedure
    ) INTO STRICT v_definition;
    v_updated := replace(
        v_definition,
        $$OR v_schema_version <> 'chat-terms-22.v2'
       OR v_prompt_version <> 'chat-terms-extraction.v2'$$,
        $$OR NOT (
           (v_schema_version = 'chat-terms-22.v2' AND v_prompt_version = 'chat-terms-extraction.v2')
           OR (v_schema_version = 'chat-terms-22.v3' AND v_prompt_version = 'chat-terms-extraction.v3')
       )$$
    );
    IF v_updated = v_definition AND v_definition NOT LIKE '%chat-terms-22.v3%' THEN
        RAISE EXCEPTION 'WHITELISTING_V3_DISCLOSURE_DRIFT';
    END IF;
    IF v_updated <> v_definition THEN EXECUTE v_updated; END IF;
END;
$migration$;

REVOKE ALL ON FUNCTION public.payment_tracking_valid_terms_extraction_v2(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.whitelisting_v3_credential_like(text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.payment_tracking_valid_terms_extraction(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
