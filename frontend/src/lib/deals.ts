import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import type { DocumentPickerAsset } from 'expo-document-picker';

import { supabase } from '@/lib/supabase';
import { getJson, postJson, putJson } from '@/lib/api';

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

/* ─────────────────────────────────────────────────────────────────────────
 * Pending accept / decline (task 9.5, B3-016) — the first real server-side
 * stage transition. Routed through FastAPI (changes deal stage): the server is
 * the source of truth; the client only requests. Sends the session token so the
 * backend can verify + enforce the recipient/pending/72h guards.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Accept result:
 *  - transitioned → the deal moved to Chatting.
 *  - needsAck → a warn-only exclusivity notice; re-call with acknowledge=true.
 */
export type AcceptOutcome =
  | { ok: true; transitioned: true; exclusivityWarning?: string }
  | { ok: true; transitioned: false; needsAck: true; exclusivityWarning: string }
  | { ok: false; message: string };

type AcceptResponse = {
  transitioned: boolean;
  requires_acknowledgement?: boolean;
  exclusivity_warning?: string;
  stage?: string;
};

async function sessionToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Recipient accepts a Pending connection (→ Chatting). */
export async function acceptDeal(dealId: string, acknowledgeExclusivity = false): Promise<AcceptOutcome> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };

  const res = await postJson<AcceptResponse>(
    `/deals/${dealId}/accept`,
    { acknowledge_exclusivity: acknowledgeExclusivity },
    token,
  );
  if (!res.ok) return { ok: false, message: res.message };

  if (res.data.requires_acknowledgement) {
    return {
      ok: true,
      transitioned: false,
      needsAck: true,
      exclusivityWarning: res.data.exclusivity_warning ?? 'This creator has an active exclusivity arrangement.',
    };
  }
  return { ok: true, transitioned: true, exclusivityWarning: res.data.exclusivity_warning };
}

/** Recipient declines a Pending connection (→ Declined, terminal). */
export async function declineDeal(
  dealId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };

  const res = await postJson<{ transitioned: boolean }>(`/deals/${dealId}/decline`, {}, token);
  if (!res.ok) return { ok: false, message: res.message };
  return { ok: true };
}

/**
 * The remaining stage-transition requests the sticky action bar wires (9.7). Each
 * maps 1:1 to a documented endpoint in backend/api/deals.py. accept/decline stay
 * separate above (accept has the exclusivity-ack two-step). Downstream guards are
 * stub-built today, so these often return the engine's clean 409 "not available
 * yet" — the caller surfaces `message` rather than crashing.
 */
export type TransitionAction = 'cancel' | 'close';

export async function requestDealTransition(
  dealId: string,
  action: TransitionAction,
): Promise<{ ok: true; stage?: string } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };

  const res = await postJson<{ transitioned: boolean; stage?: string }>(`/deals/${dealId}/${action}`, {}, token);
  if (!res.ok) return { ok: false, message: res.message };
  return { ok: true, stage: res.data.stage };
}

/* ── Chatting Gate A — 9.9 checklist + 9.10 two-side request ───────────── */

export type ChecklistStatus = 'found' | 'not_discussed' | 'ambiguous';
export type SummaryRequestStatus = 'idle' | 'awaiting_confirmation' | 'ready_for_generation';

export type SummaryChecklistItem = {
  key: string;
  label: string;
  status: ChecklistStatus;
  missing_children: string[];
  is_complete: boolean;
  override: { state: 'awaiting_confirmation' | 'confirmed'; proposed_by: string; proposer_side: 'creator' | 'brand' } | null;
};

export type SummaryChecklist = {
  checklist: SummaryChecklistItem[];
  missing_fields: Pick<SummaryChecklistItem, 'key' | 'label' | 'status' | 'missing_children'>[];
  summary_request_allowed: boolean;
  request_status: SummaryRequestStatus;
  requester_side: 'creator' | 'brand' | null;
  requested_by: string | null;
  confirmed_by: string | null;
  can_act: boolean;
  viewer_side: 'creator' | 'brand';
};

async function summaryPost(
  dealId: string,
  path: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const res = await postJson<unknown>(`/deals/${dealId}/${path}`, {}, token);
  return res.ok ? { ok: true } : { ok: false, message: res.message };
}

export async function fetchSummaryChecklist(dealId: string): Promise<{ ok: true; data: SummaryChecklist } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const res = await getJson<SummaryChecklist>(`/deals/${dealId}/summary-checklist`, token);
  return res.ok ? { ok: true, data: res.data } : { ok: false, message: res.message };
}

export const requestTermsSummary = (dealId: string) => summaryPost(dealId, 'request-summary');
export const confirmTermsSummaryRequest = (dealId: string) => summaryPost(dealId, 'confirm-summary-request');
export const deferTermsSummaryRequest = (dealId: string) => summaryPost(dealId, 'summary-request-not-yet');
export const proposeChecklistOverride = (dealId: string, fieldKey: string) =>
  summaryPost(dealId, `summary-checklist/${fieldKey}/override`);
export const confirmChecklistOverride = (dealId: string, fieldKey: string) =>
  summaryPost(dealId, `summary-checklist/${fieldKey}/confirm-override`);

/* ── Versioned 22-field review + all-participant Gate B (workplan 10-C) ── */

export type TermsReviewField = {
  key: string;
  label: string;
  status: ChecklistStatus;
  value: unknown;
  evidence: { message_id: string; quote: string }[];
  applicable: boolean;
  blocks_approval: boolean;
};

export type TermsApprover = {
  profile_id: string;
  display_name: string;
  role: ParticipantRole;
  status: 'pending' | 'approved' | 'changes_requested';
  comment: string | null;
  decided_at: string | null;
};

export type TermsReviewState = {
  deal_id: string;
  stage: DealStage;
  summary: {
    id: string;
    status: 'pending_approval' | 'approved' | 'issue_raised';
    schema_version: string;
    generated_at: string;
    fields: TermsReviewField[];
    unresolved_fields: string[];
    approvers: TermsApprover[];
  } | null;
};

export async function fetchTermsReview(
  dealId: string,
): Promise<{ ok: true; data: TermsReviewState } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<TermsReviewState>(`/deals/${dealId}/terms-summary`, token);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message };
}

export async function decideTermsSummary(
  dealId: string,
  summaryId: string,
  decision: 'approved' | 'issue_raised',
  comment?: string,
): Promise<{ ok: true; transitioned: boolean; idempotent: boolean } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<{ transitioned: boolean; idempotent: boolean }>(
    `/deals/${dealId}/approve-summary`,
    { summary_id: summaryId, decision, comment: comment?.trim() || null },
    token,
  );
  return result.ok
    ? { ok: true, transitioned: result.data.transitioned, idempotent: result.data.idempotent }
    : { ok: false, message: result.message };
}

/* ── Versioned creative brief (workplan 9.13-A) ── */

export type CreativeBriefContent = {
  objective: string;
  guidelines: string;
  dos: string[];
  donts: string[];
  hashtags: string[];
  caption_guidance: string;
};

export type CreativeBriefVersion = {
  id: string;
  version: number;
  content: CreativeBriefContent;
  created_by: string | null;
  created_by_display_name: string;
  created_at: string;
  acknowledged_by_creator: boolean;
  acknowledged_by: string | null;
  acknowledged_by_display_name: string | null;
  acknowledged_at: string | null;
};

export type CreativeBriefState = {
  deal_id: string;
  stage: DealStage;
  latest: CreativeBriefVersion | null;
  history: CreativeBriefVersion[];
  history_order: 'newest_first';
  allowed_actions: {
    can_create_version: boolean;
    can_acknowledge_latest: boolean;
  };
};

export async function fetchCreativeBriefs(
  dealId: string,
): Promise<{ ok: true; data: CreativeBriefState } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<CreativeBriefState>(`/deals/${dealId}/briefs`, token);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message };
}

export async function createCreativeBriefVersion(
  dealId: string,
  expectedVersion: number,
  content: CreativeBriefContent,
): Promise<{ ok: true; data: CreativeBriefState } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<CreativeBriefState>(
    `/deals/${dealId}/briefs`,
    { expected_version: expectedVersion, content },
    token,
  );
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message };
}

export async function acknowledgeCreativeBrief(
  dealId: string,
  briefId: string,
): Promise<{ ok: true; data: CreativeBriefState } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<CreativeBriefState>(
    `/deals/${dealId}/briefs/${briefId}/acknowledge`,
    {},
    token,
  );
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message };
}

/* ── Canonical deliverable plan (workplan 9.13-B) ── */

export type DeliverableContentFormat =
  | 'reel' | 'static_post' | 'story' | 'carousel' | 'yt_video' | 'yt_short'
  | 'blog' | 'ugc_photo' | 'podcast_read' | 'x_thread' | 'linkedin_post' | 'pinterest_pin';

export type DeliverablePlatform =
  | 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'x' | 'pinterest' | 'threads' | 'podcast';

export type CanonicalDeliverable = {
  id: string;
  sequence: number;
  display_name: string;
  content_format: DeliverableContentFormat;
  platform: DeliverablePlatform;
  posting_date: string | null;
  posting_window_start: string | null;
  posting_window_end: string | null;
  location: string | null;
  revision_max: number;
  revision_current: number;
  status: 'pending' | 'submitted' | 'in_revision' | 'approved' | 'posted';
  content_ops_attention: boolean;
  content_ops_reason: 'revision_rounds_exhausted' | null;
  current_submission: ContentSubmission | null;
  submission_history: ContentSubmission[];
  content_approval: ContentApprovalState | null;
  available_actions: {
    can_submit_content: boolean;
    can_request_revision: boolean;
    can_approve_content: boolean;
    can_submit_live_url: boolean;
  };
  post_state: DeliverablePostState;
};

export type LivePostVerificationStatus = 'verified' | 'flagged' | 'confirmed';

export type LivePostEvidence = {
  id: string;
  version: number;
  submitted_url: string;
  final_url: string;
  host: string;
  title: string | null;
  site_name: string | null;
  description: string | null;
  verification_status: LivePostVerificationStatus;
  submitted_by_name: string;
  verified_at: string;
  flag_reason: string | null;
  flagged_by_name: string | null;
  flagged_at: string | null;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
};

export type DeliverablePostState = {
  current: LivePostEvidence | null;
  history: LivePostEvidence[];
  history_truncated: boolean;
  verification_scope: 'platform_domain' | 'public_https';
  future_actions: {
    can_submit_or_replace: boolean;
    can_flag: boolean;
  };
};

export type ContentApprovalState = {
  request_id: string;
  status: 'pending' | 'approved' | 'rejected';
  maker_id: string;
  maker_name: string;
  checker_id: string;
  checker_name: string;
  revision_id: string;
  round_number: number;
  comment: string | null;
  created_at: string;
  decided_at: string | null;
  can_decide: boolean;
};

export type ContentSubmission = {
  id: string;
  round_number: number;
  lifecycle: 'awaiting_review' | 'revision_requested' | 'approved';
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  submitted_at: string;
  submitted_by_name: string;
  comment: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  can_download: true;
};

export type CanonicalDeliverableState = {
  deal_id: string;
  stage: 'creating' | 'posted' | 'payment' | 'closed';
  deliverables: CanonicalDeliverable[];
  post_confirmation: {
    expected_versions: { deliverable_id: string; version: number }[];
    future_actions: { can_confirm_all: boolean };
  };
  order: 'sequence_ascending';
};

export async function fetchCanonicalDeliverables(
  dealId: string,
): Promise<{ ok: true; data: CanonicalDeliverableState } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<CanonicalDeliverableState>(`/deals/${dealId}/deliverables`, token);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message };
}

type MutationOutcome = { ok: true } | { ok: false; message: string };

export async function submitLivePost(
  dealId: string,
  deliverableId: string,
  url: string,
  expectedVersion: number,
): Promise<MutationOutcome> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<unknown>(
    `/deals/${dealId}/deliverables/${deliverableId}/live-post`,
    { url, expected_version: expectedVersion },
    token,
  );
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function flagLivePost(
  dealId: string,
  deliverableId: string,
  expectedVersion: number,
  reason: string,
): Promise<MutationOutcome> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<unknown>(
    `/deals/${dealId}/deliverables/${deliverableId}/live-post/flag`,
    { expected_version: expectedVersion, reason },
    token,
  );
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export type PaymentDetailsState = {
  deal_id: string;
  stage: 'posted' | 'payment' | 'closed';
  creator_legal_name: string | null;
  creator_bank_or_upi: string | null;
  creator_tax_id: string | null;
  brand_billing_name: string | null;
  brand_billing_address: string | null;
  brand_gst: string | null;
  creator_version: number;
  brand_version: number;
  creator_complete: boolean;
  brand_complete: boolean;
  creator_updated_at: string | null;
  brand_updated_at: string | null;
  allowed_actions: {
    can_edit_creator: boolean;
    can_edit_brand: boolean;
    can_confirm_posts: boolean;
  };
};

export type CreatorPaymentDetailsInput = Pick<
  PaymentDetailsState,
  'creator_legal_name' | 'creator_bank_or_upi' | 'creator_tax_id'
>;

export type BrandPaymentDetailsInput = Pick<
  PaymentDetailsState,
  'brand_billing_name' | 'brand_billing_address' | 'brand_gst'
>;

export async function fetchPaymentDetails(
  dealId: string,
): Promise<{ ok: true; data: PaymentDetailsState } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<PaymentDetailsState>(`/deals/${dealId}/payment-details`, token);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message };
}

export async function updateCreatorPaymentDetails(
  dealId: string,
  expectedVersion: number,
  input: CreatorPaymentDetailsInput,
): Promise<MutationOutcome> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await putJson<PaymentDetailsState>(
    `/deals/${dealId}/payment-details/creator`,
    { expected_version: expectedVersion, ...input },
    token,
  );
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function updateBrandPaymentDetails(
  dealId: string,
  expectedVersion: number,
  input: BrandPaymentDetailsInput,
): Promise<MutationOutcome> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await putJson<PaymentDetailsState>(
    `/deals/${dealId}/payment-details/brand`,
    { expected_version: expectedVersion, ...input },
    token,
  );
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

/* ── Participant-safe off-platform payment tracking (workplan 9.15-D) ─── */

export type PaymentState =
  | 'paid_full'
  | 'paid_partial'
  | 'not_paid_in_window'
  | 'not_paid_delayed'
  | 'bad_debt'
  | 'disputed'
  | 'refunded';

export type ReportablePaymentState = Exclude<PaymentState, 'disputed'>;
export type PaymentStructure = 'single' | 'milestone' | 'combination';

export type PaymentTrackingMilestone = {
  id: string;
  sequence: number;
  trigger: string;
  amount: string;
  due_date: string | null;
  state: PaymentState;
  version: number;
  reported_at: string;
  receipt_confirmed: boolean;
  receipt_confirmed_at: string | null;
  allowed_actions: {
    can_update_state: boolean;
    can_confirm_receipt: boolean;
  };
};

export type PaymentTrackingAvailable = {
  available: true;
  deal_id: string;
  stage: 'payment' | 'closed';
  payment_id: string;
  source_version_identifier: 'executed-contract-v1';
  amount: string;
  currency: string;
  structure: PaymentStructure;
  state: PaymentState;
  due_date: string | null;
  due_date_pending: boolean;
  version: number;
  reported_at: string;
  receipt_confirmed: boolean;
  receipt_confirmed_at: string | null;
  receipt_complete: boolean;
  milestones: PaymentTrackingMilestone[];
  allowed_actions: {
    can_update_state: boolean;
    can_update_milestones: boolean;
    can_confirm_receipt: boolean;
  };
  future_actions: {
    can_request_close: boolean;
    payment_reported_full: boolean;
    receipt_complete: boolean;
  };
};

export type PaymentTrackingUnavailable = {
  available: false;
  deal_id: string;
  stage: DealStage;
  reason: 'not_yet_available';
  allowed_actions: Record<string, never>;
  future_actions: {
    can_request_close: false;
    receipt_complete: false;
  };
};

export type PaymentTrackingState = PaymentTrackingAvailable | PaymentTrackingUnavailable;
export type PaymentTrackingActionResult =
  | { ok: true; data: PaymentTrackingAvailable }
  | { ok: false; message: string; stale?: boolean };

const PAYMENT_STATES: readonly PaymentState[] = [
  'paid_full',
  'paid_partial',
  'not_paid_in_window',
  'not_paid_delayed',
  'bad_debt',
  'disputed',
  'refunded',
];
const PAYMENT_STRUCTURES: readonly PaymentStructure[] = ['single', 'milestone', 'combination'];
const DEAL_STAGES: readonly DealStage[] = [
  'pending', 'chatting', 'approval', 'creating', 'posted', 'payment', 'closed', 'declined', 'cancelled',
];
const PAYMENT_CONFLICT_MESSAGE = 'This payment status changed. Refresh and try again.';
const INVALID_PAYMENT_RESPONSE = 'Payment tracking returned an invalid response. Refresh and try again.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function hasBooleanFields(value: unknown, keys: readonly string[]): value is Record<string, boolean> {
  return isRecord(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => typeof value[key] === 'boolean');
}

function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value);
}

function isPaymentState(value: unknown): value is PaymentState {
  return typeof value === 'string' && PAYMENT_STATES.includes(value as PaymentState);
}

function isPaymentMilestone(value: unknown): value is PaymentTrackingMilestone {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id)
    && isPositiveInteger(value.sequence)
    && isNonEmptyString(value.trigger)
    && isDecimalString(value.amount)
    && isNullableString(value.due_date)
    && isPaymentState(value.state)
    && isPositiveInteger(value.version)
    && isNonEmptyString(value.reported_at)
    && typeof value.receipt_confirmed === 'boolean'
    && isNullableString(value.receipt_confirmed_at)
    && hasBooleanFields(value.allowed_actions, ['can_update_state', 'can_confirm_receipt']);
}

function parsePaymentTracking(value: unknown): PaymentTrackingState | null {
  if (!isRecord(value) || typeof value.available !== 'boolean' || !isNonEmptyString(value.deal_id)) return null;
  if (value.available === false) {
    if (!DEAL_STAGES.includes(value.stage as DealStage)
      || value.reason !== 'not_yet_available'
      || !isRecord(value.allowed_actions)
      || Object.keys(value.allowed_actions).length !== 0
      || !isRecord(value.future_actions)
      || value.future_actions.can_request_close !== false
      || value.future_actions.receipt_complete !== false) return null;
    return value as PaymentTrackingUnavailable;
  }
  if (value.stage !== 'payment' && value.stage !== 'closed') return null;
  if (!isNonEmptyString(value.payment_id)
    || value.source_version_identifier !== 'executed-contract-v1'
    || !isDecimalString(value.amount)
    || typeof value.currency !== 'string'
    || !/^[A-Z]{3}$/.test(value.currency)
    || !PAYMENT_STRUCTURES.includes(value.structure as PaymentStructure)
    || !isPaymentState(value.state)
    || !isNullableString(value.due_date)
    || typeof value.due_date_pending !== 'boolean'
    || !isPositiveInteger(value.version)
    || !isNonEmptyString(value.reported_at)
    || typeof value.receipt_confirmed !== 'boolean'
    || !isNullableString(value.receipt_confirmed_at)
    || typeof value.receipt_complete !== 'boolean'
    || !Array.isArray(value.milestones)
    || !value.milestones.every(isPaymentMilestone)
    || !hasBooleanFields(value.allowed_actions, ['can_update_state', 'can_update_milestones', 'can_confirm_receipt'])
    || !hasBooleanFields(value.future_actions, ['can_request_close', 'payment_reported_full', 'receipt_complete'])) return null;
  const structure = value.structure as PaymentStructure;
  if ((structure === 'single' && value.milestones.length !== 0)
    || (structure !== 'single' && value.milestones.length === 0)) return null;
  return value as PaymentTrackingAvailable;
}

function paymentActionFailure(message: string): PaymentTrackingActionResult {
  return { ok: false, message, stale: message === PAYMENT_CONFLICT_MESSAGE };
}

export async function fetchPaymentTracking(
  dealId: string,
): Promise<{ ok: true; data: PaymentTrackingState } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<unknown>(`/deals/${dealId}/payment-tracking`, token);
  if (!result.ok) return { ok: false, message: result.message };
  const parsed = parsePaymentTracking(result.data);
  return parsed?.deal_id === dealId
    ? { ok: true, data: parsed }
    : { ok: false, message: INVALID_PAYMENT_RESPONSE };
}

/* ── Server-authoritative mutual close gate (workplan 9.17-A) ─────────── */

export type CloseConfirmation = {
  confirmed: boolean;
  display_label: string | null;
  confirmed_at: string | null;
};

export type CloseStatusAvailable = {
  available: true;
  deal_id: string;
  stage: 'payment' | 'closed';
  payment_complete: boolean;
  dispute_blocked: boolean;
  confirmations: { creator: CloseConfirmation; brand: CloseConfirmation };
  allowed_actions: { can_confirm: boolean };
};

export type CloseStatusUnavailable = {
  available: false;
  deal_id: string;
  stage: DealStage;
  reason: 'not_yet_available';
  payment_complete: false;
  dispute_blocked: false;
  confirmations: { creator: CloseConfirmation; brand: CloseConfirmation };
  allowed_actions: { can_confirm: false };
};

export type CloseStatus = CloseStatusAvailable | CloseStatusUnavailable;
const INVALID_CLOSE_RESPONSE = 'Close status returned an invalid response. Refresh and try again.';

function isCloseConfirmation(value: unknown): value is CloseConfirmation {
  if (!isRecord(value)
    || Object.keys(value).length !== 3
    || typeof value.confirmed !== 'boolean'
    || !(value.display_label === null || isBoundedText(value.display_label, 160))
    || !(value.confirmed_at === null || isBoundedText(value.confirmed_at, 64))) return false;
  return value.confirmed
    ? value.display_label !== null && value.confirmed_at !== null
    : value.display_label === null && value.confirmed_at === null;
}

function parseCloseStatus(value: unknown): CloseStatus | null {
  if (!isRecord(value)
    || typeof value.available !== 'boolean'
    || !isBoundedText(value.deal_id, 64)
    || !DEAL_STAGES.includes(value.stage as DealStage)
    || typeof value.payment_complete !== 'boolean'
    || typeof value.dispute_blocked !== 'boolean'
    || !isRecord(value.confirmations)
    || Object.keys(value.confirmations).length !== 2
    || !isCloseConfirmation(value.confirmations.creator)
    || !isCloseConfirmation(value.confirmations.brand)
    || !hasBooleanFields(value.allowed_actions, ['can_confirm'])) return null;
  if (!value.available) {
    if (Object.keys(value).length !== 8
      || value.reason !== 'not_yet_available'
      || value.payment_complete !== false
      || value.dispute_blocked !== false
      || value.allowed_actions.can_confirm !== false
      || value.confirmations.creator.confirmed
      || value.confirmations.brand.confirmed) return null;
    return value as CloseStatusUnavailable;
  }
  if (Object.keys(value).length !== 7
    || (value.stage !== 'payment' && value.stage !== 'closed')
    || (value.dispute_blocked && value.allowed_actions.can_confirm)
    || (value.stage === 'closed' && (
      !value.payment_complete
      || value.dispute_blocked
      || !value.confirmations.creator.confirmed
      || !value.confirmations.brand.confirmed
      || value.allowed_actions.can_confirm
    ))) return null;
  return value as CloseStatusAvailable;
}

export async function fetchCloseStatus(
  dealId: string,
): Promise<{ ok: true; data: CloseStatus } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<unknown>(`/deals/${dealId}/close-status`, token);
  if (!result.ok) return { ok: false, message: result.message };
  const parsed = parseCloseStatus(result.data);
  return parsed?.deal_id === dealId
    ? { ok: true, data: parsed }
    : { ok: false, message: INVALID_CLOSE_RESPONSE };
}

export async function confirmDealClose(
  dealId: string,
  requestId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<unknown>(`/deals/${dealId}/close`, { request_id: requestId }, token);
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

/* ── Closed outcomes: ratings, entries, immutable chat archive (9.17-B) ── */

export type PostCloseRating = {
  side: 'creator' | 'brand';
  score: number;
  review: string | null;
  display_label: string;
  created_at: string;
};

export type PostCloseRatings = {
  deal_id: string;
  ratings: PostCloseRating[];
  status: { creator: boolean; brand: boolean };
  allowed_actions: { can_rate: boolean };
};

export type PostCloseEntry = {
  id: string;
  body: string;
  visibility: 'shared' | 'private';
  author_label: string;
  created_at: string;
};

export type PostCloseEntryFeed = {
  deal_id: string;
  visibility: 'shared' | 'private';
  entries: PostCloseEntry[];
  next_cursor: string | null;
};

export type ChatArchiveStatus =
  | { deal_id: string; state: 'preparing'; allowed_actions: { can_retry: false; can_download: false } }
  | { deal_id: string; state: 'failed'; failure: string; allowed_actions: { can_retry: true; can_download: false } }
  | { deal_id: string; state: 'ready'; message_count: number; page_count: number; allowed_actions: { can_retry: false; can_download: true } };

const INVALID_POST_CLOSE_RESPONSE = 'Post-deal information returned an invalid response. Refresh and try again.';

function parsePostCloseRatings(value: unknown): PostCloseRatings | null {
  if (!isRecord(value) || Object.keys(value).length !== 4 || !isBoundedText(value.deal_id, 64)
    || !Array.isArray(value.ratings) || value.ratings.length > 2
    || !hasBooleanFields(value.status, ['creator', 'brand'])
    || !hasBooleanFields(value.allowed_actions, ['can_rate'])) return null;
  const seen = new Set<string>();
  const ratings: PostCloseRating[] = [];
  for (const item of value.ratings) {
    if (!isRecord(item) || Object.keys(item).length !== 5
      || (item.side !== 'creator' && item.side !== 'brand') || seen.has(item.side)
      || !Number.isInteger(item.score) || (item.score as number) < 1 || (item.score as number) > 5
      || !(item.review === null || isBoundedText(item.review, 1000))
      || !isBoundedText(item.display_label, 160) || !isBoundedText(item.created_at, 64)) return null;
    seen.add(item.side);
    ratings.push(item as PostCloseRating);
  }
  if (value.status.creator !== seen.has('creator') || value.status.brand !== seen.has('brand')) return null;
  return {
    deal_id: value.deal_id,
    ratings,
    status: { creator: value.status.creator, brand: value.status.brand },
    allowed_actions: { can_rate: value.allowed_actions.can_rate },
  };
}

function parsePostCloseFeed(value: unknown, visibility: 'shared' | 'private'): PostCloseEntryFeed | null {
  if (!isRecord(value) || Object.keys(value).length !== 4 || !isBoundedText(value.deal_id, 64)
    || value.visibility !== visibility || !Array.isArray(value.entries) || value.entries.length > 50
    || !(value.next_cursor === null || isBoundedText(value.next_cursor, 512))) return null;
  const entries: PostCloseEntry[] = [];
  for (const item of value.entries) {
    if (!isRecord(item) || Object.keys(item).length !== 5 || !isBoundedText(item.id, 64)
      || !isBoundedText(item.body, 2000) || item.visibility !== visibility
      || !isBoundedText(item.author_label, 160) || !isBoundedText(item.created_at, 64)) return null;
    entries.push(item as PostCloseEntry);
  }
  return { deal_id: value.deal_id, visibility, entries, next_cursor: value.next_cursor };
}

function parseChatArchiveStatus(value: unknown): ChatArchiveStatus | null {
  if (!isRecord(value) || !isBoundedText(value.deal_id, 64)
    || !hasBooleanFields(value.allowed_actions, ['can_retry', 'can_download'])) return null;
  if (value.state === 'preparing' && Object.keys(value).length === 3
    && !value.allowed_actions.can_retry && !value.allowed_actions.can_download) return value as ChatArchiveStatus;
  if (value.state === 'failed' && Object.keys(value).length === 4 && isBoundedText(value.failure, 200)
    && value.allowed_actions.can_retry && !value.allowed_actions.can_download) return value as ChatArchiveStatus;
  if (value.state === 'ready' && Object.keys(value).length === 5
    && Number.isInteger(value.message_count) && (value.message_count as number) >= 0
    && Number.isInteger(value.page_count) && (value.page_count as number) >= 1
    && !value.allowed_actions.can_retry && value.allowed_actions.can_download) return value as ChatArchiveStatus;
  return null;
}

export async function fetchPostCloseRatings(dealId: string): Promise<{ ok: true; data: PostCloseRatings } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<unknown>(`/deals/${dealId}/post-close/ratings`, token);
  if (!result.ok) return result;
  const parsed = parsePostCloseRatings(result.data);
  return parsed?.deal_id === dealId ? { ok: true, data: parsed } : { ok: false, message: INVALID_POST_CLOSE_RESPONSE };
}

export async function submitPostCloseRating(
  dealId: string, score: number, review: string | null, requestId: string,
): Promise<{ ok: true; data: PostCloseRatings } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<unknown>(`/deals/${dealId}/post-close/ratings`, { score, review, request_id: requestId }, token);
  if (!result.ok) return result;
  const parsed = parsePostCloseRatings(result.data);
  return parsed?.deal_id === dealId ? { ok: true, data: parsed } : { ok: false, message: INVALID_POST_CLOSE_RESPONSE };
}

export async function fetchPostCloseEntries(
  dealId: string, visibility: 'shared' | 'private', cursor?: string,
): Promise<{ ok: true; data: PostCloseEntryFeed } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const query = new URLSearchParams({ visibility, limit: '20' });
  if (cursor) query.set('cursor', cursor);
  const result = await getJson<unknown>(`/deals/${dealId}/post-close/entries?${query.toString()}`, token);
  if (!result.ok) return result;
  const parsed = parsePostCloseFeed(result.data, visibility);
  return parsed?.deal_id === dealId ? { ok: true, data: parsed } : { ok: false, message: INVALID_POST_CLOSE_RESPONSE };
}

export async function submitPostCloseEntry(
  dealId: string, visibility: 'shared' | 'private', body: string, requestId: string,
): Promise<{ ok: true; data: PostCloseEntryFeed } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<unknown>(`/deals/${dealId}/post-close/entries`, { visibility, body, request_id: requestId }, token);
  if (!result.ok) return result;
  const parsed = parsePostCloseFeed(result.data, visibility);
  return parsed?.deal_id === dealId ? { ok: true, data: parsed } : { ok: false, message: INVALID_POST_CLOSE_RESPONSE };
}

export async function fetchChatArchiveStatus(dealId: string): Promise<{ ok: true; data: ChatArchiveStatus } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<unknown>(`/deals/${dealId}/chat-archive`, token);
  if (!result.ok) return result;
  const parsed = parseChatArchiveStatus(result.data);
  return parsed?.deal_id === dealId ? { ok: true, data: parsed } : { ok: false, message: INVALID_POST_CLOSE_RESPONSE };
}

export async function retryChatArchive(dealId: string): Promise<{ ok: true; data: ChatArchiveStatus } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<unknown>(`/deals/${dealId}/chat-archive/prepare`, {}, token);
  if (!result.ok) return result;
  const parsed = parseChatArchiveStatus(result.data);
  return parsed?.deal_id === dealId ? { ok: true, data: parsed } : { ok: false, message: INVALID_POST_CLOSE_RESPONSE };
}

export async function getChatArchiveDownload(dealId: string): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<unknown>(`/deals/${dealId}/chat-archive/download`, token);
  if (!result.ok) return result;
  if (!isRecord(result.data) || Object.keys(result.data).length !== 2
    || !isBoundedText(result.data.url, 4096) || result.data.expires_in !== 300
    || !/^https:\/\//i.test(result.data.url)) return { ok: false, message: INVALID_POST_CLOSE_RESPONSE };
  return { ok: true, url: result.data.url };
}

/* ── Payment disputes (workplan 9.16-B) ───────────────────────────────── */

export type DisputeEvidenceReference = { kind: 'message' | 'live_post'; id: string };

export type DisputeEvidenceItem = DisputeEvidenceReference & { snippet: string };

export type DisputeItem = {
  id: string;
  status: 'open' | 'resolved';
  description: string;
  raised_by: {
    display_name: string;
    side: 'creator' | 'brand';
    role: ParticipantRole;
    role_label: string;
  };
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  evidence: DisputeEvidenceItem[];
};

export type DisputeProjection = {
  available: boolean;
  deal_id: string;
  stage: DealStage;
  reason?: 'not_yet_available';
  history: DisputeItem[];
  current_open: DisputeItem | null;
  allowed_actions: { can_raise: boolean; can_resolve: false };
};

const DISPUTE_SAFE_FAILURE = 'The current dispute record could not be read safely. Please try again.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isBoundedText(value: unknown, maximum: number, minimum = 1): value is string {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum;
}

function isDisputeReference(value: unknown): value is DisputeEvidenceReference {
  return isRecord(value)
    && (value.kind === 'message' || value.kind === 'live_post')
    && typeof value.id === 'string'
    && UUID_RE.test(value.id);
}

function parseDisputeItem(value: unknown): DisputeItem | null {
  if (!isRecord(value)
    || !isBoundedText(value.id, 64)
    || !UUID_RE.test(value.id)
    || (value.status !== 'open' && value.status !== 'resolved')
    || !isBoundedText(value.description, 2000)
    || !isRecord(value.raised_by)
    || !isBoundedText(value.raised_by.display_name, 160)
    || (value.raised_by.side !== 'creator' && value.raised_by.side !== 'brand')
    || !['creator', 'brand_admin', 'brand_maker', 'brand_checker'].includes(String(value.raised_by.role))
    || !isBoundedText(value.raised_by.role_label, 80)
    || !isBoundedText(value.created_at, 64)
    || !isNullableString(value.resolved_at)
    || (value.resolved_at !== null && !isBoundedText(value.resolved_at, 64))
    || !isNullableString(value.resolution_note)
    || (value.resolution_note !== null && !isBoundedText(value.resolution_note, 500))
    || !Array.isArray(value.evidence)
    || value.evidence.length > 10) return null;

  const evidence: DisputeEvidenceItem[] = [];
  const seen = new Set<string>();
  for (const item of value.evidence) {
    if (!isRecord(item)) return null;
    const snippet = item.snippet;
    if (!isDisputeReference(item) || !isBoundedText(snippet, 160)) return null;
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return null;
    seen.add(key);
    evidence.push({ kind: item.kind, id: item.id, snippet });
  }
  return {
    id: value.id,
    status: value.status,
    description: value.description,
    raised_by: {
      display_name: value.raised_by.display_name,
      side: value.raised_by.side,
      role: value.raised_by.role as ParticipantRole,
      role_label: value.raised_by.role_label,
    },
    created_at: value.created_at,
    resolved_at: value.resolved_at,
    resolution_note: value.resolution_note,
    evidence,
  };
}

function parseDisputeProjection(value: unknown): DisputeProjection | null {
  if (!isRecord(value)
    || typeof value.available !== 'boolean'
    || !isBoundedText(value.deal_id, 64)
    || !['pending', 'chatting', 'approval', 'creating', 'posted', 'payment', 'closed', 'declined', 'cancelled'].includes(String(value.stage))
    || !Array.isArray(value.history)
    || value.history.length > 50
    || !isRecord(value.allowed_actions)
    || typeof value.allowed_actions.can_raise !== 'boolean'
    || value.allowed_actions.can_resolve !== false
    || (value.current_open !== null && value.current_open === undefined)) return null;
  if (!value.available && value.reason !== 'not_yet_available') return null;
  const history = value.history.map(parseDisputeItem);
  if (history.some((item) => item === null)) return null;
  const currentOpen = value.current_open === null ? null : parseDisputeItem(value.current_open);
  if (currentOpen === null && value.current_open !== null) return null;
  if (currentOpen && (currentOpen.status !== 'open' || !history.some((item) => item?.id === currentOpen.id))) return null;
  return {
    available: value.available,
    deal_id: value.deal_id,
    stage: value.stage as DealStage,
    ...(value.reason === 'not_yet_available' ? { reason: 'not_yet_available' as const } : {}),
    history: history as DisputeItem[],
    current_open: currentOpen,
    allowed_actions: { can_raise: value.allowed_actions.can_raise, can_resolve: false },
  };
}

export async function fetchDisputes(
  dealId: string,
): Promise<{ ok: true; data: DisputeProjection } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<unknown>(`/deals/${dealId}/disputes`, token);
  if (!result.ok) return { ok: false, message: result.message };
  const parsed = parseDisputeProjection(result.data);
  return parsed?.deal_id === dealId
    ? { ok: true, data: parsed }
    : { ok: false, message: DISPUTE_SAFE_FAILURE };
}

export async function raisePaymentDispute(
  dealId: string,
  description: string,
  evidence: DisputeEvidenceReference[],
): Promise<{ ok: true; data: DisputeProjection } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const trimmed = description.trim();
  const unique = Array.from(new Map(
    evidence.filter(isDisputeReference).map((item) => [`${item.kind}:${item.id}`, item]),
  ).values());
  if (trimmed.length < 10 || trimmed.length > 2000 || unique.length !== evidence.length || unique.length > 10) {
    return { ok: false, message: 'Review the dispute description and selected evidence before trying again.' };
  }
  const body = unique.length ? { description: trimmed, evidence: unique } : { description: trimmed };
  const result = await postJson<unknown>(`/deals/${dealId}/disputes`, body, token);
  if (!result.ok) return { ok: false, message: result.message };
  const parsed = parseDisputeProjection(result.data);
  return parsed?.deal_id === dealId
    ? { ok: true, data: parsed }
    : { ok: false, message: DISPUTE_SAFE_FAILURE };
}

export async function updatePaymentTrackingState(
  dealId: string,
  expectedVersion: number,
  state: ReportablePaymentState,
): Promise<PaymentTrackingActionResult> {
  const token = await sessionToken();
  if (!token) return paymentActionFailure('Your session has expired. Please sign in again.');
  const result = await putJson<unknown>(
    `/deals/${dealId}/payment-tracking/state`,
    { expected_version: expectedVersion, state },
    token,
  );
  if (!result.ok) return paymentActionFailure(result.message);
  const parsed = parsePaymentTracking(result.data);
  return parsed?.available && parsed.deal_id === dealId
    ? { ok: true, data: parsed }
    : paymentActionFailure(INVALID_PAYMENT_RESPONSE);
}

export async function updatePaymentMilestoneState(
  dealId: string,
  milestoneId: string,
  expectedVersion: number,
  state: ReportablePaymentState,
): Promise<PaymentTrackingActionResult> {
  const token = await sessionToken();
  if (!token) return paymentActionFailure('Your session has expired. Please sign in again.');
  const result = await putJson<unknown>(
    `/deals/${dealId}/payment-tracking/milestones/${milestoneId}/state`,
    { expected_version: expectedVersion, state },
    token,
  );
  if (!result.ok) return paymentActionFailure(result.message);
  const parsed = parsePaymentTracking(result.data);
  return parsed?.available && parsed.deal_id === dealId
    ? { ok: true, data: parsed }
    : paymentActionFailure(INVALID_PAYMENT_RESPONSE);
}

export async function confirmPaymentReceipt(
  dealId: string,
  expectedVersion: number,
  milestoneId?: string,
): Promise<PaymentTrackingActionResult> {
  const token = await sessionToken();
  if (!token) return paymentActionFailure('Your session has expired. Please sign in again.');
  const body = milestoneId == null
    ? { expected_version: expectedVersion }
    : { milestone_id: milestoneId, expected_version: expectedVersion };
  const result = await postJson<unknown>(`/deals/${dealId}/payment-tracking/confirm-receipt`, body, token);
  if (!result.ok) return paymentActionFailure(result.message);
  const parsed = parsePaymentTracking(result.data);
  return parsed?.available && parsed.deal_id === dealId
    ? { ok: true, data: parsed }
    : paymentActionFailure(INVALID_PAYMENT_RESPONSE);
}

export async function confirmLivePosts(
  dealId: string,
  versions: CanonicalDeliverableState['post_confirmation']['expected_versions'],
  creatorPaymentVersion: number,
  brandPaymentVersion: number,
): Promise<MutationOutcome> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<unknown>(
    `/deals/${dealId}/confirm-posts`,
    {
      versions,
      creator_payment_version: creatorPaymentVersion,
      brand_payment_version: brandPaymentVersion,
    },
    token,
  );
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

const CONTENT_DRAFT_BUCKET = 'content-drafts';
const MAX_CONTENT_DRAFT_BYTES = 100 * 1024 * 1024;
const CONTENT_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
};

function contentMime(asset: DocumentPickerAsset): string | null {
  const extension = asset.name.split('.').pop()?.toLowerCase() ?? '';
  const fromName = CONTENT_MIME_BY_EXTENSION[extension];
  if (!fromName) return null;
  if (asset.mimeType && asset.mimeType !== fromName) return null;
  return fromName;
}

export async function uploadContentDraft(
  dealId: string,
  deliverableId: string,
  asset: DocumentPickerAsset,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: 'You need to sign in again before uploading.' };
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const mimeType = contentMime(asset);
  if (!mimeType) return { ok: false, message: 'Choose a PDF, JPEG, PNG, WebP, MP4, or MOV file with a matching extension.' };
  try {
    const bytes = await readDocumentBytes(asset.uri);
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_CONTENT_DRAFT_BYTES) {
      return { ok: false, message: 'Choose a draft no larger than 100 MB.' };
    }
    const prepared = await postJson<{
      reservation_id: string;
      upload_path: string;
      round_number: number;
    }>(
      `/deals/${dealId}/deliverables/${deliverableId}/content/prepare`,
      { original_filename: asset.name, mime_type: mimeType, size_bytes: bytes.byteLength },
      token,
    );
    if (!prepared.ok) return { ok: false, message: prepared.message };
    const { error: uploadError } = await supabase.storage.from(CONTENT_DRAFT_BUCKET).upload(
      prepared.data.upload_path,
      bytes,
      { contentType: mimeType, upsert: false },
    );
    if (uploadError) throw uploadError;
    const submitted = await postJson<unknown>(
      `/deals/${dealId}/deliverables/${deliverableId}/content/submit`,
      {
        reservation_id: prepared.data.reservation_id,
        expected_round: prepared.data.round_number,
      },
      token,
    );
    if (!submitted.ok) {
      // This succeeds only while unbound. If the response was lost after a
      // successful bind, Storage RLS keeps the immutable submitted object.
      await supabase.storage.from(CONTENT_DRAFT_BUCKET).remove([prepared.data.upload_path]);
      return { ok: false, message: submitted.message };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Couldn't upload that draft. Check your connection and try again." };
  }
}

export async function requestContentRevision(
  dealId: string,
  deliverableId: string,
  revisionId: string,
  comment: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<unknown>(
    `/deals/${dealId}/deliverables/${deliverableId}/content/request-revision`,
    { revision_id: revisionId, comment: comment.trim() },
    token,
  );
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function approveContentSubmission(
  dealId: string,
  deliverableId: string,
  revisionId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<unknown>(
    `/deals/${dealId}/deliverables/${deliverableId}/content/approve`,
    { revision_id: revisionId },
    token,
  );
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function decideContentApproval(
  requestId: string,
  decision: 'approve' | 'reject',
  comment?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<unknown>(
    `/maker-checker/requests/${requestId}/decide`,
    { decision, comment: comment?.trim() || null },
    token,
  );
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function getContentDraftDownload(
  dealId: string,
  deliverableId: string,
  revisionId: string,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<{ url: string }>(
    `/deals/${dealId}/deliverables/${deliverableId}/content/${revisionId}/download`,
    token,
  );
  return result.ok ? { ok: true, url: result.data.url } : { ok: false, message: result.message };
}

export type ContractSignatureState = {
  signer_id: string;
  signer_name: string;
  side: 'creator' | 'brand';
  signature_mode: 'stored' | 'drawn' | 'print_bypass';
  signed_at: string;
  wet_signed_document: boolean;
};

export type ContractApprovalState = {
  request_id: string;
  status: 'pending' | 'approved' | 'rejected';
  maker_id: string;
  maker_name: string;
  checker_id: string;
  checker_name: string;
  comment: string | null;
  created_at: string;
  decided_at: string | null;
  can_decide: boolean;
};

export type ContractAlignmentConflict = {
  field_key: string;
  label: string;
  reason: 'approved_summary_unresolved' | 'contract_field_unresolved' | 'value_mismatch';
  approved_value: unknown;
  contract_value: unknown;
  contract_status: ChecklistStatus;
};

export type ContractAlignmentState = {
  status: 'not_started' | 'processing' | 'failed' | 'clear' | 'conflict' | 'overridden';
  signing_enabled: boolean;
  failure_message: string | null;
  extraction_id: string | null;
  conflicts: ContractAlignmentConflict[];
  creator_confirmation: { confirmed: boolean; actor_id: string | null; confirmed_at: string | null };
  brand_confirmation: { confirmed: boolean; actor_id: string | null; confirmed_at: string | null };
  can_override: boolean;
};

export type ContractState = {
  contract: {
    id: string;
    status: 'draft' | 'awaiting_signatures' | 'executed';
    version: number;
    created_at: string;
  } | null;
  signatures: ContractSignatureState[];
  required_signatures: { creator: 'pending' | 'held' | 'signed'; brand: 'pending' | 'held' | 'signed' };
  maker_checker: ContractApprovalState | null;
  alignment: ContractAlignmentState;
};

export async function fetchContract(dealId: string): Promise<{ ok: true; data: ContractState } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<ContractState>(`/deals/${dealId}/contract`, token);
  return result.ok ? { ok: true, data: result.data } : { ok: false, message: result.message };
}

export const generateContract = (dealId: string) => summaryPost(dealId, 'contract');

export const runContractAlignment = (dealId: string) => summaryPost(dealId, 'contract/alignment');

export async function overrideContractAlignment(
  dealId: string,
  extractionId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<ContractState>(
    `/deals/${dealId}/contract/alignment/override`,
    { extraction_id: extractionId },
    token,
  );
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export type ContractSignPayload = {
  mode: 'stored' | 'drawn' | 'print_bypass';
  svg?: string;
  bypass_reason?: string;
  physical_doc_path?: string;
};

export async function signContract(dealId: string, body: ContractSignPayload): Promise<{ ok: true } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<ContractState>(`/deals/${dealId}/contract/sign`, body, token);
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function decideContractSigning(
  requestId: string,
  decision: 'approve' | 'reject',
  comment?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await postJson<unknown>(
    `/maker-checker/requests/${requestId}/decide`,
    { decision, comment: comment?.trim() || null },
    token,
  );
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function getContractDownload(
  dealId: string,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const result = await getJson<{ url: string }>(`/deals/${dealId}/contract/download`, token);
  return result.ok ? { ok: true, url: result.data.url } : { ok: false, message: result.message };
}

async function readDocumentBytes(uri: string): Promise<Uint8Array | ArrayBuffer> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    return response.arrayBuffer();
  }
  return new FileSystem.File(uri).bytes();
}

export async function uploadWetSignedContract(
  dealId: string,
  contractId: string,
  asset: DocumentPickerAsset,
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: 'You need to sign in again before uploading.' };
  const session = await supabase.auth.getSession();
  const userId = session.data.session?.user.id;
  if (!userId) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  const isPdf = asset.mimeType === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return { ok: false, message: 'Choose a PDF file.' };
  if (asset.size != null && (asset.size < 1_000 || asset.size > 10 * 1024 * 1024)) {
    return { ok: false, message: 'Choose a PDF between 1 KB and 10 MB.' };
  }
  try {
    const path = `${dealId}/${contractId}/wet-signatures/${userId}/${Crypto.randomUUID()}.pdf`;
    const bytes = await readDocumentBytes(asset.uri);
    if (bytes.byteLength < 1_000 || bytes.byteLength > 10 * 1024 * 1024) {
      return { ok: false, message: 'Choose a PDF between 1 KB and 10 MB.' };
    }
    const { error } = await supabase.storage.from('contracts').upload(path, bytes, {
      contentType: 'application/pdf',
      upsert: false,
    });
    if (error) throw error;
    return { ok: true, path };
  } catch {
    return { ok: false, message: "Couldn't upload that PDF. Check your connection and try again." };
  }
}

export async function removeWetSignedContract(path: string): Promise<void> {
  if (!supabase || !path) return;
  await supabase.storage.from('contracts').remove([path]);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Chat / deal-room reads (Phase 9 Cluster 1 — tasks 9.2 / 9.3).
 *
 * These are Supabase-DIRECT under RLS (anon key). Reading a deal's messages and
 * inserting your own are simple participant-scoped ops (api-architecture.md);
 * `is_deal_participant` gates every row. Nothing here changes deal STAGE — that
 * stays server-side in FastAPI (the sticky action bar, task 9.7).
 * ──────────────────────────────────────────────────────────────────────── */

// Forward-only 7-stage engine + the two terminal off-ramps (deal-engine.md).
export type DealStage =
  | 'pending'
  | 'chatting'
  | 'approval'
  | 'creating'
  | 'posted'
  | 'payment'
  | 'closed'
  | 'declined'
  | 'cancelled';

export type ParticipantRole = 'creator' | 'brand_admin' | 'brand_maker' | 'brand_checker';

export type ParticipantCandidate = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  eligible_roles: Exclude<ParticipantRole, 'creator'>[];
};

export type ParticipantManagementState = {
  deal_id: string;
  stage: DealStage;
  participants: {
    display_name: string;
    avatar_url: string | null;
    role: ParticipantRole;
    role_label: string;
  }[];
  pending_request: null | {
    id: string;
    proposed: { display_name: string; avatar_url: string | null };
    proposed_role: Exclude<ParticipantRole, 'creator'>;
    proposed_role_label: string;
    reason: string;
    created_at: string;
    approvals: { display_name: string; status: 'pending' | 'approved' | 'rejected' }[];
    can_decide: boolean;
  };
  candidates: ParticipantCandidate[];
  available_actions: { can_request: boolean };
};

export async function fetchParticipantManagement(
  dealId: string,
): Promise<{ ok: true; data: ParticipantManagementState } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  return getJson<ParticipantManagementState>(`/deals/${dealId}/participants`, token);
}

export async function createParticipantRequest(
  dealId: string,
  input: { request_id: string; proposed_profile_id: string; proposed_role: Exclude<ParticipantRole, 'creator'>; reason: string },
): Promise<{ ok: true; data: ParticipantManagementState } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  return postJson<ParticipantManagementState>(`/deals/${dealId}/participant-requests`, input, token);
}

export async function decideParticipantRequest(
  dealId: string,
  requestId: string,
  decision: 'approved' | 'rejected',
): Promise<{ ok: true; data: ParticipantManagementState } | { ok: false; message: string }> {
  const token = await sessionToken();
  if (!token) return { ok: false, message: 'Your session has expired. Please sign in again.' };
  return postJson<ParticipantManagementState>(
    `/deals/${dealId}/participant-requests/${requestId}/decision`,
    { decision },
    token,
  );
}

/** The next thing THIS user should do, plus whether it's their turn (drives the dot). */
export type NextAction = { text: string; active: boolean };

export type DealPreview = {
  dealId: string;
  dealName: string;
  stage: DealStage;
  isDisputed: boolean;
  direction: 'inbound' | 'outbound' | null;
  /** Display names of the OTHER participants (everyone but me). */
  otherNames: string[];
  /** First other participant's avatar, for the card's leading avatar. */
  otherAvatarPath: string | null;
  lastMessage: { senderName: string; body: string; createdAt: string } | null;
  unreadCount: number;
  myRole: ParticipantRole;
  nextAction: NextAction;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  body: string | null;
  createdAt: string;
  mine: boolean;
};

export type DealThread = {
  dealId: string;
  dealName: string;
  /** Null fails closed while a local schema is still missing migration 045. */
  dealNameVersion: number | null;
  stage: DealStage;
  isDisputed: boolean;
  otherNames: string[];
  /** deals.created_by — the initiator; the OTHER participant is the recipient. */
  createdBy: string | null;
  /** THIS user's per-deal role — drives which action-bar buttons show (9.7). */
  myRole: ParticipantRole | null;
  /** Pending connection-request expiry (null once accepted). */
  expiresAt: string | null;
  /** profile_id → display name, so a raw Realtime row can render a sender name. */
  namesById: Record<string, string>;
  messages: ChatMessage[];
};

type ProfileLite = { display_name: string | null; avatar_url: string | null };

/**
 * The chat-list feed: one preview per deal I participate in, newest-active first.
 * Kept as a few bounded queries (not one nested join) so each stays RLS-simple;
 * the MVP seed is small, so fetch-then-reduce in JS is fine. Any failure returns
 * an empty list — the screen shows its empty state, never a raw error.
 */
export async function fetchMyDealPreviews(userId: string): Promise<DealPreview[]> {
  if (!supabase) return [];

  // 1. Every deal I'm on, with my own read-state + per-deal role.
  const { data: myParts, error: e1 } = await supabase
    .from('deal_participants')
    .select('deal_id, participant_role, last_read_at')
    .eq('profile_id', userId);
  if (e1 || !myParts || myParts.length === 0) return [];

  const dealIds = myParts.map((p) => p.deal_id as string);
  const myByDeal = new Map(
    myParts.map((p) => [
      p.deal_id as string,
      { role: p.participant_role as ParticipantRole, lastReadAt: p.last_read_at as string | null },
    ]),
  );

  // 2. The deals themselves (live only).
  const { data: deals, error: e2 } = await supabase
    .from('deals')
    .select('id, deal_name, stage, is_disputed, direction, created_by, updated_at, created_at')
    .in('id', dealIds)
    .is('deleted_at', null);
  if (e2 || !deals) return [];

  // 3. All participants across those deals (for other-party names + avatars).
  const { data: parts } = await supabase
    .from('deal_participants')
    .select('deal_id, profile_id, profiles(display_name, avatar_url)')
    .in('deal_id', dealIds);
  const nameById = new Map<string, string>();
  const partsByDeal = new Map<string, { profileId: string; profile: ProfileLite | null }[]>();
  for (const row of parts ?? []) {
    // supabase-js types a many-to-one embed as an array; at runtime it's an object.
    const profile = (row.profiles as unknown as ProfileLite | null) ?? null;
    if (profile?.display_name) nameById.set(row.profile_id as string, profile.display_name);
    const list = partsByDeal.get(row.deal_id as string) ?? [];
    list.push({ profileId: row.profile_id as string, profile });
    partsByDeal.set(row.deal_id as string, list);
  }

  // 4. Messages across those deals — reduced in JS to last-per-deal + unread count.
  const { data: msgs } = await supabase
    .from('messages')
    .select('deal_id, sender_id, body, created_at')
    .in('deal_id', dealIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  const lastByDeal = new Map<string, { senderId: string; body: string; createdAt: string }>();
  const unreadByDeal = new Map<string, number>();
  for (const m of msgs ?? []) {
    const dealId = m.deal_id as string;
    lastByDeal.set(dealId, {
      senderId: m.sender_id as string,
      body: (m.body as string | null) ?? '',
      createdAt: m.created_at as string,
    });
    const mine = myByDeal.get(dealId);
    const lastRead = mine?.lastReadAt ? new Date(mine.lastReadAt).getTime() : 0;
    const isUnread = m.sender_id !== userId && new Date(m.created_at as string).getTime() > lastRead;
    if (isUnread) unreadByDeal.set(dealId, (unreadByDeal.get(dealId) ?? 0) + 1);
  }

  const previews: DealPreview[] = deals.map((d) => {
    const dealId = d.id as string;
    const mine = myByDeal.get(dealId);
    const myRole = mine?.role ?? 'creator';
    const others = (partsByDeal.get(dealId) ?? []).filter((p) => p.profileId !== userId);
    const last = lastByDeal.get(dealId) ?? null;
    const stage = d.stage as DealStage;
    return {
      dealId,
      dealName: (d.deal_name as string) ?? 'Deal',
      stage,
      isDisputed: Boolean(d.is_disputed),
      direction: (d.direction as 'inbound' | 'outbound' | null) ?? null,
      otherNames: others.map((o) => o.profile?.display_name ?? 'Someone'),
      otherAvatarPath: others[0]?.profile?.avatar_url ?? null,
      lastMessage: last
        ? { senderName: nameById.get(last.senderId) ?? 'Someone', body: last.body, createdAt: last.createdAt }
        : null,
      unreadCount: unreadByDeal.get(dealId) ?? 0,
      myRole,
      nextAction: nextActionPrompt(stage, myRole, d.created_by === userId, Boolean(d.is_disputed)),
    };
  });

  // Newest activity first (last message, else the deal's own timestamp).
  const activityTs = (p: DealPreview) =>
    p.lastMessage ? new Date(p.lastMessage.createdAt).getTime() : 0;
  previews.sort((a, b) => activityTs(b) - activityTs(a));
  return previews;
}

/**
 * Full thread for the deal room: header + message history oldest→newest (so the
 * newest sits at the bottom). RLS guarantees I only get a deal I'm a participant
 * on; a missing/forbidden deal returns null → the screen shows a friendly state.
 */
export async function fetchDealThread(dealId: string, userId: string): Promise<DealThread | null> {
  if (!supabase) return null;

  let { data: deal, error: eDeal } = await supabase
    .from('deals')
    .select('id, deal_name, deal_name_version, stage, is_disputed, created_by, expires_at')
    .eq('id', dealId)
    .is('deleted_at', null)
    .maybeSingle();
  // During a local rolling migration, preserve read-only deal access but never
  // invent a version that could enable an unsafe rename.
  if (eDeal && String(eDeal.message).includes('deal_name_version')) {
    const fallback = await supabase
      .from('deals')
      .select('id, deal_name, stage, is_disputed, created_by, expires_at')
      .eq('id', dealId)
      .is('deleted_at', null)
      .maybeSingle();
    deal = fallback.data ? { ...fallback.data, deal_name_version: null } : null;
    eDeal = fallback.error;
  }
  if (eDeal || !deal) return null;

  const { data: parts } = await supabase
    .from('deal_participants')
    .select('profile_id, participant_role, profiles(display_name)')
    .eq('deal_id', dealId);
  const nameById = new Map<string, string>();
  const otherNames: string[] = [];
  let myRole: ParticipantRole | null = null;
  for (const row of parts ?? []) {
    const name =
      (row.profiles as unknown as { display_name: string | null } | null)?.display_name ?? 'Someone';
    nameById.set(row.profile_id as string, name);
    if (row.profile_id === userId) {
      myRole = (row.participant_role as ParticipantRole | null) ?? null;
    } else {
      otherNames.push(name);
    }
  }

  const { data: msgs, error: eMsgs } = await supabase
    .from('messages')
    .select('id, sender_id, body, created_at')
    .eq('deal_id', dealId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (eMsgs) return null;

  const messages: ChatMessage[] = (msgs ?? []).map((m) => ({
    id: m.id as string,
    senderId: m.sender_id as string,
    senderName: nameById.get(m.sender_id as string) ?? 'Someone',
    body: (m.body as string | null) ?? null,
    createdAt: m.created_at as string,
    mine: m.sender_id === userId,
  }));

  return {
    dealId: deal.id as string,
    dealName: (deal.deal_name as string) ?? 'Deal',
    dealNameVersion: Number.isInteger(deal.deal_name_version) ? Number(deal.deal_name_version) : null,
    stage: deal.stage as DealStage,
    isDisputed: Boolean(deal.is_disputed),
    otherNames,
    createdBy: (deal.created_by as string | null) ?? null,
    myRole,
    expiresAt: (deal.expires_at as string | null) ?? null,
    namesById: Object.fromEntries(nameById),
    messages,
  };
}

export type DealNameResult = {
  deal_name: string;
  deal_name_version: number;
  idempotent: boolean;
};

export type RenameDealOutcome =
  | { ok: true; result: DealNameResult }
  | { ok: false; message: string; stale: boolean };

/** Backend-owned atomic rename; callers must bind to the exact displayed version. */
export async function renameDeal(
  dealId: string,
  dealName: string,
  expectedVersion: number,
): Promise<RenameDealOutcome> {
  const token = await sessionToken();
  if (!token) {
    return { ok: false, message: 'Your session has expired. Please sign in again.', stale: false };
  }
  const response = await putJson<DealNameResult>(
    `/deals/${dealId}/name`,
    { deal_name: dealName, expected_version: expectedVersion },
    token,
  );
  if (!response.ok) {
    return {
      ok: false,
      message: response.message,
      stale: response.status === 409 && response.message.startsWith('Someone else renamed this deal.'),
    };
  }
  const result = response.data;
  if (
    typeof result.deal_name !== 'string'
    || !Number.isInteger(result.deal_name_version)
    || result.deal_name_version < 0
    || typeof result.idempotent !== 'boolean'
  ) {
    return { ok: false, message: 'The server returned an invalid deal name. Refresh and try again.', stale: false };
  }
  return { ok: true, result };
}

/** Send a chat message (Supabase-direct; RLS enforces sender = me + participant). */
export async function sendMessage(
  dealId: string,
  senderId: string,
  body: string,
): Promise<{ ok: true; message: ChatMessage } | { ok: false; message: string; readOnly?: boolean }> {
  if (!supabase) return { ok: false, message: 'Not signed in.' };
  const text = body.trim();
  if (!text) return { ok: false, message: 'Message is empty.' };

  const { data, error } = await supabase
    .from('messages')
    .insert({ deal_id: dealId, sender_id: senderId, body: text })
    .select('id, sender_id, body, created_at')
    .single();
  if (error || !data) {
    const readOnly = JSON.stringify(error ?? {}).includes('DEAL_THREAD_READ_ONLY');
    return readOnly
      ? { ok: false, readOnly: true, message: 'This deal is closed, so the thread is now read-only.' }
      : { ok: false, message: 'Couldn’t send your message. Try again.' };
  }

  return {
    ok: true,
    message: {
      id: data.id as string,
      senderId: data.sender_id as string,
      senderName: 'You',
      body: (data.body as string | null) ?? null,
      createdAt: data.created_at as string,
      mine: true,
    },
  };
}

/**
 * Mark this deal's thread read for me — stamps my own `deal_participants.last_read_at`
 * (RLS: `deal_participants_update_own`). Clears the unread badge on return to the list.
 * Best-effort: a failure here shouldn't block the thread from opening.
 */
export async function markDealRead(dealId: string, userId: string): Promise<void> {
  if (!supabase) return;
  await supabase
    .from('deal_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('deal_id', dealId)
    .eq('profile_id', userId);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Realtime message delivery (task 9.4, B3-003). Supabase Realtime streams
 * `messages` INSERTs (see migration 017: the table is in the supabase_realtime
 * publication). Realtime applies the messages RLS to the subscriber's JWT, so a
 * client only ever receives rows for deals it participates in.
 * ──────────────────────────────────────────────────────────────────────── */

/** The raw shape of a `messages` INSERT payload from Realtime. */
export type IncomingMessageRow = {
  id: string;
  deal_id: string;
  sender_id: string;
  body: string | null;
  created_at: string;
};

/**
 * Subscribe to new messages on one deal. `accessToken` is passed to
 * `realtime.setAuth` so RLS-gated delivery works even if the socket authed
 * before sign-in. Returns a cleanup fn that unsubscribes + removes the channel.
 */
export function subscribeToDealMessages(
  dealId: string,
  accessToken: string | null,
  onInsert: (row: IncomingMessageRow) => void,
): () => void {
  if (!supabase) return () => {};
  if (accessToken) supabase.realtime.setAuth(accessToken);

  const channel = supabase
    .channel(`deal:${dealId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `deal_id=eq.${dealId}` },
      (payload) => onInsert(payload.new as IncomingMessageRow),
    )
    .subscribe();

  return () => {
    void channel.unsubscribe();
    void supabase?.removeChannel(channel);
  };
}

/**
 * Approval INSERTs are refresh hints, never authority. RLS limits delivery to
 * participants and every callback refetches the authenticated API state.
 */
export function subscribeToTermApprovals(
  summaryId: string,
  accessToken: string | null,
  onChange: () => void,
): () => void {
  if (!supabase) return () => {};
  if (accessToken) supabase.realtime.setAuth(accessToken);
  const channel = supabase
    .channel(`terms:${summaryId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'term_approvals', filter: `summary_id=eq.${summaryId}` },
      onChange,
    )
    .subscribe();
  return () => {
    void channel.unsubscribe();
    void supabase?.removeChannel(channel);
  };
}

/* ── Presentation helpers (shared by the list card + the deal-room header) ── */

/** Label + NativeWind token classes (bg + text kept apart) for a stage pill. Colours from the mockup. */
export function stagePill(stage: DealStage, isDisputed: boolean): { label: string; bg: string; text: string } {
  if (isDisputed && stage === 'payment') {
    return { label: 'Disputed', bg: 'bg-status-critical-tint', text: 'text-status-critical' };
  }
  const map: Record<DealStage, { label: string; bg: string; text: string }> = {
    pending: { label: 'Pending', bg: 'bg-surface-recess', text: 'text-ink-3' },
    chatting: { label: 'Chatting', bg: 'bg-surface-recess', text: 'text-ink-2' },
    approval: { label: 'Approval', bg: 'bg-[#F3EFE2]', text: 'text-[#8A7A45]' },
    creating: { label: 'Creating', bg: 'bg-[#E8EFF0]', text: 'text-[#12707E]' },
    posted: { label: 'Posted', bg: 'bg-status-good-tint', text: 'text-status-good-label' },
    payment: { label: 'Payment', bg: 'bg-[#EFEBE3]', text: 'text-[#6A553E]' },
    closed: { label: 'Closed', bg: 'bg-surface-recess', text: 'text-ink-3' },
    declined: { label: 'Declined', bg: 'bg-status-critical-tint', text: 'text-status-critical' },
    cancelled: { label: 'Cancelled', bg: 'bg-status-critical-tint', text: 'text-status-critical' },
  };
  return map[stage];
}

/**
 * The next-action line for a deal, per stage + this user's role. High-level for
 * this cluster — the fine-grained sub-state (approvals, signatures, revision
 * counters) arrives with the sticky action bar (9.7). `active` = it's my turn.
 */
export function nextActionPrompt(
  stage: DealStage,
  myRole: ParticipantRole,
  isInitiator: boolean,
  isDisputed: boolean,
): NextAction {
  const isBrand = myRole !== 'creator';
  switch (stage) {
    case 'pending':
      return isInitiator
        ? { text: 'Waiting for a response', active: false }
        : { text: 'Respond to this connection request', active: true };
    case 'chatting':
      return { text: 'Negotiate the terms in chat', active: true };
    case 'approval':
      return { text: 'Review and sign the contract', active: true };
    case 'creating':
      return isBrand
        ? { text: 'Review the creator’s work', active: true }
        : { text: 'Submit your content', active: true };
    case 'posted':
      return isBrand
        ? { text: 'Confirm the post is live', active: true }
        : { text: 'Waiting for the brand to confirm', active: false };
    case 'payment':
      if (isDisputed) return { text: 'Dispute in progress', active: false };
      return isBrand
        ? { text: 'Update the payment status', active: true }
        : { text: 'Confirm you’ve received payment', active: true };
    case 'closed':
      return { text: 'Deal closed', active: false };
    case 'declined':
      return { text: 'Connection declined', active: false };
    case 'cancelled':
      return { text: 'Deal cancelled', active: false };
  }
}
