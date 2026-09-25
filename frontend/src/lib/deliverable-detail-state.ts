export type DeliverableDetail = {
  version: 1; asOf: string; dealId: string;
  deliverable: {
    id: string; displayName: string; contentFormat: string; platform: string; location: string | null;
    postingDate: string | null; postingWindowStart: string | null; postingWindowEnd: string | null;
    revisionCurrent: number; revisionMax: number; status: string; operationalAttention: boolean;
    currentSubmission: DraftSubmission | null; submissionHistory: DraftSubmission[]; historyTruncated: boolean;
    approval: Approval | null; liveProof: LiveProof | null;
  };
  usageRights: UsageRights; allowedActions: { canDownloadDrafts: boolean };
};

export type DraftSubmission = { id: string; roundNumber: number; lifecycle: string; originalFilename: string; mimeType: string; sizeBytes: number; submittedAt: string; submittedByName: string; comment: string | null; decidedAt: string | null; decidedByName: string | null; canDownload: true };
export type Approval = { status: 'pending' | 'approved' | 'rejected'; makerName: string; checkerName: string; roundNumber: number; comment: string | null; createdAt: string; decidedAt: string | null };
export type LiveProof = { finalUrl: string; host: string; title: string | null; verificationStatus: 'verified' | 'flagged' | 'confirmed'; verifiedAt: string; flaggedAt: string | null; confirmedAt: string | null };
export type UsageRights = { present: true; hasUsageRights: boolean; channels: string[]; startDate: string | null; endDate: string | null; isPerpetual: boolean; status: 'none' | 'perpetual' | 'active' | 'expiring' | 'expired' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const FORMATS = ['reel', 'static_post', 'story', 'carousel', 'yt_video', 'yt_short', 'blog', 'ugc_photo', 'podcast_read', 'x_thread', 'linkedin_post', 'pinterest_pin'];
const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'linkedin', 'x', 'pinterest', 'threads', 'podcast'];
const STATUSES = ['pending', 'submitted', 'in_revision', 'approved', 'posted'];
const LIFECYCLES = ['awaiting_review', 'revision_requested', 'approved'];

function invalid(): never { throw new Error('invalid deliverable detail response'); }
function record(value: unknown, keys: readonly string[]) { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); const found = Object.keys(value as object).sort(); const expected = [...keys].sort(); if (found.length !== expected.length || found.some((key, i) => key !== expected[i])) invalid(); return value as Record<string, unknown>; }
function text(value: unknown, max: number) { if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) invalid(); return value; }
function nullableText(value: unknown, max: number) { return value === null ? null : text(value, max); }
function id(value: unknown) { if (typeof value !== 'string' || !UUID.test(value)) invalid(); return value; }
function integer(value: unknown, max: number) { if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) invalid(); return value as number; }
function date(value: unknown, nullable = false): string | null { if (nullable && value === null) return null; if (typeof value !== 'string' || !DATE.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) invalid(); return value; }
function instant(value: unknown, nullable = false): string | null { if (nullable && value === null) return null; if (typeof value !== 'string' || !INSTANT.test(value) || !Number.isFinite(Date.parse(value))) invalid(); return value; }
function bool(value: unknown) { if (typeof value !== 'boolean') invalid(); return value; }
function enumValue<T extends string>(value: unknown, values: readonly T[]): T { if (typeof value !== 'string' || !values.includes(value as T)) invalid(); return value as T; }

function draft(value: unknown): DraftSubmission {
  const row = record(value, ['id', 'round_number', 'lifecycle', 'original_filename', 'mime_type', 'size_bytes', 'submitted_at', 'submitted_by_name', 'comment', 'decided_at', 'decided_by_name', 'can_download']);
  if (row.can_download !== true) invalid();
  return { id: id(row.id), roundNumber: integer(row.round_number, 100), lifecycle: enumValue(row.lifecycle, LIFECYCLES), originalFilename: text(row.original_filename, 255), mimeType: text(row.mime_type, 100), sizeBytes: integer(row.size_bytes, 1_000_000_000), submittedAt: instant(row.submitted_at) as string, submittedByName: text(row.submitted_by_name, 160), comment: nullableText(row.comment, 500), decidedAt: instant(row.decided_at, true), decidedByName: nullableText(row.decided_by_name, 160), canDownload: true };
}

function proof(value: unknown): LiveProof | null {
  if (value === null) return null;
  const row = record(value, ['final_url', 'host', 'title', 'verification_status', 'verified_at', 'flagged_at', 'confirmed_at']);
  const finalUrl = text(row.final_url, 2048); let parsed: URL;
  try { parsed = new URL(finalUrl); } catch { invalid(); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hostname !== text(row.host, 253)) invalid();
  return { finalUrl, host: parsed.hostname, title: nullableText(row.title, 160), verificationStatus: enumValue(row.verification_status, ['verified', 'flagged', 'confirmed']), verifiedAt: instant(row.verified_at) as string, flaggedAt: instant(row.flagged_at, true), confirmedAt: instant(row.confirmed_at, true) };
}

export function parseDeliverableDetail(value: unknown): DeliverableDetail {
  const root = record(value, ['version', 'as_of', 'deal_id', 'deliverable', 'usage_rights', 'allowed_actions']);
  if (root.version !== 1) invalid(); const dealId = id(root.deal_id);
  const row = record(root.deliverable, ['id', 'display_name', 'content_format', 'platform', 'location', 'posting_date', 'posting_window_start', 'posting_window_end', 'revision_current', 'revision_max', 'status', 'operational_attention', 'current_submission', 'submission_history', 'history_truncated', 'approval', 'live_proof']);
  const postingDate = date(row.posting_date, true); const windowStart = date(row.posting_window_start, true); const windowEnd = date(row.posting_window_end, true);
  if ((postingDate === null) === (windowStart === null) || (windowStart !== null && (windowEnd === null || windowStart > windowEnd))) invalid();
  if (!Array.isArray(row.submission_history) || row.submission_history.length > 20) invalid();
  const history = row.submission_history.map(draft); if (new Set(history.map((item) => item.id)).size !== history.length) invalid();
  const current = row.current_submission === null ? null : draft(row.current_submission);
  if (current && !history.some((item) => item.id === current.id)) invalid();
  const revisionCurrent = integer(row.revision_current, 100); const revisionMax = integer(row.revision_max, 100);
  if (revisionCurrent > revisionMax) invalid();
  let approval: Approval | null = null;
  if (row.approval !== null) { const approvalRow = record(row.approval, ['status', 'maker_name', 'checker_name', 'round_number', 'comment', 'created_at', 'decided_at']); const approvalStatus = enumValue(approvalRow.status, ['pending', 'approved', 'rejected']); const decidedAt = instant(approvalRow.decided_at, true); if ((approvalStatus === 'pending') !== (decidedAt === null)) invalid(); approval = { status: approvalStatus, makerName: text(approvalRow.maker_name, 160), checkerName: text(approvalRow.checker_name, 160), roundNumber: integer(approvalRow.round_number, 100), comment: nullableText(approvalRow.comment, 500), createdAt: instant(approvalRow.created_at) as string, decidedAt }; }
  const rightsRow = record(root.usage_rights, ['present', 'has_usage_rights', 'channels', 'start_date', 'end_date', 'is_perpetual', 'status']);
  if (rightsRow.present !== true || !Array.isArray(rightsRow.channels) || rightsRow.channels.length > 50) invalid();
  const hasRights = bool(rightsRow.has_usage_rights); const perpetual = bool(rightsRow.is_perpetual); const start = date(rightsRow.start_date, true); const end = date(rightsRow.end_date, true); const status = enumValue(rightsRow.status, ['none', 'perpetual', 'active', 'expiring', 'expired']);
  if ((!hasRights && (rightsRow.channels.length || start || end || perpetual || status !== 'none')) || (hasRights && (!start || (perpetual ? end !== null || status !== 'perpetual' : !end || !['active', 'expiring', 'expired'].includes(status)))) || (start && end && start > end)) invalid();
  const actions = record(root.allowed_actions, ['can_download_drafts']);
  return { version: 1, asOf: instant(root.as_of) as string, dealId, deliverable: { id: id(row.id), displayName: text(row.display_name, 160), contentFormat: enumValue(row.content_format, FORMATS), platform: enumValue(row.platform, PLATFORMS), location: nullableText(row.location, 160), postingDate, postingWindowStart: windowStart, postingWindowEnd: windowEnd, revisionCurrent, revisionMax, status: enumValue(row.status, STATUSES), operationalAttention: bool(row.operational_attention), currentSubmission: current, submissionHistory: history, historyTruncated: bool(row.history_truncated), approval, liveProof: proof(row.live_proof) }, usageRights: { present: true, hasUsageRights: hasRights, channels: rightsRow.channels.map((channel) => text(channel, 100)), startDate: start, endDate: end, isPerpetual: perpetual, status }, allowedActions: { canDownloadDrafts: bool(actions.can_download_drafts) } };
}

export class DeliverableDetailContextFence {
  private context = ''; private generation = 0;
  switchContext(context: string) { if (context !== this.context) { this.context = context; this.generation += 1; } }
  begin(context: string) { this.switchContext(context); this.generation += 1; return { context, generation: this.generation }; }
  invalidate() { this.generation += 1; }
  isCurrent(ticket: { context: string; generation: number }) { return ticket.context === this.context && ticket.generation === this.generation; }
}
