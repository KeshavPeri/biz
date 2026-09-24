-- ============================================================
-- 050_payment_dashboard.sql
-- Workplan 11.2: participant-safe cross-deal payment dashboard
-- Depends on: 049_monthly_deal_summary.sql
-- ============================================================

-- Fixed-clock helper for serialized development acceptance tests. Authenticated
-- callers can execute only the wrapper at the end of this file.
CREATE OR REPLACE FUNCTION public.payment_dashboard_snapshot(
    p_viewer uuid,
    p_as_of timestamptz,
    p_deal_id uuid DEFAULT NULL,
    p_counterparty_id uuid DEFAULT NULL,
    p_due_from date DEFAULT NULL,
    p_due_to date DEFAULT NULL,
    p_bucket text DEFAULT NULL,
    p_state text DEFAULT NULL,
    p_limit integer DEFAULT 40,
    p_cursor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_cursor jsonb;
    v_cursor_context text;
    v_context text;
    v_cursor_rank integer;
    v_cursor_due date;
    v_cursor_id uuid;
    v_result jsonb;
BEGIN
    IF p_viewer IS NULL
       OR p_as_of IS NULL
       OR p_limit IS NULL
       OR p_limit NOT BETWEEN 1 AND 100
       OR p_bucket IS NOT NULL AND p_bucket NOT IN ('received', 'pending', 'overdue', 'bad_debt')
       OR p_state IS NOT NULL AND p_state NOT IN (
           'paid_full', 'paid_partial', 'not_paid_in_window', 'not_paid_delayed',
           'bad_debt', 'disputed', 'refunded'
       )
       OR p_due_from IS NOT NULL AND p_due_to IS NOT NULL AND p_due_from > p_due_to
       OR p_bucket = 'received' AND p_state IS NOT NULL AND p_state <> 'paid_full'
       OR p_bucket = 'bad_debt' AND p_state IS NOT NULL AND p_state <> 'bad_debt'
       OR p_bucket IN ('received', 'pending', 'overdue') AND p_state = 'bad_debt'
       OR p_cursor IS NOT NULL AND length(p_cursor) NOT BETWEEN 1 AND 1024 THEN
        RAISE EXCEPTION 'PAYMENT_DASHBOARD_INVALID_REQUEST';
    END IF;

    v_context := md5(concat_ws('|',
        'payment-dashboard-v1', p_viewer::text, (p_as_of AT TIME ZONE 'UTC')::date::text,
        COALESCE(p_deal_id::text, ''), COALESCE(p_counterparty_id::text, ''),
        COALESCE(p_due_from::text, ''), COALESCE(p_due_to::text, ''),
        COALESCE(p_bucket, ''), COALESCE(p_state, ''), p_limit::text
    ));

    IF p_cursor IS NOT NULL THEN
        BEGIN
            v_cursor := convert_from(decode(p_cursor, 'base64'), 'UTF8')::jsonb;
            IF jsonb_typeof(v_cursor) <> 'object'
               OR NOT v_cursor ?& ARRAY['v','context','rank','due','id']::text[]
               OR (SELECT count(*) FROM jsonb_object_keys(v_cursor)) <> 5
               OR jsonb_typeof(v_cursor->'v') <> 'number'
               OR v_cursor->>'v' <> '1'
               OR jsonb_typeof(v_cursor->'context') <> 'string'
               OR jsonb_typeof(v_cursor->'rank') <> 'number'
               OR jsonb_typeof(v_cursor->'due') <> 'string'
               OR jsonb_typeof(v_cursor->'id') <> 'string'
               OR (v_cursor->>'rank') !~ '^[0-3]$'
               OR (v_cursor->>'due') !~ '^\d{4}-\d{2}-\d{2}$'
               OR (v_cursor->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
                RAISE EXCEPTION 'invalid';
            END IF;
            v_cursor_context := v_cursor->>'context';
            v_cursor_rank := (v_cursor->>'rank')::integer;
            v_cursor_due := (v_cursor->>'due')::date;
            v_cursor_id := (v_cursor->>'id')::uuid;
            IF v_cursor_context <> v_context
               OR to_char(v_cursor_due, 'YYYY-MM-DD') <> v_cursor->>'due' THEN
                RAISE EXCEPTION 'invalid';
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'PAYMENT_DASHBOARD_INVALID_CURSOR';
        END;
    END IF;

    WITH
    clock AS (
        SELECT p_as_of AS as_of, (p_as_of AT TIME ZONE 'UTC')::date AS today
    ),
    viewer AS (
        SELECT CASE WHEN pr.account_type::text = 'creator' THEN 'creator' ELSE 'brand' END AS kind
          FROM public.profiles pr
         WHERE pr.id = p_viewer
           AND pr.account_type::text IN ('creator', 'brand')
    ),
    eligible_deals AS (
        SELECT d.id, d.deal_name, d.creator_id, d.brand_id,
               CASE WHEN d.creator_id = p_viewer THEN d.brand_id ELSE d.creator_id END AS counterparty_id,
               CASE WHEN d.creator_id = p_viewer THEN b.company_name ELSE cp.display_name END AS counterparty_name
          FROM public.deals d
          JOIN public.brands b ON b.id = d.brand_id
          JOIN public.profiles cp ON cp.id = d.creator_id
          CROSS JOIN viewer v
         WHERE d.deleted_at IS NULL
           AND d.stage::text IN ('payment', 'closed')
           AND (p_deal_id IS NULL OR d.id = p_deal_id)
           AND (p_counterparty_id IS NULL OR
                CASE WHEN d.creator_id = p_viewer THEN d.brand_id ELSE d.creator_id END = p_counterparty_id)
           AND EXISTS (
               SELECT 1
                 FROM public.deal_participants dp
                WHERE dp.deal_id = d.id
                  AND dp.profile_id = p_viewer
                  AND (
                      (v.kind = 'creator' AND dp.participant_role::text = 'creator' AND d.creator_id = p_viewer)
                      OR (
                          v.kind = 'brand'
                          AND
                          dp.participant_role::text IN ('brand_admin', 'brand_maker', 'brand_checker')
                          AND EXISTS (
                              SELECT 1
                                FROM public.brand_members bm
                               WHERE bm.brand_id = d.brand_id
                                 AND bm.profile_id = p_viewer
                                 AND bm.status::text = 'active'
                          )
                      )
                  )
           )
    ),
    eligible_guard AS (
        SELECT 1 / CASE WHEN count(*) <= 500 THEN 1 ELSE 0 END AS ok FROM eligible_deals
    ),
    payment_shape AS (
        SELECT ed.id AS deal_id,
               count(p.id)::integer AS payment_count,
               (array_agg(p.id ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS payment_id,
               (array_agg(p.source_summary_id ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS source_summary_id,
               (array_agg(p.structure::text ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS structure,
               (array_agg(p.amount ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS amount,
               (array_agg(p.currency ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS currency,
               (array_agg(p.state::text ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS state,
               (array_agg(p.due_date ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS due_date,
               (array_agg(p.due_date_pending ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS due_date_pending,
               (array_agg(p.version ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS version,
               (array_agg(p.creator_receipt_version ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS receipt_version,
               (array_agg(p.creator_receipt_confirmed_by ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS receipt_by,
               (array_agg(p.creator_receipt_confirmed_at ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS receipt_at
          FROM eligible_deals ed
          CROSS JOIN eligible_guard eg
          LEFT JOIN public.payments p ON p.deal_id = ed.id AND p.source_summary_id IS NOT NULL
         WHERE eg.ok = 1
         GROUP BY ed.id
    ),
    milestone_shape AS (
        SELECT ps.deal_id,
               count(m.id)::integer AS milestone_count,
               min(m.sequence) AS first_sequence,
               max(m.sequence) AS last_sequence,
               COALESCE(sum(m.amount), 0::numeric) AS milestone_total,
               bool_and(m.sequence IS NOT NULL AND m.version > 0 AND m.amount > 0
                        AND m.amount <> 'NaN'::numeric
                        AND m.amount <= 999999999999999999::numeric
                        AND m.amount * 100 = trunc(m.amount * 100)) AS rows_valid
          FROM payment_shape ps
          LEFT JOIN public.payment_milestones m ON m.payment_id = ps.payment_id
         GROUP BY ps.deal_id
    ),
    integrity AS (
        SELECT count(*) FILTER (WHERE NOT (
                   ps.payment_count = 1
                   AND ps.amount > 0 AND ps.amount <> 'NaN'::numeric
                   AND ps.amount <= 999999999999999999::numeric
                   AND ps.amount * 100 = trunc(ps.amount * 100)
                   AND ps.currency ~ '^[A-Z]{3}$'
                   AND ps.version > 0
                   AND EXISTS (
                       SELECT 1 FROM public.ai_summaries s
                        WHERE s.id = ps.source_summary_id
                          AND s.deal_id = ps.deal_id
                          AND s.status::text = 'approved'
                   )
                   AND (
                       (ps.structure = 'single' AND ms.milestone_count = 0
                        AND ps.due_date_pending = (ps.due_date IS NULL))
                       OR
                       (ps.structure IN ('milestone', 'combination')
                        AND ms.milestone_count BETWEEN 1 AND 100
                        AND ms.first_sequence = 1
                        AND ms.last_sequence = ms.milestone_count
                        AND ms.milestone_total = ps.amount
                        AND ms.rows_valid)
                   )
               ))::integer AS bad_count
          FROM payment_shape ps
          JOIN milestone_shape ms ON ms.deal_id = ps.deal_id
    ),
    integrity_guard AS (
        SELECT 1 / CASE WHEN bad_count = 0 THEN 1 ELSE 0 END AS ok FROM integrity
    ),
    raw_obligations AS (
        SELECT ps.payment_id AS obligation_id, ed.id AS deal_id, ed.deal_name,
               ed.counterparty_id, ed.counterparty_name, 'single'::text AS item_kind,
               NULL::integer AS milestone_sequence, NULL::text AS milestone_trigger,
               ps.amount, ps.currency, ps.due_date, ps.due_date_pending, ps.state,
               COALESCE(ps.receipt_version = ps.version AND ps.receipt_by = ed.creator_id, false) AS receipt_confirmed,
               CASE WHEN ps.receipt_version = ps.version AND ps.receipt_by = ed.creator_id
                    THEN ps.receipt_at ELSE NULL END AS receipt_confirmed_at
          FROM eligible_deals ed
          JOIN payment_shape ps ON ps.deal_id = ed.id AND ps.structure = 'single'
          CROSS JOIN integrity_guard ig
         WHERE ig.ok = 1
        UNION ALL
        SELECT m.id, ed.id, ed.deal_name, ed.counterparty_id, ed.counterparty_name,
               'milestone'::text, m.sequence, m.trigger_description,
               m.amount, ps.currency, m.due_date, (m.due_date IS NULL), m.state::text,
               COALESCE(m.creator_receipt_version = m.version AND m.creator_receipt_confirmed_by = ed.creator_id, false),
               CASE WHEN m.creator_receipt_version = m.version
                          AND m.creator_receipt_confirmed_by = ed.creator_id
                    THEN m.creator_receipt_confirmed_at ELSE NULL END
          FROM eligible_deals ed
          JOIN payment_shape ps ON ps.deal_id = ed.id AND ps.structure IN ('milestone', 'combination')
          JOIN public.payment_milestones m ON m.payment_id = ps.payment_id AND m.sequence IS NOT NULL
          CROSS JOIN integrity_guard ig
         WHERE ig.ok = 1
    ),
    classified AS (
        SELECT ro.*,
               CASE
                   WHEN ro.state = 'paid_full' AND ro.receipt_confirmed THEN 'received'
                   WHEN ro.state = 'bad_debt' THEN 'bad_debt'
                   WHEN ro.state = 'not_paid_delayed'
                        OR (ro.due_date IS NOT NULL AND ro.due_date < c.today) THEN 'overdue'
                   ELSE 'pending'
               END AS bucket
          FROM raw_obligations ro CROSS JOIN clock c
    ),
    filtered AS (
        SELECT c.*,
               CASE c.bucket WHEN 'bad_debt' THEN 0 WHEN 'overdue' THEN 1
                             WHEN 'pending' THEN 2 ELSE 3 END AS sort_rank,
               COALESCE(c.due_date, '9999-12-31'::date) AS sort_due
          FROM classified c
         WHERE (p_due_from IS NULL OR c.due_date >= p_due_from)
           AND (p_due_to IS NULL OR c.due_date <= p_due_to)
           AND (p_bucket IS NULL OR c.bucket = p_bucket)
           AND (p_state IS NULL OR c.state = p_state)
    ),
    after_cursor AS (
        SELECT f.*
          FROM filtered f
         WHERE p_cursor IS NULL
            OR (f.sort_rank, f.sort_due, f.obligation_id) >
               (v_cursor_rank, v_cursor_due, v_cursor_id)
    ),
    selected AS (
        SELECT * FROM after_cursor
         ORDER BY sort_rank, sort_due, obligation_id
         LIMIT p_limit + 1
    ),
    page AS (
        SELECT * FROM selected
         ORDER BY sort_rank, sort_due, obligation_id
         LIMIT p_limit
    ),
    page_totals AS (
        SELECT currency, sum(amount) AS obligation_total,
               COALESCE(sum(amount) FILTER (WHERE bucket = 'received'), 0::numeric) AS confirmed_received,
               count(*)::integer AS obligation_count,
               count(*) FILTER (WHERE bucket = 'received')::integer AS received_count,
               count(*) FILTER (WHERE bucket = 'pending')::integer AS pending_count,
               count(*) FILTER (WHERE bucket = 'overdue')::integer AS overdue_count,
               count(*) FILTER (WHERE bucket = 'bad_debt')::integer AS bad_debt_count,
               count(*) FILTER (WHERE state = 'paid_partial')::integer AS partial_unquantified_count
          FROM page GROUP BY currency
    ),
    total_guard AS (
        SELECT 1 / CASE WHEN COALESCE(bool_and(
                   obligation_total <= 999999999999999999::numeric
                   AND confirmed_received <= 999999999999999999::numeric
               ), true) THEN 1 ELSE 0 END AS ok
          FROM page_totals
    ),
    last_row AS (
        SELECT * FROM page ORDER BY sort_rank DESC, sort_due DESC, obligation_id DESC LIMIT 1
    )
    SELECT jsonb_build_object(
        'version', 1,
        'as_of', to_jsonb(c.as_of),
        'viewer_kind', v.kind,
        'filters', jsonb_build_object(
            'deal_id', p_deal_id, 'counterparty_id', p_counterparty_id,
            'due_from', p_due_from, 'due_to', p_due_to,
            'bucket', p_bucket, 'state', p_state, 'limit', p_limit
        ),
        'filter_options', jsonb_build_object(
            'deals', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', ed.id,
                'label', COALESCE(NULLIF(left(regexp_replace(btrim(ed.deal_name), '[[:cntrl:]]', ' ', 'g'), 160), ''), 'Untitled deal')
            ) ORDER BY lower(ed.deal_name), ed.deal_name, ed.id) FROM eligible_deals ed), '[]'::jsonb),
            'counterparties', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', options.counterparty_id, 'label', options.counterparty_name
            ) ORDER BY lower(options.counterparty_name), options.counterparty_name, options.counterparty_id)
            FROM (SELECT DISTINCT counterparty_id,
                    COALESCE(NULLIF(left(regexp_replace(btrim(counterparty_name), '[[:cntrl:]]', ' ', 'g'), 160), ''), 'Unnamed counterparty') AS counterparty_name
                    FROM eligible_deals) options), '[]'::jsonb)
        ),
        -- A full page keeps a cursor even when it may be the exact final multiple;
        -- the following request then returns an explicit empty terminal page.
        'next_cursor', CASE WHEN (SELECT count(*) FROM page) = p_limit THEN (
            SELECT encode(convert_to(jsonb_build_object(
                'v', 1, 'context', v_context, 'rank', lr.sort_rank,
                'due', to_char(lr.sort_due, 'YYYY-MM-DD'), 'id', lr.obligation_id
            )::text, 'UTF8'), 'base64') FROM last_row lr
        ) ELSE NULL END,
        'totals', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'currency', pt.currency,
            'obligation_total', to_char(pt.obligation_total, 'FM9999999999999999990.00'),
            'confirmed_received', to_char(pt.confirmed_received, 'FM9999999999999999990.00'),
            'obligation_count', pt.obligation_count,
            'received_count', pt.received_count, 'pending_count', pt.pending_count,
            'overdue_count', pt.overdue_count, 'bad_debt_count', pt.bad_debt_count,
            'partial_unquantified_count', pt.partial_unquantified_count
        ) ORDER BY pt.currency) FROM page_totals pt), '[]'::jsonb),
        'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'obligation_id', p.obligation_id, 'deal_id', p.deal_id,
            'deal_name', COALESCE(NULLIF(left(regexp_replace(btrim(p.deal_name), '[[:cntrl:]]', ' ', 'g'), 160), ''), 'Untitled deal'),
            'counterparty_id', p.counterparty_id,
            'counterparty_name', COALESCE(NULLIF(left(regexp_replace(btrim(p.counterparty_name), '[[:cntrl:]]', ' ', 'g'), 160), ''), 'Unnamed counterparty'),
            'item_kind', p.item_kind, 'milestone_sequence', p.milestone_sequence,
            'milestone_trigger', CASE WHEN p.milestone_trigger IS NULL THEN NULL
                ELSE left(regexp_replace(btrim(p.milestone_trigger), '[[:cntrl:]]', ' ', 'g'), 200) END,
            'amount', to_char(p.amount, 'FM9999999999999999990.00'), 'currency', p.currency,
            'due_date', p.due_date, 'due_date_pending', p.due_date_pending,
            'canonical_state', p.state, 'history_bucket', p.bucket,
            'creator_receipt_confirmed', p.receipt_confirmed,
            'creator_receipt_confirmed_at', p.receipt_confirmed_at,
            'source_deal_id', p.deal_id
        ) ORDER BY p.sort_rank, p.sort_due, p.obligation_id) FROM page p), '[]'::jsonb)
    ) INTO v_result
      FROM clock c CROSS JOIN viewer v CROSS JOIN total_guard tg
     WHERE tg.ok = 1;

    IF v_result IS NULL THEN
        RAISE EXCEPTION 'PAYMENT_DASHBOARD_UNAVAILABLE';
    END IF;
    RETURN v_result;
EXCEPTION
    WHEN division_by_zero THEN RAISE EXCEPTION 'PAYMENT_DASHBOARD_UNAVAILABLE';
END;
$function$;

REVOKE ALL ON FUNCTION public.payment_dashboard_snapshot(
    uuid, timestamptz, uuid, uuid, date, date, text, text, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_dashboard_snapshot(
    uuid, timestamptz, uuid, uuid, date, date, text, text, integer, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_payment_dashboard(
    p_deal_id uuid DEFAULT NULL,
    p_counterparty_id uuid DEFAULT NULL,
    p_due_from date DEFAULT NULL,
    p_due_to date DEFAULT NULL,
    p_bucket text DEFAULT NULL,
    p_state text DEFAULT NULL,
    p_limit integer DEFAULT 40,
    p_cursor text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_viewer uuid := auth.uid();
BEGIN
    IF v_viewer IS NULL THEN
        RAISE EXCEPTION 'PAYMENT_DASHBOARD_UNAUTHENTICATED';
    END IF;
    RETURN public.payment_dashboard_snapshot(
        v_viewer, statement_timestamp(), p_deal_id, p_counterparty_id,
        p_due_from, p_due_to, p_bucket, p_state, p_limit, p_cursor
    );
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'PAYMENT_DASHBOARD_%' THEN RAISE; END IF;
    RAISE EXCEPTION 'PAYMENT_DASHBOARD_INVALID_REQUEST';
END;
$function$;

REVOKE ALL ON FUNCTION public.get_payment_dashboard(
    uuid, uuid, date, date, text, text, integer, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_payment_dashboard(
    uuid, uuid, date, date, text, text, integer, text
) TO authenticated;
