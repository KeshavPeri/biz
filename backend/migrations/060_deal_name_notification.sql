-- Workplan 12.1-E: an actual deal-name change atomically alerts other participants.
-- Replaces only the service-role rename routine; existing rows are untouched.
CREATE OR REPLACE FUNCTION public.apply_deal_name_rename(
    p_deal_id uuid,
    p_actor_id uuid,
    p_expected_version integer,
    p_deal_name text,
    p_ip_address text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal deals%ROWTYPE;
    v_role participant_role_enum;
    v_new_version integer;
    v_new_updated_at timestamptz;
BEGIN
    SELECT * INTO v_deal
      FROM deals
     WHERE id = p_deal_id
     FOR UPDATE;
    IF NOT FOUND OR v_deal.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'DEAL_NAME_NOT_FOUND';
    END IF;

    SELECT participant_role INTO v_role
      FROM deal_participants
     WHERE deal_id = p_deal_id
       AND profile_id = p_actor_id;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'DEAL_NAME_FORBIDDEN';
    END IF;

    IF v_deal.stage IN ('closed', 'declined', 'cancelled') THEN
        RAISE EXCEPTION 'DEAL_NAME_TERMINAL';
    END IF;

    -- Python supplies NFKC/collapsed-whitespace text. The database still owns
    -- hard validity checks so a service regression cannot persist unsafe text.
    IF p_deal_name IS NULL
       OR p_deal_name <> btrim(p_deal_name)
       OR char_length(p_deal_name) NOT BETWEEN 1 AND 160
       OR p_deal_name ~ '[[:cntrl:]]'
       OR strpos(p_deal_name, chr(1564)) > 0
       OR strpos(p_deal_name, chr(8206)) > 0
       OR strpos(p_deal_name, chr(8207)) > 0
       OR strpos(p_deal_name, chr(8234)) > 0
       OR strpos(p_deal_name, chr(8235)) > 0
       OR strpos(p_deal_name, chr(8236)) > 0
       OR strpos(p_deal_name, chr(8237)) > 0
       OR strpos(p_deal_name, chr(8238)) > 0
       OR strpos(p_deal_name, chr(8294)) > 0
       OR strpos(p_deal_name, chr(8295)) > 0
       OR strpos(p_deal_name, chr(8296)) > 0
       OR strpos(p_deal_name, chr(8297)) > 0 THEN
        RAISE EXCEPTION 'DEAL_NAME_INVALID';
    END IF;

    -- Exact retries are idempotent even after their displayed version becomes
    -- stale. This comparison is against the already-normalized canonical value.
    IF p_deal_name = v_deal.deal_name THEN
        RETURN jsonb_build_object(
            'deal_name', v_deal.deal_name,
            'deal_name_version', v_deal.deal_name_version,
            'idempotent', true
        );
    END IF;

    IF p_expected_version IS NULL OR p_expected_version <> v_deal.deal_name_version THEN
        RAISE EXCEPTION 'DEAL_NAME_STALE';
    END IF;

    v_new_version := v_deal.deal_name_version + 1;
    v_new_updated_at := greatest(clock_timestamp(), v_deal.updated_at + interval '1 microsecond');
    UPDATE deals
       SET deal_name = p_deal_name,
           deal_name_version = v_new_version,
           updated_at = v_new_updated_at
     WHERE id = p_deal_id;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id,
        'deal_name_changed',
        'deal',
        p_deal_id,
        jsonb_build_object(
            'previous_version', v_deal.deal_name_version,
            'new_version', v_new_version,
            'previous_character_count', char_length(v_deal.deal_name),
            'new_character_count', char_length(p_deal_name)
        ),
        p_ip_address
    );

    -- The same transaction owns the name, audit and recipient notices.
    -- Participant rows, not the request or brand membership, choose recipients.
    INSERT INTO public.notifications (profile_id, tier, title, body, deal_id)
    SELECT DISTINCT dp.profile_id, 'informational'::notification_tier_enum, 'Deal renamed',
           'A deal you participate in was renamed.', p_deal_id
      FROM public.deal_participants AS dp
     WHERE dp.deal_id = p_deal_id
       AND dp.profile_id <> p_actor_id;

    RETURN jsonb_build_object(
        'deal_name', p_deal_name,
        'deal_name_version', v_new_version,
        'idempotent', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_deal_name_rename(uuid, uuid, integer, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_deal_name_rename(uuid, uuid, integer, text, text)
    TO service_role;
