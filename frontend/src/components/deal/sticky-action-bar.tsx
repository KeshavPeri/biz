import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  acceptDeal,
  confirmChecklistOverride,
  confirmTermsSummaryRequest,
  declineDeal,
  deferTermsSummaryRequest,
  fetchSummaryChecklist,
  proposeChecklistOverride,
  requestDealTransition,
  requestTermsSummary,
  type DealThread,
  type SummaryChecklist,
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
  onTransitioned,
}: {
  thread: DealThread;
  userId: string;
  onTransitioned: () => void;
}) {
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when accept returns a warn-only exclusivity notice (needs re-confirm).
  const [exclusivityWarning, setExclusivityWarning] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryChecklist | null>(null);

  const loadSummary = useCallback(async () => {
    if (thread.stage !== 'chatting') return;
    const result = await fetchSummaryChecklist(thread.dealId);
    if (result.ok) setSummary(result.data);
    else setError(result.message);
  }, [thread.dealId, thread.stage]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

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

  // ── Role / relationship derivations (rbac.md + deal-engine.md) ──
  const { stage, myRole, isDisputed } = thread;
  const isInitiator = thread.createdBy === userId;
  const isCreator = myRole === 'creator';
  const isBrandActor = myRole === 'brand_admin' || myRole === 'brand_maker';
  // Checker can't accept/decline/cancel/close (rbac.md "Deal flow — by stage").
  const canRespond = myRole === 'creator' || isBrandActor;

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
        return <SummaryGate summary={summary} dealId={thread.dealId} userId={userId} acting={acting} error={error} onAction={runSummary} />;

      case 'approval':
        // Signing is the 9.12 signature flow (not a stage transition) — the only
        // transition here is the pre-signature cancel off-ramp.
        return (
          <Actions label="Approval — review & sign the contract" error={error}>
            {canRespond ? (
              <ButtonRow>
                <GhostButton label="Cancel deal" onPress={() => onTransition('cancel')} disabled={acting} />
              </ButtonRow>
            ) : (
              <Waiting text="Review and sign the contract." />
            )}
          </Actions>
        );

      case 'creating':
        if (isCreator) {
          return (
            <Actions label="Creating — posting gate" error={error}>
              <ButtonRow>
                <PrimaryButton label="Submit live link" onPress={() => onTransition('submit-live')} disabled={acting} />
              </ButtonRow>
            </Actions>
          );
        }
        return <Waiting text="Reviewing the creator’s work." />;

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

  return <View className="border-t border-hairline bg-app px-4 pb-2 pt-3">{body()}</View>;
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
