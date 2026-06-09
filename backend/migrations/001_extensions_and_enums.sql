-- ============================================================
-- 001_extensions_and_enums.sql
-- Extensions and all custom enum types used across the schema.
-- Run this first — every subsequent file depends on these types.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Identity & Profile ────────────────────────────────────────

CREATE TYPE account_type_enum AS ENUM ('creator', 'brand');

-- Shared across social_handles, rate_card_items, brand_partnerships,
-- deliverables, whitelisting_arrangements, disclosure_requirements
CREATE TYPE platform_enum AS ENUM (
    'instagram', 'tiktok', 'youtube', 'linkedin',
    'x', 'pinterest', 'threads', 'podcast'
);

-- Shared across rate_card_items and deliverables
CREATE TYPE content_format_enum AS ENUM (
    'reel', 'static_post', 'story', 'carousel',
    'yt_video', 'yt_short', 'blog', 'ugc_photo',
    'podcast_read', 'x_thread', 'linkedin_post', 'pinterest_pin'
);

CREATE TYPE verification_status_enum AS ENUM ('pending', 'verified');

CREATE TYPE signature_type_enum AS ENUM ('drawn', 'typed');

CREATE TYPE brand_role_enum AS ENUM ('admin', 'member');

CREATE TYPE brand_member_status_enum AS ENUM ('invited', 'active');

CREATE TYPE affiliation_type_enum AS ENUM ('show', 'award', 'press', 'podcast');

-- ── Deal Core ─────────────────────────────────────────────────

CREATE TYPE deal_type_enum AS ENUM ('campaign', 'product', 'experience');

CREATE TYPE deal_stage_enum AS ENUM (
    'pending', 'chatting', 'approval', 'creating',
    'posted', 'payment', 'closed', 'declined', 'cancelled'
);

CREATE TYPE deal_direction_enum AS ENUM ('inbound', 'outbound');

CREATE TYPE participant_role_enum AS ENUM (
    'creator', 'brand_admin', 'brand_maker', 'brand_checker'
);

CREATE TYPE transition_type_enum AS ENUM ('auto', 'gated');

CREATE TYPE participant_request_status_enum AS ENUM ('pending', 'approved', 'rejected');

CREATE TYPE deliverable_status_enum AS ENUM (
    'pending', 'submitted', 'in_revision', 'approved', 'posted'
);

-- ── Terms & Contracts ─────────────────────────────────────────

CREATE TYPE payment_terms_type_enum AS ENUM (
    'upfront', 'on_posting', 'net_x_days', 'milestone', 'combination'
);

CREATE TYPE payment_from_date_basis_enum AS ENUM ('invoice_date', 'posting_date');

CREATE TYPE content_ownership_enum AS ENUM ('creator', 'brand');

CREATE TYPE ai_summary_status_enum AS ENUM (
    'pending_approval', 'approved', 'issue_raised'
);

CREATE TYPE term_approval_decision_enum AS ENUM ('approved', 'issue_raised');

CREATE TYPE contract_status_enum AS ENUM (
    'draft', 'awaiting_signatures', 'executed'
);

CREATE TYPE signature_mode_enum AS ENUM ('stored', 'drawn', 'print_bypass');

CREATE TYPE revision_decision_enum AS ENUM ('approved', 'revision_requested');

-- ── Rights ────────────────────────────────────────────────────

CREATE TYPE blackout_timing_enum AS ENUM ('before', 'after', 'both');

-- ── Payments ─────────────────────────────────────────────────

CREATE TYPE payment_structure_enum AS ENUM ('single', 'milestone', 'combination');

-- Shared across payments.state and payment_milestones.state
CREATE TYPE payment_state_enum AS ENUM (
    'paid_full', 'paid_partial', 'not_paid_in_window',
    'not_paid_delayed', 'bad_debt', 'disputed', 'refunded'
);

-- ── Deal Outcomes ─────────────────────────────────────────────

CREATE TYPE dispute_status_enum AS ENUM ('open', 'resolved');

CREATE TYPE deal_comment_visibility_enum AS ENUM ('shared', 'private');

-- ── Maker-Checker ─────────────────────────────────────────────

CREATE TYPE maker_checker_action_type_enum AS ENUM (
    'payment_release', 'contract_signing', 'content_approval'
);

CREATE TYPE maker_checker_status_enum AS ENUM ('pending', 'approved', 'rejected');

-- ── Private Annotations ───────────────────────────────────────

CREATE TYPE annotation_entity_type_enum AS ENUM ('deal', 'deliverable');

-- ── Notifications ─────────────────────────────────────────────

CREATE TYPE notification_tier_enum AS ENUM (
    'critical', 'important', 'informational'
);
