import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { useOnboardingStore } from '@/store/onboarding-store';

/**
 * Finish-of-onboarding write logic (Cluster B). Everything the wizard collected is
 * held in the onboarding store and committed here in ONE idempotent pass, so the
 * DB never holds a half-built profile and the onboarding gate
 * (profiles.profile_completeness > 0) flips exactly once, at the very end.
 *
 * All writes use the authenticated anon client under RLS (no service_role). The
 * brand path relies on the bootstrap policy from migration 014 to insert the
 * first admin membership.
 */

type OnboardingState = ReturnType<typeof useOnboardingStore.getState>;

export type SubmitResult = { ok: true } | { ok: false; message: string };

const GENERIC_ERROR = "Couldn't finish setting up your profile. Please try again.";

/**
 * Profile completeness %, adapted from the mockup's computePct(). Never reaches
 * 100 at onboarding — later enrichment (rate card, demographics) owns the rest.
 */
export function computeCompleteness(state: OnboardingState): number {
  if (state.role === 'brand') {
    // Brand: base for the required company + contact, plus optional trust fields.
    let pct = 45;
    if (state.industry.trim()) pct += 12;
    if (state.companyIdGst.trim()) pct += 12;
    if (state.domain.trim()) pct += 12;
    return Math.min(pct, 86);
  }
  // Creator: mirrors the mockup weights (40 base + essentials).
  let pct = 40;
  if (Object.keys(state.platforms).length > 1) pct += 6;
  if (state.niches.length) pct += 8;
  if (state.languages.length) pct += 6;
  if (state.bio.trim()) pct += 6;
  return Math.min(pct, 86);
}

const VERIFY_THRESHOLD = 7000;

async function submitCreator(state: OnboardingState, userId: string): Promise<void> {
  const client = supabase!;

  // creator_profiles (1:1 with profiles; UNIQUE profile_id → upsert is idempotent).
  const { data: cp, error: cpError } = await client
    .from('creator_profiles')
    .upsert(
      {
        profile_id: userId,
        niches: state.niches,
        content_languages: state.languages,
        bio: state.bio.trim() || null,
        inbound_enabled: state.inbound,
        outbound_enabled: state.outbound,
      },
      { onConflict: 'profile_id' },
    )
    .select('id')
    .single();
  if (cpError) throw cpError;

  const creatorId = cp.id as string;

  // social_handles: replace any prior set so a retry stays clean.
  const { error: delError } = await client
    .from('social_handles')
    .delete()
    .eq('creator_id', creatorId);
  if (delError) throw delError;

  const connected = Object.entries(state.platforms);
  if (connected.length > 0) {
    // The highest-follower handle is the primary one.
    let primaryKey = connected[0][0];
    let primaryMax = -1;
    for (const [key, p] of connected) {
      if (p.followerCount > primaryMax) {
        primaryMax = p.followerCount;
        primaryKey = key;
      }
    }
    const rows = connected.map(([platform, p]) => ({
      creator_id: creatorId,
      platform,
      handle: p.handle,
      follower_count: p.followerCount,
      engagement_rate: p.engagementRate,
      weekly_reach: p.weeklyReach,
      is_primary: platform === primaryKey,
      // Mock verification: clears the threshold ⇒ verified (no live API in MVP).
      verification_status: p.followerCount >= VERIFY_THRESHOLD ? 'verified' : 'pending',
    }));
    const { error: shError } = await client.from('social_handles').insert(rows);
    if (shError) throw shError;
  }
}

async function submitBrand(state: OnboardingState, userId: string): Promise<void> {
  const client = supabase!;

  // Idempotency: if a prior attempt already made this user a brand admin, reuse it
  // rather than creating a second brand.
  const { data: existing, error: exError } = await client
    .from('brand_members')
    .select('brand_id')
    .eq('profile_id', userId)
    .maybeSingle();
  if (exError) throw exError;
  if (existing) return;

  const { data: brand, error: brandError } = await client
    .from('brands')
    .insert({
      company_name: state.companyName.trim(),
      industry: state.industry.trim() || null,
      company_id_gst: state.companyIdGst.trim() || null,
      domain: state.domain.trim() || null,
    })
    .select('id')
    .single();
  if (brandError) throw brandError;

  // First admin — allowed by the bootstrap RLS policy (brand has no members yet).
  const { error: memberError } = await client.from('brand_members').insert({
    brand_id: brand.id,
    profile_id: userId,
    brand_role: 'admin',
    status: 'active',
  });
  if (memberError) throw memberError;
}

export async function submitOnboarding(session: Session): Promise<SubmitResult> {
  const state = useOnboardingStore.getState();

  if (!supabase) return { ok: false, message: GENERIC_ERROR };
  if (!state.role) return { ok: false, message: GENERIC_ERROR };

  const userId = session.user.id;
  const email = session.user.email;
  if (!email) return { ok: false, message: GENERIC_ERROR };

  try {
    // 1. profiles first (completeness 0 for now — the FK target for sub-tables).
    const { error: profileError } = await supabase.from('profiles').upsert(
      {
        id: userId,
        account_type: state.role,
        display_name: state.displayName.trim(),
        email,
        city: state.city.trim() || null,
        profile_completeness: 0,
      },
      { onConflict: 'id' },
    );
    if (profileError) throw profileError;

    // 2. role-specific rows.
    if (state.role === 'creator') {
      await submitCreator(state, userId);
    } else {
      await submitBrand(state, userId);
    }

    // 3. LAST: set completeness — the onboarding gate flips only now, once every
    //    other write has succeeded.
    const completeness = computeCompleteness(state);
    const { error: completenessError } = await supabase
      .from('profiles')
      .update({ profile_completeness: completeness })
      .eq('id', userId);
    if (completenessError) throw completenessError;

    return { ok: true };
  } catch {
    // Never surface a raw error; partial writes are safe to retry (upserts +
    // membership check), and completeness stays 0 so routing won't advance.
    return { ok: false, message: GENERIC_ERROR };
  }
}
