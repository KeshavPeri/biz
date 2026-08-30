-- ============================================================
-- 034_private_deliverable_labels.sql
-- Workplan 9.13-E: creator-private labels on canonical deliverables
-- Depends on: 033_content_approval_hardening.sql
-- ============================================================

-- Fail closed before adding constraints. Historical rows are never rewritten or
-- silently deduplicated; the counts make any required owner review actionable.
DO $$
DECLARE
    v_invalid_labels bigint;
    v_invalid_targets bigint;
    v_duplicate_rows bigint;
BEGIN
    SELECT count(*) INTO v_invalid_labels
      FROM public.private_annotations
     WHERE entity_type = 'deliverable'
       AND label NOT IN ('Idea', 'In Progress', 'Filmed', 'Approved', 'Scheduled');

    SELECT count(*) INTO v_invalid_targets
      FROM public.private_annotations pa
      LEFT JOIN public.deliverables d ON d.id = pa.entity_id
      LEFT JOIN public.deals deal ON deal.id = d.deal_id
      LEFT JOIN public.deal_participants dp
        ON dp.deal_id = d.deal_id
       AND dp.profile_id = pa.profile_id
       AND dp.participant_role = 'creator'
     WHERE pa.entity_type = 'deliverable'
       AND (
           d.id IS NULL
           OR deal.creator_id IS DISTINCT FROM pa.profile_id
           OR dp.id IS NULL
       );

    SELECT coalesce(sum(group_count - 1), 0) INTO v_duplicate_rows
      FROM (
          SELECT count(*) AS group_count
            FROM public.private_annotations
           WHERE entity_type = 'deliverable'
           GROUP BY profile_id, entity_id
          HAVING count(*) > 1
      ) duplicates;

    IF v_invalid_labels > 0 OR v_invalid_targets > 0 OR v_duplicate_rows > 0 THEN
        RAISE EXCEPTION
            'PRIVATE_DELIVERABLE_LABEL_MIGRATION_BLOCKED invalid_labels=% invalid_targets=% duplicate_extra_rows=%',
            v_invalid_labels, v_invalid_targets, v_duplicate_rows;
    END IF;
END;
$$;

ALTER TABLE public.private_annotations
    ADD CONSTRAINT private_annotations_deliverable_label_allowed CHECK (
        entity_type <> 'deliverable'
        OR label IN ('Idea', 'In Progress', 'Filmed', 'Approved', 'Scheduled')
    );

CREATE UNIQUE INDEX private_annotations_one_deliverable_label
    ON public.private_annotations (profile_id, entity_type, entity_id)
    WHERE entity_type = 'deliverable';

CREATE FUNCTION public.enforce_private_deliverable_label()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND (OLD.entity_type = 'deliverable' OR NEW.entity_type = 'deliverable')
       AND (
           NEW.profile_id IS DISTINCT FROM OLD.profile_id
           OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
           OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
       ) THEN
        RAISE EXCEPTION 'PRIVATE_DELIVERABLE_LABEL_IDENTITY_IMMUTABLE';
    END IF;

    IF NEW.entity_type = 'deliverable' THEN
        IF NEW.label NOT IN ('Idea', 'In Progress', 'Filmed', 'Approved', 'Scheduled') THEN
            RAISE EXCEPTION 'PRIVATE_DELIVERABLE_LABEL_INVALID';
        END IF;
        IF NOT EXISTS (
            SELECT 1
              FROM public.deliverables d
              JOIN public.deals deal ON deal.id = d.deal_id
              JOIN public.deal_participants dp
                ON dp.deal_id = d.deal_id
               AND dp.profile_id = NEW.profile_id
               AND dp.participant_role = 'creator'
             WHERE d.id = NEW.entity_id
               AND deal.creator_id = NEW.profile_id
        ) THEN
            RAISE EXCEPTION 'PRIVATE_DELIVERABLE_LABEL_TARGET_FORBIDDEN';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER private_annotations_validate_deliverable_label
    BEFORE INSERT OR UPDATE ON public.private_annotations
    FOR EACH ROW EXECUTE FUNCTION public.enforce_private_deliverable_label();

-- Keep direct deal-annotation CRUD compatible. Deliverable-label mutations use
-- only the authenticated atomic function below, so partial-index races cannot
-- become client-side read/insert/update sequences.
DROP POLICY IF EXISTS "private_annotations_owner_only" ON public.private_annotations;

CREATE POLICY "private_annotations_select_owner"
    ON public.private_annotations FOR SELECT TO authenticated
    USING (profile_id = auth.uid());

CREATE POLICY "private_annotations_insert_owned_deal"
    ON public.private_annotations FOR INSERT TO authenticated
    WITH CHECK (profile_id = auth.uid() AND entity_type = 'deal');

CREATE POLICY "private_annotations_update_owned_deal"
    ON public.private_annotations FOR UPDATE TO authenticated
    USING (profile_id = auth.uid() AND entity_type = 'deal')
    WITH CHECK (profile_id = auth.uid() AND entity_type = 'deal');

CREATE POLICY "private_annotations_delete_owned_deal"
    ON public.private_annotations FOR DELETE TO authenticated
    USING (profile_id = auth.uid() AND entity_type = 'deal');

CREATE FUNCTION public.set_private_deliverable_label(
    p_deliverable_id uuid,
    p_label text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_actor_id uuid := auth.uid();
    v_label text;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'PRIVATE_DELIVERABLE_LABEL_AUTH_REQUIRED';
    END IF;

    -- Missing, guessed, and other-creator targets deliberately share one error.
    -- The row lock serializes against direct DELETE and the deliverable leg of a
    -- parent-deal cascade. Lock only the child row: parent cascades lock the deal
    -- first, so also locking the parent here would create an avoidable lock cycle.
    PERFORM 1
      FROM public.deliverables d
      JOIN public.deals deal ON deal.id = d.deal_id
      JOIN public.deal_participants dp
        ON dp.deal_id = d.deal_id
       AND dp.profile_id = v_actor_id
       AND dp.participant_role = 'creator'
     WHERE d.id = p_deliverable_id
       AND deal.creator_id = v_actor_id
     FOR UPDATE OF d;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PRIVATE_DELIVERABLE_LABEL_FORBIDDEN';
    END IF;

    IF p_label IS NULL THEN
        DELETE FROM public.private_annotations
         WHERE profile_id = v_actor_id
           AND entity_type = 'deliverable'
           AND entity_id = p_deliverable_id;
        RETURN NULL;
    END IF;

    IF p_label NOT IN ('Idea', 'In Progress', 'Filmed', 'Approved', 'Scheduled') THEN
        RAISE EXCEPTION 'PRIVATE_DELIVERABLE_LABEL_INVALID';
    END IF;

    INSERT INTO public.private_annotations (profile_id, entity_type, entity_id, label)
    VALUES (v_actor_id, 'deliverable', p_deliverable_id, p_label)
    ON CONFLICT (profile_id, entity_type, entity_id)
        WHERE entity_type = 'deliverable'
    DO UPDATE SET label = EXCLUDED.label
    RETURNING label INTO v_label;

    -- Recheck in a fresh READ COMMITTED statement while the deliverable lock is
    -- still held. Any lifecycle change that could remove the target must either
    -- have completed before the lock (and failed above) or wait for cleanup.
    IF NOT EXISTS (
        SELECT 1
          FROM public.deliverables d
          JOIN public.deals deal ON deal.id = d.deal_id
         WHERE d.id = p_deliverable_id
           AND deal.creator_id = v_actor_id
    ) THEN
        RAISE EXCEPTION 'PRIVATE_DELIVERABLE_LABEL_FORBIDDEN';
    END IF;

    RETURN v_label;
END;
$$;

CREATE FUNCTION public.delete_private_deliverable_label()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    DELETE FROM public.private_annotations
     WHERE entity_type = 'deliverable'
       AND entity_id = OLD.id;
    RETURN OLD;
END;
$$;

CREATE TRIGGER deliverables_delete_private_label
    AFTER DELETE ON public.deliverables
    FOR EACH ROW EXECUTE FUNCTION public.delete_private_deliverable_label();

REVOKE ALL ON FUNCTION public.enforce_private_deliverable_label()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_private_deliverable_label()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_private_deliverable_label(uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_private_deliverable_label(uuid, text) TO authenticated;
