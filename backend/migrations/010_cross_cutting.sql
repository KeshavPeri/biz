-- ============================================================
-- 010_cross_cutting.sql
-- Domain 9: Cross-cutting (3 tables + audit immutability trigger)
-- Depends on: 002_identity_profile.sql, 003_deal_core.sql
-- ============================================================

-- ── notifications ─────────────────────────────────────────────
-- deal_id SET NULL so the notification survives if the deal is soft-deleted.
-- 90-day auto-clear is handled by a scheduled job querying created_at.

CREATE TABLE notifications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    tier       notification_tier_enum NOT NULL,
    title      text NOT NULL,
    body       text NOT NULL,
    deal_id    uuid REFERENCES deals(id) ON DELETE SET NULL,
    read       bool NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ── notification_preferences ─────────────────────────────────
-- One row per (profile_id, category). UNIQUE on (profile_id, category)
-- not on profile_id alone — a profile has one row per notification category.

CREATE TABLE notification_preferences (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    category          text NOT NULL,
    channel_in_app    bool NOT NULL DEFAULT true,
    channel_email     bool NOT NULL DEFAULT true,
    quiet_hours_start time,
    quiet_hours_end   time,
    UNIQUE (profile_id, category)
);

-- ── audit_log ─────────────────────────────────────────────────
-- Immutable append-only log. actor_id RESTRICT so audit records are
-- never silently orphaned if a profile is removed.
-- INSERT is via service_role (backend only). RLS in 012 blocks all reads
-- by authenticated users — admin/ops access requires service_role.

CREATE TABLE audit_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    action      text NOT NULL,
    entity_type text NOT NULL,
    entity_id   uuid NOT NULL,
    metadata    jsonb,
    ip_address  text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Immutability: raise an exception on any UPDATE or DELETE attempt.
-- Using a trigger (not RULES) so callers get a clear error, not silent failure.

CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is immutable — updates and deletes are not permitted';
END;
$$;

CREATE TRIGGER audit_log_immutable
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_modification();
