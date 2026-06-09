-- ============================================================
-- 006_payments.sql
-- Domain 5: Payments — tracking only (3 tables)
-- Depends on: 003_deal_core.sql
--
-- No real money movement, no payment gateway, no auto-release.
-- Status tracking + reminders only (MVP scope).
-- ============================================================

-- ── payments ─────────────────────────────────────────────────

CREATE TABLE payments (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id    uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    amount     numeric NOT NULL,
    currency   text NOT NULL DEFAULT 'INR',
    structure  payment_structure_enum NOT NULL DEFAULT 'single',
    state      payment_state_enum NOT NULL DEFAULT 'not_paid_in_window',
    due_date   date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── payment_milestones ────────────────────────────────────────
-- deliverable_id is SET NULL (not CASCADE) so a milestone survives
-- if a deliverable row is removed without dropping the payment record.

CREATE TABLE payment_milestones (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id          uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    deliverable_id      uuid REFERENCES deliverables(id) ON DELETE SET NULL,
    trigger_description text NOT NULL,
    amount              numeric NOT NULL,
    due_date            date NOT NULL,
    state               payment_state_enum NOT NULL DEFAULT 'not_paid_in_window'
);

-- ── deal_payment_details ──────────────────────────────────────
-- Captured before Payment stage activates. 1:1 with deals.
-- Stores invoicing info for both sides; no invoice generated in MVP.

CREATE TABLE deal_payment_details (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id               uuid NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
    creator_legal_name    text NOT NULL,
    creator_bank_or_upi   text NOT NULL,
    creator_tax_id        text,
    brand_billing_name    text NOT NULL,
    brand_billing_address text NOT NULL,
    brand_gst             text,
    created_at            timestamptz NOT NULL DEFAULT now()
);
