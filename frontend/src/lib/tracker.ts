import { supabase } from './supabase';
import { parseDealTrackerSnapshot, type DealTrackerSnapshot } from './tracker-state';

export type TrackerResult =
  | { ok: true; data: DealTrackerSnapshot }
  | { ok: false; message: string };

export async function fetchDealTracker(): Promise<TrackerResult> {
  if (!supabase) return { ok: false, message: 'Tracking is not configured on this device.' };
  try {
    const { data, error } = await supabase.rpc('get_deal_tracker');
    if (error) return { ok: false, message: 'Could not load tracking right now. Please try again.' };
    return { ok: true, data: parseDealTrackerSnapshot(data) };
  } catch {
    return { ok: false, message: 'Could not load tracking right now. Please try again.' };
  }
}
