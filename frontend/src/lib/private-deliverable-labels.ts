import { supabase } from '@/lib/supabase';

export const PRIVATE_DELIVERABLE_LABELS = [
  'Idea',
  'In Progress',
  'Filmed',
  'Approved',
  'Scheduled',
] as const;

export type PrivateDeliverableLabel = (typeof PRIVATE_DELIVERABLE_LABELS)[number];
export type PrivateDeliverableLabelMap = Record<string, PrivateDeliverableLabel | null>;

type LabelResult<T> = { ok: true; data: T } | { ok: false; message: string };

function friendlyLabelError(): string {
  return "Couldn't update your private label. Refresh and try again.";
}

export async function fetchPrivateDeliverableLabels(
  deliverableIds: string[],
): Promise<LabelResult<PrivateDeliverableLabelMap>> {
  if (!supabase) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  if (deliverableIds.length === 0) return { ok: true, data: {} };

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.access_token) {
    return { ok: false, message: 'Your session has expired. Please sign in again.' };
  }

  try {
    const { data, error } = await supabase
      .from('private_annotations')
      .select('entity_id,label')
      .eq('entity_type', 'deliverable')
      .in('entity_id', deliverableIds);
    if (error) return { ok: false, message: friendlyLabelError() };

    const labels: PrivateDeliverableLabelMap = {};
    for (const row of data ?? []) {
      if (
        typeof row.entity_id === 'string'
        && PRIVATE_DELIVERABLE_LABELS.includes(row.label as PrivateDeliverableLabel)
      ) {
        labels[row.entity_id] = row.label as PrivateDeliverableLabel;
      }
    }
    return { ok: true, data: labels };
  } catch {
    return { ok: false, message: friendlyLabelError() };
  }
}

export async function setPrivateDeliverableLabel(
  deliverableId: string,
  label: PrivateDeliverableLabel | null,
): Promise<LabelResult<PrivateDeliverableLabel | null>> {
  if (!supabase) return { ok: false, message: 'Your session has expired. Please sign in again.' };

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.access_token) {
    return { ok: false, message: 'Your session has expired. Please sign in again.' };
  }

  try {
    const { data, error } = await supabase.rpc('set_private_deliverable_label', {
      p_deliverable_id: deliverableId,
      p_label: label,
    });
    if (error) return { ok: false, message: friendlyLabelError() };
    return { ok: true, data: (data as PrivateDeliverableLabel | null) ?? null };
  } catch {
    return { ok: false, message: friendlyLabelError() };
  }
}
