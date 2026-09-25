import { supabase } from './supabase';
import {
  parsePaymentDashboardPage, type PaymentDashboardFilters, type PaymentDashboardPage,
} from './payment-dashboard-state';

export type PaymentDashboardResult =
  | { ok: true; data: PaymentDashboardPage }
  | { ok: false; message: string };

export async function fetchPaymentDashboard(
  filters: PaymentDashboardFilters,
  cursor: string | null = null,
): Promise<PaymentDashboardResult> {
  if (!supabase) return { ok: false, message: 'Tracking is not configured on this device.' };
  try {
    const { data, error } = await supabase.rpc('get_payment_dashboard', {
      p_deal_id: filters.dealId, p_counterparty_id: filters.counterpartyId,
      p_due_from: filters.dueFrom, p_due_to: filters.dueTo,
      p_bucket: filters.bucket, p_state: filters.state,
      p_limit: filters.limit, p_cursor: cursor,
    });
    if (error) return { ok: false, message: 'Could not load payment history. Please try again.' };
    return { ok: true, data: parsePaymentDashboardPage(data) };
  } catch {
    return { ok: false, message: 'Could not load payment history. Please try again.' };
  }
}
