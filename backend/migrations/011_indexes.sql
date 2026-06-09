-- ============================================================
-- 011_indexes.sql
-- All indexes: FK indexes, hot-path query indexes, partial indexes.
-- Depends on: all table files (002–010).
--
-- Note: UNIQUE constraint columns already have implicit indexes.
-- e.g. deal_participants(deal_id, profile_id), brand_members(brand_id, profile_id),
-- deal_terms(deal_id), deal_payment_details(deal_id), creator_profiles(profile_id),
-- notification_preferences(profile_id, category) — not duplicated here.
-- ============================================================

-- ── profiles ─────────────────────────────────────────────────
CREATE INDEX idx_profiles_account_type ON profiles(account_type);
CREATE INDEX idx_profiles_email ON profiles(email);

-- ── brands ───────────────────────────────────────────────────
CREATE INDEX idx_brands_verified ON brands(verified) WHERE verified = true;

-- ── brand_members ─────────────────────────────────────────────
CREATE INDEX idx_brand_members_brand_id ON brand_members(brand_id);
CREATE INDEX idx_brand_members_profile_id ON brand_members(profile_id);

-- ── social_handles ───────────────────────────────────────────
CREATE INDEX idx_social_handles_creator_id ON social_handles(creator_id);
CREATE INDEX idx_social_handles_platform ON social_handles(platform);

-- ── signatures ───────────────────────────────────────────────
-- Partial unique: only one active signature allowed per profile at a time.
CREATE UNIQUE INDEX idx_signatures_active_per_profile
    ON signatures(profile_id)
    WHERE is_active = true;

CREATE INDEX idx_signatures_profile_id ON signatures(profile_id);

-- ── rate_cards ────────────────────────────────────────────────
CREATE INDEX idx_rate_cards_creator_id ON rate_cards(creator_id);
-- Brand discovery: only query enabled rate cards
CREATE INDEX idx_rate_cards_enabled
    ON rate_cards(creator_id)
    WHERE is_enabled = true;

-- ── rate_card_items ───────────────────────────────────────────
CREATE INDEX idx_rate_card_items_rate_card_id ON rate_card_items(rate_card_id);

-- ── affiliations ─────────────────────────────────────────────
CREATE INDEX idx_affiliations_creator_id ON affiliations(creator_id);

-- ── brand_partnerships ────────────────────────────────────────
CREATE INDEX idx_brand_partnerships_creator_id ON brand_partnerships(creator_id);

-- ── deals ─────────────────────────────────────────────────────
CREATE INDEX idx_deals_creator_id ON deals(creator_id);
CREATE INDEX idx_deals_brand_id ON deals(brand_id);
CREATE INDEX idx_deals_stage ON deals(stage);
CREATE INDEX idx_deals_created_by ON deals(created_by);
-- Soft-delete-aware composite for the most common list query
CREATE INDEX idx_deals_active
    ON deals(creator_id, brand_id, stage)
    WHERE deleted_at IS NULL;

-- ── deal_participants ─────────────────────────────────────────
-- THE RLS ANCHOR — most-queried table in the system.
-- (deal_id, profile_id) UNIQUE constraint already provides the primary lookup index.
CREATE INDEX idx_deal_participants_deal_id ON deal_participants(deal_id);
CREATE INDEX idx_deal_participants_profile_id ON deal_participants(profile_id);

-- ── deal_stage_transitions ────────────────────────────────────
CREATE INDEX idx_deal_stage_transitions_deal_id ON deal_stage_transitions(deal_id);
CREATE INDEX idx_deal_stage_transitions_triggered_by ON deal_stage_transitions(triggered_by);
-- Timeline view: deal history ordered by time
CREATE INDEX idx_deal_stage_transitions_deal_id_created_at
    ON deal_stage_transitions(deal_id, created_at);

-- ── participant_add_requests ──────────────────────────────────
CREATE INDEX idx_participant_add_requests_deal_id ON participant_add_requests(deal_id);
CREATE INDEX idx_participant_add_requests_proposed_profile
    ON participant_add_requests(proposed_profile_id);

-- ── messages ─────────────────────────────────────────────────
-- Compound index for ordered chat fetch — the primary access pattern
CREATE INDEX idx_messages_deal_id_created_at
    ON messages(deal_id, created_at DESC);
-- Exclude soft-deleted messages from chat queries
CREATE INDEX idx_messages_active
    ON messages(deal_id, created_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_messages_sender_id ON messages(sender_id);

-- ── message_attachments ───────────────────────────────────────
CREATE INDEX idx_message_attachments_message_id ON message_attachments(message_id);

-- ── deliverables ─────────────────────────────────────────────
CREATE INDEX idx_deliverables_deal_id ON deliverables(deal_id);
CREATE INDEX idx_deliverables_status ON deliverables(deal_id, status);
-- Calendar query: upcoming posting dates across all deals
CREATE INDEX idx_deliverables_posting_date
    ON deliverables(posting_date)
    WHERE posting_date IS NOT NULL;

-- ── deal_terms ────────────────────────────────────────────────
-- deal_id already covered by UNIQUE constraint index
CREATE INDEX idx_deal_terms_deal_id ON deal_terms(deal_id);

-- ── ai_summaries ─────────────────────────────────────────────
CREATE INDEX idx_ai_summaries_deal_id ON ai_summaries(deal_id);
CREATE INDEX idx_ai_summaries_deal_status ON ai_summaries(deal_id, status);

-- ── contracts ────────────────────────────────────────────────
CREATE INDEX idx_contracts_deal_id ON contracts(deal_id);
CREATE INDEX idx_contracts_summary_id ON contracts(generated_from_summary_id);

-- ── extracted_terms ──────────────────────────────────────────
CREATE INDEX idx_extracted_terms_deal_id ON extracted_terms(deal_id);
CREATE INDEX idx_extracted_terms_contract_id ON extracted_terms(contract_id);

-- ── term_approvals ────────────────────────────────────────────
CREATE INDEX idx_term_approvals_summary_id ON term_approvals(summary_id);
CREATE INDEX idx_term_approvals_profile_id ON term_approvals(profile_id);

-- ── contract_signatures ───────────────────────────────────────
CREATE INDEX idx_contract_signatures_contract_id ON contract_signatures(contract_id);
CREATE INDEX idx_contract_signatures_signer_id ON contract_signatures(signer_id);

-- ── briefs ───────────────────────────────────────────────────
CREATE INDEX idx_briefs_deal_id ON briefs(deal_id);

-- ── revisions ────────────────────────────────────────────────
CREATE INDEX idx_revisions_deliverable_id ON revisions(deliverable_id);

-- ── exclusivity_clauses ───────────────────────────────────────
CREATE INDEX idx_exclusivity_clauses_deal_id ON exclusivity_clauses(deal_id);
-- Rights tracker expiry query
CREATE INDEX idx_exclusivity_end_date
    ON exclusivity_clauses(end_date)
    WHERE end_date IS NOT NULL;

-- ── usage_rights ─────────────────────────────────────────────
CREATE INDEX idx_usage_rights_deal_id ON usage_rights(deal_id);
CREATE INDEX idx_usage_rights_end_date
    ON usage_rights(end_date)
    WHERE end_date IS NOT NULL;

-- ── whitelisting_arrangements ─────────────────────────────────
CREATE INDEX idx_whitelisting_arrangements_deal_id ON whitelisting_arrangements(deal_id);
CREATE INDEX idx_whitelisting_end_date
    ON whitelisting_arrangements(end_date)
    WHERE end_date IS NOT NULL;

-- ── blackout_windows ─────────────────────────────────────────
CREATE INDEX idx_blackout_windows_deal_id ON blackout_windows(deal_id);
CREATE INDEX idx_blackout_end_date
    ON blackout_windows(end_date)
    WHERE end_date IS NOT NULL;

-- ── disclosure_requirements ───────────────────────────────────
CREATE INDEX idx_disclosure_requirements_deal_id ON disclosure_requirements(deal_id);
CREATE INDEX idx_disclosure_requirements_deliverable_id
    ON disclosure_requirements(deliverable_id)
    WHERE deliverable_id IS NOT NULL;

-- ── payments ─────────────────────────────────────────────────
CREATE INDEX idx_payments_deal_id ON payments(deal_id);
-- Payment reminder query: upcoming + overdue
CREATE INDEX idx_payments_state_due ON payments(state, due_date);
CREATE INDEX idx_payments_due_date
    ON payments(due_date)
    WHERE due_date IS NOT NULL;

-- ── payment_milestones ────────────────────────────────────────
CREATE INDEX idx_payment_milestones_payment_id ON payment_milestones(payment_id);
CREATE INDEX idx_payment_milestones_deliverable_id
    ON payment_milestones(deliverable_id)
    WHERE deliverable_id IS NOT NULL;

-- ── deal_payment_details ──────────────────────────────────────
-- deal_id already covered by UNIQUE constraint index
CREATE INDEX idx_deal_payment_details_deal_id ON deal_payment_details(deal_id);

-- ── disputes ─────────────────────────────────────────────────
CREATE INDEX idx_disputes_deal_id ON disputes(deal_id);
CREATE INDEX idx_disputes_raised_by ON disputes(raised_by);
CREATE INDEX idx_disputes_open ON disputes(deal_id) WHERE status = 'open';

-- ── ratings ──────────────────────────────────────────────────
CREATE INDEX idx_ratings_deal_id ON ratings(deal_id);
CREATE INDEX idx_ratings_rater_id ON ratings(rater_id);
CREATE INDEX idx_ratings_ratee_profile_id
    ON ratings(ratee_profile_id)
    WHERE ratee_profile_id IS NOT NULL;
CREATE INDEX idx_ratings_ratee_brand_id
    ON ratings(ratee_brand_id)
    WHERE ratee_brand_id IS NOT NULL;

-- ── deal_comments ─────────────────────────────────────────────
CREATE INDEX idx_deal_comments_deal_id ON deal_comments(deal_id);
CREATE INDEX idx_deal_comments_author_id ON deal_comments(author_id);

-- ── maker_checker_config ──────────────────────────────────────
CREATE INDEX idx_maker_checker_config_brand_id ON maker_checker_config(brand_id);

-- ── maker_checker_requests ────────────────────────────────────
CREATE INDEX idx_maker_checker_requests_deal_id ON maker_checker_requests(deal_id);
CREATE INDEX idx_maker_checker_requests_initiated_by
    ON maker_checker_requests(initiated_by);
CREATE INDEX idx_maker_checker_requests_checker_id
    ON maker_checker_requests(checker_id);
-- Action inbox: pending items waiting for a specific checker
CREATE INDEX idx_maker_checker_requests_pending
    ON maker_checker_requests(checker_id, status)
    WHERE status = 'pending';

-- ── private_annotations ───────────────────────────────────────
CREATE INDEX idx_private_annotations_profile_id ON private_annotations(profile_id);
-- Polymorphic lookup: find annotations for a specific entity
CREATE INDEX idx_private_annotations_entity
    ON private_annotations(entity_type, entity_id);

-- ── notifications ─────────────────────────────────────────────
CREATE INDEX idx_notifications_profile_id ON notifications(profile_id);
-- Unread badge count — the hottest notification query
CREATE INDEX idx_notifications_unread
    ON notifications(profile_id, created_at DESC)
    WHERE read = false;
-- 90-day auto-clear: find old notifications for deletion
CREATE INDEX idx_notifications_created_at ON notifications(created_at);
CREATE INDEX idx_notifications_deal_id
    ON notifications(deal_id)
    WHERE deal_id IS NOT NULL;

-- ── notification_preferences ─────────────────────────────────
-- (profile_id, category) already covered by UNIQUE constraint index
CREATE INDEX idx_notification_preferences_profile_id
    ON notification_preferences(profile_id);

-- ── audit_log ─────────────────────────────────────────────────
CREATE INDEX idx_audit_log_actor_id ON audit_log(actor_id);
-- Entity lookup: find all audit events for a specific record
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);
