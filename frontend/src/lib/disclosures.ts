import { getJson } from '@/lib/api';
import { parseDisclosureSnapshot, type DisclosureSnapshot } from '@/lib/disclosures-state';
import { supabase } from '@/lib/supabase';

export type DisclosureResult = { ok: true; data: DisclosureSnapshot } | { ok: false; message: string };

export async function fetchDisclosures(): Promise<DisclosureResult> {
  if (!supabase) return { ok: false, message: 'Disclosure tracking is not configured on this device.' };
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<unknown>('/tracking/disclosures', data.session.access_token);
  if (!result.ok) return { ok: false, message: 'Disclosures could not be loaded. Please try again.' };
  try { return { ok: true, data: parseDisclosureSnapshot(result.data) }; }
  catch { return { ok: false, message: 'Disclosures could not be verified safely. Please refresh.' }; }
}
