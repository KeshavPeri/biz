-- ============================================================
-- 012_rls.sql
-- Row Level Security: enable RLS on all 42 tables + all policies.
-- Depends on: all table files (002–010).
--
-- Design principle: visibility = deal participation.
-- A user can see a deal and everything attached to it iff they have
-- a row in deal_participants for that deal.
--
-- Two-key model: service_role (backend/FastAPI) bypasses RLS entirely.
-- These policies govern what the anon key (frontend Supabase client) can do.
-- ============================================================

-- ── Helper functions ─────────────────────────────────────────
-- SECURITY DEFINER: runs as the function owner so it can query
-- deal_participants without triggering RLS recursion on that table.

CREATE OR REPLACE FUNCTION is_deal_participant(p_deal_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM deal_participants
        WHERE deal_id   = p_deal_id
          AND profile_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION is_brand_member(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM brand_members
        WHERE brand_id   = p_brand_id
          AND profile_id = auth.uid()
          AND status     = 'active'
    );
$$;

CREATE OR REPLACE FUNCTION is_brand_admin(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM brand_members
        WHERE brand_id   = p_brand_id
          AND profile_id = auth.uid()
          AND brand_role = 'admin'
          AND status     = 'active'
    );
$$;

-- ════════════════════════════════════════════════════════════
-- DOMAIN 1: Identity & Profile
-- ════════════════════════════════════════════════════════════

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_read_any"
    ON profiles FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "profiles_insert_own"
    ON profiles FOR INSERT TO authenticated
    WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own"
    ON profiles FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());


ALTER TABLE creator_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "creator_profiles_read_any"
    ON creator_profiles FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "creator_profiles_insert_own"
    ON creator_profiles FOR INSERT TO authenticated
    WITH CHECK (profile_id = auth.uid());

CREATE POLICY "creator_profiles_update_own"
    ON creator_profiles FOR UPDATE TO authenticated
    USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());


ALTER TABLE brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brands_read_any"
    ON brands FOR SELECT TO authenticated
    USING (true);

-- Any authenticated user can create a brand (they become the first admin).
-- FastAPI enforces the brand-creation flow; RLS just permits the insert.
CREATE POLICY "brands_insert_authenticated"
    ON brands FOR INSERT TO authenticated
    WITH CHECK (true);

CREATE POLICY "brands_update_admin"
    ON brands FOR UPDATE TO authenticated
    USING (is_brand_admin(id))
    WITH CHECK (is_brand_admin(id));


ALTER TABLE brand_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_members_read_same_brand"
    ON brand_members FOR SELECT TO authenticated
    USING (is_brand_member(brand_id));

CREATE POLICY "brand_members_insert_admin"
    ON brand_members FOR INSERT TO authenticated
    WITH CHECK (is_brand_admin(brand_id));

-- Admins can update any member; members can update their own row (e.g. accept invite)
CREATE POLICY "brand_members_update"
    ON brand_members FOR UPDATE TO authenticated
    USING (is_brand_admin(brand_id) OR profile_id = auth.uid())
    WITH CHECK (is_brand_admin(brand_id) OR profile_id = auth.uid());

CREATE POLICY "brand_members_delete_admin"
    ON brand_members FOR DELETE TO authenticated
    USING (is_brand_admin(brand_id));


ALTER TABLE social_handles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_handles_read_any"
    ON social_handles FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "social_handles_insert_own"
    ON social_handles FOR INSERT TO authenticated
    WITH CHECK (
        creator_id IN (
            SELECT id FROM creator_profiles WHERE profile_id = auth.uid()
        )
    );

CREATE POLICY "social_handles_update_own"
    ON social_handles FOR UPDATE TO authenticated
    USING (
        creator_id IN (
            SELECT id FROM creator_profiles WHERE profile_id = auth.uid()
        )
    );

CREATE POLICY "social_handles_delete_own"
    ON social_handles FOR DELETE TO authenticated
    USING (
        creator_id IN (
            SELECT id FROM creator_profiles WHERE profile_id = auth.uid()
        )
    );


ALTER TABLE signatures ENABLE ROW LEVEL SECURITY;

-- Signatures are private; only the owner can read and manage them.
CREATE POLICY "signatures_read_own"
    ON signatures FOR SELECT TO authenticated
    USING (profile_id = auth.uid());

CREATE POLICY "signatures_insert_own"
    ON signatures FOR INSERT TO authenticated
    WITH CHECK (profile_id = auth.uid());

CREATE POLICY "signatures_update_own"
    ON signatures FOR UPDATE TO authenticated
    USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());


ALTER TABLE rate_cards ENABLE ROW LEVEL SECURITY;

-- Owner always sees their own rate card
CREATE POLICY "rate_cards_read_owner"
    ON rate_cards FOR SELECT TO authenticated
    USING (
        creator_id IN (
            SELECT id FROM creator_profiles WHERE profile_id = auth.uid()
        )
    );

-- Authenticated brand users see enabled rate cards (brand discovery)
CREATE POLICY "rate_cards_read_brand_enabled"
    ON rate_cards FOR SELECT TO authenticated
    USING (
        is_enabled = true
        AND (SELECT account_type FROM profiles WHERE id = auth.uid()) = 'brand'
    );

CREATE POLICY "rate_cards_insert_own"
    ON rate_cards FOR INSERT TO authenticated
    WITH CHECK (
        creator_id IN (
            SELECT id FROM creator_profiles WHERE profile_id = auth.uid()
        )
    );

CREATE POLICY "rate_cards_update_own"
    ON rate_cards FOR UPDATE TO authenticated
    USING (
        creator_id IN (
            SELECT id FROM creator_profiles WHERE profile_id = auth.uid()
        )
    );


ALTER TABLE rate_card_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rate_card_items_read_if_card_visible"
    ON rate_card_items FOR SELECT TO authenticated
    USING (
        rate_card_id IN (
            SELECT rc.id FROM rate_cards rc
            JOIN creator_profiles cp ON rc.creator_id = cp.id
            WHERE cp.profile_id = auth.uid()
               OR (
                   rc.is_enabled = true
                   AND (SELECT account_type FROM profiles WHERE id = auth.uid()) = 'brand'
               )
        )
    );

CREATE POLICY "rate_card_items_insert_own"
    ON rate_card_items FOR INSERT TO authenticated
    WITH CHECK (
        rate_card_id IN (
            SELECT rc.id FROM rate_cards rc
            JOIN creator_profiles cp ON rc.creator_id = cp.id
            WHERE cp.profile_id = auth.uid()
        )
    );

CREATE POLICY "rate_card_items_update_own"
    ON rate_card_items FOR UPDATE TO authenticated
    USING (
        rate_card_id IN (
            SELECT rc.id FROM rate_cards rc
            JOIN creator_profiles cp ON rc.creator_id = cp.id
            WHERE cp.profile_id = auth.uid()
        )
    );

CREATE POLICY "rate_card_items_delete_own"
    ON rate_card_items FOR DELETE TO authenticated
    USING (
        rate_card_id IN (
            SELECT rc.id FROM rate_cards rc
            JOIN creator_profiles cp ON rc.creator_id = cp.id
            WHERE cp.profile_id = auth.uid()
        )
    );


ALTER TABLE affiliations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "affiliations_read_any"
    ON affiliations FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "affiliations_insert_own"
    ON affiliations FOR INSERT TO authenticated
    WITH CHECK (
        creator_id IN (
            SELECT id FROM creator_profiles WHERE profile_id = auth.uid()
        )
    );

CREATE POLICY "affiliations_update_own"
    ON affiliations FOR UPDATE TO authenticated
    USING (
        creator_id IN (
            SELECT id FROM creator_profiles WHERE profile_id = auth.uid()
        )
    );

CREATE POLICY "affiliations_delete_own"
    ON affiliations FOR DELETE TO authenticated
    USING (
        creator_id IN (
            SELECT id FROM creator_profiles WHERE profile_id = auth.uid()
        )
    );


ALTER TABLE brand_partnerships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_partnerships_read_any"
    ON brand_partnerships FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "brand_partnerships_insert_own"
    ON brand_partnerships FOR INSERT TO authenticated
    WITH CHECK (
        creator_id IN (
            SELECT id FROM creator_profiles WHERE profile_id = auth.uid()
        )
    );

CREATE POLICY "brand_partnerships_update_own"
    ON brand_partnerships FOR UPDATE TO authenticated
    USING (
        creator_id IN (
            SELECT id FROM creator_profiles WHERE profile_id = auth.uid()
        )
    );

CREATE POLICY "brand_partnerships_delete_own"
    ON brand_partnerships FOR DELETE TO authenticated
    USING (
        creator_id IN (
            SELECT id FROM creator_profiles WHERE profile_id = auth.uid()
        )
    );

-- ════════════════════════════════════════════════════════════
-- DOMAIN 2: Deal Core
-- ════════════════════════════════════════════════════════════

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

-- Read: participants OR the deal creator (needed immediately after creation,
-- before the deal_participants row is committed)
CREATE POLICY "deals_read_participant"
    ON deals FOR SELECT TO authenticated
    USING (is_deal_participant(id) OR created_by = auth.uid());

CREATE POLICY "deals_insert_own"
    ON deals FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid());

-- Updates (e.g. deal_name, soft delete) by any participant;
-- stage transitions are backend-only via service_role
CREATE POLICY "deals_update_participant"
    ON deals FOR UPDATE TO authenticated
    USING (is_deal_participant(id))
    WITH CHECK (is_deal_participant(id));


ALTER TABLE deal_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_participants_read_participant"
    ON deal_participants FOR SELECT TO authenticated
    USING (is_deal_participant(deal_id));

-- A user can add themselves to a deal they were invited to
-- (backend creates the invite; client confirms with this policy)
CREATE POLICY "deal_participants_insert_own"
    ON deal_participants FOR INSERT TO authenticated
    WITH CHECK (profile_id = auth.uid());

-- Only own row update allowed (for last_read_at unread tracking)
CREATE POLICY "deal_participants_update_own"
    ON deal_participants FOR UPDATE TO authenticated
    USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());


ALTER TABLE deal_stage_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_stage_transitions_read_participant"
    ON deal_stage_transitions FOR SELECT TO authenticated
    USING (is_deal_participant(deal_id));

-- Inserts are backend-only (service_role). No INSERT policy for authenticated
-- means direct inserts by the client are blocked.


ALTER TABLE participant_add_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "participant_add_requests_read_participant"
    ON participant_add_requests FOR SELECT TO authenticated
    USING (is_deal_participant(deal_id));

CREATE POLICY "participant_add_requests_insert_participant"
    ON participant_add_requests FOR INSERT TO authenticated
    WITH CHECK (
        requested_by = auth.uid()
        AND is_deal_participant(deal_id)
    );

CREATE POLICY "participant_add_requests_update_participant"
    ON participant_add_requests FOR UPDATE TO authenticated
    USING (is_deal_participant(deal_id))
    WITH CHECK (is_deal_participant(deal_id));


ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_read_participant"
    ON messages FOR SELECT TO authenticated
    USING (is_deal_participant(deal_id));

CREATE POLICY "messages_insert_participant"
    ON messages FOR INSERT TO authenticated
    WITH CHECK (
        sender_id = auth.uid()
        AND is_deal_participant(deal_id)
    );

-- Soft-delete only: sender sets deleted_at on their own messages
CREATE POLICY "messages_update_sender"
    ON messages FOR UPDATE TO authenticated
    USING (sender_id = auth.uid())
    WITH CHECK (sender_id = auth.uid());


ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "message_attachments_read_participant"
    ON message_attachments FOR SELECT TO authenticated
    USING (
        message_id IN (
            SELECT id FROM messages WHERE is_deal_participant(deal_id)
        )
    );

CREATE POLICY "message_attachments_insert_sender"
    ON message_attachments FOR INSERT TO authenticated
    WITH CHECK (
        message_id IN (
            SELECT id FROM messages
            WHERE sender_id = auth.uid()
              AND is_deal_participant(deal_id)
        )
    );


ALTER TABLE deliverables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deliverables_read_participant"
    ON deliverables FOR SELECT TO authenticated
    USING (is_deal_participant(deal_id));

CREATE POLICY "deliverables_insert_participant"
    ON deliverables FOR INSERT TO authenticated
    WITH CHECK (is_deal_participant(deal_id));

CREATE POLICY "deliverables_update_participant"
    ON deliverables FOR UPDATE TO authenticated
    USING (is_deal_participant(deal_id))
    WITH CHECK (is_deal_participant(deal_id));

-- ════════════════════════════════════════════════════════════
-- DOMAIN 3: Terms & Contracts
-- ════════════════════════════════════════════════════════════

ALTER TABLE deal_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_terms_read_participant"
    ON deal_terms FOR SELECT TO authenticated
    USING (is_deal_participant(deal_id));

CREATE POLICY "deal_terms_insert_participant"
    ON deal_terms FOR INSERT TO authenticated
    WITH CHECK (is_deal_participant(deal_id));

CREATE POLICY "deal_terms_update_participant"
    ON deal_terms FOR UPDATE TO authenticated
    USING (is_deal_participant(deal_id))
    WITH CHECK (is_deal_participant(deal_id));


ALTER TABLE ai_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_summaries_read_participant"
    ON ai_summaries FOR SELECT TO authenticated
    USING (is_deal_participant(deal_id));

-- Inserts are backend-only (AI generation); no client INSERT policy.


ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contracts_read_participant"
    ON contracts FOR SELECT TO authenticated
    USING (is_deal_participant(deal_id));

-- Inserts and status updates are backend-only.


ALTER TABLE extracted_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "extracted_terms_read_participant"
    ON extracted_terms FOR SELECT TO authenticated
    USING (is_deal_participant(deal_id));


ALTER TABLE term_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "term_approvals_read_participant"
    ON term_approvals FOR SELECT TO authenticated
    USING (
        summary_id IN (
            SELECT id FROM ai_summaries WHERE is_deal_participant(deal_id)
        )
    );

CREATE POLICY "term_approvals_insert_own"
    ON term_approvals FOR INSERT TO authenticated
    WITH CHECK (
        profile_id = auth.uid()
        AND summary_id IN (
            SELECT id FROM ai_summaries WHERE is_deal_participant(deal_id)
        )
    );


ALTER TABLE contract_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contract_signatures_read_participant"
    ON contract_signatures FOR SELECT TO authenticated
    USING (
        contract_id IN (
            SELECT id FROM contracts WHERE is_deal_participant(deal_id)
        )
    );

CREATE POLICY "contract_signatures_insert_signer"
    ON contract_signatures FOR INSERT TO authenticated
    WITH CHECK (
        signer_id = auth.uid()
        AND contract_id IN (
            SELECT id FROM contracts WHERE is_deal_participant(deal_id)
        )
    );


ALTER TABLE briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "briefs_read_participant"
    ON briefs FOR SELECT TO authenticated
    USING (is_deal_participant(deal_id));

CREATE POLICY "briefs_insert_participant"
    ON briefs FOR INSERT TO authenticated
    WITH CHECK (is_deal_participant(deal_id));

CREATE POLICY "briefs_update_participant"
    ON briefs FOR UPDATE TO authenticated
    USING (is_deal_participant(deal_id))
    WITH CHECK (is_deal_participant(deal_id));


ALTER TABLE revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "revisions_read_participant"
    ON revisions FOR SELECT TO authenticated
    USING (
        deliverable_id IN (
            SELECT id FROM deliverables WHERE is_deal_participant(deal_id)
        )
    );

CREATE POLICY "revisions_insert_participant"
    ON revisions FOR INSERT TO authenticated
    WITH CHECK (
        deliverable_id IN (
            SELECT id FROM deliverables WHERE is_deal_participant(deal_id)
        )
    );

-- ════════════════════════════════════════════════════════════
-- DOMAIN 4: Rights
-- All rights tables: participants on the deal get full access.
-- Service_role populates them from the AI parser.
-- ════════════════════════════════════════════════════════════

ALTER TABLE exclusivity_clauses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exclusivity_clauses_participant"
    ON exclusivity_clauses FOR ALL TO authenticated
    USING (is_deal_participant(deal_id))
    WITH CHECK (is_deal_participant(deal_id));


ALTER TABLE usage_rights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_rights_participant"
    ON usage_rights FOR ALL TO authenticated
    USING (is_deal_participant(deal_id))
    WITH CHECK (is_deal_participant(deal_id));


ALTER TABLE whitelisting_arrangements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whitelisting_arrangements_participant"
    ON whitelisting_arrangements FOR ALL TO authenticated
    USING (is_deal_participant(deal_id))
    WITH CHECK (is_deal_participant(deal_id));


ALTER TABLE blackout_windows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blackout_windows_participant"
    ON blackout_windows FOR ALL TO authenticated
    USING (is_deal_participant(deal_id))
    WITH CHECK (is_deal_participant(deal_id));


ALTER TABLE disclosure_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "disclosure_requirements_participant"
    ON disclosure_requirements FOR ALL TO authenticated
    USING (is_deal_participant(deal_id))
    WITH CHECK (is_deal_participant(deal_id));

-- ════════════════════════════════════════════════════════════
-- DOMAIN 5: Payments
-- ════════════════════════════════════════════════════════════

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_participant"
    ON payments FOR ALL TO authenticated
    USING (is_deal_participant(deal_id))
    WITH CHECK (is_deal_participant(deal_id));


ALTER TABLE payment_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_milestones_participant"
    ON payment_milestones FOR ALL TO authenticated
    USING (
        payment_id IN (
            SELECT id FROM payments WHERE is_deal_participant(deal_id)
        )
    )
    WITH CHECK (
        payment_id IN (
            SELECT id FROM payments WHERE is_deal_participant(deal_id)
        )
    );


ALTER TABLE deal_payment_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_payment_details_participant"
    ON deal_payment_details FOR ALL TO authenticated
    USING (is_deal_participant(deal_id))
    WITH CHECK (is_deal_participant(deal_id));

-- ════════════════════════════════════════════════════════════
-- DOMAIN 6: Deal Outcomes
-- ════════════════════════════════════════════════════════════

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "disputes_read_participant"
    ON disputes FOR SELECT TO authenticated
    USING (is_deal_participant(deal_id));

CREATE POLICY "disputes_insert_participant"
    ON disputes FOR INSERT TO authenticated
    WITH CHECK (
        raised_by = auth.uid()
        AND is_deal_participant(deal_id)
    );

-- Updates (e.g. resolution) are backend-only via service_role.


ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ratings_read_participant"
    ON ratings FOR SELECT TO authenticated
    USING (is_deal_participant(deal_id));

CREATE POLICY "ratings_insert_own"
    ON ratings FOR INSERT TO authenticated
    WITH CHECK (
        rater_id = auth.uid()
        AND is_deal_participant(deal_id)
    );


ALTER TABLE deal_comments ENABLE ROW LEVEL SECURITY;

-- Shared comments visible to all participants; private comments only to author.
CREATE POLICY "deal_comments_read"
    ON deal_comments FOR SELECT TO authenticated
    USING (
        is_deal_participant(deal_id)
        AND (visibility = 'shared' OR author_id = auth.uid())
    );

CREATE POLICY "deal_comments_insert_participant"
    ON deal_comments FOR INSERT TO authenticated
    WITH CHECK (
        author_id = auth.uid()
        AND is_deal_participant(deal_id)
    );

-- ════════════════════════════════════════════════════════════
-- DOMAIN 7: Maker-Checker
-- ════════════════════════════════════════════════════════════

ALTER TABLE maker_checker_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "maker_checker_config_read_brand_member"
    ON maker_checker_config FOR SELECT TO authenticated
    USING (is_brand_member(brand_id));

CREATE POLICY "maker_checker_config_insert_admin"
    ON maker_checker_config FOR INSERT TO authenticated
    WITH CHECK (is_brand_admin(brand_id));

CREATE POLICY "maker_checker_config_update_admin"
    ON maker_checker_config FOR UPDATE TO authenticated
    USING (is_brand_admin(brand_id))
    WITH CHECK (is_brand_admin(brand_id));


ALTER TABLE maker_checker_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "maker_checker_requests_read_participant"
    ON maker_checker_requests FOR SELECT TO authenticated
    USING (is_deal_participant(deal_id));

CREATE POLICY "maker_checker_requests_insert_participant"
    ON maker_checker_requests FOR INSERT TO authenticated
    WITH CHECK (
        initiated_by = auth.uid()
        AND is_deal_participant(deal_id)
    );

-- Only the assigned checker can approve/reject
CREATE POLICY "maker_checker_requests_update_checker"
    ON maker_checker_requests FOR UPDATE TO authenticated
    USING (checker_id = auth.uid())
    WITH CHECK (checker_id = auth.uid());

-- ════════════════════════════════════════════════════════════
-- DOMAIN 8: Private Annotations
-- ════════════════════════════════════════════════════════════

ALTER TABLE private_annotations ENABLE ROW LEVEL SECURITY;

-- Strictly owner-only: no other participant can see these rows.
CREATE POLICY "private_annotations_owner_only"
    ON private_annotations FOR ALL TO authenticated
    USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());

-- ════════════════════════════════════════════════════════════
-- DOMAIN 9: Cross-cutting
-- ════════════════════════════════════════════════════════════

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Only the recipient can read/update (mark as read) their notifications.
-- Inserts are backend-only (service_role).
CREATE POLICY "notifications_recipient_read"
    ON notifications FOR SELECT TO authenticated
    USING (profile_id = auth.uid());

CREATE POLICY "notifications_recipient_update"
    ON notifications FOR UPDATE TO authenticated
    USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());


ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_preferences_owner_only"
    ON notification_preferences FOR ALL TO authenticated
    USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());


ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- No policy = no access for the authenticated role.
-- Reads require service_role (backend/ops). Inserts via service_role bypass RLS.
-- UPDATE and DELETE are blocked by the immutability trigger in 010.
