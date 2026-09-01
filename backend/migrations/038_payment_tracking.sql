-- ============================================================
-- 038_payment_tracking.sql
-- Workplan 9.15-C: authoritative off-platform payment tracking
-- Depends on: 037_payment_details_gate.sql
--
-- Tracking only. This schema never moves, verifies or releases money.
-- ============================================================

-- Historical rows are retained exactly as found. Only rows with a non-null
-- source_summary_id are canonical and eligible for the service-only RPCs.
ALTER TABLE public.payments
    ADD COLUMN source_summary_id uuid REFERENCES public.ai_summaries(id) ON DELETE RESTRICT,
    ADD COLUMN due_date_pending boolean,
    ADD COLUMN version integer,
    ADD COLUMN updated_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    ADD COLUMN creator_receipt_version integer,
    ADD COLUMN creator_receipt_confirmed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    ADD COLUMN creator_receipt_confirmed_at timestamptz;

ALTER TABLE public.payments
    ADD CONSTRAINT payments_canonical_shape CHECK (
        source_summary_id IS NULL OR (
            amount > 0
            AND amount <> 'NaN'::numeric
            AND currency ~ '^[A-Z]{3}$'
            AND due_date_pending IS NOT NULL
            AND version > 0
            AND updated_by IS NOT NULL
        )
    ),
    ADD CONSTRAINT payments_receipt_evidence_consistent CHECK (
        (creator_receipt_version IS NULL
            AND creator_receipt_confirmed_by IS NULL
            AND creator_receipt_confirmed_at IS NULL)
        OR
        (creator_receipt_version > 0
            AND creator_receipt_version <= version
            AND creator_receipt_confirmed_by IS NOT NULL
            AND creator_receipt_confirmed_at IS NOT NULL)
    );

CREATE UNIQUE INDEX payments_one_canonical_per_deal
    ON public.payments (deal_id)
    WHERE source_summary_id IS NOT NULL;

CREATE INDEX payments_source_summary_lookup
    ON public.payments (source_summary_id)
    WHERE source_summary_id IS NOT NULL;

ALTER TABLE public.payment_milestones
    ADD COLUMN sequence integer,
    ADD COLUMN version integer,
    ADD COLUMN updated_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    ADD COLUMN updated_at timestamptz,
    ADD COLUMN creator_receipt_version integer,
    ADD COLUMN creator_receipt_confirmed_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    ADD COLUMN creator_receipt_confirmed_at timestamptz;

ALTER TABLE public.payment_milestones
    ADD CONSTRAINT payment_milestones_canonical_shape CHECK (
        sequence IS NULL OR (
            sequence > 0
            AND version > 0
            AND updated_by IS NOT NULL
            AND updated_at IS NOT NULL
            AND amount > 0
            AND amount <> 'NaN'::numeric
            AND trigger_description = btrim(trigger_description)
            AND length(trigger_description) BETWEEN 1 AND 500
            AND trigger_description !~ '[[:cntrl:]]'
        )
    ),
    ADD CONSTRAINT payment_milestones_receipt_evidence_consistent CHECK (
        (creator_receipt_version IS NULL
            AND creator_receipt_confirmed_by IS NULL
            AND creator_receipt_confirmed_at IS NULL)
        OR
        (creator_receipt_version > 0
            AND creator_receipt_version <= version
            AND creator_receipt_confirmed_by IS NOT NULL
            AND creator_receipt_confirmed_at IS NOT NULL)
    );

CREATE UNIQUE INDEX payment_milestones_payment_sequence_unique
    ON public.payment_milestones (payment_id, sequence)
    WHERE sequence IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_canonical_payment_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.source_summary_id IS NOT NULL AND (
        NEW.id IS DISTINCT FROM OLD.id
        OR NEW.deal_id IS DISTINCT FROM OLD.deal_id
        OR NEW.source_summary_id IS DISTINCT FROM OLD.source_summary_id
        OR NEW.amount IS DISTINCT FROM OLD.amount
        OR NEW.currency IS DISTINCT FROM OLD.currency
        OR NEW.structure IS DISTINCT FROM OLD.structure
        OR NEW.due_date IS DISTINCT FROM OLD.due_date
        OR NEW.due_date_pending IS DISTINCT FROM OLD.due_date_pending
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
    ) THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_IMMUTABLE_TERMS';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER payments_immutable_identity
BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.enforce_canonical_payment_identity();

CREATE OR REPLACE FUNCTION public.enforce_canonical_payment_milestone_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.sequence IS NOT NULL AND (
        NEW.id IS DISTINCT FROM OLD.id
        OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
        OR NEW.deliverable_id IS DISTINCT FROM OLD.deliverable_id
        OR NEW.sequence IS DISTINCT FROM OLD.sequence
        OR NEW.trigger_description IS DISTINCT FROM OLD.trigger_description
        OR NEW.amount IS DISTINCT FROM OLD.amount
        OR NEW.due_date IS DISTINCT FROM OLD.due_date
    ) THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_IMMUTABLE_TERMS';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER payment_milestones_immutable_identity
BEFORE UPDATE ON public.payment_milestones
FOR EACH ROW EXECUTE FUNCTION public.enforce_canonical_payment_milestone_identity();

DROP POLICY IF EXISTS payments_participant ON public.payments;
DROP POLICY IF EXISTS payment_milestones_participant ON public.payment_milestones;
REVOKE ALL ON TABLE public.payments FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_milestones FROM anon, authenticated;
GRANT ALL ON TABLE public.payments TO service_role;
GRANT ALL ON TABLE public.payment_milestones TO service_role;

CREATE OR REPLACE FUNCTION public.payment_tracking_json_exact_keys(
    p_value jsonb,
    p_keys text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT jsonb_typeof(p_value) = 'object'
       AND p_value ?& p_keys
       AND (SELECT count(*) FROM jsonb_object_keys(p_value)) = cardinality(p_keys);
$$;

CREATE OR REPLACE FUNCTION public.payment_tracking_json_integer(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT jsonb_typeof(p_value) = 'number'
       AND (p_value #>> '{}') ~ '^-?(0|[1-9][0-9]*)$';
$$;

CREATE OR REPLACE FUNCTION public.payment_tracking_json_text(
    p_value jsonb,
    p_min integer,
    p_max integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT jsonb_typeof(p_value) = 'string'
       AND length(btrim(p_value #>> '{}')) BETWEEN p_min AND p_max;
$$;

CREATE OR REPLACE FUNCTION public.payment_tracking_iso_date(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_text text;
    v_date date;
BEGIN
    IF jsonb_typeof(p_value) <> 'string' THEN RETURN false; END IF;
    v_text := p_value #>> '{}';
    IF v_text !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN false; END IF;
    BEGIN
        v_date := v_text::date;
    EXCEPTION WHEN OTHERS THEN
        RETURN false;
    END;
    RETURN to_char(v_date, 'YYYY-MM-DD') = v_text;
END;
$$;

CREATE OR REPLACE FUNCTION public.payment_tracking_valid_envelope(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status text;
    v_evidence jsonb;
    v_item jsonb;
BEGIN
    IF NOT public.payment_tracking_json_exact_keys(
        p_value, ARRAY['status','value','evidence']::text[]
    ) THEN RETURN false; END IF;
    IF jsonb_typeof(p_value->'status') <> 'string'
       OR jsonb_typeof(p_value->'evidence') <> 'array' THEN RETURN false; END IF;
    v_status := p_value->>'status';
    v_evidence := p_value->'evidence';
    IF v_status NOT IN ('found','not_discussed','ambiguous')
       OR jsonb_array_length(v_evidence) > 5 THEN RETURN false; END IF;
    IF v_status = 'found' AND (
        p_value->'value' = 'null'::jsonb OR jsonb_array_length(v_evidence) = 0
    ) THEN RETURN false; END IF;
    IF v_status = 'ambiguous' AND (
        p_value->'value' <> 'null'::jsonb OR jsonb_array_length(v_evidence) = 0
    ) THEN RETURN false; END IF;
    IF v_status = 'not_discussed' AND (
        p_value->'value' <> 'null'::jsonb OR jsonb_array_length(v_evidence) <> 0
    ) THEN RETURN false; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_evidence)
    LOOP
        IF NOT public.payment_tracking_json_exact_keys(
            v_item, ARRAY['message_id','quote']::text[]
        ) OR jsonb_typeof(v_item->'message_id') <> 'string'
          OR length(v_item->>'message_id') NOT BETWEEN 1 AND 128
          OR jsonb_typeof(v_item->'quote') <> 'string'
          OR length(v_item->>'quote') NOT BETWEEN 1 AND 500 THEN
            RETURN false;
        END IF;
    END LOOP;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.payment_tracking_valid_amount(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT public.payment_tracking_json_exact_keys(
               p_value, ARRAY['amount','currency']::text[]
           )
       AND jsonb_typeof(p_value->'amount') = 'number'
       AND (p_value->>'amount')::numeric >= 0
       AND (p_value->>'amount')::numeric <> 'NaN'::numeric
       AND jsonb_typeof(p_value->'currency') = 'string'
       AND (p_value->>'currency') ~ '^[A-Z]{3}$';
$$;

-- Mirrors TermsExtraction.model_validate for the complete locked 22-field v1
-- contract. It intentionally validates no message ownership: that source-aware
-- check belongs to extraction, while this boundary re-validates stored JSON.
CREATE OR REPLACE FUNCTION public.payment_tracking_valid_terms_extraction(p_terms jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_key text;
    v_value jsonb;
    v_item jsonb;
    v_index integer;
    v_content_indices integer[];
    v_platform_indices integer[];
    v_posting_indices integer[];
    v_location_indices integer[];
    v_reference_indices integer[];
    v_deliverable_count integer;
    v_parent boolean;
    v_terms_type text;
    v_schedule_total numeric := 0;
    v_payment_amount numeric;
    v_payment_currency text;
    v_date date;
    v_start date;
    v_end date;
BEGIN
    IF NOT public.payment_tracking_json_exact_keys(p_terms, ARRAY[
        'payment_amount','payment_terms_type','payment_terms_from_date',
        'exclusivity','exclusivity_duration_days','exclusivity_category',
        'usage_rights','usage_rights_duration','usage_rights_channels','whitelisting',
        'blackout_window','blackout_duration_timing','revision_rounds_max',
        'creative_guidance','content_format_per_deliverable','platform_per_deliverable',
        'posting_window_per_deliverable','sponsored_content_disclosure',
        'content_ownership','deliverable_count','location_per_deliverable',
        'milestone_schedule'
    ]::text[]) THEN RETURN false; END IF;

    FOR v_key IN SELECT jsonb_object_keys(p_terms)
    LOOP
        IF NOT public.payment_tracking_valid_envelope(p_terms->v_key) THEN RETURN false; END IF;
    END LOOP;

    IF p_terms #>> '{payment_amount,status}' = 'found'
       AND NOT public.payment_tracking_valid_amount(p_terms #> '{payment_amount,value}') THEN
        RETURN false;
    END IF;
    IF p_terms #>> '{payment_terms_type,status}' = 'found' AND (
        jsonb_typeof(p_terms #> '{payment_terms_type,value}') <> 'string'
        OR p_terms #>> '{payment_terms_type,value}' NOT IN (
            'upfront','on_posting','net_x_days','milestone','combination'
        )
    ) THEN RETURN false; END IF;
    IF p_terms #>> '{payment_terms_from_date,status}' = 'found' THEN
        v_value := p_terms #> '{payment_terms_from_date,value}';
        IF NOT public.payment_tracking_json_exact_keys(
            v_value, ARRAY['basis','net_days']::text[]
        ) OR jsonb_typeof(v_value->'basis') <> 'string'
          OR v_value->>'basis' NOT IN ('invoice_date','posting_date')
          OR NOT (
              v_value->'net_days' = 'null'::jsonb
              OR (
                  public.payment_tracking_json_integer(v_value->'net_days')
                  AND (v_value->>'net_days')::integer > 0
              )
          ) THEN RETURN false; END IF;
    END IF;

    FOREACH v_key IN ARRAY ARRAY['exclusivity','usage_rights','whitelisting','blackout_window']::text[]
    LOOP
        IF p_terms #>> ARRAY[v_key,'status'] = 'found'
           AND jsonb_typeof(p_terms #> ARRAY[v_key,'value']) <> 'boolean' THEN RETURN false; END IF;
    END LOOP;
    IF p_terms #>> '{exclusivity_duration_days,status}' = 'found' AND NOT (
        public.payment_tracking_json_integer(p_terms #> '{exclusivity_duration_days,value}')
        AND (p_terms #>> '{exclusivity_duration_days,value}')::integer > 0
    ) THEN RETURN false; END IF;
    IF p_terms #>> '{exclusivity_category,status}' = 'found'
       AND NOT public.payment_tracking_json_text(
           p_terms #> '{exclusivity_category,value}', 1, 500
       ) THEN RETURN false; END IF;

    IF p_terms #>> '{usage_rights_duration,status}' = 'found' THEN
        v_value := p_terms #> '{usage_rights_duration,value}';
        IF NOT public.payment_tracking_json_exact_keys(
            v_value, ARRAY['duration_days','is_perpetual']::text[]
        ) OR jsonb_typeof(v_value->'is_perpetual') <> 'boolean'
          OR NOT (
              v_value->'duration_days' = 'null'::jsonb
              OR (
                  public.payment_tracking_json_integer(v_value->'duration_days')
                  AND (v_value->>'duration_days')::integer > 0
              )
          ) OR ((v_value->'duration_days' = 'null'::jsonb) = NOT (v_value->>'is_perpetual')::boolean)
        THEN RETURN false; END IF;
    END IF;
    IF p_terms #>> '{usage_rights_channels,status}' = 'found' THEN
        v_value := p_terms #> '{usage_rights_channels,value}';
        IF jsonb_typeof(v_value) <> 'array' OR jsonb_array_length(v_value) = 0 THEN RETURN false; END IF;
        FOR v_item IN SELECT value FROM jsonb_array_elements(v_value)
        LOOP
            IF NOT public.payment_tracking_json_text(v_item, 1, 500) THEN RETURN false; END IF;
        END LOOP;
    END IF;
    IF p_terms #>> '{blackout_duration_timing,status}' = 'found' THEN
        v_value := p_terms #> '{blackout_duration_timing,value}';
        IF NOT public.payment_tracking_json_exact_keys(
            v_value, ARRAY['timing','duration_days']::text[]
        ) OR jsonb_typeof(v_value->'timing') <> 'string'
          OR v_value->>'timing' NOT IN ('before','after','both')
          OR NOT public.payment_tracking_json_integer(v_value->'duration_days')
          OR (v_value->>'duration_days')::integer <= 0 THEN RETURN false; END IF;
    END IF;
    IF p_terms #>> '{revision_rounds_max,status}' = 'found' AND NOT (
        public.payment_tracking_json_integer(p_terms #> '{revision_rounds_max,value}')
        AND (p_terms #>> '{revision_rounds_max,value}')::integer >= 0
    ) THEN RETURN false; END IF;
    IF p_terms #>> '{creative_guidance,status}' = 'found' THEN
        v_value := p_terms #> '{creative_guidance,value}';
        IF NOT public.payment_tracking_json_exact_keys(v_value, ARRAY['kind','text']::text[])
           OR jsonb_typeof(v_value->'kind') <> 'string'
           OR v_value->>'kind' NOT IN ('guidance','brief_reference','creator_discretion')
           OR NOT public.payment_tracking_json_text(v_value->'text', 1, 500) THEN RETURN false; END IF;
    END IF;

    IF p_terms #>> '{content_format_per_deliverable,status}' = 'found' THEN
        v_value := p_terms #> '{content_format_per_deliverable,value}';
        IF jsonb_typeof(v_value) <> 'array' OR jsonb_array_length(v_value) = 0 THEN RETURN false; END IF;
        v_content_indices := ARRAY[]::integer[];
        FOR v_item IN SELECT value FROM jsonb_array_elements(v_value)
        LOOP
            IF NOT public.payment_tracking_json_exact_keys(
                v_item, ARRAY['deliverable_index','content_format']::text[]
            ) OR NOT public.payment_tracking_json_integer(v_item->'deliverable_index')
              OR (v_item->>'deliverable_index')::integer <= 0
              OR jsonb_typeof(v_item->'content_format') <> 'string'
              OR v_item->>'content_format' NOT IN (
                  'Reel','Static Post','Story','Carousel','YouTube Video','YouTube Short',
                  'Blog Post','UGC Photo','Podcast Read','X/Twitter Thread','LinkedIn Post','Pinterest Pin'
              ) THEN RETURN false; END IF;
            v_content_indices := array_append(v_content_indices, (v_item->>'deliverable_index')::integer);
        END LOOP;
        SELECT array_agg(value ORDER BY value) INTO v_content_indices FROM unnest(v_content_indices) value;
        IF v_content_indices <> ARRAY(SELECT generate_series(1, cardinality(v_content_indices))) THEN RETURN false; END IF;
    END IF;

    IF p_terms #>> '{platform_per_deliverable,status}' = 'found' THEN
        v_value := p_terms #> '{platform_per_deliverable,value}';
        IF jsonb_typeof(v_value) <> 'array' OR jsonb_array_length(v_value) = 0 THEN RETURN false; END IF;
        v_platform_indices := ARRAY[]::integer[];
        FOR v_item IN SELECT value FROM jsonb_array_elements(v_value)
        LOOP
            IF NOT public.payment_tracking_json_exact_keys(
                v_item, ARRAY['deliverable_index','platform']::text[]
            ) OR NOT public.payment_tracking_json_integer(v_item->'deliverable_index')
              OR (v_item->>'deliverable_index')::integer <= 0
              OR jsonb_typeof(v_item->'platform') <> 'string'
              OR v_item->>'platform' NOT IN (
                  'Instagram','TikTok','YouTube','LinkedIn','X/Twitter','Pinterest','Threads',
                  'Podcast platform','Brand''s own channel (UGC)'
              ) THEN RETURN false; END IF;
            v_platform_indices := array_append(v_platform_indices, (v_item->>'deliverable_index')::integer);
        END LOOP;
        SELECT array_agg(value ORDER BY value) INTO v_platform_indices FROM unnest(v_platform_indices) value;
        IF v_platform_indices <> ARRAY(SELECT generate_series(1, cardinality(v_platform_indices))) THEN RETURN false; END IF;
    END IF;

    IF p_terms #>> '{posting_window_per_deliverable,status}' = 'found' THEN
        v_value := p_terms #> '{posting_window_per_deliverable,value}';
        IF jsonb_typeof(v_value) <> 'array' OR jsonb_array_length(v_value) = 0 THEN RETURN false; END IF;
        v_posting_indices := ARRAY[]::integer[];
        FOR v_item IN SELECT value FROM jsonb_array_elements(v_value)
        LOOP
            IF NOT public.payment_tracking_json_exact_keys(
                v_item, ARRAY['deliverable_index','posting_date','window_start','window_end']::text[]
            ) OR NOT public.payment_tracking_json_integer(v_item->'deliverable_index')
              OR (v_item->>'deliverable_index')::integer <= 0 THEN RETURN false; END IF;
            IF v_item->'posting_date' <> 'null'::jsonb THEN
                IF NOT public.payment_tracking_iso_date(v_item->'posting_date')
                   OR v_item->'window_start' <> 'null'::jsonb
                   OR v_item->'window_end' <> 'null'::jsonb THEN RETURN false; END IF;
            ELSE
                IF NOT public.payment_tracking_iso_date(v_item->'window_start')
                   OR NOT public.payment_tracking_iso_date(v_item->'window_end') THEN RETURN false; END IF;
                v_start := (v_item->>'window_start')::date;
                v_end := (v_item->>'window_end')::date;
                IF v_start > v_end THEN RETURN false; END IF;
            END IF;
            v_posting_indices := array_append(v_posting_indices, (v_item->>'deliverable_index')::integer);
        END LOOP;
        SELECT array_agg(value ORDER BY value) INTO v_posting_indices FROM unnest(v_posting_indices) value;
        IF v_posting_indices <> ARRAY(SELECT generate_series(1, cardinality(v_posting_indices))) THEN RETURN false; END IF;
    END IF;

    IF p_terms #>> '{sponsored_content_disclosure,status}' = 'found' THEN
        v_value := p_terms #> '{sponsored_content_disclosure,value}';
        IF NOT public.payment_tracking_json_exact_keys(
            v_value, ARRAY['required','platform_rules']::text[]
        ) OR jsonb_typeof(v_value->'required') <> 'boolean'
          OR jsonb_typeof(v_value->'platform_rules') <> 'array' THEN RETURN false; END IF;
        FOR v_item IN SELECT value FROM jsonb_array_elements(v_value->'platform_rules')
        LOOP
            IF NOT public.payment_tracking_json_text(v_item, 1, 500) THEN RETURN false; END IF;
        END LOOP;
    END IF;
    IF p_terms #>> '{content_ownership,status}' = 'found' AND (
        jsonb_typeof(p_terms #> '{content_ownership,value}') <> 'string'
        OR p_terms #>> '{content_ownership,value}' NOT IN ('creator','brand')
    ) THEN RETURN false; END IF;
    IF p_terms #>> '{deliverable_count,status}' = 'found' THEN
        IF NOT public.payment_tracking_json_integer(p_terms #> '{deliverable_count,value}')
           OR (p_terms #>> '{deliverable_count,value}')::integer <= 0 THEN RETURN false; END IF;
        v_deliverable_count := (p_terms #>> '{deliverable_count,value}')::integer;
    END IF;
    IF p_terms #>> '{location_per_deliverable,status}' = 'found' THEN
        v_value := p_terms #> '{location_per_deliverable,value}';
        IF jsonb_typeof(v_value) <> 'array' OR jsonb_array_length(v_value) = 0 THEN RETURN false; END IF;
        v_location_indices := ARRAY[]::integer[];
        FOR v_item IN SELECT value FROM jsonb_array_elements(v_value)
        LOOP
            IF NOT public.payment_tracking_json_exact_keys(
                v_item, ARRAY['deliverable_index','location']::text[]
            ) OR NOT public.payment_tracking_json_integer(v_item->'deliverable_index')
              OR (v_item->>'deliverable_index')::integer <= 0
              OR NOT public.payment_tracking_json_text(v_item->'location', 1, 500) THEN RETURN false; END IF;
            v_location_indices := array_append(v_location_indices, (v_item->>'deliverable_index')::integer);
        END LOOP;
        SELECT array_agg(value ORDER BY value) INTO v_location_indices FROM unnest(v_location_indices) value;
        IF v_location_indices <> ARRAY(SELECT generate_series(1, cardinality(v_location_indices))) THEN RETURN false; END IF;
    END IF;

    IF p_terms #>> '{milestone_schedule,status}' = 'found' THEN
        v_value := p_terms #> '{milestone_schedule,value}';
        IF jsonb_typeof(v_value) <> 'array' THEN RETURN false; END IF;
        FOR v_item IN SELECT value FROM jsonb_array_elements(v_value)
        LOOP
            IF NOT public.payment_tracking_json_exact_keys(
                v_item, ARRAY['trigger','amount','due_date']::text[]
            ) OR NOT public.payment_tracking_json_text(v_item->'trigger', 1, 500)
              OR NOT public.payment_tracking_valid_amount(v_item->'amount')
              OR NOT public.payment_tracking_iso_date(v_item->'due_date') THEN RETURN false; END IF;
            v_schedule_total := v_schedule_total + (v_item #>> '{amount,amount}')::numeric;
            IF v_payment_currency IS NULL THEN v_payment_currency := v_item #>> '{amount,currency}'; END IF;
            IF v_payment_currency <> v_item #>> '{amount,currency}' THEN RETURN false; END IF;
        END LOOP;
    END IF;

    -- Parent/child conditional contracts.
    IF p_terms #>> '{exclusivity,status}' = 'found' THEN
        v_parent := (p_terms #>> '{exclusivity,value}')::boolean;
        IF v_parent AND (
            p_terms #>> '{exclusivity_duration_days,status}' <> 'found'
            OR p_terms #>> '{exclusivity_category,status}' <> 'found'
        ) THEN RETURN false; END IF;
        IF NOT v_parent AND (
            p_terms #>> '{exclusivity_duration_days,status}' = 'found'
            OR p_terms #>> '{exclusivity_category,status}' = 'found'
        ) THEN RETURN false; END IF;
    END IF;
    IF p_terms #>> '{usage_rights,status}' = 'found' THEN
        v_parent := (p_terms #>> '{usage_rights,value}')::boolean;
        IF v_parent AND (
            p_terms #>> '{usage_rights_duration,status}' <> 'found'
            OR p_terms #>> '{usage_rights_channels,status}' <> 'found'
        ) THEN RETURN false; END IF;
        IF NOT v_parent AND (
            p_terms #>> '{usage_rights_duration,status}' = 'found'
            OR p_terms #>> '{usage_rights_channels,status}' = 'found'
        ) THEN RETURN false; END IF;
    END IF;
    IF p_terms #>> '{blackout_window,status}' = 'found' THEN
        v_parent := (p_terms #>> '{blackout_window,value}')::boolean;
        IF v_parent AND p_terms #>> '{blackout_duration_timing,status}' <> 'found' THEN RETURN false; END IF;
        IF NOT v_parent AND p_terms #>> '{blackout_duration_timing,status}' = 'found' THEN RETURN false; END IF;
    END IF;

    IF p_terms #>> '{payment_terms_type,status}' = 'found' THEN
        v_terms_type := p_terms #>> '{payment_terms_type,value}';
        IF v_terms_type = 'net_x_days' AND (
            p_terms #>> '{payment_terms_from_date,status}' <> 'found'
            OR p_terms #> '{payment_terms_from_date,value,net_days}' = 'null'::jsonb
        ) THEN RETURN false; END IF;
        IF v_terms_type <> 'net_x_days'
           AND p_terms #>> '{payment_terms_from_date,status}' = 'found'
           AND p_terms #> '{payment_terms_from_date,value,net_days}' <> 'null'::jsonb
           AND v_terms_type <> 'combination' THEN RETURN false; END IF;

        IF v_terms_type IN ('milestone','combination') AND (
            p_terms #>> '{milestone_schedule,status}' <> 'found'
            OR jsonb_array_length(p_terms #> '{milestone_schedule,value}') = 0
        ) THEN RETURN false; END IF;
        IF v_terms_type NOT IN ('milestone','combination')
           AND p_terms #>> '{milestone_schedule,status}' = 'found' THEN RETURN false; END IF;
        IF v_terms_type IN ('milestone','combination')
           AND p_terms #>> '{payment_amount,status}' = 'found' THEN
            v_payment_amount := (p_terms #>> '{payment_amount,value,amount}')::numeric;
            IF v_schedule_total <> v_payment_amount
               OR v_payment_currency <> p_terms #>> '{payment_amount,value,currency}' THEN RETURN false; END IF;
        END IF;
    END IF;

    v_reference_indices := COALESCE(v_content_indices, v_platform_indices, v_posting_indices);
    IF v_reference_indices IS NOT NULL AND (
        (v_content_indices IS NOT NULL AND v_content_indices <> v_reference_indices)
        OR (v_platform_indices IS NOT NULL AND v_platform_indices <> v_reference_indices)
        OR (v_posting_indices IS NOT NULL AND v_posting_indices <> v_reference_indices)
    ) THEN RETURN false; END IF;
    IF v_reference_indices IS NOT NULL AND v_deliverable_count IS NOT NULL
       AND cardinality(v_reference_indices) <> v_deliverable_count THEN RETURN false; END IF;
    IF v_location_indices IS NOT NULL AND v_deliverable_count IS NOT NULL
       AND v_location_indices[cardinality(v_location_indices)] > v_deliverable_count THEN RETURN false; END IF;
    RETURN true;
EXCEPTION WHEN OTHERS THEN
    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_tracking_json_exact_keys(jsonb, text[])
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.payment_tracking_json_integer(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.payment_tracking_json_text(jsonb, integer, integer)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.payment_tracking_iso_date(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.payment_tracking_valid_envelope(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.payment_tracking_valid_amount(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.payment_tracking_valid_terms_extraction(jsonb)
    FROM PUBLIC, anon, authenticated, service_role;

-- Internal routine. The deal row lock serializes entry, retry and recovery.
CREATE OR REPLACE FUNCTION public.materialize_payment_tracking_locked(
    p_deal_id uuid,
    p_actor_id uuid,
    p_payment_entry_date date,
    p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal public.deals%ROWTYPE;
    v_source_summary_id uuid;
    v_terms jsonb;
    v_amount numeric;
    v_currency text;
    v_terms_type text;
    v_structure text;
    v_basis text;
    v_net_days integer;
    v_schedule jsonb;
    v_schedule_count integer := 0;
    v_schedule_total numeric := 0;
    v_item jsonb;
    v_ordinal bigint;
    v_trigger text;
    v_item_amount numeric;
    v_item_currency text;
    v_item_due_date date;
    v_due_date date;
    v_due_date_pending boolean := false;
    v_payment public.payments%ROWTYPE;
    v_existing_count integer;
    v_existing_milestone_count integer;
    v_created boolean := false;
BEGIN
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_TRACKING_DEAL_NOT_FOUND'; END IF;
    IF v_deal.stage::text NOT IN ('posted', 'payment') THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_NOT_AVAILABLE';
    END IF;
    IF v_deal.is_disputed THEN RAISE EXCEPTION 'PAYMENT_TRACKING_DISPUTED'; END IF;

    SELECT c.generated_from_summary_id, s.structured_terms
      INTO v_source_summary_id, v_terms
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
    IF v_source_summary_id IS NULL OR jsonb_typeof(v_terms) <> 'object' THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_INVALID_TERMS';
    END IF;
    IF NOT public.payment_tracking_valid_terms_extraction(v_terms) THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_INVALID_TERMS';
    END IF;

    BEGIN
        IF v_terms #>> '{payment_amount,status}' <> 'found'
           OR jsonb_typeof(v_terms #> '{payment_amount,value,amount}') <> 'number'
           OR jsonb_typeof(v_terms #> '{payment_amount,value,currency}') <> 'string'
           OR v_terms #>> '{payment_terms_type,status}' <> 'found' THEN
            RAISE EXCEPTION 'invalid';
        END IF;
        v_amount := (v_terms #>> '{payment_amount,value,amount}')::numeric;
        v_currency := v_terms #>> '{payment_amount,value,currency}';
        v_terms_type := v_terms #>> '{payment_terms_type,value}';
        IF v_amount <= 0 OR v_currency !~ '^[A-Z]{3}$'
           OR v_terms_type NOT IN ('upfront','on_posting','net_x_days','milestone','combination') THEN
            RAISE EXCEPTION 'invalid';
        END IF;

        v_structure := CASE
            WHEN v_terms_type IN ('milestone','combination') THEN v_terms_type
            ELSE 'single'
        END;

        IF v_terms_type = 'net_x_days' THEN
            IF v_terms #>> '{payment_terms_from_date,status}' <> 'found'
               OR jsonb_typeof(v_terms #> '{payment_terms_from_date,value,net_days}') <> 'number'
               OR jsonb_typeof(v_terms #> '{payment_terms_from_date,value,basis}') <> 'string' THEN
                RAISE EXCEPTION 'invalid';
            END IF;
            v_basis := v_terms #>> '{payment_terms_from_date,value,basis}';
            v_net_days := (v_terms #>> '{payment_terms_from_date,value,net_days}')::integer;
            IF v_basis NOT IN ('invoice_date','posting_date') OR v_net_days <= 0 THEN
                RAISE EXCEPTION 'invalid';
            END IF;
        END IF;

        IF v_structure IN ('milestone','combination') THEN
            IF v_terms #>> '{milestone_schedule,status}' <> 'found'
               OR jsonb_typeof(v_terms #> '{milestone_schedule,value}') <> 'array' THEN
                RAISE EXCEPTION 'invalid';
            END IF;
            v_schedule := v_terms #> '{milestone_schedule,value}';
            v_schedule_count := jsonb_array_length(v_schedule);
            IF v_schedule_count NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid'; END IF;
            FOR v_item, v_ordinal IN
                SELECT value, ordinality FROM jsonb_array_elements(v_schedule) WITH ORDINALITY
            LOOP
                IF jsonb_typeof(v_item) <> 'object'
                   OR jsonb_typeof(v_item #> '{trigger}') <> 'string'
                   OR jsonb_typeof(v_item #> '{amount,amount}') <> 'number'
                   OR jsonb_typeof(v_item #> '{amount,currency}') <> 'string'
                   OR jsonb_typeof(v_item #> '{due_date}') <> 'string' THEN
                    RAISE EXCEPTION 'invalid';
                END IF;
                v_trigger := btrim(v_item->>'trigger');
                v_item_amount := (v_item #>> '{amount,amount}')::numeric;
                v_item_currency := v_item #>> '{amount,currency}';
                v_item_due_date := (v_item->>'due_date')::date;
                IF length(v_trigger) NOT BETWEEN 1 AND 500
                   OR v_trigger ~ '[[:cntrl:]]'
                   OR v_item_amount <= 0
                   OR v_item_currency <> v_currency
                   OR to_char(v_item_due_date, 'YYYY-MM-DD') <> v_item->>'due_date' THEN
                    RAISE EXCEPTION 'invalid';
                END IF;
                v_schedule_total := v_schedule_total + v_item_amount;
                v_due_date := GREATEST(v_due_date, v_item_due_date);
            END LOOP;
            IF v_schedule_total <> v_amount THEN RAISE EXCEPTION 'invalid'; END IF;
        ELSIF v_terms #>> '{milestone_schedule,status}' = 'found' THEN
            RAISE EXCEPTION 'invalid';
        ELSIF v_terms_type = 'on_posting' THEN
            v_due_date := p_payment_entry_date;
        ELSIF v_terms_type = 'net_x_days' AND v_basis = 'posting_date' THEN
            v_due_date := p_payment_entry_date + v_net_days;
        ELSIF v_terms_type = 'net_x_days' THEN
            v_due_date := NULL;
            v_due_date_pending := true;
        ELSIF v_terms_type = 'upfront' THEN
            SELECT created_at::date INTO v_due_date
              FROM public.deal_stage_transitions
             WHERE deal_id = p_deal_id AND from_stage::text = 'approval' AND to_stage::text = 'creating'
             ORDER BY created_at DESC, id DESC LIMIT 1;
            v_due_date_pending := v_due_date IS NULL;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_INVALID_TERMS';
    END;

    SELECT count(*) INTO v_existing_count FROM public.payments WHERE deal_id = p_deal_id;
    IF v_existing_count > 0 THEN
        SELECT * INTO v_payment FROM public.payments
         WHERE deal_id = p_deal_id AND source_summary_id IS NOT NULL
         LIMIT 1 FOR UPDATE;
        IF v_existing_count <> 1 OR NOT FOUND
           OR v_payment.source_summary_id <> v_source_summary_id
           OR v_payment.amount <> v_amount
           OR v_payment.currency <> v_currency
           OR v_payment.structure::text <> v_structure
           OR v_payment.due_date IS DISTINCT FROM v_due_date
           OR v_payment.due_date_pending IS DISTINCT FROM v_due_date_pending THEN
            RAISE EXCEPTION 'PAYMENT_TRACKING_CONFLICT';
        END IF;
        SELECT count(*) INTO v_existing_milestone_count
          FROM public.payment_milestones WHERE payment_id = v_payment.id;
        IF v_existing_milestone_count <> v_schedule_count THEN
            RAISE EXCEPTION 'PAYMENT_TRACKING_CONFLICT';
        END IF;
        FOR v_item, v_ordinal IN
            SELECT value, ordinality FROM jsonb_array_elements(COALESCE(v_schedule, '[]'::jsonb)) WITH ORDINALITY
        LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.payment_milestones m
                 WHERE m.payment_id = v_payment.id
                   AND m.sequence = v_ordinal
                   AND m.trigger_description = btrim(v_item->>'trigger')
                   AND m.amount = (v_item #>> '{amount,amount}')::numeric
                   AND m.due_date = (v_item->>'due_date')::date
            ) THEN RAISE EXCEPTION 'PAYMENT_TRACKING_CONFLICT'; END IF;
        END LOOP;
        RETURN jsonb_build_object('payment_id', v_payment.id, 'created', false, 'idempotent', true);
    END IF;

    INSERT INTO public.payments (
        deal_id, amount, currency, structure, state, due_date, source_summary_id,
        due_date_pending, version, updated_by, updated_at
    ) VALUES (
        p_deal_id, v_amount, v_currency, v_structure::public.payment_structure_enum,
        'not_paid_in_window', v_due_date, v_source_summary_id,
        v_due_date_pending, 1, p_actor_id, now()
    ) RETURNING * INTO v_payment;
    v_created := true;

    FOR v_item, v_ordinal IN
        SELECT value, ordinality FROM jsonb_array_elements(COALESCE(v_schedule, '[]'::jsonb)) WITH ORDINALITY
    LOOP
        INSERT INTO public.payment_milestones (
            payment_id, sequence, trigger_description, amount, due_date, state,
            version, updated_by, updated_at
        ) VALUES (
            v_payment.id, v_ordinal, btrim(v_item->>'trigger'),
            (v_item #>> '{amount,amount}')::numeric, (v_item->>'due_date')::date,
            'not_paid_in_window', 1, p_actor_id, now()
        );
    END LOOP;

    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'payment_tracking_initialized', 'deal', p_deal_id,
        jsonb_build_object(
            'deal_id', p_deal_id, 'payment_id', v_payment.id,
            'source_summary_id', v_source_summary_id, 'structure', v_structure,
            'version', 1, 'milestone_count', v_schedule_count,
            'outcome', 'tracking_initialized'
        ), p_ip_address
    );
    RETURN jsonb_build_object('payment_id', v_payment.id, 'created', v_created, 'idempotent', false);
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_payment_tracking_locked(uuid, uuid, date, text)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.initialize_payment_tracking(
    p_deal_id uuid,
    p_actor_id uuid,
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
    v_entry_date date;
BEGIN
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_TRACKING_DEAL_NOT_FOUND'; END IF;
    SELECT participant_role::text INTO v_role FROM public.deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role IS NULL THEN RAISE EXCEPTION 'PAYMENT_TRACKING_NOT_PARTICIPANT'; END IF;
    IF v_role NOT IN ('brand_admin','brand_maker') OR NOT EXISTS (
        SELECT 1 FROM public.brand_members
         WHERE brand_id = v_deal.brand_id AND profile_id = p_actor_id AND status::text = 'active'
    ) THEN RAISE EXCEPTION 'PAYMENT_TRACKING_BRAND_ONLY'; END IF;
    IF v_deal.stage::text NOT IN ('posted','payment') THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_NOT_AVAILABLE';
    END IF;
    SELECT created_at::date INTO v_entry_date FROM public.deal_stage_transitions
     WHERE deal_id = p_deal_id AND from_stage::text = 'posted' AND to_stage::text = 'payment'
     ORDER BY created_at DESC, id DESC LIMIT 1;
    RETURN public.materialize_payment_tracking_locked(
        p_deal_id, p_actor_id,
        COALESCE(v_entry_date, (now() AT TIME ZONE 'UTC')::date), p_ip_address
    );
END;
$$;

REVOKE ALL ON FUNCTION public.initialize_payment_tracking(uuid, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.initialize_payment_tracking(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.update_payment_tracking_state(
    p_deal_id uuid,
    p_actor_id uuid,
    p_expected_version integer,
    p_state text,
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
    v_payment public.payments%ROWTYPE;
    v_old_state text;
BEGIN
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_TRACKING_DEAL_NOT_FOUND'; END IF;
    SELECT participant_role::text INTO v_role FROM public.deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role IS NULL THEN RAISE EXCEPTION 'PAYMENT_TRACKING_NOT_PARTICIPANT'; END IF;
    IF v_role NOT IN ('brand_admin','brand_maker') OR NOT EXISTS (
        SELECT 1 FROM public.brand_members
         WHERE brand_id = v_deal.brand_id AND profile_id = p_actor_id AND status::text = 'active'
    ) THEN RAISE EXCEPTION 'PAYMENT_TRACKING_BRAND_ONLY'; END IF;
    IF v_deal.stage::text = 'closed' THEN RAISE EXCEPTION 'PAYMENT_TRACKING_READ_ONLY'; END IF;
    IF v_deal.stage::text <> 'payment' THEN RAISE EXCEPTION 'PAYMENT_TRACKING_NOT_AVAILABLE'; END IF;
    IF v_deal.is_disputed THEN RAISE EXCEPTION 'PAYMENT_TRACKING_DISPUTED'; END IF;

    SELECT * INTO v_payment FROM public.payments
     WHERE deal_id = p_deal_id AND source_summary_id IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_TRACKING_MISSING'; END IF;
    IF v_payment.structure::text <> 'single' THEN RAISE EXCEPTION 'PAYMENT_TRACKING_MILESTONE_ONLY'; END IF;
    IF p_expected_version IS NULL OR p_expected_version <= 0 THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_INVALID_VERSION';
    END IF;
    IF p_state IS NULL OR p_state NOT IN (
        'paid_full','paid_partial','not_paid_in_window','not_paid_delayed','bad_debt','refunded'
    ) THEN RAISE EXCEPTION 'PAYMENT_TRACKING_INVALID_STATE'; END IF;

    IF v_payment.state::text = p_state
       AND p_expected_version IN (v_payment.version, v_payment.version - 1) THEN
        RETURN jsonb_build_object(
            'state', v_payment.state, 'version', v_payment.version, 'idempotent', true
        );
    END IF;
    IF p_expected_version <> v_payment.version THEN RAISE EXCEPTION 'PAYMENT_TRACKING_STALE_VERSION'; END IF;

    v_old_state := v_payment.state::text;
    UPDATE public.payments
       SET state = p_state::public.payment_state_enum,
           version = version + 1,
           updated_by = p_actor_id,
           updated_at = now()
     WHERE id = v_payment.id
     RETURNING * INTO v_payment;

    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'payment_state_reported', 'payment', v_payment.id,
        jsonb_build_object(
            'deal_id', p_deal_id, 'payment_id', v_payment.id,
            'old_state', v_old_state, 'new_state', p_state,
            'version', v_payment.version, 'side', 'brand', 'outcome', 'state_reported'
        ), p_ip_address
    );
    RETURN jsonb_build_object(
        'state', v_payment.state, 'version', v_payment.version, 'idempotent', false
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_payment_milestone_state(
    p_deal_id uuid,
    p_milestone_id uuid,
    p_actor_id uuid,
    p_expected_version integer,
    p_state text,
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
    v_payment public.payments%ROWTYPE;
    v_milestone public.payment_milestones%ROWTYPE;
    v_old_state text;
    v_aggregate text;
BEGIN
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_TRACKING_DEAL_NOT_FOUND'; END IF;
    SELECT participant_role::text INTO v_role FROM public.deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role IS NULL THEN RAISE EXCEPTION 'PAYMENT_TRACKING_NOT_PARTICIPANT'; END IF;
    IF v_role NOT IN ('brand_admin','brand_maker') OR NOT EXISTS (
        SELECT 1 FROM public.brand_members
         WHERE brand_id = v_deal.brand_id AND profile_id = p_actor_id AND status::text = 'active'
    ) THEN RAISE EXCEPTION 'PAYMENT_TRACKING_BRAND_ONLY'; END IF;
    IF v_deal.stage::text = 'closed' THEN RAISE EXCEPTION 'PAYMENT_TRACKING_READ_ONLY'; END IF;
    IF v_deal.stage::text <> 'payment' THEN RAISE EXCEPTION 'PAYMENT_TRACKING_NOT_AVAILABLE'; END IF;
    IF v_deal.is_disputed THEN RAISE EXCEPTION 'PAYMENT_TRACKING_DISPUTED'; END IF;

    SELECT * INTO v_payment FROM public.payments
     WHERE deal_id = p_deal_id AND source_summary_id IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_TRACKING_MISSING'; END IF;
    IF v_payment.structure::text = 'single' THEN RAISE EXCEPTION 'PAYMENT_TRACKING_SINGLE_ONLY'; END IF;
    SELECT * INTO v_milestone FROM public.payment_milestones
     WHERE id = p_milestone_id AND payment_id = v_payment.id AND sequence IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_TRACKING_MILESTONE_NOT_FOUND'; END IF;
    IF p_expected_version IS NULL OR p_expected_version <= 0 THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_INVALID_VERSION';
    END IF;
    IF p_state IS NULL OR p_state NOT IN (
        'paid_full','paid_partial','not_paid_in_window','not_paid_delayed','bad_debt','refunded'
    ) THEN RAISE EXCEPTION 'PAYMENT_TRACKING_INVALID_STATE'; END IF;

    IF v_milestone.state::text = p_state
       AND p_expected_version IN (v_milestone.version, v_milestone.version - 1) THEN
        RETURN jsonb_build_object(
            'milestone_id', v_milestone.id, 'state', v_milestone.state,
            'version', v_milestone.version, 'aggregate_state', v_payment.state,
            'idempotent', true
        );
    END IF;
    IF p_expected_version <> v_milestone.version THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_STALE_VERSION';
    END IF;

    v_old_state := v_milestone.state::text;
    UPDATE public.payment_milestones
       SET state = p_state::public.payment_state_enum,
           version = version + 1,
           updated_by = p_actor_id,
           updated_at = now()
     WHERE id = v_milestone.id
     RETURNING * INTO v_milestone;

    SELECT CASE
        WHEN bool_or(state::text = 'bad_debt') THEN 'bad_debt'
        WHEN bool_or(state::text = 'not_paid_delayed') THEN 'not_paid_delayed'
        WHEN bool_and(state::text = 'paid_full') THEN 'paid_full'
        WHEN bool_and(state::text = 'refunded') THEN 'refunded'
        WHEN bool_or(state::text IN ('paid_full','paid_partial','refunded')) THEN 'paid_partial'
        ELSE 'not_paid_in_window'
    END INTO v_aggregate
      FROM public.payment_milestones
     WHERE payment_id = v_payment.id AND sequence IS NOT NULL;

    UPDATE public.payments
       SET state = v_aggregate::public.payment_state_enum,
           updated_by = p_actor_id,
           updated_at = now()
     WHERE id = v_payment.id AND state::text <> v_aggregate
     RETURNING * INTO v_payment;
    IF NOT FOUND THEN
        SELECT * INTO v_payment FROM public.payments WHERE id = v_milestone.payment_id;
    END IF;

    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'payment_milestone_state_reported', 'payment_milestone', v_milestone.id,
        jsonb_build_object(
            'deal_id', p_deal_id, 'payment_id', v_payment.id, 'milestone_id', v_milestone.id,
            'old_state', v_old_state, 'new_state', p_state,
            'version', v_milestone.version, 'aggregate_state', v_aggregate,
            'side', 'brand', 'outcome', 'state_reported'
        ), p_ip_address
    );
    RETURN jsonb_build_object(
        'milestone_id', v_milestone.id, 'state', v_milestone.state,
        'version', v_milestone.version, 'aggregate_state', v_aggregate,
        'idempotent', false
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_payment_receipt(
    p_deal_id uuid,
    p_milestone_id uuid,
    p_actor_id uuid,
    p_expected_version integer,
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
    v_payment public.payments%ROWTYPE;
    v_milestone public.payment_milestones%ROWTYPE;
BEGIN
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_TRACKING_DEAL_NOT_FOUND'; END IF;
    SELECT participant_role::text INTO v_role FROM public.deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role IS NULL THEN RAISE EXCEPTION 'PAYMENT_TRACKING_NOT_PARTICIPANT'; END IF;
    IF v_role <> 'creator' OR v_deal.creator_id <> p_actor_id THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_CREATOR_ONLY';
    END IF;
    IF v_deal.stage::text = 'closed' THEN RAISE EXCEPTION 'PAYMENT_TRACKING_READ_ONLY'; END IF;
    IF v_deal.stage::text <> 'payment' THEN RAISE EXCEPTION 'PAYMENT_TRACKING_NOT_AVAILABLE'; END IF;
    IF v_deal.is_disputed THEN RAISE EXCEPTION 'PAYMENT_TRACKING_DISPUTED'; END IF;

    SELECT * INTO v_payment FROM public.payments
     WHERE deal_id = p_deal_id AND source_summary_id IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_TRACKING_MISSING'; END IF;
    IF p_expected_version IS NULL OR p_expected_version <= 0 THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_INVALID_VERSION';
    END IF;

    IF v_payment.structure::text = 'single' THEN
        IF p_milestone_id IS NOT NULL THEN RAISE EXCEPTION 'PAYMENT_TRACKING_SINGLE_ONLY'; END IF;
        IF v_payment.version <> p_expected_version THEN RAISE EXCEPTION 'PAYMENT_TRACKING_STALE_VERSION'; END IF;
        IF v_payment.state::text NOT IN ('paid_partial','paid_full') THEN
            RAISE EXCEPTION 'PAYMENT_TRACKING_RECEIPT_STATE';
        END IF;
        IF v_payment.creator_receipt_version = p_expected_version
           AND v_payment.creator_receipt_confirmed_by = p_actor_id THEN
            RETURN jsonb_build_object(
                'item_type', 'payment', 'item_id', v_payment.id,
                'version', v_payment.version, 'idempotent', true
            );
        END IF;
        UPDATE public.payments
           SET creator_receipt_version = p_expected_version,
               creator_receipt_confirmed_by = p_actor_id,
               creator_receipt_confirmed_at = now()
         WHERE id = v_payment.id
         RETURNING * INTO v_payment;
        INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (
            p_actor_id, 'payment_receipt_confirmed', 'payment', v_payment.id,
            jsonb_build_object(
                'deal_id', p_deal_id, 'payment_id', v_payment.id,
                'version', v_payment.version, 'state', v_payment.state,
                'side', 'creator', 'outcome', 'receipt_confirmed'
            ), p_ip_address
        );
        RETURN jsonb_build_object(
            'item_type', 'payment', 'item_id', v_payment.id,
            'version', v_payment.version, 'idempotent', false
        );
    END IF;

    IF p_milestone_id IS NULL THEN RAISE EXCEPTION 'PAYMENT_TRACKING_MILESTONE_ONLY'; END IF;
    SELECT * INTO v_milestone FROM public.payment_milestones
     WHERE id = p_milestone_id AND payment_id = v_payment.id AND sequence IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_TRACKING_MILESTONE_NOT_FOUND'; END IF;
    IF v_milestone.version <> p_expected_version THEN RAISE EXCEPTION 'PAYMENT_TRACKING_STALE_VERSION'; END IF;
    IF v_milestone.state::text NOT IN ('paid_partial','paid_full') THEN
        RAISE EXCEPTION 'PAYMENT_TRACKING_RECEIPT_STATE';
    END IF;
    IF v_milestone.creator_receipt_version = p_expected_version
       AND v_milestone.creator_receipt_confirmed_by = p_actor_id THEN
        RETURN jsonb_build_object(
            'item_type', 'milestone', 'item_id', v_milestone.id,
            'version', v_milestone.version, 'idempotent', true
        );
    END IF;
    UPDATE public.payment_milestones
       SET creator_receipt_version = p_expected_version,
           creator_receipt_confirmed_by = p_actor_id,
           creator_receipt_confirmed_at = now()
     WHERE id = v_milestone.id
     RETURNING * INTO v_milestone;
    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'payment_milestone_receipt_confirmed', 'payment_milestone', v_milestone.id,
        jsonb_build_object(
            'deal_id', p_deal_id, 'payment_id', v_payment.id, 'milestone_id', v_milestone.id,
            'version', v_milestone.version, 'state', v_milestone.state,
            'side', 'creator', 'outcome', 'receipt_confirmed'
        ), p_ip_address
    );
    RETURN jsonb_build_object(
        'item_type', 'milestone', 'item_id', v_milestone.id,
        'version', v_milestone.version, 'idempotent', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.update_payment_tracking_state(uuid, uuid, integer, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_payment_milestone_state(uuid, uuid, uuid, integer, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_payment_receipt(uuid, uuid, uuid, integer, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_payment_tracking_state(uuid, uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_payment_milestone_state(uuid, uuid, uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_payment_receipt(uuid, uuid, uuid, integer, text) TO service_role;

-- Extend the existing request/response-compatible Posted -> Payment transaction.
CREATE OR REPLACE FUNCTION public.confirm_live_posts(
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
    v_entry_date date;
    v_payment_result jsonb;
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
    IF v_deal.is_disputed THEN RAISE EXCEPTION 'PAYMENT_TRACKING_DISPUTED'; END IF;

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
        SELECT created_at::date INTO v_entry_date FROM public.deal_stage_transitions
         WHERE deal_id = p_deal_id AND from_stage::text = 'posted' AND to_stage::text = 'payment'
         ORDER BY created_at DESC, id DESC LIMIT 1;
    ELSE
        v_entry_date := (now() AT TIME ZONE 'UTC')::date;
    END IF;
    v_payment_result := public.materialize_payment_tracking_locked(
        p_deal_id, p_actor_id, COALESCE(v_entry_date, (now() AT TIME ZONE 'UTC')::date), p_ip_address
    );

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
            'payment_id', v_payment_result->>'payment_id',
            'outcome', 'all_posts_payment_details_and_tracking_confirmed'
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

REVOKE ALL ON FUNCTION public.enforce_canonical_payment_identity()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_canonical_payment_milestone_identity()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_live_posts(uuid, uuid, jsonb, integer, integer, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_live_posts(uuid, uuid, jsonb, integer, integer, text)
    TO service_role;
