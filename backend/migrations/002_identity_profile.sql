-- ============================================================
-- 002_identity_profile.sql
-- Domain 1: Identity & Profile (10 tables)
-- Depends on: 001_extensions_and_enums.sql, auth.users (Supabase managed)
-- ============================================================

-- ── profiles ─────────────────────────────────────────────────
-- 1:1 extension of auth.users. id = auth.users.id (not generated).

CREATE TABLE profiles (
    id                   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    account_type         account_type_enum NOT NULL,
    display_name         text NOT NULL,
    email                text NOT NULL,
    phone                text,
    city                 text,
    avatar_url           text,
    profile_completeness int NOT NULL DEFAULT 0,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── brands ────────────────────────────────────────────────────
-- Organisation entity — not a user; brand users are linked via brand_members.

CREATE TABLE brands (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name         text NOT NULL,
    industry             text,
    company_id_gst       text,
    domain               text,
    verified             bool NOT NULL DEFAULT false,
    trust_rating         numeric,
    deal_completion_rate numeric,
    profile_attributes   jsonb,
    created_at           timestamptz NOT NULL DEFAULT now()
);

-- ── brand_members ─────────────────────────────────────────────
-- Links a profile to a brand. brand_role is brand standing (admin/member).
-- Operative maker/checker hat is per-deal on deal_participants.

CREATE TABLE brand_members (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id   uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    brand_role brand_role_enum NOT NULL DEFAULT 'member',
    status     brand_member_status_enum NOT NULL DEFAULT 'invited',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (brand_id, profile_id)
);

-- ── creator_profiles ─────────────────────────────────────────
-- Creator-specific fields. 1:1 with profiles where account_type = creator.

CREATE TABLE creator_profiles (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id           uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    niche                text,
    content_category     text,
    bio                  text,
    content_languages    text[],
    photo_carousel       jsonb,
    inbound_enabled      bool NOT NULL DEFAULT true,
    outbound_enabled     bool NOT NULL DEFAULT true,
    trust_score          numeric,
    deal_completion_rate numeric,
    response_time_hours  numeric,
    privacy_settings     jsonb
);

-- ── social_handles ────────────────────────────────────────────
-- Mock stats for MVP (no live social API calls).

CREATE TABLE social_handles (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id          uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
    platform            platform_enum NOT NULL,
    handle              text NOT NULL,
    follower_count      int,
    engagement_rate     numeric,
    weekly_reach        int,
    is_primary          bool NOT NULL DEFAULT false,
    verification_status verification_status_enum NOT NULL DEFAULT 'pending'
);

-- ── signatures ───────────────────────────────────────────────
-- Stored digital signatures reused for one-tap signing.
-- Only one can be active at a time — enforced by partial unique index in 011.

CREATE TABLE signatures (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    signature_data text NOT NULL,
    signature_type signature_type_enum NOT NULL,
    is_active      bool NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── rate_cards ────────────────────────────────────────────────

CREATE TABLE rate_cards (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
    is_enabled bool NOT NULL DEFAULT false
);

-- ── rate_card_items ───────────────────────────────────────────

CREATE TABLE rate_card_items (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rate_card_id   uuid NOT NULL REFERENCES rate_cards(id) ON DELETE CASCADE,
    platform       platform_enum NOT NULL,
    content_format content_format_enum NOT NULL,
    base_price     numeric NOT NULL,
    currency       text NOT NULL DEFAULT 'INR',
    title          text NOT NULL,
    description    text,
    add_ons        jsonb
);

-- ── affiliations ─────────────────────────────────────────────

CREATE TABLE affiliations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id  uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
    type        affiliation_type_enum NOT NULL,
    name        text NOT NULL,
    year        int,
    description text
);

-- ── brand_partnerships ────────────────────────────────────────
-- Self-declared previous partnerships; feeds trust scoring.

CREATE TABLE brand_partnerships (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id  uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
    brand_name  text NOT NULL,
    platform    platform_enum,
    views_reach int,
    year        int,
    description text
);
