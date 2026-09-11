import { supabase } from '@/lib/supabase';
import {
  labelsByDeal,
  normalizePrivateDealLabel,
  type PrivateDealLabel,
} from '@/lib/private-deal-label-state';

export { MAX_PRIVATE_DEAL_LABELS, normalizePrivateDealLabel, type PrivateDealLabel } from '@/lib/private-deal-label-state';

export type PrivateDealLabelResult<T> = { ok: true; data: T } | { ok: false; message: string };

function friendlyError(): string {
  return "Couldn't update your private labels. Refresh and try again.";
}

async function currentAccount(expectedAccountId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id === expectedAccountId ? expectedAccountId : null;
}

export async function fetchPrivateDealLabels(
  accountId: string, dealIds: string[],
): Promise<PrivateDealLabelResult<Record<string, PrivateDealLabel[]>>> {
  if (!supabase || !(await currentAccount(accountId))) {
    return { ok: false, message: 'Your session has expired. Please sign in again.' };
  }
  if (!dealIds.length) return { ok: true, data: {} };
  try {
    const { data, error } = await supabase
      .from('private_annotations')
      .select('id,entity_id,label')
      .eq('entity_type', 'deal')
      .in('entity_id', dealIds);
    if (error) return { ok: false, message: friendlyError() };
    return {
      ok: true,
      data: labelsByDeal((data ?? []).map((row) => ({
        id: String(row.id), dealId: String(row.entity_id), label: String(row.label),
      }))),
    };
  } catch {
    return { ok: false, message: friendlyError() };
  }
}

export async function addPrivateDealLabel(
  accountId: string, dealId: string, value: string,
): Promise<PrivateDealLabelResult<PrivateDealLabel>> {
  const label = normalizePrivateDealLabel(value);
  if (!label) return { ok: false, message: 'Use 1–32 visible characters for a private label.' };
  if (!supabase || !(await currentAccount(accountId))) {
    return { ok: false, message: 'Your session has expired. Please sign in again.' };
  }
  try {
    const { data, error } = await supabase
      .from('private_annotations')
      .insert({ profile_id: accountId, entity_type: 'deal', entity_id: dealId, label })
      .select('id,entity_id,label')
      .single();
    if (error || !data) return { ok: false, message: friendlyError() };
    return { ok: true, data: { id: String(data.id), dealId: String(data.entity_id), label: String(data.label) } };
  } catch {
    return { ok: false, message: friendlyError() };
  }
}

export async function removePrivateDealLabel(
  accountId: string, annotationId: string,
): Promise<PrivateDealLabelResult<null>> {
  if (!supabase || !(await currentAccount(accountId))) {
    return { ok: false, message: 'Your session has expired. Please sign in again.' };
  }
  try {
    const { error } = await supabase.from('private_annotations').delete().eq('id', annotationId).eq('entity_type', 'deal');
    return error ? { ok: false, message: friendlyError() } : { ok: true, data: null };
  } catch {
    return { ok: false, message: friendlyError() };
  }
}
