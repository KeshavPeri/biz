-- ============================================================
-- 053_contract_summary_reservation.sql
-- Workplan 11.4-E1 recovery: atomically reserve the exact approved
-- summary already validated by the backend's schema/prompt registry.
-- Additive only: no table, RLS, client grant, or historical-row changes.
-- ============================================================

CREATE OR REPLACE FUNCTION reserve_contract_for_summary_v1(
    p_deal_id uuid,
    p_actor_id uuid,
    p_summary_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_stage deal_stage_enum;
    v_contract contracts%ROWTYPE;
    v_created boolean := false;
BEGIN
    SELECT stage INTO v_stage
      FROM deals
     WHERE id = p_deal_id AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'deal_not_found';
    ELSIF v_stage <> 'approval' THEN
        RAISE EXCEPTION 'deal_not_in_approval';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM deal_participants
         WHERE deal_id = p_deal_id AND profile_id = p_actor_id
    ) THEN
        RAISE EXCEPTION 'not_participant';
    END IF;

    -- The application has already selected and strictly validated this exact
    -- immutable row. SQL verifies identity/status under the deal lock; it does
    -- not guess a schema from JSON or select a different history row.
    IF NOT EXISTS (
        SELECT 1 FROM ai_summaries
         WHERE id = p_summary_id
           AND deal_id = p_deal_id
           AND status = 'approved'
    ) THEN
        RAISE EXCEPTION 'approved_summary_required';
    END IF;

    INSERT INTO contracts (
        deal_id, version, storage_path, generated_from_summary_id, status
    ) VALUES (
        p_deal_id, 1, '', p_summary_id, 'draft'
    )
    ON CONFLICT (deal_id, version) DO NOTHING
    RETURNING * INTO v_contract;

    IF FOUND THEN
        v_created := true;
    ELSE
        SELECT * INTO v_contract
          FROM contracts
         WHERE deal_id = p_deal_id AND version = 1
         FOR UPDATE;
        IF NOT FOUND
           OR v_contract.generated_from_summary_id <> p_summary_id
           OR NOT EXISTS (
               SELECT 1 FROM ai_summaries
                WHERE id = v_contract.generated_from_summary_id
                  AND deal_id = p_deal_id
                  AND status = 'approved'
           ) THEN
            RAISE EXCEPTION 'contract_source_conflict';
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'created', v_created,
        'contract', to_jsonb(v_contract)
    );
END;
$$;

-- Preserve the existing exhaustive v1 JSON validator, then expose a
-- transaction-local dispatcher. Versioned wrappers below set the exact trusted
-- persisted pair before entering the existing canonical materializers; legacy
-- callers with no setting retain v1-only behavior.
DO $migration$
BEGIN
    IF to_regprocedure('public.payment_tracking_valid_terms_extraction_v1(jsonb)') IS NULL THEN
        ALTER FUNCTION public.payment_tracking_valid_terms_extraction(jsonb)
            RENAME TO payment_tracking_valid_terms_extraction_v1;
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.payment_tracking_valid_terms_extraction(p_terms jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_schema text := current_setting('biz.terms_schema_version', true);
    v_prompt text := current_setting('biz.terms_prompt_version', true);
    v_disclosure jsonb;
    v_rule jsonb;
    v_legacy_rules jsonb := '[]'::jsonb;
    v_negotiated text[];
    v_covered text[];
BEGIN
    IF coalesce(v_schema, '') = '' AND coalesce(v_prompt, '') = '' THEN
        RETURN public.payment_tracking_valid_terms_extraction_v1(p_terms);
    END IF;
    IF v_schema = 'chat-terms-22.v1' AND v_prompt = 'chat-terms-extraction.v1' THEN
        RETURN public.payment_tracking_valid_terms_extraction_v1(p_terms);
    END IF;
    IF v_schema <> 'chat-terms-22.v2' OR v_prompt <> 'chat-terms-extraction.v2' THEN
        RETURN false;
    END IF;
    IF p_terms #>> '{sponsored_content_disclosure,status}' <> 'found' THEN
        RETURN public.payment_tracking_valid_terms_extraction_v1(p_terms);
    END IF;

    v_disclosure := p_terms #> '{sponsored_content_disclosure,value}';
    IF NOT public.payment_tracking_json_exact_keys(
        v_disclosure, ARRAY['required','platform_rules']::text[]
    ) OR jsonb_typeof(v_disclosure->'required') <> 'boolean'
      OR jsonb_typeof(v_disclosure->'platform_rules') <> 'array'
      OR jsonb_array_length(v_disclosure->'platform_rules') > 50
      OR ((v_disclosure->>'required')::boolean AND jsonb_array_length(v_disclosure->'platform_rules') = 0)
      OR (NOT (v_disclosure->>'required')::boolean AND jsonb_array_length(v_disclosure->'platform_rules') <> 0)
    THEN RETURN false; END IF;

    FOR v_rule IN SELECT value FROM jsonb_array_elements(v_disclosure->'platform_rules')
    LOOP
        IF NOT public.payment_tracking_json_exact_keys(v_rule, ARRAY['platform','rule']::text[])
           OR jsonb_typeof(v_rule->'platform') <> 'string'
           OR v_rule->>'platform' NOT IN (
               'Instagram','TikTok','YouTube','LinkedIn','X/Twitter','Pinterest',
               'Threads','Podcast platform','Brand''s own channel (UGC)'
           )
           OR NOT public.payment_tracking_json_text(v_rule->'rule', 1, 500)
        THEN RETURN false; END IF;
        v_legacy_rules := v_legacy_rules || jsonb_build_array(v_rule->'rule');
    END LOOP;
    IF (
        SELECT count(*) FROM jsonb_array_elements(v_disclosure->'platform_rules') item
    ) <> (
        SELECT count(DISTINCT lower(regexp_replace(btrim(item->>'platform') || ':' || btrim(item->>'rule'), '\s+', ' ', 'g')))
          FROM jsonb_array_elements(v_disclosure->'platform_rules') item
    ) THEN RETURN false; END IF;

    IF (v_disclosure->>'required')::boolean THEN
        SELECT array_agg(DISTINCT item->>'platform' ORDER BY item->>'platform')
          INTO v_covered
          FROM jsonb_array_elements(v_disclosure->'platform_rules') item;
        SELECT array_agg(DISTINCT item->>'platform' ORDER BY item->>'platform')
          INTO v_negotiated
          FROM jsonb_array_elements(p_terms #> '{platform_per_deliverable,value}') item;
        IF v_covered IS DISTINCT FROM v_negotiated THEN RETURN false; END IF;
    END IF;

    RETURN public.payment_tracking_valid_terms_extraction_v1(
        jsonb_set(
            p_terms,
            '{sponsored_content_disclosure,value,platform_rules}',
            v_legacy_rules,
            false
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN false;
END;
$$;

-- Keep the existing payment transaction unchanged, but bind its validator to
-- the exact persisted pair on the executed contract source while holding the
-- same deal-row lock. Renaming preserves the exhaustive v1 implementation and
-- every existing caller resolves this wrapper at execution time.
DO $migration$
BEGIN
    IF to_regprocedure('public.materialize_payment_tracking_locked_v1(uuid,uuid,date,text)') IS NULL THEN
        ALTER FUNCTION public.materialize_payment_tracking_locked(uuid, uuid, date, text)
            RENAME TO materialize_payment_tracking_locked_v1;
    END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.materialize_payment_tracking_locked(
    p_deal_id uuid,
    p_actor_id uuid,
    p_payment_entry_date date,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal public.deals%ROWTYPE;
    v_source_summary_id uuid;
    v_schema_version text;
    v_prompt_version text;
BEGIN
    SELECT * INTO v_deal
      FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_TRACKING_DEAL_NOT_FOUND'; END IF;
    IF v_deal.stage::text NOT IN ('posted', 'payment') THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_NOT_AVAILABLE';
    END IF;
    IF v_deal.is_disputed THEN RAISE EXCEPTION 'PAYMENT_TRACKING_DISPUTED'; END IF;

    SELECT c.generated_from_summary_id, s.schema_version, s.prompt_version
      INTO v_source_summary_id, v_schema_version, v_prompt_version
      FROM public.contracts c
      JOIN public.ai_summaries s
        ON s.id = c.generated_from_summary_id
       AND s.deal_id = c.deal_id
       AND s.status::text = 'approved'
     WHERE c.deal_id = p_deal_id
       AND c.version = 1
       AND c.status::text = 'executed'
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT 1;
    IF v_source_summary_id IS NULL OR NOT (
        (v_schema_version = 'chat-terms-22.v1' AND v_prompt_version = 'chat-terms-extraction.v1')
        OR (v_schema_version = 'chat-terms-22.v2' AND v_prompt_version = 'chat-terms-extraction.v2')
    ) THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_INVALID_TERMS';
    END IF;

    PERFORM set_config('biz.terms_schema_version', v_schema_version, true);
    PERFORM set_config('biz.terms_prompt_version', v_prompt_version, true);
    RETURN public.materialize_payment_tracking_locked_v1(
        p_deal_id, p_actor_id, p_payment_entry_date, p_ip_address
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.materialize_canonical_calendar_terms_versioned(
    p_deal_id uuid,
    p_source_summary_id uuid,
    p_actor_id uuid,
    p_ip_address text,
    p_schema_version text,
    p_prompt_version text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT (
        (p_schema_version = 'chat-terms-22.v1' AND p_prompt_version = 'chat-terms-extraction.v1')
        OR (p_schema_version = 'chat-terms-22.v2' AND p_prompt_version = 'chat-terms-extraction.v2')
    ) OR NOT EXISTS (
        SELECT 1 FROM public.ai_summaries
         WHERE id = p_source_summary_id
           AND deal_id = p_deal_id
           AND status::text = 'approved'
           AND schema_version = p_schema_version
           AND prompt_version = p_prompt_version
    ) THEN
        RAISE EXCEPTION 'CALENDAR_TERMS_UNTRUSTED_SOURCE';
    END IF;
    PERFORM set_config('biz.terms_schema_version', p_schema_version, true);
    PERFORM set_config('biz.terms_prompt_version', p_prompt_version, true);
    RETURN public.materialize_canonical_calendar_terms(
        p_deal_id, p_source_summary_id, p_actor_id, p_ip_address
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.materialize_canonical_exclusivity_versioned(
    p_deal_id uuid,
    p_source_summary_id uuid,
    p_actor_id uuid,
    p_ip_address text,
    p_schema_version text,
    p_prompt_version text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT (
        (p_schema_version = 'chat-terms-22.v1' AND p_prompt_version = 'chat-terms-extraction.v1')
        OR (p_schema_version = 'chat-terms-22.v2' AND p_prompt_version = 'chat-terms-extraction.v2')
    ) OR NOT EXISTS (
        SELECT 1 FROM public.ai_summaries
         WHERE id = p_source_summary_id
           AND deal_id = p_deal_id
           AND status::text = 'approved'
           AND schema_version = p_schema_version
           AND prompt_version = p_prompt_version
    ) THEN
        RAISE EXCEPTION 'EXCLUSIVITY_UNTRUSTED_SOURCE';
    END IF;
    PERFORM set_config('biz.terms_schema_version', p_schema_version, true);
    PERFORM set_config('biz.terms_prompt_version', p_prompt_version, true);
    RETURN public.materialize_canonical_exclusivity(
        p_deal_id, p_source_summary_id, p_actor_id, p_ip_address
    );
END;
$$;

-- Migration 013 grants new routines to API roles by default. Keep every new
-- entry point backend-only and both validators internal; this does not add any
-- client authority or table privilege.
REVOKE ALL ON FUNCTION public.reserve_contract_for_summary_v1(uuid, uuid, uuid)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payment_tracking_valid_terms_extraction_v1(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.payment_tracking_valid_terms_extraction(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.materialize_payment_tracking_locked_v1(uuid, uuid, date, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.materialize_payment_tracking_locked(uuid, uuid, date, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.materialize_canonical_calendar_terms_versioned(uuid, uuid, uuid, text, text, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.materialize_canonical_exclusivity_versioned(uuid, uuid, uuid, text, text, text)
    FROM PUBLIC, anon, authenticated;
