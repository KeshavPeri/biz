import { supabase } from '@/lib/supabase';
import { postJson } from '@/lib/api';

/**
 * Deal actions that change deal state → routed through FastAPI (service_role),
 * never Supabase-direct (docs/api-architecture.md). Phase 8 ships only "connect"
 * (B2-004); accept/decline/stage transitions are Phase 9.
 */

export type ConnectResult = {
  deal_id: string;
  stage: string;
  created: boolean;
  exclusivity_warning?: string;
};

export type ConnectOutcome =
  | { ok: true; result: ConnectResult }
  | { ok: false; message: string };

/**
 * Seed a Pending deal with a creator or brand. Sends the current session's access
 * token so FastAPI can verify + enforce RBAC server-side.
 */
export async function connectDeal(
  targetType: 'creator' | 'brand',
  targetId: string,
): Promise<ConnectOutcome> {
  if (!supabase) return { ok: false, message: 'Not signed in.' };

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };

  const res = await postJson<ConnectResult>(
    '/deals/connect',
    { target_type: targetType, target_id: targetId },
    token,
  );
  if (!res.ok) return { ok: false, message: res.message };
  return { ok: true, result: res.data };
}
