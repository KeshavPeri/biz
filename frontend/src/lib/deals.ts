import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import type { DocumentPickerAsset } from 'expo-document-picker';

import { supabase } from '@/lib/supabase';
import { getJson, postJson } from '@/lib/api';

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
export type TransitionAction = 'cancel' | 'submit-live' | 'confirm-posts' | 'close';

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
    can_submit_live_url: false;
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
  stage: 'creating';
  deliverables: CanonicalDeliverable[];
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

  const { data: deal, error: eDeal } = await supabase
    .from('deals')
    .select('id, deal_name, stage, is_disputed, created_by, expires_at')
    .eq('id', dealId)
    .is('deleted_at', null)
    .maybeSingle();
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

/** Send a chat message (Supabase-direct; RLS enforces sender = me + participant). */
export async function sendMessage(
  dealId: string,
  senderId: string,
  body: string,
): Promise<{ ok: true; message: ChatMessage } | { ok: false; message: string }> {
  if (!supabase) return { ok: false, message: 'Not signed in.' };
  const text = body.trim();
  if (!text) return { ok: false, message: 'Message is empty.' };

  const { data, error } = await supabase
    .from('messages')
    .insert({ deal_id: dealId, sender_id: senderId, body: text })
    .select('id, sender_id, body, created_at')
    .single();
  if (error || !data) return { ok: false, message: 'Couldn’t send your message. Try again.' };

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
