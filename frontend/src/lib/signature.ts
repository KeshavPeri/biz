import { supabase } from '@/lib/supabase';
import type { SignatureType } from '@/store/onboarding-store';

/**
 * Save a reusable signature (task 7.9), Supabase-direct under the owner-only
 * `signatures` RLS. Stored inline: `drawn` → SVG markup, `typed` → the name.
 *
 * Order matters: `idx_signatures_active_per_profile` is a partial-unique index
 * (one active signature per profile), so we must DEACTIVATE any current active
 * row BEFORE inserting the new active one, or the insert violates the index.
 *
 * Reusable for a later standalone re-set (the profiles row already exists then);
 * during onboarding it's called at finish, after the profiles row is written.
 */
export async function saveSignature(
  profileId: string,
  type: SignatureType,
  data: string,
): Promise<void> {
  const client = supabase;
  if (!client || !data.trim()) return; // nothing to store — skip silently

  // 1. Deactivate the prior active signature (if any).
  const { error: deactivateError } = await client
    .from('signatures')
    .update({ is_active: false })
    .eq('profile_id', profileId)
    .eq('is_active', true);
  if (deactivateError) throw deactivateError;

  // 2. Insert the new active signature.
  const { error: insertError } = await client.from('signatures').insert({
    profile_id: profileId,
    signature_type: type,
    signature_data: data,
    is_active: true,
  });
  if (insertError) throw insertError;
}
