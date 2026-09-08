-- ============================================================
-- 043_post_close_outcomes.sql
-- Workplan 9.17-B: ratings, post-close entries, chat archives
-- Depends on: 042_deal_close_gate.sql
-- Existing rows remain untouched; provenance is required only for new rows.
-- ============================================================

ALTER TABLE public.ratings
    ADD COLUMN side text,
    ADD COLUMN request_id uuid,
    ADD COLUMN request_fingerprint text;

ALTER TABLE public.ratings
    ADD CONSTRAINT ratings_provenance_complete CHECK (
        (side IS NULL AND request_id IS NULL AND request_fingerprint IS NULL)
        OR (
            side IN ('creator', 'brand')
            AND request_id IS NOT NULL
            AND request_fingerprint ~ '^[0-9a-f]{64}$'
        )
    ),
    ADD CONSTRAINT ratings_proven_side_target CHECK (
        side IS NULL
        OR (side = 'creator' AND ratee_brand_id IS NOT NULL AND ratee_profile_id IS NULL)
        OR (side = 'brand' AND ratee_profile_id IS NOT NULL AND ratee_brand_id IS NULL)
    ),
    ADD CONSTRAINT ratings_proven_review CHECK (
        side IS NULL
        OR review IS NULL
        OR (
            review = btrim(review)
            AND char_length(review) BETWEEN 1 AND 1000
            AND review !~ '[[:cntrl:]<>]'
            AND review !~* '(https?://|www\\.|[a-z0-9][a-z0-9.-]*\\.[a-z]{2,}(/|$))'
        )
    );

CREATE UNIQUE INDEX ratings_one_proven_side_per_deal
    ON public.ratings (deal_id, side) WHERE side IS NOT NULL;
CREATE UNIQUE INDEX ratings_one_proven_request
    ON public.ratings (request_id) WHERE request_id IS NOT NULL;

ALTER TABLE public.deal_comments
    ADD COLUMN request_id uuid,
    ADD COLUMN request_fingerprint text;

ALTER TABLE public.deal_comments
    ADD CONSTRAINT deal_comments_provenance_complete CHECK (
        (request_id IS NULL AND request_fingerprint IS NULL)
        OR (request_id IS NOT NULL AND request_fingerprint ~ '^[0-9a-f]{64}$')
    ),
    ADD CONSTRAINT deal_comments_proven_body CHECK (
        request_id IS NULL
        OR (
            body = btrim(body)
            AND char_length(body) BETWEEN 1 AND 2000
            AND regexp_replace(body, E'[\\n\\r\\t]', '', 'g') !~ '[[:cntrl:]<>]'
        )
    );

CREATE UNIQUE INDEX deal_comments_one_proven_request
    ON public.deal_comments (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX deal_comments_closed_feed
    ON public.deal_comments (deal_id, created_at DESC, id DESC)
    WHERE request_id IS NOT NULL;

CREATE TABLE public.deal_chat_archives (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id               uuid NOT NULL UNIQUE REFERENCES public.deals(id) ON DELETE CASCADE,
    state                 text NOT NULL DEFAULT 'pending'
                          CHECK (state IN ('pending', 'generating', 'ready', 'failed')),
    closed_at             timestamptz NOT NULL,
    source_message_count  integer NOT NULL CHECK (source_message_count >= 0),
    source_last_created_at timestamptz,
    source_last_message_id uuid,
    storage_path          text NOT NULL UNIQUE,
    source_hash           text CHECK (source_hash IS NULL OR source_hash ~ '^[0-9a-f]{64}$'),
    byte_count            integer CHECK (byte_count IS NULL OR byte_count > 0),
    page_count            integer CHECK (page_count IS NULL OR page_count > 0),
    message_count         integer CHECK (message_count IS NULL OR message_count >= 0),
    failure_code          text CHECK (failure_code IS NULL OR failure_code IN (
                              'source_too_large', 'source_inconsistent', 'render_failed',
                              'storage_failed', 'generation_interrupted'
                          )),
    attempt_count         integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    lease_token           uuid,
    lease_expires_at      timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    ready_at              timestamptz,
    CONSTRAINT deal_chat_archives_watermark CHECK (
        (source_message_count = 0 AND source_last_created_at IS NULL AND source_last_message_id IS NULL)
        OR (source_message_count > 0 AND source_last_created_at IS NOT NULL AND source_last_message_id IS NOT NULL)
    ),
    CONSTRAINT deal_chat_archives_state_fields CHECK (
        (state = 'ready' AND source_hash IS NOT NULL AND byte_count IS NOT NULL
            AND page_count IS NOT NULL AND message_count = source_message_count
            AND failure_code IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL
            AND ready_at IS NOT NULL)
        OR (state = 'failed' AND failure_code IS NOT NULL AND lease_token IS NULL
            AND lease_expires_at IS NULL AND ready_at IS NULL)
        OR (state = 'generating' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
            AND ready_at IS NULL)
        OR (state = 'pending' AND lease_token IS NULL AND lease_expires_at IS NULL
            AND ready_at IS NULL)
    )
);

CREATE INDEX deal_chat_archives_work_queue
    ON public.deal_chat_archives (state, lease_expires_at, created_at);

ALTER TABLE public.deal_chat_archives ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('deal-chat-archives', 'deal-chat-archives', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Client roles receive no archive-table or archive-object privileges. Storage
-- has no policy for this bucket, so only service_role can access its objects.
REVOKE ALL ON TABLE public.ratings, public.deal_comments, public.deal_chat_archives
    FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.ratings, public.deal_comments, public.deal_chat_archives TO service_role;

-- Trust aggregates are backend-owned. Keep established profile editing usable
-- while withholding only the derived trust columns from authenticated clients.
REVOKE INSERT, UPDATE ON TABLE public.creator_profiles, public.brands FROM authenticated;
GRANT INSERT (profile_id, niches, content_category, bio, content_languages,
              photo_carousel, inbound_enabled, outbound_enabled,
              deal_completion_rate, response_time_hours, privacy_settings)
    ON public.creator_profiles TO authenticated;
GRANT UPDATE (niches, content_category, bio, content_languages, photo_carousel,
              inbound_enabled, outbound_enabled, deal_completion_rate,
              response_time_hours, privacy_settings)
    ON public.creator_profiles TO authenticated;
GRANT INSERT (company_name, industry, company_id_gst, domain, verified,
              deal_completion_rate, profile_attributes)
    ON public.brands TO authenticated;
GRANT UPDATE (company_name, industry, company_id_gst, domain, verified,
              deal_completion_rate, profile_attributes)
    ON public.brands TO authenticated;

DROP POLICY IF EXISTS ratings_insert_own ON public.ratings;
DROP POLICY IF EXISTS deal_comments_insert_participant ON public.deal_comments;

CREATE OR REPLACE FUNCTION public.prevent_post_close_outcome_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'POST_CLOSE_OUTCOME_IMMUTABLE';
END;
$$;

CREATE TRIGGER ratings_immutable
BEFORE UPDATE OR DELETE ON public.ratings
FOR EACH ROW EXECUTE FUNCTION public.prevent_post_close_outcome_mutation();

CREATE TRIGGER deal_comments_immutable
BEFORE UPDATE OR DELETE ON public.deal_comments
FOR EACH ROW EXECUTE FUNCTION public.prevent_post_close_outcome_mutation();

CREATE OR REPLACE FUNCTION public.enqueue_closed_deal_chat_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count integer;
    v_last_created_at timestamptz;
    v_last_id uuid;
BEGIN
    IF OLD.stage::text <> 'closed' AND NEW.stage::text = 'closed' THEN
        SELECT count(*)::integer INTO v_count
          FROM public.messages
         WHERE deal_id = NEW.id AND deleted_at IS NULL;
        SELECT created_at, id INTO v_last_created_at, v_last_id
          FROM public.messages
         WHERE deal_id = NEW.id AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 1;
        INSERT INTO public.deal_chat_archives (
            deal_id, closed_at, source_message_count, source_last_created_at,
            source_last_message_id, storage_path
        ) VALUES (
            NEW.id, NEW.updated_at, v_count, v_last_created_at, v_last_id,
            'deals/' || NEW.id::text || '/chat-record.pdf'
        ) ON CONFLICT (deal_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER deals_enqueue_chat_archive
AFTER UPDATE OF stage ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.enqueue_closed_deal_chat_archive();

-- Conservatively enqueue already-Closed development rows without rewriting any
-- historical rating/comment/message content.
INSERT INTO public.deal_chat_archives (
    deal_id, closed_at, source_message_count, source_last_created_at,
    source_last_message_id, storage_path
)
SELECT d.id, d.updated_at, count(m.id)::integer,
       (array_agg(m.created_at ORDER BY m.created_at DESC, m.id DESC)
           FILTER (WHERE m.id IS NOT NULL))[1],
       (array_agg(m.id ORDER BY m.created_at DESC, m.id DESC)
           FILTER (WHERE m.id IS NOT NULL))[1],
       'deals/' || d.id::text || '/chat-record.pdf'
  FROM public.deals d
  LEFT JOIN public.messages m ON m.deal_id = d.id AND m.deleted_at IS NULL
 WHERE d.stage::text = 'closed' AND d.deleted_at IS NULL
 GROUP BY d.id, d.updated_at
ON CONFLICT (deal_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.submit_deal_rating(
    p_deal_id uuid,
    p_actor_id uuid,
    p_request_id uuid,
    p_request_fingerprint text,
    p_score integer,
    p_review text,
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
    v_side text;
    v_existing public.ratings%ROWTYPE;
    v_rating public.ratings%ROWTYPE;
    v_average numeric;
BEGIN
    IF p_request_id IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
       OR p_score NOT BETWEEN 1 AND 5 OR p_ip_address IS NULL
       OR (p_review IS NOT NULL AND (
           p_review <> btrim(p_review) OR char_length(p_review) NOT BETWEEN 1 AND 1000
           OR p_review ~ '[[:cntrl:]<>]'
           OR p_review ~* '(https?://|www\\.|[a-z0-9][a-z0-9.-]*\\.[a-z]{2,}(/|$))'
       )) THEN RAISE EXCEPTION 'POST_CLOSE_INVALID_RATING'; END IF;

    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'POST_CLOSE_NOT_FOUND'; END IF;
    IF v_deal.stage::text <> 'closed' THEN RAISE EXCEPTION 'POST_CLOSE_NOT_AVAILABLE'; END IF;
    IF EXISTS (SELECT 1 FROM public.platform_ops_members
                WHERE profile_id = p_actor_id AND is_active) THEN
        RAISE EXCEPTION 'POST_CLOSE_NOT_AUTHORIZED';
    END IF;
    SELECT participant_role::text INTO v_role FROM public.deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF v_role = 'creator' AND p_actor_id = v_deal.creator_id THEN
        v_side := 'creator';
    ELSIF v_role IN ('brand_admin', 'brand_maker', 'brand_checker') AND EXISTS (
        SELECT 1 FROM public.brand_members
         WHERE brand_id = v_deal.brand_id AND profile_id = p_actor_id AND status::text = 'active'
    ) THEN
        v_side := 'brand';
    ELSE
        RAISE EXCEPTION 'POST_CLOSE_NOT_AUTHORIZED';
    END IF;

    SELECT * INTO v_existing FROM public.ratings WHERE request_id = p_request_id;
    IF FOUND THEN
        IF v_existing.deal_id = p_deal_id AND v_existing.rater_id = p_actor_id
           AND v_existing.side = v_side
           AND v_existing.request_fingerprint = p_request_fingerprint THEN
            RETURN jsonb_build_object('idempotent', true, 'rating_id', v_existing.id);
        END IF;
        RAISE EXCEPTION 'POST_CLOSE_REQUEST_CONFLICT';
    END IF;
    SELECT * INTO v_existing FROM public.ratings
     WHERE deal_id = p_deal_id AND side = v_side FOR UPDATE;
    IF FOUND THEN RAISE EXCEPTION 'POST_CLOSE_ALREADY_RATED'; END IF;

    INSERT INTO public.ratings (
        deal_id, rater_id, ratee_profile_id, ratee_brand_id, score, review,
        side, request_id, request_fingerprint
    ) VALUES (
        p_deal_id, p_actor_id,
        CASE WHEN v_side = 'brand' THEN v_deal.creator_id END,
        CASE WHEN v_side = 'creator' THEN v_deal.brand_id END,
        p_score, p_review, v_side, p_request_id, p_request_fingerprint
    ) RETURNING * INTO v_rating;

    IF v_side = 'creator' THEN
        SELECT round(avg(score)::numeric, 2) INTO v_average FROM public.ratings
         WHERE side = 'creator' AND ratee_brand_id = v_deal.brand_id
           AND request_id IS NOT NULL AND request_fingerprint IS NOT NULL;
        UPDATE public.brands SET trust_rating = v_average WHERE id = v_deal.brand_id;
    ELSE
        SELECT round(avg(score)::numeric, 2) INTO v_average FROM public.ratings
         WHERE side = 'brand' AND ratee_profile_id = v_deal.creator_id
           AND request_id IS NOT NULL AND request_fingerprint IS NOT NULL;
        UPDATE public.creator_profiles SET trust_score = v_average
         WHERE profile_id = v_deal.creator_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'POST_CLOSE_TRUST_TARGET_MISSING'; END IF;
    END IF;

    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, metadata, ip_address)
    VALUES (p_actor_id, 'deal_rating_submitted', 'deal', p_deal_id,
        jsonb_build_object('deal_id', p_deal_id, 'side', v_side, 'score', p_score), p_ip_address);
    RETURN jsonb_build_object('idempotent', false, 'rating_id', v_rating.id);
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'POST_CLOSE_REQUEST_CONFLICT';
END;
$$;

CREATE OR REPLACE FUNCTION public.append_deal_post_close_entry(
    p_deal_id uuid,
    p_actor_id uuid,
    p_request_id uuid,
    p_request_fingerprint text,
    p_visibility text,
    p_body text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deal public.deals%ROWTYPE;
    v_role text;
    v_existing public.deal_comments%ROWTYPE;
    v_entry public.deal_comments%ROWTYPE;
    v_recipient uuid;
BEGIN
    IF p_request_id IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
       OR p_visibility NOT IN ('shared', 'private')
       OR p_body <> btrim(p_body) OR char_length(p_body) NOT BETWEEN 1 AND 2000
       OR regexp_replace(p_body, E'[\\n\\r\\t]', '', 'g') ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'POST_CLOSE_INVALID_ENTRY'; END IF;
    SELECT * INTO v_deal FROM public.deals
     WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'POST_CLOSE_NOT_FOUND'; END IF;
    IF v_deal.stage::text <> 'closed' THEN RAISE EXCEPTION 'POST_CLOSE_NOT_AVAILABLE'; END IF;
    IF EXISTS (SELECT 1 FROM public.platform_ops_members
                WHERE profile_id = p_actor_id AND is_active) THEN
        RAISE EXCEPTION 'POST_CLOSE_NOT_AUTHORIZED';
    END IF;
    SELECT participant_role::text INTO v_role FROM public.deal_participants
     WHERE deal_id = p_deal_id AND profile_id = p_actor_id;
    IF NOT (
        (v_role = 'creator' AND p_actor_id = v_deal.creator_id)
        OR (v_role IN ('brand_admin', 'brand_maker', 'brand_checker') AND EXISTS (
            SELECT 1 FROM public.brand_members
             WHERE brand_id = v_deal.brand_id AND profile_id = p_actor_id AND status::text = 'active'
        ))
    ) THEN RAISE EXCEPTION 'POST_CLOSE_NOT_AUTHORIZED'; END IF;

    SELECT * INTO v_existing FROM public.deal_comments WHERE request_id = p_request_id;
    IF FOUND THEN
        IF v_existing.deal_id = p_deal_id AND v_existing.author_id = p_actor_id
           AND v_existing.request_fingerprint = p_request_fingerprint THEN
            RETURN jsonb_build_object('idempotent', true, 'entry_id', v_existing.id);
        END IF;
        RAISE EXCEPTION 'POST_CLOSE_REQUEST_CONFLICT';
    END IF;
    INSERT INTO public.deal_comments (
        deal_id, author_id, body, visibility, request_id, request_fingerprint
    ) VALUES (
        p_deal_id, p_actor_id, p_body, p_visibility::deal_comment_visibility_enum,
        p_request_id, p_request_fingerprint
    ) RETURNING * INTO v_entry;

    IF p_visibility = 'shared' THEN
        FOR v_recipient IN
            SELECT DISTINCT dp.profile_id FROM public.deal_participants dp
             WHERE dp.deal_id = p_deal_id AND dp.profile_id <> p_actor_id
               AND (dp.profile_id = v_deal.creator_id OR EXISTS (
                   SELECT 1 FROM public.brand_members bm
                    WHERE bm.brand_id = v_deal.brand_id AND bm.profile_id = dp.profile_id
                      AND bm.status::text = 'active'
               ))
        LOOP
            INSERT INTO public.notifications (profile_id, tier, title, body, deal_id)
            VALUES (v_recipient, 'informational', 'New post-deal comment',
                    'A participant added a shared follow-up comment.', p_deal_id);
        END LOOP;
    END IF;
    RETURN jsonb_build_object('idempotent', false, 'entry_id', v_entry.id);
EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'POST_CLOSE_REQUEST_CONFLICT';
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_deal_chat_archive(
    p_deal_id uuid, p_lease_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.deal_chat_archives%ROWTYPE;
BEGIN
    IF p_lease_token IS NULL THEN RAISE EXCEPTION 'CHAT_ARCHIVE_INVALID_REQUEST'; END IF;
    SELECT * INTO v_row FROM public.deal_chat_archives
     WHERE deal_id = p_deal_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CHAT_ARCHIVE_NOT_FOUND'; END IF;
    IF v_row.state = 'ready' THEN
        RETURN jsonb_build_object('reserved', false, 'state', 'ready');
    END IF;
    IF v_row.state = 'generating' AND v_row.lease_expires_at > now() THEN
        RETURN jsonb_build_object('reserved', false, 'state', 'generating');
    END IF;
    UPDATE public.deal_chat_archives SET
        state = 'generating', lease_token = p_lease_token,
        lease_expires_at = now() + interval '5 minutes',
        failure_code = NULL, source_hash = NULL, byte_count = NULL,
        page_count = NULL, message_count = NULL, ready_at = NULL,
        attempt_count = attempt_count + 1, updated_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
    RETURN jsonb_build_object(
        'reserved', true, 'state', v_row.state, 'archive_id', v_row.id,
        'closed_at', v_row.closed_at, 'source_message_count', v_row.source_message_count,
        'source_last_created_at', v_row.source_last_created_at,
        'source_last_message_id', v_row.source_last_message_id,
        'storage_path', v_row.storage_path, 'lease_token', v_row.lease_token
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_deal_chat_archive(
    p_archive_id uuid, p_lease_token uuid, p_source_hash text,
    p_byte_count integer, p_page_count integer, p_message_count integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE public.deal_chat_archives SET
        state = 'ready', source_hash = p_source_hash, byte_count = p_byte_count,
        page_count = p_page_count, message_count = p_message_count,
        failure_code = NULL, lease_token = NULL, lease_expires_at = NULL,
        ready_at = now(), updated_at = now()
     WHERE id = p_archive_id AND state = 'generating' AND lease_token = p_lease_token
       AND lease_expires_at > now() AND p_source_hash ~ '^[0-9a-f]{64}$'
       AND p_byte_count > 0 AND p_page_count > 0
       AND p_message_count = source_message_count;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_deal_chat_archive(
    p_archive_id uuid, p_lease_token uuid, p_failure_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_failure_code NOT IN ('source_too_large', 'source_inconsistent', 'render_failed',
                              'storage_failed', 'generation_interrupted') THEN
        RAISE EXCEPTION 'CHAT_ARCHIVE_INVALID_FAILURE';
    END IF;
    UPDATE public.deal_chat_archives SET
        state = 'failed', failure_code = p_failure_code,
        lease_token = NULL, lease_expires_at = NULL, ready_at = NULL, updated_at = now()
     WHERE id = p_archive_id AND state = 'generating' AND lease_token = p_lease_token;
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_post_close_outcome_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enqueue_closed_deal_chat_archive() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_deal_rating(uuid, uuid, uuid, text, integer, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.append_deal_post_close_entry(uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_deal_chat_archive(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_deal_chat_archive(uuid, uuid, text, integer, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_deal_chat_archive(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_deal_rating(uuid, uuid, uuid, text, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_deal_post_close_entry(uuid, uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_deal_chat_archive(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_deal_chat_archive(uuid, uuid, text, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_deal_chat_archive(uuid, uuid, text) TO service_role;
