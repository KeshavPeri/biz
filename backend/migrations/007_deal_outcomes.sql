-- ============================================================
-- 007_deal_outcomes.sql
-- Domain 6: Deal Outcomes (3 tables)
-- Depends on: 003_deal_core.sql, 002_identity_profile.sql
-- ============================================================

-- ── disputes ─────────────────────────────────────────────────
-- Overlay on the Payment stage (is_disputed flag on deals), not a separate stage.

CREATE TABLE disputes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id         uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    raised_by       uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    description     text NOT NULL,
    evidence        jsonb,
    status          dispute_status_enum NOT NULL DEFAULT 'open',
    resolution_note text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    resolved_at     timestamptz
);

-- ── ratings ───────────────────────────────────────────────────
-- Mutual ratings on deal close. Exactly one of ratee_profile_id or
-- ratee_brand_id must be set (enforced by CHECK constraint below).

CREATE TABLE ratings (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id          uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    rater_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    ratee_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
    ratee_brand_id   uuid REFERENCES brands(id) ON DELETE SET NULL,
    score            int NOT NULL CHECK (score >= 1 AND score <= 5),
    review           text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ratings_ratee_check CHECK (
        (ratee_profile_id IS NOT NULL AND ratee_brand_id IS NULL) OR
        (ratee_profile_id IS NULL     AND ratee_brand_id IS NOT NULL)
    )
);

-- ── deal_comments ─────────────────────────────────────────────
-- Post-close shared comments and private notes.

CREATE TABLE deal_comments (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id    uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    author_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    body       text NOT NULL,
    visibility deal_comment_visibility_enum NOT NULL DEFAULT 'shared',
    created_at timestamptz NOT NULL DEFAULT now()
);
