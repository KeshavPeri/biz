-- ============================================================
-- 049_monthly_deal_summary.sql
-- Workplan 11.1-B: participant-safe UTC monthly deal summaries
-- Depends on: 048_deal_tracker_projection.sql
-- ============================================================

-- The helper accepts a viewer and clock only so development integration tests can
-- prove exact UTC boundaries. Authenticated clients can execute only the wrapper.
CREATE OR REPLACE FUNCTION public.monthly_deal_summary_snapshot(
    p_viewer uuid,
    p_month date,
    p_as_of timestamptz
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
WITH
request AS (
    SELECT p_as_of AS as_of,
           p_month AS month_start,
           (p_month + interval '1 month')::date AS month_end,
           (p_month = date_trunc('month', p_month)::date) AS valid_month
),
eligible AS (
    SELECT d.*,
           execution.created_at AS executed_at,
           CASE WHEN d.creator_id = p_viewer THEN d.brand_id ELSE d.creator_id END AS counterparty_id,
           CASE WHEN d.creator_id = p_viewer THEN b.company_name ELSE cp.display_name END AS counterparty_name
      FROM public.deals d
      CROSS JOIN request r
      JOIN public.brands b ON b.id = d.brand_id
      JOIN public.profiles cp ON cp.id = d.creator_id
      JOIN LATERAL (
          SELECT dst.created_at
            FROM public.deal_stage_transitions dst
           WHERE dst.deal_id = d.id
             AND dst.from_stage::text = 'approval'
             AND dst.to_stage::text = 'creating'
           ORDER BY dst.created_at, dst.id
           LIMIT 1
      ) execution ON execution.created_at >= r.month_start::timestamp AT TIME ZONE 'UTC'
                 AND execution.created_at < r.month_end::timestamp AT TIME ZONE 'UTC'
     WHERE p_viewer IS NOT NULL
       AND r.valid_month
       AND d.deleted_at IS NULL
       AND d.stage::text IN ('creating', 'posted', 'payment', 'closed')
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
deal_guard AS (
    SELECT 1 / CASE WHEN count(*) <= 500 THEN 1 ELSE 0 END AS ok FROM eligible
),
bounded AS (
    SELECT e.* FROM eligible e CROSS JOIN deal_guard g WHERE g.ok = 1
),
contract_shape AS (
    SELECT e.id AS deal_id,
           count(c.id) FILTER (WHERE c.status::text = 'executed')::integer AS executed_count,
           max(c.version) FILTER (WHERE c.status::text = 'executed') AS executed_version,
           (array_agg(c.generated_from_summary_id ORDER BY c.created_at, c.id)
               FILTER (WHERE c.status::text = 'executed'))[1] AS source_summary_id
      FROM bounded e
      LEFT JOIN public.contracts c ON c.deal_id = e.id
     GROUP BY e.id
),
source_facts AS (
    SELECT e.*,
           cs.executed_count,
           cs.executed_version,
           cs.source_summary_id,
           s.status::text AS summary_status,
           s.structured_terms,
           CASE WHEN s.structured_terms #>> '{payment_amount,status}' = 'found'
                     AND jsonb_typeof(s.structured_terms #> '{payment_amount,value,amount}') = 'number'
                THEN (s.structured_terms #>> '{payment_amount,value,amount}')::numeric
                ELSE NULL END AS contracted,
           CASE WHEN s.structured_terms #>> '{payment_amount,status}' = 'found'
                     AND jsonb_typeof(s.structured_terms #> '{payment_amount,value,currency}') = 'string'
                THEN s.structured_terms #>> '{payment_amount,value,currency}'
                ELSE NULL END AS contract_currency,
           CASE WHEN s.structured_terms #>> '{deliverable_count,status}' = 'found'
                     AND public.payment_tracking_json_integer(s.structured_terms #> '{deliverable_count,value}')
                THEN (s.structured_terms #>> '{deliverable_count,value}')::integer
                ELSE NULL END AS expected_deliverables,
           s.structured_terms #>> '{payment_terms_type,value}' AS terms_type
      FROM bounded e
      JOIN contract_shape cs ON cs.deal_id = e.id
      LEFT JOIN public.ai_summaries s
        ON s.id = cs.source_summary_id AND s.deal_id = e.id
),
deliverable_facts AS (
    SELECT sf.id AS deal_id,
           count(d.id)::integer AS all_count,
           count(d.id) FILTER (WHERE d.source_summary_id = sf.source_summary_id)::integer AS canonical_count
      FROM source_facts sf
      LEFT JOIN public.deliverables d ON d.deal_id = sf.id
     GROUP BY sf.id
),
payment_shape AS (
    SELECT sf.id AS deal_id,
           sf.creator_id,
           count(p.id)::integer AS payment_count,
           (array_agg(p.id ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS payment_id,
           (array_agg(p.source_summary_id ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS payment_source_id,
           (array_agg(p.amount ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS payment_amount,
           (array_agg(p.currency ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS payment_currency,
           (array_agg(p.structure::text ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS structure,
           (array_agg(p.state::text ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS payment_state,
           (array_agg(p.version ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS payment_version,
           (array_agg(p.creator_receipt_version ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS receipt_version,
           (array_agg(p.creator_receipt_confirmed_by ORDER BY p.id) FILTER (WHERE p.id IS NOT NULL))[1] AS receipt_confirmed_by
      FROM source_facts sf
      LEFT JOIN public.payments p ON p.deal_id = sf.id
     GROUP BY sf.id, sf.creator_id
),
milestone_facts AS (
    SELECT ps.deal_id,
           count(m.id)::integer AS milestone_count,
           min(m.sequence) AS first_sequence,
           max(m.sequence) AS last_sequence,
           COALESCE(sum(m.amount), 0::numeric) AS milestone_total,
           COALESCE(sum(m.amount) FILTER (
               WHERE m.state::text = 'paid_full'
                 AND m.creator_receipt_version = m.version
                 AND m.creator_receipt_confirmed_by = ps.creator_id
           ), 0::numeric) AS confirmed_milestones,
           bool_or(m.state::text = 'paid_partial') AS has_partial,
           bool_and(m.amount > 0 AND m.version > 0) AS rows_valid
      FROM payment_shape ps
      LEFT JOIN public.payment_milestones m ON m.payment_id = ps.payment_id
     GROUP BY ps.deal_id, ps.creator_id
),
classified AS (
    SELECT sf.*,
           df.canonical_count,
           ps.payment_count, ps.payment_source_id, ps.payment_amount, ps.payment_currency,
           ps.structure, ps.payment_state, ps.payment_version, ps.receipt_version,
           ps.receipt_confirmed_by,
           mf.milestone_count, mf.first_sequence, mf.last_sequence, mf.milestone_total,
           CASE
               WHEN ps.payment_count = 1 AND ps.structure = 'single'
                    AND ps.payment_state = 'paid_full' AND ps.receipt_version = ps.payment_version
                    AND ps.receipt_confirmed_by = sf.creator_id
                   THEN ps.payment_amount
               WHEN ps.payment_count = 1 AND ps.structure IN ('milestone', 'combination')
                    AND NOT sf.is_disputed AND ps.payment_state <> 'disputed'
                   THEN mf.confirmed_milestones
               ELSE 0::numeric
           END AS confirmed_received,
           CASE WHEN ps.payment_count = 1
                     AND (
                         (ps.structure = 'single' AND ps.payment_state = 'paid_partial')
                         OR (ps.structure IN ('milestone', 'combination') AND COALESCE(mf.has_partial, false))
                     )
                THEN 1 ELSE 0 END AS partial_unquantified_count,
           COALESCE((
               sf.executed_count = 1
               AND sf.executed_version = 1
               AND sf.source_summary_id IS NOT NULL
               AND sf.summary_status = 'approved'
               AND public.payment_tracking_valid_terms_extraction(sf.structured_terms)
               AND sf.contracted > 0
               AND sf.contracted <= 999999999999999999::numeric
               AND sf.contracted * 100 = trunc(sf.contracted * 100)
               AND sf.contract_currency ~ '^[A-Z]{3}$'
               AND sf.expected_deliverables BETWEEN 1 AND 100
               AND df.all_count = df.canonical_count
               AND df.canonical_count = sf.expected_deliverables
               AND (
                   (ps.payment_count = 0 AND sf.stage::text IN ('creating', 'posted'))
                   OR (
                       ps.payment_count = 1
                       AND ps.payment_source_id = sf.source_summary_id
                       AND ps.payment_amount = sf.contracted
                       AND ps.payment_currency = sf.contract_currency
                       AND ps.payment_version > 0
                       AND (
                           (ps.structure = 'single'
                               AND sf.terms_type IN ('upfront', 'on_posting', 'net_x_days')
                               AND mf.milestone_count = 0)
                           OR
                           (ps.structure IN ('milestone', 'combination')
                               AND ps.structure = sf.terms_type
                               AND mf.milestone_count BETWEEN 1 AND 100
                               AND mf.first_sequence = 1
                               AND mf.last_sequence = mf.milestone_count
                               AND mf.milestone_total = sf.contracted
                               AND mf.rows_valid)
                       )
                   )
               )
           ), false) AS valid
      FROM source_facts sf
      JOIN deliverable_facts df ON df.deal_id = sf.id
      JOIN payment_shape ps ON ps.deal_id = sf.id
      JOIN milestone_facts mf ON mf.deal_id = sf.id
),
valid_deals AS (
    SELECT c.*,
           c.contracted - c.confirmed_received AS outstanding
      FROM classified c
     WHERE c.valid IS TRUE
       AND c.confirmed_received >= 0
       AND c.confirmed_received <= c.contracted
),
grouped AS (
    SELECT counterparty_id,
           COALESCE(NULLIF(left(regexp_replace(btrim(counterparty_name), '[[:cntrl:]]', ' ', 'g'), 160), ''), 'Unnamed counterparty') AS counterparty_name,
           contract_currency AS currency,
           sum(contracted) AS contracted,
           sum(confirmed_received) AS confirmed_received,
           sum(outstanding) AS outstanding,
           count(*)::integer AS deal_count,
           sum(canonical_count)::integer AS deliverable_count,
           count(*) FILTER (WHERE direction::text = 'inbound')::integer AS inbound_deals,
           count(*) FILTER (WHERE direction::text = 'outbound')::integer AS outbound_deals,
           sum(partial_unquantified_count)::integer AS partial_unquantified_count
      FROM valid_deals
     GROUP BY counterparty_id, counterparty_name, contract_currency
),
group_guard AS (
    SELECT 1 / CASE WHEN count(*) <= 500 THEN 1 ELSE 0 END AS ok FROM grouped
),
totals AS (
    SELECT currency,
           sum(contracted) AS contracted,
           sum(confirmed_received) AS confirmed_received,
           sum(outstanding) AS outstanding,
           sum(deal_count)::integer AS deal_count,
           sum(deliverable_count)::integer AS deliverable_count,
           sum(inbound_deals)::integer AS inbound_deals,
           sum(outbound_deals)::integer AS outbound_deals,
           sum(partial_unquantified_count)::integer AS partial_unquantified_count
      FROM grouped
     GROUP BY currency
),
attention AS (
    SELECT count(*) FILTER (
        WHERE valid IS NOT TRUE OR confirmed_received < 0 OR confirmed_received > contracted
    )::integer AS count
      FROM classified
)
SELECT jsonb_build_object(
    'version', 1,
    'as_of', to_jsonb(r.as_of),
    'month', to_jsonb(r.month_start),
    'integrity_attention_count', a.count,
    'totals', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'currency', t.currency,
            'contracted', to_char(t.contracted, 'FM9999999999999999990.00'),
            'confirmed_received', to_char(t.confirmed_received, 'FM9999999999999999990.00'),
            'outstanding', to_char(t.outstanding, 'FM9999999999999999990.00'),
            'deal_count', t.deal_count,
            'deliverable_count', t.deliverable_count,
            'inbound_deals', t.inbound_deals,
            'outbound_deals', t.outbound_deals,
            'partial_unquantified_count', t.partial_unquantified_count
        ) ORDER BY t.currency) FROM totals t
    ), '[]'::jsonb),
    'groups', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'counterparty_id', g.counterparty_id,
            'counterparty_name', g.counterparty_name,
            'currency', g.currency,
            'contracted', to_char(g.contracted, 'FM9999999999999999990.00'),
            'confirmed_received', to_char(g.confirmed_received, 'FM9999999999999999990.00'),
            'outstanding', to_char(g.outstanding, 'FM9999999999999999990.00'),
            'deal_count', g.deal_count,
            'deliverable_count', g.deliverable_count,
            'inbound_deals', g.inbound_deals,
            'outbound_deals', g.outbound_deals,
            'partial_unquantified_count', g.partial_unquantified_count
        ) ORDER BY lower(g.counterparty_name), g.counterparty_name, g.counterparty_id, g.currency)
        FROM grouped g CROSS JOIN group_guard gg WHERE gg.ok = 1
    ), '[]'::jsonb)
)
FROM request r CROSS JOIN attention a CROSS JOIN group_guard gg
WHERE r.valid_month AND gg.ok = 1;
$function$;

REVOKE ALL ON FUNCTION public.monthly_deal_summary_snapshot(uuid, date, timestamptz)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.monthly_deal_summary_snapshot(uuid, date, timestamptz)
    TO service_role;

CREATE OR REPLACE FUNCTION public.get_monthly_deal_summary(p_month date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_as_of timestamptz := statement_timestamp();
    v_month date := COALESCE(p_month, date_trunc('month', v_as_of AT TIME ZONE 'UTC')::date);
BEGIN
    IF v_month <> date_trunc('month', v_month)::date THEN
        RAISE EXCEPTION 'MONTHLY_SUMMARY_INVALID_MONTH';
    END IF;
    RETURN public.monthly_deal_summary_snapshot(auth.uid(), v_month, v_as_of);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_monthly_deal_summary(date)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_monthly_deal_summary(date) TO authenticated;
