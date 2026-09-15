import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

import { getJson } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import {
  CHAT_ATTACHMENT_BUCKET,
  CHAT_ATTACHMENT_SIGNED_URL_SECONDS,
  attemptChatAttachmentUpload,
  parseFinalizedChatAttachmentMessage,
  parsePreparedChatAttachment,
  validateChatAttachmentMetadata,
  type FinalizedChatAttachmentMessage,
  type PickedChatAttachment,
} from '@/lib/chat-attachment-core';

async function readAttachmentBytes(uri: string): Promise<Uint8Array | ArrayBuffer> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('read failed');
    return response.arrayBuffer();
  }
  return new FileSystem.File(uri).bytes();
}

async function bestEffortRemove(storagePath: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.storage.from(CHAT_ATTACHMENT_BUCKET).remove([storagePath]);
  } catch {
    // The object may already be bound or the old context may have lost access.
  }
}

function rpcError(error: unknown): { message: string; readOnly: boolean } {
  const serialized = JSON.stringify(error ?? {});
  if (serialized.includes('DEAL_THREAD_READ_ONLY')) {
    return { message: 'This deal is closed, so the thread is now read-only.', readOnly: true };
  }
  if (serialized.includes('CHAT_ATTACHMENT_INVALID_FILE')) {
    return { message: 'That file is not supported. Check its type and size, then try again.', readOnly: false };
  }
  if (serialized.includes('CHAT_ATTACHMENT_RESERVATION_EXPIRED')) {
    return { message: 'The upload timed out. Please choose the file again.', readOnly: false };
  }
  return { message: 'Couldn’t send that attachment. Check your connection and try again.', readOnly: false };
}

export async function sendChatAttachment(
  dealId: string,
  actorId: string,
  picked: PickedChatAttachment,
  caption: string,
  isCurrent: () => boolean,
): Promise<
  | { ok: true; message: FinalizedChatAttachmentMessage }
  | { ok: false; message: string; readOnly?: boolean; stale?: boolean }
> {
  if (!supabase) return { ok: false, message: 'You need to sign in again before uploading.' };
  let uploadPath: string | null = null;
  let reservationId: string | null = null;
  let cleanupUploadAttempt: (() => Promise<void>) | null = null;
  try {
    const bytes = await readAttachmentBytes(picked.uri);
    if (!isCurrent()) return { ok: false, stale: true, message: 'This attachment selection is no longer active.' };
    const validated = validateChatAttachmentMetadata(picked.name, picked.mimeType, bytes.byteLength);
    if (!validated.ok) return validated;

    const prepared = await supabase.rpc('prepare_chat_attachment_upload', {
      p_deal_id: dealId,
      p_file_name: validated.name,
      p_file_type: validated.mimeType,
      p_size_bytes: validated.size,
    });
    if (prepared.error) return { ok: false, ...rpcError(prepared.error) };
    if (!isCurrent()) return { ok: false, stale: true, message: 'This attachment selection is no longer active.' };
    const data = parsePreparedChatAttachment(prepared.data, {
      dealId, actorId, name: validated.name, mimeType: validated.mimeType, size: validated.size,
    });
    if (!data) {
      return { ok: false, message: 'The upload could not be prepared safely. Please try again.' };
    }
    reservationId = data.reservationId;
    uploadPath = data.uploadPath;

    const upload = await attemptChatAttachmentUpload(
      uploadPath,
      () => supabase!.storage.from(CHAT_ATTACHMENT_BUCKET).upload(uploadPath!, bytes, {
        contentType: validated.mimeType,
        upsert: false,
      }),
      bestEffortRemove,
    );
    cleanupUploadAttempt = upload.cleanup;
    if (!upload.ok) throw upload.error;
    if (!isCurrent()) {
      await cleanupUploadAttempt();
      return { ok: false, stale: true, message: 'This attachment selection is no longer active.' };
    }

    const finalize = () => supabase!.rpc('finalize_chat_attachment_upload', {
      p_deal_id: dealId,
      p_reservation_id: reservationId,
      p_caption: caption.trim() || null,
    });
    let finalized;
    try {
      finalized = await finalize();
    } catch (firstError) {
      if (!isCurrent()) throw firstError;
      finalized = await finalize();
    }
    if (finalized.error && isCurrent()) finalized = await finalize();
    if (finalized.error) throw finalized.error;
    if (!isCurrent()) {
      await cleanupUploadAttempt();
      return { ok: false, stale: true, message: 'This attachment selection is no longer active.' };
    }
    const message = parseFinalizedChatAttachmentMessage(finalized.data);
    if (!message) {
      await cleanupUploadAttempt();
      return { ok: false, message: 'The sent attachment could not be verified. Refresh the thread.' };
    }
    return { ok: true, message };
  } catch (error) {
    if (cleanupUploadAttempt) {
      // Bound objects cannot satisfy the delete policy, which makes a lost
      // finalize response safe: the retry recovers it, and cleanup cannot erase it.
      await cleanupUploadAttempt();
    }
    const friendly = rpcError(error);
    return isCurrent() ? { ok: false, ...friendly } : { ok: false, stale: true, message: 'This attachment selection is no longer active.' };
  }
}

export async function getSignedChatAttachmentUrl(
  dealId: string,
  messageId: string,
  attachmentId: string,
): Promise<string | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return null;
  const result = await getJson<unknown>(
    `/deals/${dealId}/messages/${messageId}/attachments/${attachmentId}/download`,
    token,
  );
  if (!result.ok || !result.data || typeof result.data !== 'object') return null;
  const payload = result.data as Record<string, unknown>;
  if (Object.keys(payload).length !== 2
    || payload.expires_in !== CHAT_ATTACHMENT_SIGNED_URL_SECONDS
    || typeof payload.url !== 'string') return null;
  try {
    const parsed = new URL(payload.url);
    return parsed.protocol === 'https:' ? payload.url : null;
  } catch {
    return null;
  }
}
