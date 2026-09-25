import { getJson } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { parseUsageRightsSnapshot, type UsageRightsSnapshot } from '@/lib/usage-rights-state';

export type UsageRightsResult = { ok: true; data: UsageRightsSnapshot } | { ok: false; message: string };

export async function fetchUsageRights(): Promise<UsageRightsResult> {
  if (!supabase) return { ok: false, message: 'Usage rights are not configured on this device.' };
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<unknown>('/tracking/usage-rights', data.session.access_token);
  if (!result.ok) return { ok: false, message: 'Usage rights could not be loaded. Please try again.' };
  try { return { ok: true, data: parseUsageRightsSnapshot(result.data) }; }
  catch { return { ok: false, message: 'Usage rights could not be verified safely. Please refresh.' }; }
}
