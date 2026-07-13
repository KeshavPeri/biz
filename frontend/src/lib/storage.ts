import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Session storage for the Supabase client (Phase 7.4).
 *
 * WHY a custom adapter: Supabase persists the session (access + refresh tokens)
 * through whatever `storage` we hand it. The default on native is AsyncStorage,
 * which writes tokens as PLAINTEXT to app storage. We instead keep them in the
 * OS keychain / keystore via expo-secure-store — the right home for auth secrets.
 *
 * THE CATCH: SecureStore caps a single value at 2048 bytes, and a Supabase
 * session comfortably exceeds that. So on native we CHUNK: the value is split
 * across numbered sub-keys (`<key>.0`, `.1`, …) plus a `<key>.__count` marker,
 * and reassembled on read. On web there is no keychain, so we let Supabase use
 * its own default (localStorage) by exporting `undefined`.
 */

// Comfortably under the 2048-byte SecureStore limit (leaves headroom for UTF-8
// multi-byte chars, since the limit is bytes and length is chars).
const CHUNK_SIZE = 1800;

// SecureStore keys must match [A-Za-z0-9._-]; Supabase's default key contains
// none other than those, but sanitise defensively so a chunk key is always valid.
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

const countKey = (key: string) => `${safeKey(key)}.__count`;
const chunkKey = (key: string, i: number) => `${safeKey(key)}.${i}`;

/**
 * A chunking SecureStore adapter. Implements the tiny async storage interface
 * Supabase expects (`getItem` / `setItem` / `removeItem`).
 */
const LargeSecureStore = {
  async getItem(key: string): Promise<string | null> {
    const countRaw = await SecureStore.getItemAsync(countKey(key));
    if (countRaw === null) return null;

    const count = Number.parseInt(countRaw, 10);
    if (!Number.isFinite(count) || count <= 0) return null;

    const parts: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      // A missing chunk means the stored value is corrupt/partial — treat the
      // whole thing as absent so Supabase falls back to a fresh login.
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    // Clear any previous (possibly longer) value first, so stale chunks can't
    // leak into a future read.
    await this.removeItem(key);

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    for (let i = 0; i < chunks.length; i += 1) {
      await SecureStore.setItemAsync(chunkKey(key, i), chunks[i]);
    }
    await SecureStore.setItemAsync(countKey(key), String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    const countRaw = await SecureStore.getItemAsync(countKey(key));
    if (countRaw !== null) {
      const count = Number.parseInt(countRaw, 10);
      if (Number.isFinite(count)) {
        for (let i = 0; i < count; i += 1) {
          await SecureStore.deleteItemAsync(chunkKey(key, i));
        }
      }
      await SecureStore.deleteItemAsync(countKey(key));
    }
  },
};

/**
 * The storage passed to `createClient`. `undefined` on web tells Supabase to use
 * its built-in default (localStorage), which is already guarded for SSR/export.
 */
export const authStorage = Platform.OS === 'web' ? undefined : LargeSecureStore;
