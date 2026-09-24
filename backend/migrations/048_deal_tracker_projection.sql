-- ============================================================
-- 048_deal_tracker_projection.sql
-- Workplan 11.1-A: participant-safe, server-time deal tracker projection
-- Depends on: 047_chat_attachments.sql
-- ============================================================

-- The helper accepts a viewer and clock only so integration tests can prove
-- exact boundary instants. It is never exposed to authenticated clients.
CREATE OR REPLACE FUNCTION public.deal_tracker_snapshot(
    p_viewer uuid,
    p_as_of timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
WITH
clock AS (
    SELECT p_as_of AS as_of, (p_as_of AT TIME ZONE 'UTC')::date AS today
),
eligible_deals AS (
    SELECT d.*
      FROM public.deals d
     WHERE p_viewer IS NOT NULL
       AND d.deleted_at IS NULL
       AND d.stage::text NOT IN ('closed', 'declined', 'cancelled')
       AND EXISTS (
           SELECT 1
             FROM public.deal_participants dp
            WHERE dp.deal_id = d.id
              AND dp.profile_id = p_viewer
              AND (
                  (dp.participant_role::text = 'creator' AND d.creator_id = p_viewer)
                  OR (
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
tracker_guard AS (
    -- Fail the whole RPC rather than return a truncated or falsely empty view.
    -- The app converts this to the same friendly recoverable error as any RPC failure.
    SELECT 1 / CASE WHEN count(*) <= 500 THEN 1 ELSE 0 END AS ok
      FROM eligible_deals
),
visible_deals AS (
    SELECT ed.* FROM eligible_deals ed CROSS JOIN tracker_guard g WHERE g.ok = 1
),
deliverable_facts AS (
    SELECT vd.id AS deal_id,
           count(d.id)::integer AS canonical_count,
           count(d.id) FILTER (
               WHERE d.status::text <> 'posted'
                 AND COALESCE(d.posting_date, d.posting_window_end) < c.today
           )::integer AS overdue_count,
           min(COALESCE(d.posting_date, d.posting_window_end)) FILTER (
               WHERE d.status::text <> 'posted'
                 AND COALESCE(d.posting_date, d.posting_window_end) < c.today
           ) AS overdue_date,
           min(COALESCE(d.posting_date, d.posting_window_end)) FILTER (
               WHERE d.status::text <> 'posted'
                 AND COALESCE(d.posting_date, d.posting_window_end) >= c.today
                 AND COALESCE(d.posting_date, d.posting_window_end) <= c.today + 2
           ) AS due_soon_date,
           min(COALESCE(d.posting_date, d.posting_window_end)) FILTER (
               WHERE d.status::text <> 'posted'
                 AND COALESCE(d.posting_date, d.posting_window_end) >= c.today
           ) AS next_date
      FROM visible_deals vd
      CROSS JOIN clock c
      LEFT JOIN public.deliverables d
        ON d.deal_id = vd.id AND d.source_summary_id IS NOT NULL
     GROUP BY vd.id
),
payment_shape AS (
    SELECT vd.id AS deal_id,
           count(DISTINCT p.id)::integer AS payment_count,
           max(p.structure::text) AS structure,
           max(p.state::text) AS aggregate_state,
           count(m.id)::integer AS milestone_count,
           min(m.sequence) AS first_sequence,
           max(m.sequence) AS last_sequence,
           CASE WHEN count(m.id) = 0 THEN NULL
                WHEN bool_or(m.state::text = 'bad_debt') THEN 'bad_debt'
                WHEN bool_or(m.state::text = 'not_paid_delayed') THEN 'not_paid_delayed'
                WHEN bool_and(m.state::text = 'paid_full') THEN 'paid_full'
                WHEN bool_and(m.state::text = 'refunded') THEN 'refunded'
                WHEN bool_or(m.state::text IN ('paid_full', 'paid_partial', 'refunded')) THEN 'paid_partial'
                ELSE 'not_paid_in_window'
            END AS derived_milestone_state
      FROM visible_deals vd
      LEFT JOIN public.payments p
        ON p.deal_id = vd.id AND p.source_summary_id IS NOT NULL
      LEFT JOIN public.payment_milestones m
        ON m.payment_id = p.id AND m.sequence IS NOT NULL
     GROUP BY vd.id
),
payment_obligations AS (
    SELECT vd.id AS deal_id, p.id AS obligation_id, p.due_date, p.state::text AS state
      FROM visible_deals vd
      JOIN public.payments p
        ON p.deal_id = vd.id
       AND p.source_summary_id IS NOT NULL
       AND p.structure::text = 'single'
    UNION ALL
    SELECT vd.id, m.id, m.due_date, m.state::text
      FROM visible_deals vd
      JOIN public.payments p
        ON p.deal_id = vd.id
       AND p.source_summary_id IS NOT NULL
       AND p.structure::text IN ('milestone', 'combination')
      JOIN public.payment_milestones m
        ON m.payment_id = p.id AND m.sequence IS NOT NULL
),
payment_facts AS (
    SELECT vd.id AS deal_id,
           count(po.obligation_id) FILTER (
               WHERE po.state NOT IN ('paid_full', 'refunded')
                 AND po.due_date BETWEEN c.today AND c.today + 7
           )::integer AS due_this_week,
           min(po.due_date) FILTER (
               WHERE po.state NOT IN ('paid_full', 'refunded')
                 AND po.due_date <= c.today - 3
           ) AS overdue_date,
           min(po.due_date) FILTER (
               WHERE po.state NOT IN ('paid_full', 'refunded')
                 AND po.due_date > c.today - 3
                 AND po.due_date <= c.today + 3
           ) AS due_soon_date,
           min(po.due_date) FILTER (
               WHERE po.state NOT IN ('paid_full', 'refunded')
                 AND po.due_date >= c.today
           ) AS next_date,
           bool_or(po.state IN ('disputed', 'bad_debt', 'not_paid_delayed')) AS critical_state
      FROM visible_deals vd
      CROSS JOIN clock c
      LEFT JOIN payment_obligations po ON po.deal_id = vd.id
     GROUP BY vd.id
),
dispute_facts AS (
    SELECT vd.id AS deal_id,
           count(di.id) FILTER (WHERE di.status::text = 'open')::integer AS open_count,
           min(di.created_at) FILTER (WHERE di.status::text = 'open') AS opened_at
      FROM visible_deals vd
      LEFT JOIN public.disputes di ON di.deal_id = vd.id
     GROUP BY vd.id
),
awaited_events AS (
    SELECT g.deal_id, g.requested_at AS waiting_since
      FROM public.deal_summary_gates g JOIN visible_deals vd ON vd.id = g.deal_id
     WHERE g.request_status = 'awaiting_confirmation' AND g.requested_at IS NOT NULL
    UNION ALL
    SELECT s.deal_id, s.generated_at
      FROM public.ai_summaries s JOIN visible_deals vd ON vd.id = s.deal_id
     WHERE s.status::text = 'pending_approval'
       AND s.id = (
           SELECT s2.id FROM public.ai_summaries s2
            WHERE s2.deal_id = s.deal_id
            ORDER BY s2.generated_at DESC, s2.id DESC LIMIT 1
       )
    UNION ALL
    SELECT co.deal_id, co.created_at
      FROM public.contracts co JOIN visible_deals vd ON vd.id = co.deal_id
     WHERE co.status::text = 'awaiting_signatures'
       AND co.id = (
           SELECT co2.id FROM public.contracts co2
            WHERE co2.deal_id = co.deal_id
            ORDER BY co2.version DESC, co2.created_at DESC, co2.id DESC LIMIT 1
       )
    UNION ALL
    SELECT d.deal_id, r.submitted_at
      FROM public.revisions r
      JOIN public.deliverables d ON d.id = r.deliverable_id AND d.source_summary_id IS NOT NULL
      JOIN visible_deals vd ON vd.id = d.deal_id
     WHERE r.lifecycle::text = 'awaiting_review' AND r.submitted_at IS NOT NULL
    UNION ALL
    SELECT b.deal_id, b.created_at
      FROM public.briefs b JOIN visible_deals vd ON vd.id = b.deal_id
     WHERE NOT b.acknowledged_by_creator
       AND b.id = (
           SELECT b2.id FROM public.briefs b2
            WHERE b2.deal_id = b.deal_id
            ORDER BY b2.version DESC, b2.created_at DESC, b2.id DESC LIMIT 1
       )
    UNION ALL
    SELECT vd.id, t.created_at
      FROM visible_deals vd
      JOIN LATERAL (
          SELECT dst.created_at FROM public.deal_stage_transitions dst
           WHERE dst.deal_id = vd.id AND dst.to_stage::text = 'posted'
           ORDER BY dst.created_at DESC, dst.id DESC LIMIT 1
      ) t ON true
     WHERE vd.stage::text = 'posted'
       AND EXISTS (
           SELECT 1 FROM public.deliverables d
           JOIN public.live_post_submissions lps ON lps.id = d.current_live_post_submission_id
            WHERE d.deal_id = vd.id AND d.source_summary_id IS NOT NULL
              AND lps.status = 'verified'
       )
    UNION ALL
    SELECT vd.id, min(dcc.confirmed_at)
      FROM visible_deals vd
      JOIN public.deal_close_confirmations dcc ON dcc.deal_id = vd.id
     GROUP BY vd.id
    HAVING count(*) = 1
),
await_facts AS (
    SELECT vd.id AS deal_id, min(ae.waiting_since) AS waiting_since
      FROM visible_deals vd
      LEFT JOIN awaited_events ae ON ae.deal_id = vd.id
     GROUP BY vd.id
),
deal_facts AS (
    SELECT vd.*,
           df.canonical_count, df.overdue_count, df.overdue_date AS deliverable_overdue_date,
           df.due_soon_date AS deliverable_due_soon_date, df.next_date AS deliverable_next_date,
           ps.payment_count, ps.structure, ps.aggregate_state, ps.milestone_count,
           ps.first_sequence, ps.last_sequence, ps.derived_milestone_state,
           pf.due_this_week, pf.overdue_date AS payment_overdue_date,
           pf.due_soon_date AS payment_due_soon_date, pf.next_date AS payment_next_date,
           COALESCE(pf.critical_state, false) AS critical_payment_state,
           dif.open_count, dif.opened_at, af.waiting_since,
           (
               ps.payment_count > 1
               OR (vd.stage::text = 'payment' AND ps.payment_count <> 1)
               OR (ps.payment_count = 1 AND ps.structure = 'single' AND ps.milestone_count <> 0)
               OR (ps.payment_count = 1 AND ps.structure IN ('milestone', 'combination') AND ps.milestone_count = 0)
               OR (ps.payment_count = 1 AND ps.structure IN ('milestone', 'combination')
                   AND (ps.first_sequence <> 1 OR ps.last_sequence <> ps.milestone_count))
               OR (ps.payment_count = 1 AND ps.structure IN ('milestone', 'combination')
                   AND NOT vd.is_disputed
                   AND ps.aggregate_state IS DISTINCT FROM ps.derived_milestone_state)
               OR (vd.stage::text IN ('posted', 'payment') AND df.canonical_count = 0)
               OR ((vd.is_disputed OR dif.open_count > 0 OR ps.aggregate_state = 'disputed')
                   AND NOT (vd.is_disputed AND dif.open_count = 1 AND ps.aggregate_state = 'disputed'))
           ) AS inconsistent,
           LEAST(df.next_date, pf.next_date) AS next_deadline,
           c.as_of, c.today
      FROM visible_deals vd
      CROSS JOIN clock c
      JOIN deliverable_facts df ON df.deal_id = vd.id
      JOIN payment_shape ps ON ps.deal_id = vd.id
      JOIN payment_facts pf ON pf.deal_id = vd.id
      JOIN dispute_facts dif ON dif.deal_id = vd.id
      JOIN await_facts af ON af.deal_id = vd.id
),
classified AS (
    SELECT f.*,
           CASE
               WHEN f.inconsistent THEN 'red'
               WHEN f.is_disputed OR f.open_count > 0 OR f.critical_payment_state THEN 'red'
               WHEN f.payment_overdue_date IS NOT NULL THEN 'red'
               WHEN f.deliverable_overdue_date IS NOT NULL THEN 'red'
               WHEN f.waiting_since <= f.as_of - interval '48 hours' THEN 'red'
               WHEN f.stage::text = 'pending' AND f.expires_at <= f.as_of THEN 'red'
               WHEN f.waiting_since <= f.as_of - interval '24 hours' THEN 'amber'
               WHEN f.deliverable_due_soon_date IS NOT NULL THEN 'amber'
               WHEN f.payment_due_soon_date IS NOT NULL THEN 'amber'
               WHEN f.stage::text = 'pending' AND f.expires_at > f.as_of
                    AND f.expires_at <= f.as_of + interval '12 hours' THEN 'amber'
               ELSE 'green'
           END AS rag_status,
           CASE
               WHEN f.inconsistent THEN 'needs_attention'
               WHEN f.is_disputed OR f.open_count > 0 OR f.critical_payment_state THEN 'payment_disputed'
               WHEN f.payment_overdue_date IS NOT NULL THEN 'payment_overdue'
               WHEN f.deliverable_overdue_date IS NOT NULL THEN 'deliverable_overdue'
               WHEN f.waiting_since <= f.as_of - interval '48 hours' THEN 'confirmation_overdue'
               WHEN f.stage::text = 'pending' AND f.expires_at <= f.as_of THEN 'connection_expired'
               WHEN f.waiting_since <= f.as_of - interval '24 hours' THEN 'confirmation_waiting'
               WHEN f.deliverable_due_soon_date IS NOT NULL THEN 'deliverable_due_soon'
               WHEN f.payment_due_soon_date IS NOT NULL THEN 'payment_due_soon'
               WHEN f.stage::text = 'pending' AND f.expires_at > f.as_of
                    AND f.expires_at <= f.as_of + interval '12 hours' THEN 'connection_expiring'
               ELSE 'on_track'
           END AS reason_code,
           CASE
               WHEN f.inconsistent THEN 'Needs attention'
               WHEN f.is_disputed OR f.open_count > 0 OR f.critical_payment_state THEN 'Payment needs attention'
               WHEN f.payment_overdue_date IS NOT NULL THEN 'Payment overdue'
               WHEN f.deliverable_overdue_date IS NOT NULL THEN 'Deliverable overdue'
               WHEN f.waiting_since <= f.as_of - interval '48 hours' THEN 'Confirmation overdue'
               WHEN f.stage::text = 'pending' AND f.expires_at <= f.as_of THEN 'Connection expired'
               WHEN f.waiting_since <= f.as_of - interval '24 hours' THEN 'Waiting for confirmation'
               WHEN f.deliverable_due_soon_date IS NOT NULL THEN 'Deliverable due soon'
               WHEN f.payment_due_soon_date IS NOT NULL THEN 'Payment due soon'
               WHEN f.stage::text = 'pending' AND f.expires_at > f.as_of
                    AND f.expires_at <= f.as_of + interval '12 hours' THEN 'Connection expiring'
               ELSE 'On track'
           END AS reason_label
      FROM deal_facts f
),
rows AS (
    SELECT c.*,
           CASE c.reason_code
               WHEN 'payment_disputed' THEN c.opened_at
               WHEN 'payment_overdue' THEN c.payment_overdue_date::timestamp AT TIME ZONE 'UTC'
               WHEN 'deliverable_overdue' THEN c.deliverable_overdue_date::timestamp AT TIME ZONE 'UTC'
               WHEN 'confirmation_overdue' THEN c.waiting_since
               WHEN 'connection_expired' THEN c.expires_at
               WHEN 'confirmation_waiting' THEN c.waiting_since
               WHEN 'deliverable_due_soon' THEN c.deliverable_due_soon_date::timestamp AT TIME ZONE 'UTC'
               WHEN 'payment_due_soon' THEN c.payment_due_soon_date::timestamp AT TIME ZONE 'UTC'
               WHEN 'connection_expiring' THEN c.expires_at
               ELSE NULL
           END AS relevant_at,
           CASE c.rag_status WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END AS status_rank
      FROM classified c
),
summary AS (
    SELECT count(*)::integer AS active_deals,
           count(*) FILTER (WHERE rag_status = 'red')::integer AS action_needed,
           COALESCE(sum(due_this_week), 0)::integer AS payments_due_this_week,
           min(next_deadline) AS next_deadline,
           COALESCE(sum(overdue_count), 0)::integer AS overdue_deliverables,
           count(*) FILTER (WHERE direction::text = 'inbound')::integer AS inbound_deals,
           count(*) FILTER (WHERE direction::text = 'outbound')::integer AS outbound_deals
      FROM rows
)
SELECT jsonb_build_object(
    'version', 1,
    'as_of', to_jsonb(p_as_of),
    'summary', jsonb_build_object(
        'active_deals', s.active_deals,
        'action_needed', s.action_needed,
        'payments_due_this_week', s.payments_due_this_week,
        'next_deadline', to_jsonb(s.next_deadline),
        'overdue_deliverables', s.overdue_deliverables,
        'inbound_deals', s.inbound_deals,
        'outbound_deals', s.outbound_deals
    ),
    'deals', COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', r.id,
                'name', COALESCE(NULLIF(left(regexp_replace(btrim(r.deal_name), '[[:cntrl:]]', ' ', 'g'), 160), ''), 'Untitled deal'),
                'status', r.rag_status,
                'reason_code', r.reason_code,
                'reason_label', r.reason_label,
                'relevant_at', to_jsonb(r.relevant_at),
                'next_deadline', to_jsonb(r.next_deadline),
                'stage', r.stage::text,
                'deal_type', r.deal_type::text,
                'direction', r.direction::text,
                'created_at', to_jsonb(r.created_at)
            ) ORDER BY r.status_rank, r.next_deadline NULLS LAST,
                       lower(r.deal_name), r.deal_name, r.id
        ) FROM rows r
    ), '[]'::jsonb)
)
FROM summary s;
$function$;

REVOKE ALL ON FUNCTION public.deal_tracker_snapshot(uuid, timestamptz)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deal_tracker_snapshot(uuid, timestamptz)
    TO service_role;

CREATE OR REPLACE FUNCTION public.get_deal_tracker()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
    SELECT public.deal_tracker_snapshot(auth.uid(), statement_timestamp());
$function$;

REVOKE ALL ON FUNCTION public.get_deal_tracker() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_deal_tracker() TO authenticated;
