-- Workplan 12.1-A: recipient-only notification reads and acknowledgement.
-- Existing rows and server-side notice writers are deliberately untouched.

DROP POLICY IF EXISTS "notifications_recipient_update" ON public.notifications;
REVOKE ALL PRIVILEGES ON TABLE public.notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.notifications TO service_role;

-- No caller identity is accepted. A second call observes the owned read row
-- without issuing another UPDATE, including after a concurrent first call.
CREATE FUNCTION public.mark_notification_read(p_notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_updated integer;
    v_recipient uuid := auth.uid();
BEGIN
    IF v_recipient IS NULL THEN
        RETURN false;
    END IF;

    UPDATE public.notifications
       SET read = true
     WHERE id = p_notification_id
       AND profile_id = v_recipient
       AND read = false;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 1 THEN
        RETURN true;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.notifications
         WHERE id = p_notification_id
           AND profile_id = v_recipient
           AND read = true
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_notification_read(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;

-- One stable cursor for recipient-scoped newest-first reads, including ties.
CREATE INDEX idx_notifications_recipient_newest
    ON public.notifications (profile_id, created_at DESC, id DESC);

-- Realtime is a refresh hint; recipient RLS remains the data boundary.
DO $publication$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_publication_tables
         WHERE pubname = 'supabase_realtime'
           AND schemaname = 'public'
           AND tablename = 'notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
END;
$publication$;
