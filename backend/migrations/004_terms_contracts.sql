-- ============================================================
-- 004_terms_contracts.sql
-- Domain 3: Terms & Contracts (8 tables)
-- Depends on: 003_deal_core.sql
--
-- No circular dependency. Dependency chain is linear:
--   ai_summaries → contracts → extracted_terms
-- Create in that order; no DEFERRABLE constraints needed.
-- ============================================================

-- ── deal_terms ────────────────────────────────────────────────
-- Canonical confirmed terms (1:1 with deal). Trackers and app read this.

CREATE TABLE deal_terms (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id                 uuid NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
    payment_amount          numeric NOT NULL,
    currency                text NOT NULL DEFAULT 'INR',
    payment_terms_type      payment_terms_type_enum NOT NULL,
    payment_net_days        int,
    payment_from_date_basis payment_from_date_basis_enum,
    revision_rounds_max     int NOT NULL DEFAULT 2,
    content_ownership       content_ownership_enum NOT NULL DEFAULT 'creator',
    deliverable_count       int NOT NULL DEFAULT 1,
    disclosure_required     bool NOT NULL DEFAULT false,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ── ai_summaries ─────────────────────────────────────────────
-- AI summary generated from chat; both parties must approve before contract.

CREATE TABLE ai_summaries (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id          uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    raw_output       jsonb NOT NULL,
    structured_terms jsonb NOT NULL,
    status           ai_summary_status_enum NOT NULL DEFAULT 'pending_approval',
    generated_at     timestamptz NOT NULL DEFAULT now()
);

-- ── contracts ─────────────────────────────────────────────────
-- Platform-generated PDF contract. References ai_summaries (exists above).

CREATE TABLE contracts (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id                   uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    version                   int NOT NULL DEFAULT 1,
    storage_path              text NOT NULL,
    generated_from_summary_id uuid NOT NULL REFERENCES ai_summaries(id) ON DELETE RESTRICT,
    status                    contract_status_enum NOT NULL DEFAULT 'draft',
    created_at                timestamptz NOT NULL DEFAULT now()
);

-- ── extracted_terms ───────────────────────────────────────────
-- AI extraction from the final contract; compared against ai_summaries for conflicts.
-- References contracts (exists above) — no circular dependency.

CREATE TABLE extracted_terms (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id            uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    contract_id        uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    raw_output         jsonb NOT NULL,
    structured_terms   jsonb NOT NULL,
    conflicts_detected jsonb,
    confirmed_by_both  bool NOT NULL DEFAULT false,
    extracted_at       timestamptz NOT NULL DEFAULT now()
);

-- ── term_approvals ────────────────────────────────────────────
-- Per-participant decision on the AI summary (all-party sign-off gate).

CREATE TABLE term_approvals (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    summary_id uuid NOT NULL REFERENCES ai_summaries(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    decision   term_approval_decision_enum NOT NULL,
    comment    text,
    decided_at timestamptz NOT NULL DEFAULT now()
);

-- ── contract_signatures ───────────────────────────────────────
-- Append-only signing record. on_behalf_of_brand_id SET NULL if brand is removed
-- so the historical signature record is preserved.

CREATE TABLE contract_signatures (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id           uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    signer_id             uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    on_behalf_of_brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
    signature_mode        signature_mode_enum NOT NULL,
    signature_ref         text NOT NULL,
    bypass_reason         text,
    physical_doc_path     text,
    signed_at             timestamptz NOT NULL DEFAULT now(),
    ip_address            text NOT NULL
);

-- ── briefs ────────────────────────────────────────────────────

CREATE TABLE briefs (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id                 uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    version                 int NOT NULL DEFAULT 1,
    content                 jsonb NOT NULL,
    acknowledged_by_creator bool NOT NULL DEFAULT false,
    created_at              timestamptz NOT NULL DEFAULT now()
);

-- ── revisions ─────────────────────────────────────────────────

CREATE TABLE revisions (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deliverable_id        uuid NOT NULL REFERENCES deliverables(id) ON DELETE CASCADE,
    round_number          int NOT NULL,
    submitted_content_url text NOT NULL,
    decision              revision_decision_enum NOT NULL,
    comment               text,
    created_at            timestamptz NOT NULL DEFAULT now()
);
