import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHAT_ATTACHMENT_IMAGE_LIMIT,
  CHAT_ATTACHMENT_SIGNED_URL_SECONDS,
  CHAT_ATTACHMENT_VIDEO_LIMIT,
  attemptChatAttachmentUpload,
  formatChatAttachmentSize,
  mergeChatMessageById,
  normalizeChatAttachmentName,
  parseChatAttachment,
  parseFinalizedChatAttachmentMessage,
  parsePickedChatAttachment,
  parsePreparedChatAttachment,
  reconcileOptimisticChatMessage,
  validateChatAttachmentMetadata,
} from '../src/lib/chat-attachment-core.ts';
import { ChatAttachmentContextFence } from '../src/lib/chat-attachment-context-fence.ts';

const attachmentRow = {
  id: '59a14dab-d778-4c09-ab02-dc33fa8e9a80',
  storage_path: 'opaque/private/path',
  file_name: 'Campaign still.png',
  file_type: 'image/png',
  file_size: 2048,
};

test('normalizes safe names and rejects paths, controls, bidi, blank, and overlong values', () => {
  assert.equal(normalizeChatAttachmentName('  Campaign   still.png  '), 'Campaign still.png');
  assert.equal(normalizeChatAttachmentName('Ｆｉｌｅ.pdf'), 'File.pdf');
  for (const value of [
    '', ' ../secret.pdf', 'folder/image.png', 'safe\u0000.pdf', 'safe\u202Efdp.exe',
    'folder\uFF0Fimage.png', 'folder\uFF3Cimage.png', `${'a'.repeat(157)}.pdf`,
  ]) {
    assert.equal(normalizeChatAttachmentName(value), null);
  }
});

test('requires extension and MIME agreement with exact per-type byte limits', () => {
  assert.equal(validateChatAttachmentMetadata('photo.jpeg', 'image/jpeg', CHAT_ATTACHMENT_IMAGE_LIMIT).ok, true);
  assert.equal(validateChatAttachmentMetadata('clip.mov', 'video/quicktime', CHAT_ATTACHMENT_VIDEO_LIMIT).ok, true);
  assert.equal(validateChatAttachmentMetadata('photo.png', 'image/jpeg', 1).ok, false);
  assert.equal(validateChatAttachmentMetadata('document.docx', null, 1).ok, false);
  assert.equal(validateChatAttachmentMetadata('empty.pdf', 'application/pdf', 0).ok, false);
  assert.equal(validateChatAttachmentMetadata('large.pdf', 'application/pdf', CHAT_ATTACHMENT_IMAGE_LIMIT + 1).ok, false);
  assert.equal(validateChatAttachmentMetadata('large.mp4', 'video/mp4', CHAT_ATTACHMENT_VIDEO_LIMIT + 1).ok, false);
});

test('picker and database rows fail closed on malformed private metadata', () => {
  assert.deepEqual(parsePickedChatAttachment({ uri: 'file://x', name: 'proof.pdf', mimeType: 'application/pdf', size: 12 }), {
    uri: 'file://x', name: 'proof.pdf', mimeType: 'application/pdf', size: 12,
  });
  assert.equal(parsePickedChatAttachment({ uri: 'file://x', name: 'proof.pdf', mimeType: 'image/png', size: 12 }), null);
  assert.deepEqual(parseChatAttachment(attachmentRow), {
    id: attachmentRow.id,
    storagePath: attachmentRow.storage_path,
    fileName: attachmentRow.file_name,
    fileType: attachmentRow.file_type,
    fileSize: attachmentRow.file_size,
  });
  assert.equal(parseChatAttachment({ ...attachmentRow, id: 'not-a-uuid' }), null);
  assert.equal(parseChatAttachment({ ...attachmentRow, file_size: -1 }), null);
  assert.equal(parseChatAttachment({ ...attachmentRow, file_name: '../private.png' }), null);
});

test('prepare and finalize RPC results require exact opaque context and bounded fields', () => {
  const dealId = '6ab56194-b095-4aa0-9120-f1d4dbfb24f6';
  const actorId = '2daec6ce-405d-4494-8af7-252f6b05dd53';
  const reservationId = '9fe62933-a513-4112-a452-d1fe04139987';
  const objectId = 'd601910d-eaab-4be6-a12c-6dd0a779902a';
  const prepared = {
    reservation_id: reservationId,
    upload_path: `${dealId}/${actorId}/${reservationId}/${objectId}.png`,
    file_name: 'Campaign still.png', file_type: 'image/png', size_bytes: 2048,
  };
  assert.deepEqual(parsePreparedChatAttachment(prepared, {
    dealId, actorId, name: 'Campaign still.png', mimeType: 'image/png', size: 2048,
  }), { reservationId, uploadPath: prepared.upload_path });
  assert.equal(parsePreparedChatAttachment({ ...prepared, upload_path: `${dealId}/${actorId}/stolen.png` }, {
    dealId, actorId, name: 'Campaign still.png', mimeType: 'image/png', size: 2048,
  }), null);

  const finalized = {
    id: 'b156d742-e15c-46f8-97e8-dc2bc3f26441',
    sender_id: actorId,
    body: null,
    created_at: '2026-09-11T01:00:00Z',
    attachment: attachmentRow,
  };
  assert.deepEqual(parseFinalizedChatAttachmentMessage(finalized)?.attachment.fileName, 'Campaign still.png');
  assert.equal(parseFinalizedChatAttachmentMessage({ ...finalized, attachment: { ...attachmentRow, file_type: 'text/html' } }), null);
});

test('authoritative hydration de-duplicates finalize, Realtime, and focus refresh by message id', () => {
  const base = { id: 'm1', createdAt: '2026-09-11T01:00:00Z', body: 'first' };
  const hydrated = { id: 'm1', createdAt: '2026-09-11T01:00:00Z', body: null, attachment: attachmentRow };
  const next = mergeChatMessageById([base], hydrated);
  assert.equal(next.length, 1);
  assert.equal(next[0], hydrated);
  const later = { id: 'm2', createdAt: '2026-09-11T02:00:00Z', body: 'later' };
  assert.deepEqual(mergeChatMessageById(next, later).map((message) => message.id), ['m1', 'm2']);

  const optimistic = { id: 'temp-1', createdAt: later.createdAt, body: 'pending' };
  const alreadyRefetched = { id: 'm3', createdAt: later.createdAt, body: 'sent' };
  assert.deepEqual(
    reconcileOptimisticChatMessage([optimistic, alreadyRefetched], optimistic.id, alreadyRefetched),
    [alreadyRefetched],
  );
});

test('persisted upload with a lost response cleans its exact reservation once', async () => {
  const reservedPath = 'deal-a/actor-a/reservation-a/object-a.png';
  const otherPath = 'deal-b/actor-b/reservation-b/object-b.png';
  const persisted = new Set([otherPath]);
  const cleanupCalls = [];

  const outcome = await attemptChatAttachmentUpload(
    reservedPath,
    async () => {
      persisted.add(reservedPath);
      throw new Error('response lost after commit');
    },
    async (path) => {
      cleanupCalls.push(path);
      persisted.delete(path);
    },
  );

  assert.equal(outcome.ok, false);
  await outcome.cleanup();
  assert.deepEqual(cleanupCalls, [reservedPath]);
  assert.equal(persisted.has(reservedPath), false);
  assert.equal(persisted.has(otherPath), true);
});

test('all delayed attachment stages are fenced across account, deal, terminal, and message changes', async () => {
  const stages = ['picker', 'byte-read', 'prepare', 'upload', 'cleanup', 'finalize', 'hydrate', 'sign', 'open'];
  for (const stage of stages) {
    const fence = new ChatAttachmentContextFence();
    fence.switchContext('account-a:deal-a:live');
    const ticket = fence.begin('account-a:deal-a:live', stage === 'sign' || stage === 'open' ? 'message-a' : undefined);
    await Promise.resolve();
    fence.switchContext(stage === 'finalize' ? 'account-a:deal-a:terminal' : 'account-b:deal-b:live');
    assert.equal(fence.isCurrent(ticket, ticket.messageId), false, `${stage} result must be stale`);
  }
  const fence = new ChatAttachmentContextFence();
  fence.switchContext('account-a:deal-a:live');
  const signed = fence.begin('account-a:deal-a:live', 'message-a');
  assert.equal(fence.isCurrent(signed, 'message-b'), false);
  fence.invalidate();
  assert.equal(fence.isCurrent(signed, 'message-a'), false);
});

test('a delayed text send cannot reconcile or mutate busy state after an account/deal switch', async () => {
  const fence = new ChatAttachmentContextFence();
  fence.switchContext('account-a:deal-a:live');
  const ticket = fence.begin('account-a:deal-a:live');
  let messages = [{ id: 'temp-a', body: 'private A text' }];
  let sending = true;
  let resolveSend;
  const delayedSend = new Promise((resolve) => { resolveSend = resolve; });
  const reconcile = delayedSend.then((message) => {
    if (!fence.isCurrent(ticket)) return;
    messages = reconcileOptimisticChatMessage(messages, 'temp-a', message);
    sending = false;
  });

  fence.switchContext('account-b:deal-b:live');
  messages = [];
  sending = false;
  resolveSend({ id: 'server-a', body: 'private A text' });
  await reconcile;
  assert.deepEqual(messages, []);
  assert.equal(sending, false);
});

test('formats bounded attachment sizes for accessible file chips', () => {
  assert.equal(CHAT_ATTACHMENT_SIGNED_URL_SECONDS, 300);
  assert.equal(formatChatAttachmentSize(500), '500 B');
  assert.equal(formatChatAttachmentSize(2048), '2 KB');
  assert.equal(formatChatAttachmentSize(1.5 * 1024 * 1024), '1.5 MB');
});
