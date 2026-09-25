import { getJson } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { parseDeliverableDetail, type DeliverableDetail } from '@/lib/deliverable-detail-state';

export async function fetchDeliverableDetail(dealId: string, deliverableId: string): Promise<{ ok: true; data: DeliverableDetail } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: 'Deliverable details are not configured on this device.' };
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<unknown>(`/deals/${dealId}/deliverables/${deliverableId}/detail`, data.session.access_token);
  if (!result.ok) return { ok: false, message: 'This deliverable is unavailable. Return to the deal and try again.' };
  try { return { ok: true, data: parseDeliverableDetail(result.data) }; } catch { return { ok: false, message: 'This deliverable could not be verified safely. Please refresh.' }; }
}
