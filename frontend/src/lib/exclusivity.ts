import { getJson } from '@/lib/api';
import { parseExclusivitySnapshot, type ExclusivitySnapshot } from '@/lib/exclusivity-state';
import { supabase } from '@/lib/supabase';

export type ExclusivityResult = { ok: true; data: ExclusivitySnapshot } | { ok: false; message: string };

export async function fetchExclusivity(): Promise<ExclusivityResult> {
  if (!supabase) return { ok: false, message: 'Exclusivity tracking is not configured on this device.' };
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<unknown>('/tracking/exclusivity', data.session.access_token);
  if (!result.ok) return { ok: false, message: 'Exclusivity could not be loaded. Please try again.' };
  try { return { ok: true, data: parseExclusivitySnapshot(result.data) }; }
  catch { return { ok: false, message: 'Exclusivity could not be verified safely. Please refresh.' }; }
}
