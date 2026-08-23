import { Fragment } from 'react';
import { Text, View } from 'react-native';

import type { DealStage } from '@/lib/deals';

/**
 * StageProgressBar (task 9.6) — the 7-stage stepper pinned to the top of every
 * deal thread. Rebuilt in RN from the mockup's `.tracker`/`.stepper` using design
 * tokens only (design-tokens.md §185: done/current nodes = ink, current ring
 * = ink/10; upcoming = cane). Driven purely by the deal's stage + is_disputed.
 *
 *   • Disputed = a red OVERLAY on the Payment node (it's a flag, not a stage).
 *   • Terminal off-ramps (declined/cancelled) leave the main line → own end-state.
 *   • closed renders the line fully complete.
 */

const MAIN_LINE: { stage: DealStage; label: string }[] = [
  { stage: 'pending', label: 'Pending' },
  { stage: 'chatting', label: 'Chatting' },
  { stage: 'approval', label: 'Approval' },
  { stage: 'creating', label: 'Creating' },
  { stage: 'posted', label: 'Posted' },
  { stage: 'payment', label: 'Payment' },
  { stage: 'closed', label: 'Closed' },
];

export function StageProgressBar({ stage, isDisputed }: { stage: DealStage; isDisputed: boolean }) {
  // Terminal off-ramps never traversed the full line — show their own end-state.
  if (stage === 'declined' || stage === 'cancelled') {
    return <TerminalStrip label={stage === 'declined' ? 'This connection was declined' : 'This deal was cancelled'} />;
  }

  const currentIndex = MAIN_LINE.findIndex((s) => s.stage === stage); // closed → 6
  const disputedPayment = isDisputed && stage === 'payment';
  const headerLabel = disputedPayment ? 'Payment — disputed' : MAIN_LINE[currentIndex].label;

  return (
    <View className="border-t border-hairline px-3.5 pb-3 pt-2.5">
      {/* Header: stage name (truncates) left, "n / 7 ›" right. */}
      <View className="mb-2.5 flex-row items-baseline justify-between gap-2.5">
        <Text
          className={`font-geist-semibold text-[13px] ${disputedPayment ? 'text-status-critical' : 'text-ink'}`}
          numberOfLines={1}
        >
          {headerLabel}
        </Text>
        <Text className="font-geist-medium text-[12px] text-ink-2">{currentIndex + 1} / 7 ›</Text>
      </View>

      {/* Stepper: nodes joined by segments. */}
      <View className="flex-row items-center">
        {MAIN_LINE.map((s, i) => (
          <Fragment key={s.stage}>
            <StepNode
              done={i < currentIndex}
              current={i === currentIndex}
              critical={disputedPayment && s.stage === 'payment'}
            />
            {i < MAIN_LINE.length - 1 ? (
              <View className={`h-[1.5px] flex-1 ${i < currentIndex ? 'bg-ink' : 'bg-cane-2'}`} />
            ) : null}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

/** A single stepper node: done/current = ink; current sits in a soft ring;
 *  a disputed Payment node turns critical; upcoming = cane.
 *  The ring colours are the ink / critical TOKENS at the ring opacity design-
 *  tokens.md §185 names (`rgba(28,27,24,.12)`) — the codebase's proven
 *  `bg-[rgba(...)]` pattern (cf. creator-card scrim), not an invented colour. */
function StepNode({ done, current, critical }: { done: boolean; current: boolean; critical: boolean }) {
  if (current) {
    const ring = critical ? 'bg-[rgba(192,57,43,0.15)]' : 'bg-[rgba(28,27,24,0.12)]';
    return (
      <View className={`h-[18px] w-[18px] items-center justify-center rounded-full ${ring}`}>
        <View className={`h-[9px] w-[9px] rounded-full ${critical ? 'bg-status-critical' : 'bg-ink'}`} />
      </View>
    );
  }
  return <View className={`h-[9px] w-[9px] rounded-full ${done ? 'bg-ink' : 'bg-cane-2'}`} />;
}

/** End-state strip for the terminal off-ramps (declined / cancelled) — muted, calm. */
function TerminalStrip({ label }: { label: string }) {
  return (
    <View className="flex-row items-center gap-2 border-t border-hairline px-4 py-2.5">
      <View className="h-2 w-2 rounded-full bg-status-neutral" />
      <Text className="font-geist-medium text-[13px] text-ink-2">{label}</Text>
    </View>
  );
}
