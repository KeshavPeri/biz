-- ============================================================
-- 016_storage_profile_photos.sql
-- Phase 8 (Discovery) — G1: profile-photos Storage bucket + RLS.
--
-- Stands up the Storage we deferred in Phase 7. A PRIVATE bucket with:
--   • public-READ via an explicit RLS SELECT policy (so brands/anon can render
--     avatars + carousel images without a signed URL), and
--   • owner-only WRITE — a user may only create/update/delete objects inside
--     their OWN top-level folder, named by their profile_id (= auth.uid(),
--     since profiles.id references auth.users.id).
--
-- Convention (app must honour): object path = '{auth.uid()}/{filename}'.
--   e.g. '2f9c...e1/primary.jpg'. creator_profiles.photo_carousel (jsonb) stores
--   up to 5 such paths; the primary path also lands on profiles.avatar_url.
--
-- Depends on: Supabase Storage schema (storage.buckets, storage.objects — managed).
-- Assumption logged in progress.md: "private bucket + public-read-per-RLS"
-- (per HANDOFF G1 / pre-resolved decision), NOT a public bucket.
-- ============================================================

-- ── 1. The bucket (private) ───────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', false)
on conflict (id) do nothing;

-- ── 2. Public read (any role, incl. anon) ─────────────────────────────────────
-- Media kits are public; a brand (or logged-out preview) must render the images.
drop policy if exists "profile_photos_public_read" on storage.objects;
create policy "profile_photos_public_read"
    on storage.objects for select
    to public
    using ( bucket_id = 'profile-photos' );

-- ── 3. Owner write — INSERT into own {profile_id}/ folder ──────────────────────
drop policy if exists "profile_photos_owner_insert" on storage.objects;
create policy "profile_photos_owner_insert"
    on storage.objects for insert
    to authenticated
    with check (
        bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- ── 4. Owner write — UPDATE own objects ───────────────────────────────────────
drop policy if exists "profile_photos_owner_update" on storage.objects;
create policy "profile_photos_owner_update"
    on storage.objects for update
    to authenticated
    using (
        bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    )
    with check (
        bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- ── 5. Owner write — DELETE own objects ───────────────────────────────────────
drop policy if exists "profile_photos_owner_delete" on storage.objects;
create policy "profile_photos_owner_delete"
    on storage.objects for delete
    to authenticated
    using (
        bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
