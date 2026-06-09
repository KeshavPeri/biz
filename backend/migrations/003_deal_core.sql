-- ============================================================
-- 003_deal_core.sql
-- Domain 2: Deal Core (7 tables)
-- Depends on: 002_identity_profile.sql
-- ============================================================

-- ── deals ─────────────────────────────────────────────────────
-- Central entity. Created when someone taps Connect.
-- RESTRICT on creator_id/brand_id/created_by: deleting a profile or brand
-- that has deals is a data-integrity violation; resolve the deal first.

CREATE TABLE deals (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    brand_id    uuid NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
    deal_name   text NOT NULL,
    deal_type   deal_type_enum NOT NULL DEFAULT 'campaign',
    stage       deal_stage_enum NOT NULL DEFAULT 'pending',
    is_disputed bool NOT NULL DEFAULT false,
    direction   deal_direction_enum NOT NULL,
    currency    text NOT NULL DEFAULT 'INR',
    expires_at  timestamptz,
    created_by  uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

-- ── deal_participants ─────────────────────────────────────────
-- THE RLS ANCHOR. A user can see a deal iff they have a row here.
-- participant_role is the operative hat for this specific deal
-- (brand_maker/brand_checker are per-deal, not permanent brand roles).

CREATE TABLE deal_participants (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id          uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    profile_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    participant_role participant_role_enum NOT NULL,
    last_read_at     timestamptz,
    joined_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (deal_id, profile_id)
);

-- ── deal_stage_transitions ────────────────────────────────────
-- Append-only audit log of every stage change.
-- from_stage is nullable for the first transition (deal creation).

CREATE TABLE deal_stage_transitions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id         uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    from_stage      deal_stage_enum,
    to_stage        deal_stage_enum NOT NULL,
    transition_type transition_type_enum NOT NULL,
    triggered_by    uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── participant_add_requests ──────────────────────────────────
-- Adding a participant mid-flow requires approval from existing participants.

CREATE TABLE participant_add_requests (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id             uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    proposed_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    requested_by        uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    reason              text NOT NULL,
    status              participant_request_status_enum NOT NULL DEFAULT 'pending',
    approvals           jsonb NOT NULL DEFAULT '{}',
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- ── messages ─────────────────────────────────────────────────
-- Chat messages within a deal. body is nullable for attachment-only messages.

CREATE TABLE messages (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id    uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    sender_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    body       text,
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

-- ── message_attachments ───────────────────────────────────────

CREATE TABLE message_attachments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id   uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    storage_path text NOT NULL,
    file_name    text NOT NULL,
    file_type    text NOT NULL,
    file_size    int NOT NULL
);

-- ── deliverables ─────────────────────────────────────────────

CREATE TABLE deliverables (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id              uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    sequence             int NOT NULL DEFAULT 1,
    content_format       content_format_enum NOT NULL,
    platform             platform_enum NOT NULL,
    posting_date         date,
    posting_window_start date,
    posting_window_end   date,
    location             text,
    revision_max         int NOT NULL DEFAULT 2,
    revision_current     int NOT NULL DEFAULT 0,
    approved_content_url text,
    live_post_url        text,
    post_metadata        jsonb,
    status               deliverable_status_enum NOT NULL DEFAULT 'pending',
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
