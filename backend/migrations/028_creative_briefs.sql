-- ============================================================
-- 028_creative_briefs.sql
-- Workplan 9.13-A: immutable, versioned creative briefs
-- Depends on: 027_contract_alignment.sql
-- ============================================================

-- Historical rows remain readable. New backend-created versions carry exact
-- author/acknowledgement provenance.
ALTER TABLE briefs
    ADD COLUMN created_by uuid REFERENCES profiles(id) ON DELETE RESTRICT,
    ADD COLUMN acknowledged_by uuid REFERENCES profiles(id) ON DELETE RESTRICT,
    ADD COLUMN acknowledged_at timestamptz;

CREATE UNIQUE INDEX briefs_deal_version_unique ON briefs (deal_id, version);

CREATE OR REPLACE FUNCTION brief_string_array_is_valid(
    p_value jsonb,
    p_max_items integer,
    p_max_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
    SELECT jsonb_typeof(p_value) = 'array'
       AND jsonb_array_length(p_value) <= p_max_items
       AND NOT EXISTS (
           SELECT 1
             FROM jsonb_array_elements(p_value) AS item(value)
            WHERE jsonb_typeof(value) <> 'string'
               OR length(value #>> '{}') NOT BETWEEN 1 AND p_max_length
       );
$$;

-- NOT VALID preserves any historical row while enforcing the contract for all
-- new versions and for the sole allowed mutation (acknowledgement).
ALTER TABLE briefs
    ADD CONSTRAINT briefs_version_positive CHECK (version > 0) NOT VALID,
    ADD CONSTRAINT briefs_created_by_required CHECK (created_by IS NOT NULL) NOT VALID,
    ADD CONSTRAINT briefs_content_shape CHECK (
        jsonb_typeof(content) = 'object'
        AND content ?& ARRAY['objective', 'guidelines', 'dos', 'donts', 'hashtags', 'caption_guidance']
        AND jsonb_typeof(content -> 'objective') = 'string'
        AND length(btrim(content ->> 'objective')) BETWEEN 1 AND 500
        AND jsonb_typeof(content -> 'guidelines') = 'string'
        AND length(content ->> 'guidelines') <= 2000
        AND brief_string_array_is_valid(content -> 'dos', 20, 200)
        AND brief_string_array_is_valid(content -> 'donts', 20, 200)
        AND brief_string_array_is_valid(content -> 'hashtags', 20, 100)
        AND jsonb_typeof(content -> 'caption_guidance') = 'string'
        AND length(content ->> 'caption_guidance') <= 2000
    ) NOT VALID,
    ADD CONSTRAINT briefs_acknowledgement_consistent CHECK (
        (NOT acknowledged_by_creator AND acknowledged_by IS NULL AND acknowledged_at IS NULL)
        OR (acknowledged_by_creator AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL)
    ) NOT VALID;

-- Participant reads remain RLS-protected. The service role is read-only too:
-- SECURITY DEFINER RPCs owned by the migration role are the sole write boundary.
DROP POLICY IF EXISTS "briefs_insert_participant" ON briefs;
DROP POLICY IF EXISTS "briefs_update_participant" ON briefs;
REVOKE INSERT, UPDATE, DELETE ON briefs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON briefs FROM service_role;
GRANT SELECT ON briefs TO authenticated;
GRANT SELECT ON briefs TO service_role;

CREATE OR REPLACE FUNCTION enforce_brief_immutable_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.deal_id IS DISTINCT FROM OLD.deal_id
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.content IS DISTINCT FROM OLD.content
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'BRIEF_IMMUTABLE';
    END IF;

    IF OLD.acknowledged_by_creator THEN
        IF NEW.acknowledged_by_creator IS DISTINCT FROM OLD.acknowledged_by_creator
           OR NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by
           OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at THEN
            RAISE EXCEPTION 'BRIEF_ACK_IMMUTABLE';
        END IF;
        RETURN NEW;
    END IF;

    IF NOT NEW.acknowledged_by_creator
       OR NEW.acknowledged_by IS NULL
       OR NEW.acknowledged_at IS NULL THEN
        RAISE EXCEPTION 'BRIEF_ONLY_ACK_UPDATE_ALLOWED';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS briefs_immutable_update ON briefs;
CREATE TRIGGER briefs_immutable_update
BEFORE UPDATE ON briefs
FOR EACH ROW EXECUTE FUNCTION enforce_brief_immutable_update();

-- A direct child delete is never valid. PostgreSQL's FK cascade invokes this
-- trigger below the parent-delete trigger depth, so deleting a deal still safely
-- removes its referenced brief history.
CREATE OR REPLACE FUNCTION prevent_brief_direct_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF pg_trigger_depth() <= 1 THEN
        RAISE EXCEPTION 'BRIEF_DIRECT_DELETE_FORBIDDEN';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS briefs_no_direct_delete ON briefs;
CREATE TRIGGER briefs_no_direct_delete
BEFORE DELETE ON briefs
FOR EACH ROW EXECUTE FUNCTION prevent_brief_direct_delete();

CREATE OR REPLACE FUNCTION create_creative_brief_version(
    p_deal_id uuid,
    p_actor_id uuid,
    p_expected_version integer,
    p_content jsonb,
    p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal deals%ROWTYPE;
    v_role text;
    v_current_version integer;
    v_brief briefs%ROWTYPE;
BEGIN
    SELECT * INTO v_deal
      FROM deals
     WHERE id = p_deal_id AND deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BRIEF_DEAL_NOT_FOUND';
    END IF;

    SELECT participant_role::text INTO v_role
      FROM deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'BRIEF_NOT_PARTICIPANT';
    END IF;
    IF v_role NOT IN ('brand_admin', 'brand_maker') THEN
        RAISE EXCEPTION 'BRIEF_WRONG_ROLE';
    END IF;
    IF v_deal.stage::text <> 'creating' THEN
        RAISE EXCEPTION 'BRIEF_WRONG_STAGE';
    END IF;
    IF p_expected_version IS NULL OR p_expected_version < 0 THEN
        RAISE EXCEPTION 'BRIEF_INVALID_EXPECTED_VERSION';
    END IF;

    SELECT COALESCE(MAX(version), 0) INTO v_current_version
      FROM briefs
     WHERE deal_id = p_deal_id;
    IF v_current_version <> p_expected_version THEN
        RAISE EXCEPTION 'BRIEF_STALE_VERSION';
    END IF;

    INSERT INTO briefs (
        deal_id, version, content, created_by,
        acknowledged_by_creator, acknowledged_by, acknowledged_at
    ) VALUES (
        p_deal_id, v_current_version + 1, p_content, p_actor_id,
        false, NULL, NULL
    )
    RETURNING * INTO v_brief;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id,
        'creative_brief_created',
        'brief',
        v_brief.id,
        jsonb_build_object(
            'deal_id', p_deal_id,
            'brief_id', v_brief.id,
            'version', v_brief.version,
            'actor_id', p_actor_id
        ),
        p_ip_address
    );

    RETURN jsonb_build_object(
        'brief_id', v_brief.id,
        'version', v_brief.version,
        'created_at', v_brief.created_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION acknowledge_creative_brief(
    p_deal_id uuid,
    p_brief_id uuid,
    p_actor_id uuid,
    p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal deals%ROWTYPE;
    v_brief briefs%ROWTYPE;
BEGIN
    SELECT * INTO v_deal
      FROM deals
     WHERE id = p_deal_id AND deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BRIEF_DEAL_NOT_FOUND';
    END IF;
    IF v_deal.creator_id <> p_actor_id
       OR NOT EXISTS (
           SELECT 1 FROM deal_participants
            WHERE deal_id = p_deal_id
              AND profile_id = p_actor_id
              AND participant_role::text = 'creator'
    ) THEN
        RAISE EXCEPTION 'BRIEF_ACK_CREATOR_ONLY';
    END IF;
    IF v_deal.stage::text <> 'creating' THEN
        RAISE EXCEPTION 'BRIEF_WRONG_STAGE';
    END IF;

    SELECT * INTO v_brief
      FROM briefs
     WHERE deal_id = p_deal_id
     ORDER BY version DESC
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BRIEF_NOT_FOUND';
    END IF;
    IF v_brief.id <> p_brief_id THEN
        RAISE EXCEPTION 'BRIEF_STALE_ACK';
    END IF;
    IF v_brief.acknowledged_by_creator THEN
        RETURN jsonb_build_object(
            'brief_id', v_brief.id,
            'version', v_brief.version,
            'acknowledged', true,
            'idempotent', true,
            'acknowledged_at', v_brief.acknowledged_at
        );
    END IF;

    UPDATE briefs
       SET acknowledged_by_creator = true,
           acknowledged_by = p_actor_id,
           acknowledged_at = now()
     WHERE id = v_brief.id
     RETURNING * INTO v_brief;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id,
        'creative_brief_acknowledged',
        'brief',
        v_brief.id,
        jsonb_build_object(
            'deal_id', p_deal_id,
            'brief_id', v_brief.id,
            'version', v_brief.version,
            'actor_id', p_actor_id
        ),
        p_ip_address
    );

    RETURN jsonb_build_object(
        'brief_id', v_brief.id,
        'version', v_brief.version,
        'acknowledged', true,
        'idempotent', false,
        'acknowledged_at', v_brief.acknowledged_at
    );
END;
$$;

REVOKE ALL ON FUNCTION enforce_brief_immutable_update() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION prevent_brief_direct_delete() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION brief_string_array_is_valid(jsonb, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION create_creative_brief_version(uuid, uuid, integer, jsonb, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION acknowledge_creative_brief(uuid, uuid, uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_creative_brief_version(uuid, uuid, integer, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION acknowledge_creative_brief(uuid, uuid, uuid, text) TO service_role;
