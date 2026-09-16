export const CHAT_ATTACHMENT_BUCKET = 'deal-files';
export const CHAT_ATTACHMENT_SIGNED_URL_SECONDS = 300;
export const CHAT_ATTACHMENT_IMAGE_LIMIT = 10 * 1024 * 1024;
export const CHAT_ATTACHMENT_VIDEO_LIMIT = 50 * 1024 * 1024;

export const CHAT_ATTACHMENT_MIME_BY_EXTENSION = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
} as const;

export type ChatAttachmentMime = (typeof CHAT_ATTACHMENT_MIME_BY_EXTENSION)[keyof typeof CHAT_ATTACHMENT_MIME_BY_EXTENSION];

export type ChatAttachment = {
  id: string;
  storagePath: string;
  fileName: string;
  fileType: ChatAttachmentMime;
  fileSize: number;
};

export type PickedChatAttachment = {
  uri: string;
  name: string;
  mimeType: ChatAttachmentMime;
  size: number | null;
};

type PickerLike = { uri?: unknown; name?: unknown; mimeType?: unknown; size?: unknown };
type AttachmentRow = {
  id?: unknown;
  storage_path?: unknown;
  file_name?: unknown;
  file_type?: unknown;
  file_size?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_OR_BIDI_RE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export function normalizeChatAttachmentName(value: string): string | null {
  const compatibilityNormalized = value.normalize('NFKC');
  if (compatibilityNormalized.includes('/') || compatibilityNormalized.includes('\\')
    || CONTROL_OR_BIDI_RE.test(compatibilityNormalized)) return null;
  const normalized = compatibilityNormalized.replace(/\s+/gu, ' ').trim();
  return normalized.length >= 1 && normalized.length <= 160 ? normalized : null;
}

export function attachmentMimeForName(name: string): ChatAttachmentMime | null {
  const extension = name.match(/\.([^.]+)$/u)?.[1]?.toLowerCase();
  if (!extension) return null;
  return CHAT_ATTACHMENT_MIME_BY_EXTENSION[extension as keyof typeof CHAT_ATTACHMENT_MIME_BY_EXTENSION] ?? null;
}

export function validateChatAttachmentMetadata(
  name: string,
  claimedMime: string | null | undefined,
  size: number,
): { ok: true; name: string; mimeType: ChatAttachmentMime; size: number } | { ok: false; message: string } {
  const safeName = normalizeChatAttachmentName(name);
  const nameMime = safeName ? attachmentMimeForName(safeName) : null;
  if (!safeName || !nameMime || (claimedMime && claimedMime !== nameMime)) {
    return { ok: false, message: 'Choose a PDF, JPEG, PNG, WebP, MP4, or MOV file with a matching extension.' };
  }
  if (!Number.isSafeInteger(size) || size < 1) {
    return { ok: false, message: 'That file is empty or could not be read. Choose another file.' };
  }
  const limit = nameMime.startsWith('video/') ? CHAT_ATTACHMENT_VIDEO_LIMIT : CHAT_ATTACHMENT_IMAGE_LIMIT;
  if (size > limit) {
    return {
      ok: false,
      message: nameMime.startsWith('video/')
        ? 'Videos must be 50 MB or smaller.'
        : 'Images and PDFs must be 10 MB or smaller.',
    };
  }
  return { ok: true, name: safeName, mimeType: nameMime, size };
}

export function parsePickedChatAttachment(asset: PickerLike): PickedChatAttachment | null {
  if (typeof asset.uri !== 'string' || !asset.uri || typeof asset.name !== 'string') return null;
  const safeName = normalizeChatAttachmentName(asset.name);
  const mimeType = safeName ? attachmentMimeForName(safeName) : null;
  if (!safeName || !mimeType || (typeof asset.mimeType === 'string' && asset.mimeType !== mimeType)) return null;
  const size = asset.size == null ? null : Number(asset.size);
  if (size !== null && (!Number.isSafeInteger(size) || size < 1)) return null;
  if (size !== null && !validateChatAttachmentMetadata(safeName, mimeType, size).ok) return null;
  return { uri: asset.uri, name: safeName, mimeType, size };
}

export function parseChatAttachment(row: AttachmentRow): ChatAttachment | null {
  if (!UUID_RE.test(String(row.id ?? '')) || typeof row.storage_path !== 'string' || !row.storage_path) return null;
  if (typeof row.file_name !== 'string' || typeof row.file_type !== 'string') return null;
  const size = Number(row.file_size);
  const validated = validateChatAttachmentMetadata(row.file_name, row.file_type, size);
  if (!validated.ok) return null;
  return {
    id: String(row.id),
    storagePath: row.storage_path,
    fileName: validated.name,
    fileType: validated.mimeType,
    fileSize: validated.size,
  };
}

export type PreparedChatAttachment = { reservationId: string; uploadPath: string };

export async function attemptChatAttachmentUpload<T extends { error?: unknown }>(
  storagePath: string,
  upload: () => Promise<T>,
  remove: (path: string) => Promise<void>,
): Promise<
  | { ok: true; result: T; cleanup: () => Promise<void> }
  | { ok: false; error: unknown; cleanup: () => Promise<void> }
> {
  let cleanupAttempted = false;
  const cleanup = async () => {
    if (cleanupAttempted) return;
    cleanupAttempted = true;
    try {
      await remove(storagePath);
    } catch {
      // Cleanup is deliberately best-effort and remains exactly-once.
    }
  };

  try {
    const result = await upload();
    if (result.error) throw result.error;
    return { ok: true, result, cleanup };
  } catch (error) {
    // A rejected upload response is not proof that Storage did not commit.
    await cleanup();
    return { ok: false, error, cleanup };
  }
}

export function parsePreparedChatAttachment(
  value: unknown,
  expected: { dealId: string; actorId: string; name: string; mimeType: ChatAttachmentMime; size: number },
): PreparedChatAttachment | null {
  if (!value || typeof value !== 'object' || !UUID_RE.test(expected.dealId) || !UUID_RE.test(expected.actorId)) return null;
  const row = value as Record<string, unknown>;
  const reservationId = String(row.reservation_id ?? '');
  if (!UUID_RE.test(reservationId) || typeof row.upload_path !== 'string') return null;
  if (row.file_name !== expected.name || row.file_type !== expected.mimeType || Number(row.size_bytes) !== expected.size) return null;
  const canonicalExtension = expected.mimeType === 'image/jpeg'
    ? 'jpg'
    : Object.entries(CHAT_ATTACHMENT_MIME_BY_EXTENSION).find(([, mime]) => mime === expected.mimeType)?.[0];
  if (!canonicalExtension) return null;
  const prefix = `${expected.dealId}/${expected.actorId}/${reservationId}/`;
  const objectName = row.upload_path.slice(prefix.length);
  if (!row.upload_path.startsWith(prefix) || !UUID_RE.test(objectName.slice(0, 36)) || objectName !== `${objectName.slice(0, 36)}.${canonicalExtension}`) return null;
  return { reservationId, uploadPath: row.upload_path };
}

export type FinalizedChatAttachmentMessage = {
  id: string;
  senderId: string;
  body: string | null;
  createdAt: string;
  attachment: ChatAttachment;
};

export function parseFinalizedChatAttachmentMessage(value: unknown): FinalizedChatAttachmentMessage | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const attachment = parseChatAttachment((row.attachment ?? {}) as Record<string, unknown>);
  if (!UUID_RE.test(String(row.id ?? '')) || !UUID_RE.test(String(row.sender_id ?? '')) || !attachment) return null;
  if (row.body !== null && typeof row.body !== 'string') return null;
  if (typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) return null;
  return {
    id: String(row.id),
    senderId: String(row.sender_id),
    body: row.body as string | null,
    createdAt: row.created_at,
    attachment,
  };
}

export function formatChatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function mergeChatMessageById<T extends { id: string }>(messages: T[], incoming: T): T[] {
  const index = messages.findIndex((message) => message.id === incoming.id);
  if (index < 0) return [...messages, incoming].sort((a, b) => {
    const aTime = 'createdAt' in a ? String(a.createdAt) : '';
    const bTime = 'createdAt' in b ? String(b.createdAt) : '';
    return aTime.localeCompare(bTime);
  });
  const next = [...messages];
  next[index] = incoming;
  return next;
}

/** Replaces one local optimistic row without duplicating an already-refetched server row. */
export function reconcileOptimisticChatMessage<T extends { id: string }>(
  messages: T[],
  optimisticId: string,
  authoritative: T,
): T[] {
  return mergeChatMessageById(
    messages.filter((message) => message.id !== optimisticId),
    authoritative,
  );
}
