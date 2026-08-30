-- ============================================================
-- 031_content_submission_hardening.sql
-- Review repair for workplan 9.13-C
-- Depends on: 030_content_submissions.sql
-- ============================================================

-- Participant history is exposed only by the safe FastAPI projection. The raw
-- table contains private object paths and therefore must not be selectable with
-- an authenticated JWT, even when its row-level participant predicate matches.
DROP POLICY IF EXISTS "revisions_read_participant" ON revisions;
REVOKE SELECT ON revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON revisions TO service_role;

-- Cleanup claims are short leases so a crashed worker can be retried. Attempts
-- are observable without retaining private errors or other request payloads.
ALTER TABLE content_draft_uploads
    ADD COLUMN cleanup_started_at timestamptz,
    ADD COLUMN cleanup_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE content_draft_uploads
    ADD CONSTRAINT content_draft_uploads_cleanup_consistent CHECK (
        cleanup_attempts >= 0
        AND (cleanup_started_at IS NULL OR (bound_revision_id IS NULL AND expires_at <= now()))
    ) NOT VALID;

-- A creator can have at most ten current unbound reservations for one
-- deliverable. The prepare RPC already holds that deliverable's deal lock, so
-- this trigger also closes concurrent direct function calls deterministically.
CREATE OR REPLACE FUNCTION enforce_content_draft_reservation_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF (
        SELECT count(*)
          FROM content_draft_uploads
         WHERE created_by = NEW.created_by
           AND deliverable_id = NEW.deliverable_id
           AND bound_revision_id IS NULL
           AND expires_at > now()
    ) >= 10 THEN
        RAISE EXCEPTION 'CONTENT_UPLOAD_LIMIT_REACHED';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER content_draft_upload_reservation_limit
BEFORE INSERT ON content_draft_uploads
FOR EACH ROW EXECUTE FUNCTION enforce_content_draft_reservation_limit();

CREATE OR REPLACE FUNCTION claim_expired_content_draft_uploads(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_limit integer;
    v_claimed jsonb;
BEGIN
    v_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 25);
    WITH candidates AS (
        SELECT id
          FROM content_draft_uploads
         WHERE bound_revision_id IS NULL
           AND expires_at <= now()
           AND (cleanup_started_at IS NULL OR cleanup_started_at < now() - interval '5 minutes')
         ORDER BY expires_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT v_limit
    ), claimed AS (
        UPDATE content_draft_uploads u
           SET cleanup_started_at = now(), cleanup_attempts = cleanup_attempts + 1
          FROM candidates c
         WHERE u.id = c.id
        RETURNING u.id, u.object_path
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'object_path', object_path)), '[]'::jsonb)
      INTO v_claimed
      FROM claimed;
    RETURN v_claimed;
END;
$$;

CREATE OR REPLACE FUNCTION complete_expired_content_draft_upload_cleanup(p_upload_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    DELETE FROM content_draft_uploads
     WHERE id = p_upload_id
       AND bound_revision_id IS NULL
       AND expires_at <= now()
       AND cleanup_started_at IS NOT NULL;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION release_expired_content_draft_upload_cleanup(p_upload_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE content_draft_uploads
       SET cleanup_started_at = NULL
     WHERE id = p_upload_id
       AND bound_revision_id IS NULL
       AND expires_at <= now();
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION enforce_content_draft_reservation_limit()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION claim_expired_content_draft_uploads(integer)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION complete_expired_content_draft_upload_cleanup(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION release_expired_content_draft_upload_cleanup(uuid)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION claim_expired_content_draft_uploads(integer) TO service_role;
GRANT EXECUTE ON FUNCTION complete_expired_content_draft_upload_cleanup(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION release_expired_content_draft_upload_cleanup(uuid) TO service_role;
