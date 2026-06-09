-- ============================================================
-- 009_private_annotations.sql
-- Domain 8: Private Annotations (1 table)
-- Depends on: 002_identity_profile.sql
-- ============================================================

-- ── private_annotations ───────────────────────────────────────
-- Per-user private labels on deals or deliverables.
-- RLS: only the owning profile_id can see their own rows —
-- even other participants on the same deal cannot see these.
--
-- entity_id is a polymorphic reference (points to deals.id or
-- deliverables.id based on entity_type). Postgres does not support
-- polymorphic FKs natively — no FK constraint on entity_id.
-- The application resolves the target table from entity_type.

CREATE TABLE private_annotations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    entity_type annotation_entity_type_enum NOT NULL,
    entity_id   uuid NOT NULL,
    label       text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
