-- Workplan 12.1-D: commit one recipient-only request notice with a new Pending deal.
-- Replaces only the service-role Connect routine; existing rows and other writers are untouched.
CREATE OR REPLACE FUNCTION public.connect_with_category(
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
    IF v_direction = 'outbound' AND v_brand_admin IS NULL THEN
        RAISE EXCEPTION 'CONNECT_RECIPIENT_UNAVAILABLE';
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
    INSERT INTO public.notifications (profile_id, tier, title, body, deal_id)
    VALUES (CASE WHEN v_direction = 'inbound' THEN v_creator ELSE v_brand_admin END,
            'important', 'Connection request received',
            'You have a new connection request to review.', v_deal_id);
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

REVOKE ALL ON FUNCTION public.connect_with_category(uuid, text, uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.connect_with_category(uuid, text, uuid, text, text, jsonb, text) TO service_role;
