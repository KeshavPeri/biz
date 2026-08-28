import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ContractSignSheet } from '@/components/deal/contract-sign-sheet';
import { ContractAlignmentCard } from '@/components/deal/contract-alignment-card';
import { TermsReviewCard } from '@/components/deal/terms-review-card';

import {
  acceptDeal,
  confirmChecklistOverride,
  confirmTermsSummaryRequest,
  declineDeal,
  decideContractSigning,
  deferTermsSummaryRequest,
  decideTermsSummary,
  fetchContract,
  fetchSummaryChecklist,
  fetchTermsReview,
  generateContract,
  getContractDownload,
  overrideContractAlignment,
  proposeChecklistOverride,
  requestDealTransition,
  requestTermsSummary,
  runContractAlignment,
  signContract,
  subscribeToTermApprovals,
  type DealThread,
  type ContractState,
  type SummaryChecklist,
  type TermsReviewState,
  type TransitionAction,
} from '@/lib/deals';

/**
 * StickyActionBar (task 9.7) — the stage-aware AND role-aware bar above the
 * composer. It shows the right buttons + context for THIS user in THIS stage,
 * per deal-engine.md's per-stage sticky-action-bar tables and rbac.md.
 *
 * The buttons only ever REQUEST a transition — the server (the engine) is the
 * source of truth. Each maps 1:1 to a documented endpoint (backend/api/deals.py).
 * Pending actions and the Chatting Gate-A summary request are live. Later
 * contract, content and payment actions remain stub-built and return a clean 409.
 *
 * On any successful transition we call onTransitioned() so the screen refetches
 * (stage bar + this bar update immediately on the acting client). NOTE: `deals`
 * isn't on the Realtime publication, so the OTHER participant won't live-update —
 * refetch-on-open covers it for MVP (a known gap for the G4 phone test).
 */
export function StickyActionBar({
  thread,
  userId,
  accessToken,
  onTransitioned,
}: {
  thread: DealThread;
  userId: string;
  accessToken: string | null;
  onTransitioned: () => void;
}) {
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when accept returns a warn-only exclusivity notice (needs re-confirm).
  const [exclusivityWarning, setExclusivityWarning] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryChecklist | null>(null);
  const [terms, setTerms] = useState<TermsReviewState | null>(null);
  const [termsLoading, setTermsLoading] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [contract, setContract] = useState<ContractState | null>(null);
  const [contractLoading, setContractLoading] = useState(false);
  const [signing, setSigning] = useState(false);
  const alignmentStartRef = useRef<string | null>(null);

  const loadSummary = useCallback(async () => {
    if (thread.stage !== 'chatting') return;
    const result = await fetchSummaryChecklist(thread.dealId);
    if (result.ok) setSummary(result.data);
    else setError(result.message);
  }, [thread.dealId, thread.stage]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const loadTerms = useCallback(async (showLoading = false) => {
    if (!['chatting', 'approval', 'creating'].includes(thread.stage)) return;
    if (showLoading) setTermsLoading(true);
    const result = await fetchTermsReview(thread.dealId);
    if (result.ok) {
      setTerms(result.data);
      setTermsError(null);
    } else {
      setTermsError(result.message);
    }
    setTermsLoading(false);
  }, [thread.dealId, thread.stage]);

  useEffect(() => {
    if (['chatting', 'approval', 'creating'].includes(thread.stage)) void loadTerms(true);
    else setTerms(null);
  }, [loadTerms, thread.stage]);
  const loadContract = useCallback(async () => {
    if (thread.stage !== 'approval') return;
    setContractLoading(true);
    const result = await fetchContract(thread.dealId);
    if (result.ok) setContract(result.data);
    else setError(result.message);
    setContractLoading(false);
  }, [thread.dealId, thread.stage]);

  useEffect(() => {
    if (thread.stage === 'approval') void loadContract();
    else setContract(null);
  }, [loadContract, thread.stage]);

  // Generation is followed by one authoritative alignment start. The backend
  // reservation makes concurrent participants/idempotent refreshes safe.
  useEffect(() => {
    const contractId = contract?.contract?.id;
    if (!contractId || contract.alignment.status !== 'not_started' || alignmentStartRef.current === contractId) return;
    alignmentStartRef.current = contractId;
    void (async () => {
      const result = await runContractAlignment(thread.dealId);
      if (!result.ok) setError(result.message);
      await loadContract();
    })();
  }, [contract, loadContract, thread.dealId]);

  // Focus is the authoritative fallback when Realtime is disconnected or the
  // final event raced navigation. It also keeps the existing contract state fresh.
  useFocusEffect(
    useCallback(() => {
      void loadTerms();
      if (thread.stage === 'chatting') void loadSummary();
      if (thread.stage === 'approval') void loadContract();
    }, [loadContract, loadSummary, loadTerms, thread.stage]),
  );

  useEffect(() => {
    const summaryId = terms?.summary?.id;
    if (!summaryId) return;
    return subscribeToTermApprovals(summaryId, accessToken, () => {
      void loadTerms();
      onTransitioned();
    });
  }, [accessToken, loadTerms, onTransitioned, terms?.summary?.id]);

  const run = useCallback(
    async (fn: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
      if (acting) return;
      setActing(true);
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.message);
      else onTransitioned();
      setActing(false);
    },
    [acting, onTransitioned],
  );

  const onAccept = useCallback(
    async (acknowledge: boolean) => {
      if (acting) return;
      setActing(true);
      setError(null);
      const res = await acceptDeal(thread.dealId, acknowledge);
      if (!res.ok) setError(res.message);
      else if (res.transitioned) {
        setExclusivityWarning(null);
        onTransitioned();
      } else {
        setExclusivityWarning(res.exclusivityWarning); // warn-only → re-confirm
      }
      setActing(false);
    },
    [acting, thread.dealId, onTransitioned],
  );

  const onTransition = useCallback(
    (action: TransitionAction) => run(() => requestDealTransition(thread.dealId, action)),
    [run, thread.dealId],
  );

  const runSummary = useCallback(
    async (fn: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
      if (acting) return;
      setActing(true);
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.message);
      await loadSummary();
      setActing(false);
    },
    [acting, loadSummary],
  );

  const runTermsDecision = useCallback(
    async (decision: 'approved' | 'issue_raised', comment?: string) => {
      const summaryId = terms?.summary?.id;
      if (!summaryId || acting) return;
      setActing(true);
      setError(null);
      const result = await decideTermsSummary(thread.dealId, summaryId, decision, comment);
      if (!result.ok) setError(result.message);
      await loadTerms();
      if (!result.ok || !result.transitioned) await loadSummary();
      if (result.ok && result.transitioned) onTransitioned();
      setActing(false);
    },
    [acting, loadSummary, loadTerms, onTransitioned, terms?.summary?.id, thread.dealId],
  );

  const runContract = useCallback(
    async (fn: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
      if (acting) return;
      setActing(true);
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.message);
      await loadContract();
      if (result.ok) onTransitioned();
      setActing(false);
    },
    [acting, loadContract, onTransitioned],
  );

  const submitSignature = useCallback(
    async (payload: Parameters<typeof signContract>[1]) => {
      setError(null);
      const result = await signContract(thread.dealId, payload);
      if (!result.ok) {
        setError(result.message);
        return result;
      }
      await loadContract();
      onTransitioned();
      return result;
    },
    [loadContract, onTransitioned, thread.dealId],
  );

  const download = useCallback(async () => {
    if (acting) return;
    setActing(true);
    setError(null);
    const result = await getContractDownload(thread.dealId);
    if (!result.ok) setError(result.message);
    else {
      try {
        await Linking.openURL(result.url);
      } catch {
        setError('The secure download link could not be opened. Please try again.');
      }
    }
    setActing(false);
  }, [acting, thread.dealId]);

  // ── Role / relationship derivations (rbac.md + deal-engine.md) ──
  const { stage, myRole, isDisputed } = thread;
  const isInitiator = thread.createdBy === userId;
  const isCreator = myRole === 'creator';
  const isBrandActor = myRole === 'brand_admin' || myRole === 'brand_maker';
  // Checker can't accept/decline/cancel/close (rbac.md "Deal flow — by stage").
  const canRespond = myRole === 'creator' || isBrandActor;

  const termsReview = (readOnly: boolean): ReactNode => {
    if (termsLoading && !terms) return <Waiting text="Loading the terms review…" />;
    if (termsError && !terms) {
      return (
        <Actions label="Terms review" error={termsError}>
          <InlineButton label="Retry" onPress={() => void loadTerms(true)} disabled={termsLoading} />
        </Actions>
      );
    }
    if (!terms?.summary) return null;
    return (
      <TermsReviewCard
        summary={terms.summary}
        userId={userId}
        readOnly={readOnly}
        acting={acting}
        error={error}
        onDecision={runTermsDecision}
      />
    );
  };

  const body = () => {
    switch (stage) {
      case 'pending':
        // The recipient (not the initiator; not a checker) responds.
        if (!isInitiator && canRespond) {
          return (
            <Actions label="Connection request" error={error}>
              {exclusivityWarning ? (
                <View className="mb-2 rounded-xl bg-status-critical-tint px-3 py-2">
                  <Text className="font-geist-medium text-[13px] text-status-critical">{exclusivityWarning}</Text>
                  <Text className="mt-0.5 font-geist text-[12px] text-ink-2">
                    You can still accept — this is a heads-up, not a block.
                  </Text>
                </View>
              ) : null}
              <ButtonRow>
                <GhostButton label="Decline" onPress={() => run(() => declineDeal(thread.dealId))} disabled={acting} />
                <PrimaryButton
                  label={exclusivityWarning ? 'Accept anyway' : 'Accept'}
                  onPress={() => onAccept(exclusivityWarning != null)}
                  disabled={acting}
                />
              </ButtonRow>
            </Actions>
          );
        }
        return <Waiting text={`Waiting for a response${thread.expiresAt ? ` · expires in ${hoursUntil(thread.expiresAt)}h` : ''}`} />;

      case 'chatting':
        return termsReview(false) ?? <SummaryGate summary={summary} dealId={thread.dealId} userId={userId} acting={acting} error={error} onAction={runSummary} />;

      case 'approval':
        if (contractLoading && !contract) return <View className="gap-2.5">{termsReview(true)}<Waiting text="Loading the contract…" /></View>;
        if (!contract?.contract) {
          return (
            <View className="gap-2.5">
              {termsReview(true)}
              <Actions label="Approval — contract" error={error}>
                <PrimaryButton label={acting ? 'Generating…' : 'Generate contract'} onPress={() => runContract(() => generateContract(thread.dealId))} disabled={acting} />
              </Actions>
            </View>
          );
        }
        return (
          <View className="gap-2.5">
            {termsReview(true)}
            <Actions label="Approval — contract" error={error}>
              <ContractCard
                state={contract}
                myRole={myRole}
                userId={userId}
                acting={acting}
                onDownload={download}
                onSign={() => setSigning(true)}
                onDecision={(requestId, decision) => runContract(() => decideContractSigning(requestId, decision))}
                onAlignmentRetry={() => runContract(() => runContractAlignment(thread.dealId))}
                onAlignmentOverride={() => {
                  const extractionId = contract.alignment.extraction_id;
                  if (extractionId) void runContract(() => overrideContractAlignment(thread.dealId, extractionId));
                }}
              />
            </Actions>
          </View>
        );

      case 'creating':
        if (isCreator) {
          return (
            <View className="gap-2.5">
              {termsReview(true)}
              <Actions label="Creating — posting gate" error={error}>
                <ButtonRow>
                  <PrimaryButton label="Submit live link" onPress={() => onTransition('submit-live')} disabled={acting} />
                </ButtonRow>
              </Actions>
            </View>
          );
        }
        return <View className="gap-2.5">{termsReview(true)}<Waiting text="Reviewing the creator’s work." /></View>;

      case 'posted':
        if (isBrandActor) {
          return (
            <Actions label="Posted — confirm the post" error={error}>
              <ButtonRow>
                <PrimaryButton label="Confirm post live" onPress={() => onTransition('confirm-posts')} disabled={acting} />
              </ButtonRow>
            </Actions>
          );
        }
        return <Waiting text="Waiting for the brand to confirm the post." />;

      case 'payment':
        if (isDisputed) return <Waiting text="Dispute in progress — payment paused." />;
        if (canRespond) {
          return (
            <Actions label="Payment — track to completion" error={error}>
              <ButtonRow>
                <PrimaryButton label="Close deal" onPress={() => onTransition('close')} disabled={acting} />
              </ButtonRow>
            </Actions>
          );
        }
        return <Waiting text="Payment in progress." />;

      case 'closed':
        return <Waiting text="This deal is closed." />;
      case 'declined':
        return <Waiting text="This connection was declined." />;
      case 'cancelled':
        return <Waiting text="This deal was cancelled." />;
    }
  };

  return (
    <>
      <View className="border-t border-hairline bg-app px-4 pb-2 pt-3">{body()}</View>
      {contract?.contract ? (
        <ContractSignSheet
          visible={signing}
          dealId={thread.dealId}
          contractId={contract.contract.id}
          onClose={() => setSigning(false)}
          onSign={submitSignature}
        />
      ) : null}
    </>
  );
}

function ContractCard({
  state,
  myRole,
  userId,
  acting,
  onDownload,
  onSign,
  onDecision,
  onAlignmentRetry,
  onAlignmentOverride,
}: {
  state: ContractState;
  myRole: DealThread['myRole'];
  userId: string;
  acting: boolean;
  onDownload: () => void;
  onSign: () => void;
  onDecision: (requestId: string, decision: 'approve' | 'reject') => void;
  onAlignmentRetry: () => void;
  onAlignmentOverride: () => void;
}) {
  const creator = state.required_signatures.creator;
  const brand = state.required_signatures.brand;
  const approval = state.maker_checker;
  const isBrand = myRole === 'brand_admin' || myRole === 'brand_maker';
  const isCreator = myRole === 'creator';
  const mySideSigned = (isCreator && creator === 'signed') || (isBrand && brand === 'signed');
  const maySign = state.contract?.status === 'awaiting_signatures' && state.alignment.signing_enabled && (isCreator || isBrand) && !mySideSigned && !(isBrand && brand === 'held');

  return (
    <View className="gap-2.5 rounded-2xl border border-hairline bg-surface-card p-3">
      <View className="flex-row items-center justify-between">
        <View>
          <Text className="font-geist-semibold text-[14px] text-ink">Contract v{state.contract?.version}</Text>
          <Text className="mt-0.5 font-geist text-[11px] text-ink-3">
            {state.contract?.status === 'executed' ? 'Executed PDF ready' : 'Secure PDF · awaiting signatures'}
          </Text>
        </View>
        <InlineButton label="Download" onPress={onDownload} disabled={acting} />
      </View>

      <View className="rounded-xl bg-surface-recess px-3 py-2">
        <SignerRow label="Creator" status={creator} signature={state.signatures.find((item) => item.side === 'creator')} />
        <View className="my-2 h-px bg-hairline" />
        <SignerRow label="Brand" status={brand} signature={state.signatures.find((item) => item.side === 'brand')} />
      </View>

      <ContractAlignmentCard
        alignment={state.alignment}
        acting={acting}
        onRetry={onAlignmentRetry}
        onOverride={onAlignmentOverride}
      />

      {approval ? (
        <View className={`rounded-xl px-3 py-2 ${approval.status === 'rejected' ? 'bg-status-critical-tint' : approval.status === 'approved' ? 'bg-status-good-tint' : 'bg-cane-1'}`}>
          <Text className="font-geist-semibold text-[12px] text-ink">
            {approval.status === 'pending'
              ? `Maker signature held · waiting for ${approval.checker_name}`
              : approval.status === 'approved'
                ? `Checker approved ${approval.maker_name}'s signature`
                : `Checker rejected ${approval.maker_name}'s signature`}
          </Text>
          {approval.comment ? <Text className="mt-1 font-geist text-[11px] text-ink-2">{approval.comment}</Text> : null}
          {approval.can_decide ? (
            <View className="mt-2 flex-row gap-2">
              <GhostButton label="Reject" onPress={() => onDecision(approval.request_id, 'reject')} disabled={acting} />
              <PrimaryButton label="Approve signing" onPress={() => onDecision(approval.request_id, 'approve')} disabled={acting} />
            </View>
          ) : null}
        </View>
      ) : null}

      {maySign ? <PrimaryButton label="Review and sign" onPress={onSign} disabled={acting} /> : null}
      {!state.alignment.signing_enabled && state.alignment.status !== 'processing' && state.alignment.status !== 'not_started' ? (
        <Text className="text-center font-geist text-[11px] text-ink-2">Review and signing stay disabled until alignment is clear or overridden.</Text>
      ) : null}
      {mySideSigned ? <Text className="text-center font-geist-medium text-[12px] text-status-good-label">Your side is signed.</Text> : null}
      {approval?.status === 'rejected' && approval.maker_id === userId ? (
        <Text className="text-center font-geist text-[11px] text-ink-2">Choose Review and sign to correct and retry.</Text>
      ) : null}
    </View>
  );
}

function SignerRow({
  label,
  status,
  signature,
}: {
  label: string;
  status: 'pending' | 'held' | 'signed';
  signature: ContractState['signatures'][number] | undefined;
}) {
  const detail = signature
    ? `${signature.signer_name} · ${signature.signature_mode === 'print_bypass' ? 'print and sign' : signature.signature_mode}`
    : status === 'held'
      ? 'Held for checker approval'
      : 'Signature pending';
  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="min-w-0 flex-1">
        <Text className="font-geist-semibold text-[12px] text-ink">{label}</Text>
        <Text className="font-geist text-[11px] text-ink-2" numberOfLines={1}>{detail}</Text>
      </View>
      <Text className={`font-geist-semibold text-[11px] ${status === 'signed' ? 'text-status-good-label' : 'text-ink-3'}`}>
        {status === 'signed' ? 'Signed' : status === 'held' ? 'Held' : 'Pending'}
      </Text>
    </View>
  );
}

/** The two ordered Chatting gates. This only handles Gate A; no AI output or
 * approval-stage CTA is shown until Phase 10 has a real parser result. */
function SummaryGate({
  summary,
  dealId,
  userId,
  acting,
  error,
  onAction,
}: {
  summary: SummaryChecklist | null;
  dealId: string;
  userId: string;
  acting: boolean;
  error: string | null;
  onAction: (fn: () => Promise<{ ok: true } | { ok: false; message: string }>) => void;
}) {
  if (!summary) return <Waiting text="Checking the deal checklist…" />;
  const missing = summary.missing_fields;
  const isRequester = summary.requested_by === userId;
  const isOtherSide = summary.requester_side != null && summary.requester_side !== summary.viewer_side;

  if (missing.length > 0) {
    return (
      <Actions label="Chatting — terms checklist" error={error}>
        <View className="rounded-2xl bg-surface-recess px-3.5 py-3">
          <Text className="font-geist-medium text-[13px] text-ink-2">
            {missing.length} field{missing.length === 1 ? '' : 's'} still needed before summary
          </Text>
          {missing.map((field) => {
            const override = summary.checklist.find((item) => item.key === field.key)?.override;
            const canConfirm = override?.state === 'awaiting_confirmation' && override.proposer_side !== summary.viewer_side;
            return (
              <View key={field.key} className="mt-2 border-t border-hairline pt-2">
                <Text className="font-geist text-[12px] text-ink-2">• {field.label}{field.status === 'ambiguous' ? ' — clarify' : ''}</Text>
                {summary.can_act ? (
                  canConfirm ? (
                    <InlineButton label="Confirm discussed" disabled={acting} onPress={() => onAction(() => confirmChecklistOverride(dealId, field.key))} />
                  ) : override?.state === 'awaiting_confirmation' ? (
                    <Text className="mt-1 font-geist text-[11px] text-ink-3">Waiting for the other side to confirm it was discussed.</Text>
                  ) : (
                    <InlineButton label="Mark as discussed" disabled={acting} onPress={() => onAction(() => proposeChecklistOverride(dealId, field.key))} />
                  )
                ) : null}
              </View>
            );
          })}
        </View>
      </Actions>
    );
  }

  if (summary.request_status === 'idle') {
    return (
      <Actions label="Chatting — next step" error={error}>
        {summary.can_act ? <PrimaryButton label="Request terms summary" onPress={() => onAction(() => requestTermsSummary(dealId))} disabled={acting} /> : <Waiting text="Checklist complete. A creator, brand admin, or maker can request the summary." />}
      </Actions>
    );
  }
  if (summary.request_status === 'awaiting_confirmation') {
    if (summary.can_act && isOtherSide) {
      return (
        <Actions label="Summary requested — confirm" error={error}>
          <ButtonRow>
            <GhostButton label="Not yet" onPress={() => onAction(() => deferTermsSummaryRequest(dealId))} disabled={acting} />
            <PrimaryButton label="Confirm request" onPress={() => onAction(() => confirmTermsSummaryRequest(dealId))} disabled={acting} />
          </ButtonRow>
        </Actions>
      );
    }
    return <Waiting text={isRequester ? 'Waiting for the other side to confirm the summary.' : 'Waiting for an eligible participant on the other side.'} />;
  }
  return <Waiting text="Both sides confirmed. Summary generation is ready; the parser arrives in Phase 10." />;
}

/** Whole hours from now until an ISO timestamp (floored at 0). */
function hoursUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 3_600_000));
}

/* ── Small presentational pieces (tokens only) ── */

function Actions({ label, error, children }: { label: string; error: string | null; children: ReactNode }) {
  return (
    <View>
      <Text className="mb-2 font-geist-semibold text-[10.5px] uppercase tracking-wider text-ink-3">{label}</Text>
      {children}
      {error ? <Text className="mt-2 font-geist text-[12px] text-status-critical">{error}</Text> : null}
    </View>
  );
}

function ButtonRow({ children }: { children: ReactNode }) {
  return <View className="flex-row gap-2">{children}</View>;
}

function Waiting({ text }: { text: string }) {
  return (
    <View className="rounded-2xl bg-surface-recess px-3.5 py-3">
      <Text className="text-center font-geist-medium text-[13px] text-ink-2">{text}</Text>
    </View>
  );
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`flex-1 items-center justify-center rounded-full bg-ink py-2.5 ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className="font-geist-semibold text-[14px] text-white">{label}</Text>
    </Pressable>
  );
}

function GhostButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`flex-1 items-center justify-center rounded-full border border-hairline bg-surface-card py-2.5 ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className="font-geist-semibold text-[14px] text-ink-2">{label}</Text>
    </Pressable>
  );
}

function InlineButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} className={`mt-1 self-start rounded-full bg-cane-2 px-2.5 py-1 ${disabled ? 'opacity-50' : ''}`}>
      <Text className="font-geist-semibold text-[11px] text-ink">{label}</Text>
    </Pressable>
  );
}
