import { supabase } from './supabase';
import { parseMonthlyDealSummary, type MonthlyDealSummary } from './monthly-summary-state';

export type MonthlySummaryResult =
  | { ok: true; data: MonthlyDealSummary }
  | { ok: false; message: string };

export async function fetchMonthlyDealSummary(month: string | null): Promise<MonthlySummaryResult> {
  if (!supabase) return { ok: false, message: 'Tracking is not configured on this device.' };
  try {
    const { data, error } = await supabase.rpc('get_monthly_deal_summary', { p_month: month });
    if (error) return { ok: false, message: 'Could not load this monthly summary. Please try again.' };
    return { ok: true, data: parseMonthlyDealSummary(data) };
  } catch {
    return { ok: false, message: 'Could not load this monthly summary. Please try again.' };
  }
}
