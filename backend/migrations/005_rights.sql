-- ============================================================
-- 005_rights.sql
-- Domain 4: Rights (5 tables)
-- Depends on: 003_deal_core.sql
--
-- All tables auto-populated from AI contract parser.
-- status (active/expiring/expired) is derived from end_date vs today,
-- not stored — compute in queries.
-- ============================================================

-- ── exclusivity_clauses ───────────────────────────────────────

CREATE TABLE exclusivity_clauses (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id         uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    has_exclusivity bool NOT NULL,
    category        text,
    duration_days   int,
    start_date      date,
    end_date        date
);

-- ── usage_rights ─────────────────────────────────────────────

CREATE TABLE usage_rights (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id          uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    has_usage_rights bool NOT NULL,
    channels         text[],
    duration_days    int,
    is_perpetual     bool NOT NULL DEFAULT false,
    start_date       date,
    end_date         date
);

-- ── whitelisting_arrangements ─────────────────────────────────

CREATE TABLE whitelisting_arrangements (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id          uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    has_whitelisting bool NOT NULL,
    platform         platform_enum,
    ad_account       text,
    budget           numeric,
    start_date       date,
    end_date         date
);

-- ── blackout_windows ─────────────────────────────────────────

CREATE TABLE blackout_windows (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id       uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    has_blackout  bool NOT NULL,
    timing        blackout_timing_enum,
    duration_days int,
    start_date    date,
    end_date      date
);

-- ── disclosure_requirements ───────────────────────────────────
-- Can be deal-wide or per-deliverable (deliverable_id nullable).

CREATE TABLE disclosure_requirements (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id        uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    deliverable_id uuid REFERENCES deliverables(id) ON DELETE CASCADE,
    platform       platform_enum NOT NULL,
    required       bool NOT NULL,
    rule_note      text NOT NULL
);
