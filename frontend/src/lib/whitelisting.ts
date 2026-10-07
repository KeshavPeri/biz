import { getJson } from '@/lib/api';
import { parseWhitelistingSnapshot, type WhitelistingSnapshot } from '@/lib/whitelisting-state';
import { supabase } from '@/lib/supabase';

export type WhitelistingResult = { ok: true; data: WhitelistingSnapshot } | { ok: false; message: string };

export async function fetchWhitelisting(): Promise<WhitelistingResult> {
  if (!supabase) return { ok: false, message: 'Whitelisting tracking is not configured on this device.' };
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<unknown>('/tracking/whitelisting', data.session.access_token);
  if (!result.ok) return { ok: false, message: 'Whitelisting arrangements could not be loaded. Please try again.' };
  try { return { ok: true, data: parseWhitelistingSnapshot(result.data) }; }
  catch { return { ok: false, message: 'Whitelisting arrangements could not be verified safely. Please refresh.' }; }
}
