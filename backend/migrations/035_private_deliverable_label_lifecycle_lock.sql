-- ============================================================
-- 035_private_deliverable_label_lifecycle_lock.sql
-- Security-review hardening for workplan 9.13-E.
-- Depends on: 034_private_deliverable_labels.sql
-- ============================================================

-- Development received migration 034 before review. Fresh installs already get
-- this corrected implementation in 034; replace it here for databases where the
-- original function was installed. The stable signature and grants do not change.
CREATE OR REPLACE FUNCTION public.set_private_deliverable_label(
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

    -- Serialize with direct target deletion and the deliverable leg of a parent
    -- cascade. Lock only the child to preserve the parent's deal-then-child order.
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

REVOKE ALL ON FUNCTION public.set_private_deliverable_label(uuid, text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_private_deliverable_label(uuid, text) TO authenticated;
