/**
 * Minimal FastAPI client (Phase 8 Cluster C — the first frontend→FastAPI call).
 *
 * Most of the app is Supabase-direct under RLS; FastAPI is only for things that
 * change deal state / need service_role (docs/api-architecture.md). Those endpoints
 * verify the caller's Supabase JWT, so we send it as a Bearer token.
 *
 * Base URL comes from EXPO_PUBLIC_API_URL (defaults to localhost for web/simulator
 * dev). On a physical device the laptop's LAN IP must be set there (Phase 14).
 */

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * POST JSON to a FastAPI path with the caller's access token. Maps every failure
 * to a friendly message — never surfaces a raw error or a FastAPI stack detail.
 */
export async function postJson<T>(
  path: string,
  body: unknown,
  accessToken: string,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // FastAPI puts a human string in `detail` for our raised errors; fall back
      // to a generic line for anything unexpected (5xx, network middle-boxes).
      let message = 'Something went wrong. Please try again.';
      try {
        const payload = await res.json();
        if (typeof payload?.detail === 'string') message = payload.detail;
      } catch {
        // non-JSON body — keep the generic message
      }
      return { ok: false, message };
    }

    return { ok: true, data: (await res.json()) as T };
  } catch {
    // Network / DNS / server down.
    return { ok: false, message: 'Could not reach the server. Check your connection.' };
  }
}

/** GET JSON from FastAPI with the same friendly-error contract as postJson. */
export async function getJson<T>(path: string, accessToken: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      let message = 'Something went wrong. Please try again.';
      try {
        const payload = await res.json();
        if (typeof payload?.detail === 'string') message = payload.detail;
      } catch {
        // Keep the generic message for a malformed error response.
      }
      return { ok: false, message };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection.' };
  }
}
