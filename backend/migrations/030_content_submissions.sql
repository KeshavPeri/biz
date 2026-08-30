-- ============================================================
-- 030_content_submissions.sql
-- Workplan 9.13-C: private draft submissions and revision requests
-- Depends on: 029_canonical_deliverables.sql
-- ============================================================

DO $$ BEGIN
    CREATE TYPE revision_lifecycle_enum AS ENUM ('awaiting_review', 'revision_requested', 'approved');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Historical decisions are preserved. A nullable decision plus the lifecycle
-- column represents a submitted draft without inventing a brand decision.
ALTER TABLE revisions ALTER COLUMN decision DROP NOT NULL;
ALTER TABLE revisions
    ADD COLUMN lifecycle revision_lifecycle_enum,
    ADD COLUMN submitted_by uuid REFERENCES profiles(id) ON DELETE RESTRICT,
    ADD COLUMN submitted_at timestamptz,
    ADD COLUMN original_filename text,
    ADD COLUMN mime_type text,
    ADD COLUMN size_bytes bigint,
    ADD COLUMN decided_by uuid REFERENCES profiles(id) ON DELETE RESTRICT,
    ADD COLUMN decided_at timestamptz;

UPDATE revisions
   SET lifecycle = CASE decision::text
       WHEN 'revision_requested' THEN 'revision_requested'::revision_lifecycle_enum
       ELSE 'approved'::revision_lifecycle_enum
   END,
       submitted_at = created_at
 WHERE lifecycle IS NULL;

ALTER TABLE revisions ALTER COLUMN lifecycle SET NOT NULL;
ALTER TABLE revisions ALTER COLUMN submitted_at SET DEFAULT now();

ALTER TABLE revisions
    ADD CONSTRAINT revisions_round_positive CHECK (round_number > 0) NOT VALID,
    ADD CONSTRAINT revisions_submission_provenance CHECK (
        submitted_by IS NOT NULL
        AND submitted_at IS NOT NULL
        AND length(btrim(original_filename)) BETWEEN 1 AND 255
        AND mime_type IN (
            'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
            'video/mp4', 'video/quicktime'
        )
        AND size_bytes BETWEEN 1 AND 104857600
        AND submitted_content_url ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png|webp|mp4|mov)$'
    ) NOT VALID,
    ADD CONSTRAINT revisions_lifecycle_consistent CHECK (
        (lifecycle = 'awaiting_review' AND decision IS NULL AND comment IS NULL
         AND decided_by IS NULL AND decided_at IS NULL)
        OR
        (lifecycle = 'revision_requested' AND decision = 'revision_requested'
         AND length(btrim(comment)) BETWEEN 3 AND 1000
         AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
        OR
        (lifecycle = 'approved' AND decision = 'approved')
    ) NOT VALID;

CREATE UNIQUE INDEX revisions_deliverable_round_unique
    ON revisions (deliverable_id, round_number);
CREATE UNIQUE INDEX revisions_one_awaiting_review
    ON revisions (deliverable_id) WHERE lifecycle = 'awaiting_review';
CREATE INDEX revisions_deliverable_history
    ON revisions (deliverable_id, round_number DESC);

-- Exhausted ordinary rounds do not change the deal stage or create a Payment
-- dispute. They leave the deliverable in revision with an explicit ops pause.
ALTER TABLE deliverables
    ADD COLUMN content_ops_attention boolean NOT NULL DEFAULT false,
    ADD COLUMN content_ops_reason text,
    ADD COLUMN content_ops_at timestamptz;
ALTER TABLE deliverables
    ADD CONSTRAINT deliverables_content_ops_consistent CHECK (
        (NOT content_ops_attention AND content_ops_reason IS NULL AND content_ops_at IS NULL)
        OR
        (content_ops_attention AND content_ops_reason = 'revision_rounds_exhausted'
         AND content_ops_at IS NOT NULL)
    ) NOT VALID;

-- Prepared upload rows are private backend coordination records. Storage RLS
-- accepts only the exact one-time opaque path reserved for the named creator.
CREATE TABLE content_draft_uploads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    deliverable_id uuid NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    expected_round integer NOT NULL CHECK (expected_round > 0),
    object_path text NOT NULL UNIQUE,
    original_filename text NOT NULL CHECK (length(btrim(original_filename)) BETWEEN 1 AND 255),
    expected_mime_type text NOT NULL CHECK (expected_mime_type IN (
        'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
        'video/mp4', 'video/quicktime'
    )),
    expected_size_bytes bigint NOT NULL CHECK (expected_size_bytes BETWEEN 1 AND 104857600),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
    bound_revision_id uuid REFERENCES revisions(id) ON DELETE RESTRICT,
    CHECK (expires_at > created_at)
);
CREATE INDEX content_draft_uploads_actor_unbound
    ON content_draft_uploads (created_by, expires_at) WHERE bound_revision_id IS NULL;

ALTER TABLE content_draft_uploads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "revisions_insert_participant" ON revisions;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON revisions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON content_draft_uploads FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON revisions TO authenticated, service_role;

CREATE OR REPLACE FUNCTION content_draft_extension(p_mime_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
    SELECT CASE p_mime_type
        WHEN 'application/pdf' THEN 'pdf'
        WHEN 'image/jpeg' THEN 'jpg'
        WHEN 'image/png' THEN 'png'
        WHEN 'image/webp' THEN 'webp'
        WHEN 'video/mp4' THEN 'mp4'
        WHEN 'video/quicktime' THEN 'mov'
    END;
$$;

CREATE OR REPLACE FUNCTION can_upload_prepared_content_draft(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM content_draft_uploads u
          JOIN deals d ON d.id = u.deal_id AND d.deleted_at IS NULL AND d.stage::text = 'creating'
          JOIN deliverables dv ON dv.id = u.deliverable_id AND dv.deal_id = u.deal_id
         WHERE u.object_path = p_name
           AND u.created_by = auth.uid()
           AND d.creator_id = auth.uid()
           AND u.bound_revision_id IS NULL
           AND u.expires_at > now()
           AND NOT dv.content_ops_attention
    );
$$;

CREATE OR REPLACE FUNCTION can_delete_unbound_content_draft(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM content_draft_uploads
         WHERE object_path = p_name
           AND created_by = auth.uid()
           AND bound_revision_id IS NULL
    );
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'content-drafts', 'content-drafts', false, 104857600,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 104857600,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "content_drafts_creator_insert" ON storage.objects;
CREATE POLICY "content_drafts_creator_insert"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'content-drafts'
        AND can_upload_prepared_content_draft(name)
        AND owner_id = auth.uid()::text
    );

DROP POLICY IF EXISTS "content_drafts_creator_delete_unbound" ON storage.objects;
CREATE POLICY "content_drafts_creator_delete_unbound"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'content-drafts' AND can_delete_unbound_content_draft(name));

CREATE OR REPLACE FUNCTION enforce_revision_lifecycle_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.deliverable_id IS DISTINCT FROM OLD.deliverable_id
       OR NEW.round_number IS DISTINCT FROM OLD.round_number
       OR NEW.submitted_content_url IS DISTINCT FROM OLD.submitted_content_url
       OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
       OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
       OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'CONTENT_SUBMISSION_IMMUTABLE';
    END IF;
    IF OLD.lifecycle <> 'awaiting_review'
       OR NEW.lifecycle NOT IN ('revision_requested', 'approved') THEN
        RAISE EXCEPTION 'CONTENT_DECISION_IMMUTABLE';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_revision_direct_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF pg_trigger_depth() <= 1 THEN
        RAISE EXCEPTION 'CONTENT_SUBMISSION_DELETE_FORBIDDEN';
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER revisions_lifecycle_update
BEFORE UPDATE ON revisions FOR EACH ROW EXECUTE FUNCTION enforce_revision_lifecycle_update();
CREATE TRIGGER revisions_no_direct_delete
BEFORE DELETE ON revisions FOR EACH ROW EXECUTE FUNCTION prevent_revision_direct_delete();

CREATE OR REPLACE FUNCTION prepare_content_draft_upload(
    p_deal_id uuid,
    p_deliverable_id uuid,
    p_actor_id uuid,
    p_original_filename text,
    p_mime_type text,
    p_size_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal deals%ROWTYPE;
    v_deliverable deliverables%ROWTYPE;
    v_upload content_draft_uploads%ROWTYPE;
    v_extension text;
BEGIN
    SELECT * INTO v_deal FROM deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_DEAL_NOT_FOUND'; END IF;
    IF v_deal.creator_id <> p_actor_id OR NOT EXISTS (
        SELECT 1 FROM deal_participants WHERE deal_id = p_deal_id
          AND profile_id = p_actor_id AND participant_role::text = 'creator'
    ) THEN RAISE EXCEPTION 'CONTENT_CREATOR_ONLY'; END IF;
    IF v_deal.stage::text <> 'creating' THEN RAISE EXCEPTION 'CONTENT_WRONG_STAGE'; END IF;

    SELECT * INTO v_deliverable FROM deliverables
     WHERE id = p_deliverable_id AND deal_id = p_deal_id
       AND source_summary_id IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_DELIVERABLE_NOT_FOUND'; END IF;
    IF v_deliverable.content_ops_attention THEN RAISE EXCEPTION 'CONTENT_OPS_PAUSED'; END IF;
    IF v_deliverable.status::text NOT IN ('pending', 'in_revision')
       OR v_deliverable.revision_current >= v_deliverable.revision_max THEN
        RAISE EXCEPTION 'CONTENT_NOT_SUBMITTABLE';
    END IF;
    v_extension := content_draft_extension(p_mime_type);
    IF v_extension IS NULL THEN RAISE EXCEPTION 'CONTENT_UNSUPPORTED_TYPE'; END IF;
    IF p_size_bytes IS NULL OR p_size_bytes < 1 OR p_size_bytes > 104857600 THEN
        RAISE EXCEPTION 'CONTENT_FILE_TOO_LARGE';
    END IF;
    IF length(btrim(p_original_filename)) NOT BETWEEN 1 AND 255 THEN
        RAISE EXCEPTION 'CONTENT_INVALID_FILENAME';
    END IF;

    INSERT INTO content_draft_uploads (
        deal_id, deliverable_id, created_by, expected_round, object_path,
        original_filename, expected_mime_type, expected_size_bytes
    ) VALUES (
        p_deal_id, p_deliverable_id, p_actor_id, v_deliverable.revision_current + 1,
        p_deal_id::text || '/' || p_deliverable_id::text || '/' || p_actor_id::text || '/'
          || gen_random_uuid()::text || '.' || v_extension,
        btrim(p_original_filename), p_mime_type, p_size_bytes
    ) RETURNING * INTO v_upload;

    RETURN jsonb_build_object(
        'reservation_id', v_upload.id,
        'upload_path', v_upload.object_path,
        'round_number', v_upload.expected_round,
        'mime_type', v_upload.expected_mime_type,
        'size_bytes', v_upload.expected_size_bytes,
        'expires_at', v_upload.expires_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION inspect_content_draft_upload(
    p_deal_id uuid, p_deliverable_id uuid, p_reservation_id uuid, p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
    v_deal deals%ROWTYPE;
    v_upload content_draft_uploads%ROWTYPE;
    v_object storage.objects%ROWTYPE;
BEGIN
    SELECT * INTO v_deal FROM deals WHERE id = p_deal_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_DEAL_NOT_FOUND'; END IF;
    IF v_deal.creator_id <> p_actor_id OR NOT EXISTS (
        SELECT 1 FROM deal_participants WHERE deal_id = p_deal_id
          AND profile_id = p_actor_id AND participant_role::text = 'creator'
    ) THEN RAISE EXCEPTION 'CONTENT_CREATOR_ONLY'; END IF;

    SELECT * INTO v_upload FROM content_draft_uploads
     WHERE id = p_reservation_id AND deal_id = p_deal_id
       AND deliverable_id = p_deliverable_id AND created_by = p_actor_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_UPLOAD_NOT_FOUND'; END IF;
    IF v_upload.bound_revision_id IS NOT NULL THEN
        RETURN jsonb_build_object('bound_revision_id', v_upload.bound_revision_id, 'already_bound', true);
    END IF;
    SELECT * INTO v_object FROM storage.objects
     WHERE bucket_id = 'content-drafts' AND name = v_upload.object_path;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_UPLOAD_MISSING'; END IF;
    RETURN jsonb_build_object(
        'already_bound', false, 'object_path', v_upload.object_path,
        'expected_mime_type', v_upload.expected_mime_type,
        'expected_size_bytes', v_upload.expected_size_bytes,
        'actual_mime_type', v_object.metadata ->> 'mimetype',
        'actual_size_bytes', (v_object.metadata ->> 'size')::bigint
    );
END;
$$;

CREATE OR REPLACE FUNCTION submit_content_draft(
    p_deal_id uuid, p_deliverable_id uuid, p_reservation_id uuid,
    p_actor_id uuid, p_expected_round integer, p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
    v_deal deals%ROWTYPE;
    v_deliverable deliverables%ROWTYPE;
    v_upload content_draft_uploads%ROWTYPE;
    v_revision revisions%ROWTYPE;
    v_object storage.objects%ROWTYPE;
BEGIN
    SELECT * INTO v_deal FROM deals WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_DEAL_NOT_FOUND'; END IF;
    IF v_deal.creator_id <> p_actor_id OR NOT EXISTS (
        SELECT 1 FROM deal_participants WHERE deal_id = p_deal_id
          AND profile_id = p_actor_id AND participant_role::text = 'creator'
    ) THEN RAISE EXCEPTION 'CONTENT_CREATOR_ONLY'; END IF;
    IF v_deal.stage::text <> 'creating' THEN RAISE EXCEPTION 'CONTENT_WRONG_STAGE'; END IF;

    SELECT * INTO v_deliverable FROM deliverables
     WHERE id = p_deliverable_id AND deal_id = p_deal_id
       AND source_summary_id IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_DELIVERABLE_NOT_FOUND'; END IF;
    SELECT * INTO v_upload FROM content_draft_uploads
     WHERE id = p_reservation_id AND deal_id = p_deal_id
       AND deliverable_id = p_deliverable_id AND created_by = p_actor_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_UPLOAD_NOT_FOUND'; END IF;
    IF v_upload.bound_revision_id IS NOT NULL THEN
        SELECT * INTO v_revision FROM revisions WHERE id = v_upload.bound_revision_id;
        RETURN jsonb_build_object(
            'revision_id', v_revision.id, 'round_number', v_revision.round_number,
            'idempotent', true, 'status', 'submitted'
        );
    END IF;
    IF v_deliverable.content_ops_attention THEN RAISE EXCEPTION 'CONTENT_OPS_PAUSED'; END IF;
    IF v_deliverable.status::text NOT IN ('pending', 'in_revision')
       OR v_deliverable.revision_current >= v_deliverable.revision_max THEN
        RAISE EXCEPTION 'CONTENT_NOT_SUBMITTABLE';
    END IF;
    IF p_expected_round IS NULL OR p_expected_round <> v_upload.expected_round
       OR p_expected_round <> v_deliverable.revision_current + 1 THEN
        RAISE EXCEPTION 'CONTENT_STALE_ROUND';
    END IF;
    IF v_upload.expires_at <= now() THEN RAISE EXCEPTION 'CONTENT_UPLOAD_EXPIRED'; END IF;
    SELECT * INTO v_object FROM storage.objects
     WHERE bucket_id = 'content-drafts' AND name = v_upload.object_path FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_UPLOAD_MISSING'; END IF;
    IF v_object.metadata ->> 'mimetype' IS DISTINCT FROM v_upload.expected_mime_type
       OR (v_object.metadata ->> 'size')::bigint IS DISTINCT FROM v_upload.expected_size_bytes THEN
        RAISE EXCEPTION 'CONTENT_UPLOAD_METADATA_MISMATCH';
    END IF;

    INSERT INTO revisions (
        deliverable_id, round_number, submitted_content_url, lifecycle,
        submitted_by, submitted_at, original_filename, mime_type, size_bytes,
        decision, comment, decided_by, decided_at
    ) VALUES (
        p_deliverable_id, p_expected_round, v_upload.object_path, 'awaiting_review',
        p_actor_id, now(), v_upload.original_filename, v_upload.expected_mime_type,
        v_upload.expected_size_bytes, NULL, NULL, NULL, NULL
    ) RETURNING * INTO v_revision;

    UPDATE deliverables SET revision_current = p_expected_round, status = 'submitted', updated_at = now()
     WHERE id = p_deliverable_id;
    UPDATE content_draft_uploads SET bound_revision_id = v_revision.id WHERE id = v_upload.id;
    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'content_draft_submitted', 'deliverable', p_deliverable_id,
        jsonb_build_object('deal_id', p_deal_id, 'deliverable_id', p_deliverable_id,
                           'revision_id', v_revision.id, 'round_number', p_expected_round,
                           'mime_type', v_upload.expected_mime_type, 'size_bytes', v_upload.expected_size_bytes),
        p_ip_address
    );
    RETURN jsonb_build_object(
        'revision_id', v_revision.id, 'round_number', p_expected_round,
        'idempotent', false, 'status', 'submitted'
    );
END;
$$;

CREATE OR REPLACE FUNCTION request_content_revision(
    p_deal_id uuid, p_deliverable_id uuid, p_revision_id uuid,
    p_actor_id uuid, p_comment text, p_ip_address text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal deals%ROWTYPE;
    v_role text;
    v_deliverable deliverables%ROWTYPE;
    v_revision revisions%ROWTYPE;
    v_exhausted boolean;
BEGIN
    SELECT * INTO v_deal FROM deals WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_DEAL_NOT_FOUND'; END IF;
    SELECT participant_role::text INTO v_role FROM deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role IS NULL THEN RAISE EXCEPTION 'CONTENT_NOT_PARTICIPANT'; END IF;
    IF v_role NOT IN ('brand_admin', 'brand_maker') THEN RAISE EXCEPTION 'CONTENT_REVIEWER_ONLY'; END IF;
    IF v_deal.stage::text <> 'creating' THEN RAISE EXCEPTION 'CONTENT_WRONG_STAGE'; END IF;
    IF length(btrim(p_comment)) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'CONTENT_INVALID_COMMENT'; END IF;

    SELECT * INTO v_deliverable FROM deliverables
     WHERE id = p_deliverable_id AND deal_id = p_deal_id
       AND source_summary_id IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_DELIVERABLE_NOT_FOUND'; END IF;
    SELECT * INTO v_revision FROM revisions
     WHERE id = p_revision_id AND deliverable_id = p_deliverable_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_REVISION_NOT_FOUND'; END IF;

    IF v_revision.lifecycle = 'revision_requested' THEN
        IF v_revision.decided_by = p_actor_id AND v_revision.comment = btrim(p_comment) THEN
            RETURN jsonb_build_object(
                'revision_id', v_revision.id, 'round_number', v_revision.round_number,
                'idempotent', true, 'ops_attention', v_deliverable.content_ops_attention
            );
        END IF;
        RAISE EXCEPTION 'CONTENT_ALREADY_DECIDED';
    END IF;
    IF v_revision.lifecycle <> 'awaiting_review'
       OR v_deliverable.status::text <> 'submitted'
       OR v_revision.round_number <> v_deliverable.revision_current THEN
        RAISE EXCEPTION 'CONTENT_STALE_REVISION';
    END IF;

    UPDATE revisions SET
        lifecycle = 'revision_requested', decision = 'revision_requested',
        comment = btrim(p_comment), decided_by = p_actor_id, decided_at = now()
     WHERE id = v_revision.id RETURNING * INTO v_revision;
    v_exhausted := v_deliverable.revision_current >= v_deliverable.revision_max;
    UPDATE deliverables SET
        status = 'in_revision',
        content_ops_attention = v_exhausted,
        content_ops_reason = CASE WHEN v_exhausted THEN 'revision_rounds_exhausted' ELSE NULL END,
        content_ops_at = CASE WHEN v_exhausted THEN now() ELSE NULL END,
        updated_at = now()
     WHERE id = p_deliverable_id;

    INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (
        p_actor_id, 'content_revision_requested', 'deliverable', p_deliverable_id,
        jsonb_build_object('deal_id', p_deal_id, 'deliverable_id', p_deliverable_id,
                           'revision_id', v_revision.id, 'round_number', v_revision.round_number,
                           'ops_attention', v_exhausted), p_ip_address
    );
    IF v_exhausted THEN
        INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
        VALUES (
            p_actor_id, 'content_revision_rounds_exhausted', 'deliverable', p_deliverable_id,
            jsonb_build_object('deal_id', p_deal_id, 'deliverable_id', p_deliverable_id,
                               'round_number', v_revision.round_number,
                               'reason', 'revision_rounds_exhausted'), p_ip_address
        );
    END IF;
    RETURN jsonb_build_object(
        'revision_id', v_revision.id, 'round_number', v_revision.round_number,
        'idempotent', false, 'ops_attention', v_exhausted
    );
END;
$$;

REVOKE ALL ON FUNCTION content_draft_extension(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION can_upload_prepared_content_draft(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION can_delete_unbound_content_draft(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION can_upload_prepared_content_draft(text) TO authenticated;
GRANT EXECUTE ON FUNCTION can_delete_unbound_content_draft(text) TO authenticated;
REVOKE ALL ON FUNCTION enforce_revision_lifecycle_update() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION prevent_revision_direct_delete() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION prepare_content_draft_upload(uuid, uuid, uuid, text, text, bigint)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION inspect_content_draft_upload(uuid, uuid, uuid, uuid)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION submit_content_draft(uuid, uuid, uuid, uuid, integer, text)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION request_content_revision(uuid, uuid, uuid, uuid, text, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION prepare_content_draft_upload(uuid, uuid, uuid, text, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION inspect_content_draft_upload(uuid, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION submit_content_draft(uuid, uuid, uuid, uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION request_content_revision(uuid, uuid, uuid, uuid, text, text) TO service_role;
