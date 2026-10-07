-- Workplan 11.5: explicit immutable deal category and creator-only conflict decisions.
-- All new routines are backend-only. Existing null-category deals are untouched.
ALTER TABLE public.deals ADD COLUMN category text;
ALTER TABLE public.deals ADD CONSTRAINT deals_category_valid CHECK (
    category IS NULL OR (
        length(category) BETWEEN 1 AND 200 AND category = btrim(category)
        AND category !~ '[[:cntrl:]]'
        AND translate(category,
            chr(8234)||chr(8235)||chr(8236)||chr(8237)||chr(8238)||
            chr(8294)||chr(8295)||chr(8296)||chr(8297)||chr(8206)||chr(8207),
            '') = category
    )
) NOT VALID;

CREATE FUNCTION public.prevent_deal_category_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.category IS DISTINCT FROM OLD.category THEN
        RAISE EXCEPTION 'DEAL_CATEGORY_IMMUTABLE';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER deal_category_immutable BEFORE UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.prevent_deal_category_change();

-- The backend owns deal creation; no authenticated table insert may bypass the
-- explicit category or participant rules.
REVOKE INSERT ON public.deals FROM PUBLIC, anon, authenticated;

-- All canonical-clause mutations take the creator's transaction advisory lock.
-- The confirm RPCs take the same lock before checking the exact snapshot.
CREATE FUNCTION public.lock_exclusivity_creator() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_creator uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT creator_id INTO v_creator FROM public.deals WHERE id = OLD.deal_id;
    ELSE
        SELECT creator_id INTO v_creator FROM public.deals WHERE id = NEW.deal_id;
    END IF;
    IF v_creator IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(v_creator::text, 57041));
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER exclusivity_creator_write_lock
BEFORE INSERT OR UPDATE OR DELETE ON public.exclusivity_clauses
FOR EACH ROW EXECUTE FUNCTION public.lock_exclusivity_creator();

-- Private inventory. Python verifies each source against the executed terms;
-- this snapshot binds that verification to the locked mutation transaction.
CREATE FUNCTION public.exclusivity_conflict_snapshot(p_creator_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_day date := (transaction_timestamp() AT TIME ZONE 'UTC')::date;
        v_rows jsonb;
BEGIN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'deal_id', e.deal_id,
        'source_summary_id', e.source_summary_id,
        'has_exclusivity', e.has_exclusivity, 'category', e.category,
        'duration_days', e.duration_days, 'start_date', e.start_date,
        'end_date', e.end_date, 'brand_name', b.company_name,
        'brand_id', d.brand_id,
        'source_status', s.status, 'source_terms_hash', md5(coalesce(s.structured_terms::text, '')),
        'source_schema', s.schema_version, 'source_prompt', s.prompt_version,
        'source_contracts', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id', c.id, 'status', c.status, 'version', c.version,
            'summary_id', c.generated_from_summary_id) ORDER BY c.id)
            FROM public.contracts c WHERE c.deal_id = d.id AND c.version = 1), '[]'::jsonb),
        'execution_audits', coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id', a.id, 'created_at', a.created_at, 'metadata', a.metadata) ORDER BY a.id)
            FROM public.audit_log a WHERE a.entity_type = 'deal' AND a.entity_id = d.id
              AND a.action = 'contract_executed'), '[]'::jsonb)
    ) ORDER BY e.id), '[]'::jsonb) INTO v_rows
    FROM public.exclusivity_clauses e
    JOIN public.deals d ON d.id = e.deal_id AND d.deleted_at IS NULL
    JOIN public.brands b ON b.id = d.brand_id
    LEFT JOIN public.ai_summaries s ON s.id = e.source_summary_id
    WHERE d.creator_id = p_creator_id AND e.source_summary_id IS NOT NULL;
    RETURN jsonb_build_object('as_of', v_day, 'rows', v_rows,
                              'snapshot', md5(v_day::text || ':' || v_rows::text));
END;
$$;

-- A pair lock makes duplicate Connect retries deterministic even when two
-- requests enter at once. The creator lock serializes clause changes.
CREATE FUNCTION public.connect_with_category(
    p_actor_id uuid, p_target_type text, p_target_id uuid,
    p_category text, p_expected_snapshot text, p_override_metadata jsonb,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actor_type text; v_creator uuid; v_brand uuid; v_direction text;
        v_brand_admin uuid; v_brand_name text; v_creator_name text;
        v_existing public.deals%ROWTYPE; v_deal_id uuid; v_snapshot jsonb;
BEGIN
    IF p_actor_id IS NULL OR p_target_id IS NULL OR p_category IS NULL
       OR length(p_category) NOT BETWEEN 1 AND 200 OR p_category <> btrim(p_category)
       OR p_category ~ '[[:cntrl:]]'
       OR translate(p_category,
            chr(8234)||chr(8235)||chr(8236)||chr(8237)||chr(8238)||
            chr(8294)||chr(8295)||chr(8296)||chr(8297)||chr(8206)||chr(8207),
            '') <> p_category
       OR p_ip_address IS NULL OR length(p_ip_address) NOT BETWEEN 1 AND 255 THEN
        RAISE EXCEPTION 'CONNECT_INVALID';
    END IF;
    SELECT account_type::text INTO v_actor_type FROM public.profiles WHERE id = p_actor_id;
    IF v_actor_type = 'creator' AND p_target_type = 'brand' THEN
        v_creator := p_actor_id; v_brand := p_target_id; v_direction := 'outbound';
        IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id = v_brand) THEN
            RAISE EXCEPTION 'CONNECT_TARGET';
        END IF;
    ELSIF v_actor_type = 'brand' AND p_target_type = 'creator' THEN
        SELECT brand_id INTO v_brand FROM public.brand_members
         WHERE profile_id = p_actor_id AND status::text = 'active'
         ORDER BY brand_id LIMIT 1;
        IF v_brand IS NULL THEN RAISE EXCEPTION 'CONNECT_MEMBERSHIP'; END IF;
        v_creator := p_target_id; v_direction := 'inbound';
        IF NOT EXISTS (SELECT 1 FROM public.profiles
                       WHERE id = v_creator AND account_type::text = 'creator') THEN
            RAISE EXCEPTION 'CONNECT_TARGET';
        END IF;
    ELSE
        RAISE EXCEPTION 'CONNECT_TARGET';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_creator::text, 57041));
    PERFORM pg_advisory_xact_lock(hashtextextended(v_creator::text || ':' || v_brand::text, 57042));
    SELECT * INTO v_existing FROM public.deals
     WHERE creator_id = v_creator AND brand_id = v_brand AND deleted_at IS NULL
       AND stage::text NOT IN ('declined', 'cancelled', 'closed')
     ORDER BY created_at, id LIMIT 1;
    IF FOUND THEN
        RETURN jsonb_build_object('deal_id', v_existing.id, 'stage', v_existing.stage,
                                  'created', false);
    END IF;
    IF v_direction = 'outbound' THEN
        v_snapshot := public.exclusivity_conflict_snapshot(v_creator);
        IF p_expected_snapshot IS NULL OR p_expected_snapshot <> v_snapshot->>'snapshot' THEN
            RAISE EXCEPTION 'CONNECT_STALE';
        END IF;
    ELSIF p_expected_snapshot IS NOT NULL OR p_override_metadata IS NOT NULL THEN
        RAISE EXCEPTION 'CONNECT_INVALID';
    END IF;
    SELECT company_name INTO v_brand_name FROM public.brands WHERE id = v_brand;
    SELECT display_name INTO v_creator_name FROM public.profiles WHERE id = v_creator;
    IF v_direction = 'inbound' THEN
        v_brand_admin := p_actor_id;
    ELSE
        SELECT profile_id INTO v_brand_admin FROM public.brand_members
         WHERE brand_id = v_brand AND status::text = 'active' AND brand_role::text = 'admin'
         ORDER BY profile_id LIMIT 1;
    END IF;
    INSERT INTO public.deals (creator_id, brand_id, deal_name, deal_type, stage,
                              direction, currency, created_by, expires_at, category)
    VALUES (v_creator, v_brand, coalesce(v_brand_name, 'Brand') || ' × ' ||
            coalesce(v_creator_name, 'Creator'), 'campaign', 'pending',
            v_direction::deal_direction_enum, 'INR', p_actor_id,
            transaction_timestamp() + interval '72 hours', p_category)
    RETURNING id INTO v_deal_id;
    INSERT INTO public.deal_participants (deal_id, profile_id, participant_role)
    VALUES (v_deal_id, v_creator, 'creator');
    IF v_brand_admin IS NOT NULL THEN
        INSERT INTO public.deal_participants (deal_id, profile_id, participant_role)
        VALUES (v_deal_id, v_brand_admin, 'brand_admin');
    END IF;
    INSERT INTO public.deal_stage_transitions
        (deal_id, from_stage, to_stage, transition_type, triggered_by)
    VALUES (v_deal_id, NULL, 'pending', 'auto', p_actor_id);
    INSERT INTO public.messages (deal_id, sender_id, body)
    VALUES (v_deal_id, p_actor_id,
            'Started a connection — this is the beginning of your deal thread.');
    IF p_override_metadata IS NOT NULL THEN
        IF v_direction <> 'outbound' OR p_override_metadata->>'digest' IS NULL THEN
            RAISE EXCEPTION 'CONNECT_INVALID';
        END IF;
        INSERT INTO public.audit_log
            (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (p_actor_id, 'exclusivity_conflict_override', 'deal', v_deal_id,
                p_override_metadata, p_ip_address);
    END IF;
    RETURN jsonb_build_object('deal_id', v_deal_id, 'stage', 'pending', 'created', true);
END;
$$;

CREATE FUNCTION public.accept_with_category_conflicts(
    p_deal_id uuid, p_actor_id uuid, p_expected_snapshot text,
    p_override_metadata jsonb, p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_deal public.deals%ROWTYPE; v_snapshot jsonb; v_applied boolean;
BEGIN
    IF p_deal_id IS NULL OR p_actor_id IS NULL OR p_expected_snapshot IS NULL
       OR p_ip_address IS NULL OR length(p_ip_address) NOT BETWEEN 1 AND 255 THEN
        RAISE EXCEPTION 'ACCEPT_INVALID';
    END IF;
    SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ACCEPT_STALE'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_deal.creator_id::text, 57041));
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_deal.stage::text <> 'pending' THEN RAISE EXCEPTION 'ACCEPT_STALE'; END IF;
    IF v_deal.category IS NULL OR v_deal.created_by = p_actor_id
       OR v_deal.creator_id <> p_actor_id
       OR NOT EXISTS (SELECT 1 FROM public.deal_participants
                       WHERE deal_id = p_deal_id AND profile_id = p_actor_id
                         AND participant_role::text = 'creator') THEN
        RAISE EXCEPTION 'ACCEPT_ROLE';
    END IF;
    IF v_deal.expires_at IS NOT NULL AND transaction_timestamp() >= v_deal.expires_at THEN
        RAISE EXCEPTION 'ACCEPT_EXPIRED';
    END IF;
    v_snapshot := public.exclusivity_conflict_snapshot(v_deal.creator_id);
    IF p_expected_snapshot <> v_snapshot->>'snapshot' THEN RAISE EXCEPTION 'ACCEPT_STALE'; END IF;
    IF p_override_metadata IS NOT NULL AND p_override_metadata->>'digest' IS NULL THEN
        RAISE EXCEPTION 'ACCEPT_INVALID';
    END IF;
    v_applied := public.apply_stage_transition(
        p_deal_id, 'pending', 'chatting', 'gated', p_actor_id, true,
        'deal_accept', p_actor_id,
        coalesce(p_override_metadata, '{}'::jsonb) ||
            jsonb_build_object('from_stage', 'pending', 'to_stage', 'chatting'),
        p_ip_address
    );
    IF NOT v_applied THEN RAISE EXCEPTION 'ACCEPT_STALE'; END IF;
    RETURN jsonb_build_object('transitioned', true, 'stage', 'chatting');
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_deal_category_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lock_exclusivity_creator() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.exclusivity_conflict_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.connect_with_category(uuid, text, uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_with_category_conflicts(uuid, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exclusivity_conflict_snapshot(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.connect_with_category(uuid, text, uuid, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_with_category_conflicts(uuid, uuid, text, jsonb, text) TO service_role;
