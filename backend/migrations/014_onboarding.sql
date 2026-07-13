-- ============================================================
-- 014_onboarding.sql
-- Phase 7 Cluster B — schema support for role selection + onboarding.
--
-- Two changes:
--   1. creator_profiles.niche (text) -> niches (text[]): a creator picks up to
--      3 niches (the approved onboarding mockup), consistent with
--      content_languages. The dev DB is empty, so there's no data to migrate.
--   2. Brand first-admin bootstrap RLS: the existing brand_members_insert_admin
--      policy requires you to ALREADY be an admin (is_brand_admin), which makes
--      the VERY FIRST admin impossible to insert from the authenticated client.
--      Add a narrow bootstrap policy that lets a user create their own admin
--      membership only while the brand has no members yet.
-- Depends on: 002_identity_profile.sql, 012_rls.sql
-- ============================================================

-- ── 1. creator_profiles.niche -> niches (text[]) ──────────────────────────────
ALTER TABLE creator_profiles DROP COLUMN IF EXISTS niche;
ALTER TABLE creator_profiles ADD COLUMN niches text[];

-- App also caps at 3; this is the DB backstop.
ALTER TABLE creator_profiles
    ADD CONSTRAINT creator_profiles_niches_max3
    CHECK (niches IS NULL OR array_length(niches, 1) <= 3);

-- ── 2. Brand first-admin bootstrap RLS ────────────────────────────────────────
-- SECURITY DEFINER helper: does this brand already have any members? Runs as the
-- definer so the policy's own SELECT isn't blocked by brand_members RLS
-- (mirrors is_brand_admin / is_brand_member in 012).
CREATE OR REPLACE FUNCTION brand_has_members(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM brand_members WHERE brand_id = p_brand_id
    );
$$;

-- Coexists (OR) with brand_members_insert_admin. A user may insert their OWN
-- active-admin row ONLY when the brand has zero members yet — i.e. the brand they
-- just created. Cannot be used to self-promote into an existing brand.
CREATE POLICY "brand_members_insert_self_bootstrap"
    ON brand_members FOR INSERT TO authenticated
    WITH CHECK (
        profile_id = auth.uid()
        AND brand_role = 'admin'
        AND status = 'active'
        AND NOT brand_has_members(brand_id)
    );
