-- ============================================================
-- 008_maker_checker.sql
-- Domain 7: Maker-Checker (2 tables)
-- Depends on: 002_identity_profile.sql, 003_deal_core.sql
-- ============================================================

-- ── maker_checker_config ──────────────────────────────────────
-- Per-brand configuration: which actions require Checker sign-off.
-- escalation_contact SET NULL if that profile is removed.

CREATE TABLE maker_checker_config (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id           uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    action_type        maker_checker_action_type_enum NOT NULL,
    requires_checker   bool NOT NULL DEFAULT false,
    escalation_contact uuid REFERENCES profiles(id) ON DELETE SET NULL
);

-- ── maker_checker_requests ────────────────────────────────────
-- A pending approval intercepted at runtime.
-- Both initiated_by and checker_id RESTRICT — participants must be
-- resolved before their request records can be removed.

CREATE TABLE maker_checker_requests (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id      uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    action_type  maker_checker_action_type_enum NOT NULL,
    initiated_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    checker_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    status       maker_checker_status_enum NOT NULL DEFAULT 'pending',
    comment      text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    decided_at   timestamptz
);
