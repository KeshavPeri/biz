-- ============================================================
-- 046_onboarding_creator_profile_upsert_grant.sql
-- Restore the narrow column privilege needed by onboarding retries.
-- ============================================================

-- PostgREST's `ON CONFLICT (profile_id) DO UPDATE` needs UPDATE privilege on
-- the conflict column even though the onboarding payload does not change it.
-- This is intentionally limited to profile_id: creator_profiles_update_own's
-- USING and WITH CHECK clauses still require both the existing and proposed
-- profile_id to equal auth.uid(), so an authenticated user cannot take over or
-- reassign another creator profile.
GRANT UPDATE (profile_id) ON TABLE public.creator_profiles TO authenticated;
