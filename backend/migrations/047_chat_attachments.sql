-- Migration 047: secure participant-scoped chat attachments.
-- Bytes remain in the private deal-files bucket; this table records the exact
-- object a participant may upload before an atomic message bind.

CREATE TABLE IF NOT EXISTS public.chat_attachment_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  file_type text NOT NULL,
  expected_size bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  bound_message_id uuid UNIQUE REFERENCES public.messages(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_attachment_uploads_size_positive CHECK (expected_size > 0),
  CONSTRAINT chat_attachment_uploads_name_length CHECK (char_length(file_name) BETWEEN 1 AND 160),
  CONSTRAINT chat_attachment_uploads_type_allowed CHECK (
    file_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime')
  )
);

ALTER TABLE public.chat_attachment_uploads
  DROP CONSTRAINT IF EXISTS chat_attachment_uploads_type_size_limit,
  DROP CONSTRAINT IF EXISTS chat_attachment_uploads_expiry_window,
  DROP CONSTRAINT IF EXISTS chat_attachment_uploads_opaque_path;
ALTER TABLE public.chat_attachment_uploads
  ADD CONSTRAINT chat_attachment_uploads_type_size_limit CHECK (
    (file_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') AND expected_size <= 10485760)
    OR (file_type IN ('video/mp4', 'video/quicktime') AND expected_size <= 52428800)
  ),
  ADD CONSTRAINT chat_attachment_uploads_expiry_window CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '20 minutes'
  ),
  ADD CONSTRAINT chat_attachment_uploads_opaque_path CHECK (
    storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png|webp|mp4|mov)$'
  );

CREATE INDEX IF NOT EXISTS chat_attachment_uploads_owner_unbound
  ON public.chat_attachment_uploads (owner_id, expires_at)
  WHERE bound_message_id IS NULL;

ALTER TABLE public.chat_attachment_uploads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.chat_attachment_uploads FROM anon, authenticated;
GRANT ALL ON TABLE public.chat_attachment_uploads TO service_role;

-- Attachment rows are created only by finalize_chat_attachment_upload(). Text
-- messages keep their existing participant INSERT path.
DROP POLICY IF EXISTS "message_attachments_insert_sender" ON public.message_attachments;
REVOKE ALL ON public.message_attachments FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.message_attachments FROM PUBLIC, authenticated;
GRANT SELECT ON public.message_attachments TO authenticated;
GRANT ALL ON public.message_attachments TO service_role;

CREATE OR REPLACE FUNCTION public.chat_message_has_attachment(p_message_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.message_attachments a
      JOIN public.messages m ON m.id = a.message_id
     WHERE a.message_id = p_message_id
       AND m.sender_id = auth.uid()
  );
$$;

-- Direct chat INSERT remains available for real text messages only. The
-- SECURITY DEFINER finalizer bypasses RLS when it creates attachment-only rows.
DROP POLICY IF EXISTS "messages_insert_participant" ON public.messages;
CREATE POLICY "messages_insert_participant"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_deal_participant(deal_id)
    AND body IS NOT NULL
    AND body !~ '^[[:space:]]*$'
  );

DROP POLICY IF EXISTS "messages_update_sender" ON public.messages;
CREATE POLICY "messages_update_sender"
  ON public.messages FOR UPDATE TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      (body IS NOT NULL AND body !~ '^[[:space:]]*$')
      OR public.chat_message_has_attachment(id)
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_authenticated_message_soft_delete_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Trusted backend maintenance retains its existing behavior. Authenticated
  -- clients may only move their own immutable message from live to deleted.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.deal_id IS DISTINCT FROM OLD.deal_id
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR OLD.deleted_at IS NOT NULL
     OR NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'DEAL_MESSAGE_UPDATE_FORBIDDEN';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_authenticated_soft_delete_only ON public.messages;
CREATE TRIGGER messages_authenticated_soft_delete_only
BEFORE UPDATE ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_authenticated_message_soft_delete_only();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'deal-files',
  'deal-files',
  false,
  52428800,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.chat_attachment_extension(p_file_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_file_type
    WHEN 'application/pdf' THEN 'pdf'
    WHEN 'image/jpeg' THEN 'jpg'
    WHEN 'image/png' THEN 'png'
    WHEN 'image/webp' THEN 'webp'
    WHEN 'video/mp4' THEN 'mp4'
    WHEN 'video/quicktime' THEN 'mov'
  END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_chat_attachment_filename(p_file_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
BEGIN
  v_name := normalize(p_file_name, NFKC);
  v_name := regexp_replace(v_name, '[[:space:]]+', ' ', 'g');
  RETURN btrim(v_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_attachment_metadata_valid(
  p_file_name text,
  p_file_type text,
  p_size_bytes bigint
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_extension text;
  v_name text;
BEGIN
  IF p_file_name IS NULL OR p_file_type IS NULL OR p_size_bytes IS NULL THEN RETURN false; END IF;
  -- Normalize first so compatibility forms cannot disguise a separator or
  -- formatting control that would have been rejected in its ASCII form.
  v_name := public.normalize_chat_attachment_filename(p_file_name);
  IF v_name ~ '[\\/]'
     OR v_name ~ '[[:cntrl:]]'
     OR v_name ~ U&'[\200E\200F\202A-\202E\2066-\2069]' THEN
    RETURN false;
  END IF;
  IF char_length(v_name) NOT BETWEEN 1 AND 160 THEN RETURN false; END IF;
  v_extension := lower(substring(v_name FROM '\.([^.]+)$'));
  IF public.chat_attachment_extension(p_file_type) IS NULL THEN RETURN false; END IF;
  IF NOT (
    (p_file_type = 'image/jpeg' AND v_extension IN ('jpg', 'jpeg'))
    OR (p_file_type <> 'image/jpeg' AND v_extension = public.chat_attachment_extension(p_file_type))
  ) THEN RETURN false; END IF;
  IF p_size_bytes < 1 THEN RETURN false; END IF;
  IF p_file_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') THEN
    RETURN p_size_bytes <= 10485760;
  END IF;
  RETURN p_size_bytes <= 52428800;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_upload_prepared_chat_attachment(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.chat_attachment_uploads u
      JOIN public.deals d ON d.id = u.deal_id
     WHERE u.storage_path = p_name
       AND u.owner_id = auth.uid()
       AND u.bound_message_id IS NULL
       AND u.expires_at > now()
       AND d.deleted_at IS NULL
       AND d.stage::text NOT IN ('closed', 'declined', 'cancelled')
       AND public.is_deal_participant(d.id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_delete_unbound_chat_attachment(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.chat_attachment_uploads u
      JOIN public.deals d ON d.id = u.deal_id
     WHERE u.storage_path = p_name
       AND u.owner_id = auth.uid()
       AND u.bound_message_id IS NULL
       AND d.deleted_at IS NULL
       AND d.stage::text NOT IN ('closed', 'declined', 'cancelled')
       AND public.is_deal_participant(d.id)
  );
$$;

DROP POLICY IF EXISTS "deal_files_reserved_insert" ON storage.objects;
CREATE POLICY "deal_files_reserved_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'deal-files'
    AND owner_id = auth.uid()::text
    AND public.can_upload_prepared_chat_attachment(name)
  );

DROP POLICY IF EXISTS "deal_files_participant_select" ON storage.objects;
DROP FUNCTION IF EXISTS public.can_read_bound_chat_attachment(text);

DROP POLICY IF EXISTS "deal_files_owner_delete_unbound" ON storage.objects;
CREATE POLICY "deal_files_owner_delete_unbound"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'deal-files'
    AND owner_id = auth.uid()::text
    AND public.can_delete_unbound_chat_attachment(name)
  );

CREATE OR REPLACE FUNCTION public.prepare_chat_attachment_upload(
  p_deal_id uuid,
  p_file_name text,
  p_file_type text,
  p_size_bytes bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_deal public.deals%ROWTYPE;
  v_reservation_id uuid := gen_random_uuid();
  v_object_id uuid := gen_random_uuid();
  v_path text;
  v_name text;
  v_expires_at timestamptz := now() + interval '15 minutes';
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'CHAT_ATTACHMENT_UNAUTHENTICATED'; END IF;
  SELECT * INTO v_deal
    FROM public.deals
   WHERE id = p_deal_id AND deleted_at IS NULL
   FOR SHARE;
  IF NOT FOUND OR NOT public.is_deal_participant(p_deal_id) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_DEAL_NOT_FOUND';
  END IF;
  IF v_deal.stage::text IN ('closed', 'declined', 'cancelled') THEN
    RAISE EXCEPTION 'DEAL_THREAD_READ_ONLY';
  END IF;
  IF NOT public.chat_attachment_metadata_valid(p_file_name, p_file_type, p_size_bytes) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_INVALID_FILE';
  END IF;
  v_name := public.normalize_chat_attachment_filename(p_file_name);
  v_path := p_deal_id::text || '/' || v_actor_id::text || '/' || v_reservation_id::text || '/'
    || v_object_id::text || '.' || public.chat_attachment_extension(p_file_type);

  INSERT INTO public.chat_attachment_uploads (
    id, deal_id, owner_id, storage_path, file_name, file_type,
    expected_size, expires_at
  ) VALUES (
    v_reservation_id, p_deal_id, v_actor_id, v_path, v_name, p_file_type,
    p_size_bytes, v_expires_at
  );
  RETURN jsonb_build_object(
    'reservation_id', v_reservation_id,
    'upload_path', v_path,
    'file_name', v_name,
    'file_type', p_file_type,
    'size_bytes', p_size_bytes,
    'expires_at', v_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_chat_attachment_upload(
  p_deal_id uuid,
  p_reservation_id uuid,
  p_caption text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_deal public.deals%ROWTYPE;
  v_upload public.chat_attachment_uploads%ROWTYPE;
  v_object storage.objects%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_attachment public.message_attachments%ROWTYPE;
  v_caption text := NULLIF(regexp_replace(p_caption, '(^[[:space:]]+|[[:space:]]+$)', '', 'g'), '');
  v_actual_size_text text;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'CHAT_ATTACHMENT_UNAUTHENTICATED'; END IF;
  SELECT * INTO v_deal
    FROM public.deals
   WHERE id = p_deal_id AND deleted_at IS NULL
   FOR SHARE;
  IF NOT FOUND OR NOT public.is_deal_participant(p_deal_id) THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_DEAL_NOT_FOUND';
  END IF;
  SELECT * INTO v_upload
    FROM public.chat_attachment_uploads
   WHERE id = p_reservation_id
     AND deal_id = p_deal_id
     AND owner_id = v_actor_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CHAT_ATTACHMENT_RESERVATION_NOT_FOUND'; END IF;

  IF v_upload.bound_message_id IS NOT NULL THEN
    SELECT * INTO v_message FROM public.messages WHERE id = v_upload.bound_message_id;
    SELECT * INTO v_attachment FROM public.message_attachments
     WHERE message_id = v_upload.bound_message_id AND storage_path = v_upload.storage_path;
    IF NOT FOUND OR v_message.deal_id IS DISTINCT FROM p_deal_id
       OR v_message.sender_id IS DISTINCT FROM v_actor_id
       OR v_message.body IS DISTINCT FROM v_caption THEN
      RAISE EXCEPTION 'CHAT_ATTACHMENT_FINALIZE_CONFLICT';
    END IF;
    RETURN jsonb_build_object(
      'id', v_message.id, 'sender_id', v_message.sender_id,
      'body', v_message.body, 'created_at', v_message.created_at,
      'idempotent', true,
      'attachment', jsonb_build_object(
        'id', v_attachment.id, 'file_name', v_attachment.file_name,
        'file_type', v_attachment.file_type, 'file_size', v_attachment.file_size,
        'storage_path', v_attachment.storage_path
      )
    );
  END IF;
  IF v_deal.stage::text IN ('closed', 'declined', 'cancelled') THEN
    RAISE EXCEPTION 'DEAL_THREAD_READ_ONLY';
  END IF;
  IF v_upload.expires_at <= now() THEN RAISE EXCEPTION 'CHAT_ATTACHMENT_RESERVATION_EXPIRED'; END IF;

  SELECT * INTO v_object
    FROM storage.objects
   WHERE bucket_id = 'deal-files' AND name = v_upload.storage_path
   FOR UPDATE;
  IF NOT FOUND OR v_object.owner_id IS DISTINCT FROM v_actor_id::text THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_OBJECT_MISSING';
  END IF;
  v_actual_size_text := v_object.metadata ->> 'size';
  IF v_object.metadata IS NULL
     OR v_object.metadata ->> 'mimetype' IS DISTINCT FROM v_upload.file_type
     OR v_actual_size_text IS NULL
     OR v_actual_size_text !~ '^[0-9]+$'
     OR v_actual_size_text::bigint IS DISTINCT FROM v_upload.expected_size THEN
    RAISE EXCEPTION 'CHAT_ATTACHMENT_OBJECT_MISMATCH';
  END IF;

  INSERT INTO public.messages (deal_id, sender_id, body)
  VALUES (p_deal_id, v_actor_id, v_caption)
  RETURNING * INTO v_message;

  INSERT INTO public.message_attachments (
    message_id, storage_path, file_name, file_type, file_size
  ) VALUES (
    v_message.id, v_upload.storage_path, v_upload.file_name,
    v_upload.file_type, v_upload.expected_size::integer
  ) RETURNING * INTO v_attachment;

  UPDATE public.chat_attachment_uploads
     SET bound_message_id = v_message.id, updated_at = now()
   WHERE id = v_upload.id;

  RETURN jsonb_build_object(
    'id', v_message.id, 'sender_id', v_message.sender_id,
    'body', v_message.body, 'created_at', v_message.created_at,
    'idempotent', false,
    'attachment', jsonb_build_object(
      'id', v_attachment.id, 'file_name', v_attachment.file_name,
      'file_type', v_attachment.file_type, 'file_size', v_attachment.file_size,
      'storage_path', v_attachment.storage_path
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.chat_attachment_extension(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.chat_message_has_attachment(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.enforce_authenticated_message_soft_delete_only() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.normalize_chat_attachment_filename(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.chat_attachment_metadata_valid(text, text, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.can_upload_prepared_chat_attachment(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.can_delete_unbound_chat_attachment(text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.prepare_chat_attachment_upload(uuid, text, text, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_chat_attachment_upload(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_upload_prepared_chat_attachment(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_message_has_attachment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_delete_unbound_chat_attachment(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_chat_attachment_upload(uuid, text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_chat_attachment_upload(uuid, uuid, text) TO authenticated;
