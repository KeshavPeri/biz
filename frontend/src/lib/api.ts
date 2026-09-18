/**
 * Minimal FastAPI client (Phase 8 Cluster C — the first frontend→FastAPI call).
 *
 * Most of the app is Supabase-direct under RLS; FastAPI is only for things that
 * change deal state / need service_role (docs/api-architecture.md). Those endpoints
 * verify the caller's Supabase JWT, so we send it as a Bearer token.
 *
 * Base URL comes from EXPO_PUBLIC_API_URL; in local dev its host follows the
 * host the app was loaded from (see api-base.ts), so a phone on the LAN works
 * without rebuilding when the laptop's IP changes.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { resolveApiBase } from './api-base';

/** Host this app was loaded from: the page on web, the Metro dev server on native. */
function currentHost(): string | undefined {
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' ? window.location?.hostname || undefined : undefined;
  }
  const hostUri = Constants.expoConfig?.hostUri;
  return hostUri ? hostUri.split(':')[0] : undefined;
}

let apiBase: string | undefined;

/** Resolved lazily so the web static render (no window) never pins the wrong host. */
function getApiBase(): string {
  apiBase ??= resolveApiBase(process.env.EXPO_PUBLIC_API_URL, currentHost());
  return apiBase;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string; status?: number };

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
    const res = await fetch(`${getApiBase()}${path}`, {
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
      return { ok: false, message, status: res.status };
    }

    return { ok: true, data: (await res.json()) as T };
  } catch {
    // Network / DNS / server down.
    return { ok: false, message: 'Could not reach the server. Check your connection.' };
  }
}

/** PUT JSON for versioned API resources, with the same bounded error surface. */
export async function putJson<T>(
  path: string,
  body: unknown,
  accessToken: string,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let message = 'Something went wrong. Please try again.';
      try {
        const payload = await res.json();
        if (typeof payload?.detail === 'string') message = payload.detail;
      } catch {
        // Keep the generic message for malformed/non-JSON responses.
      }
      return { ok: false, message, status: res.status };
    }

    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection.' };
  }
}

/** GET JSON from FastAPI with the same friendly-error contract as postJson. */
export async function getJson<T>(path: string, accessToken: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      let message = 'Something went wrong. Please try again.';
      try {
        const payload = await res.json();
        if (typeof payload?.detail === 'string') message = payload.detail;
      } catch {
        // Keep the generic message for a malformed error response.
      }
      return { ok: false, message, status: res.status };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection.' };
  }
}
