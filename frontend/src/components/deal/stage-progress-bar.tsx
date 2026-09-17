import { Fragment, useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Platform, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { EASE_OUT_STRONG, useMotion } from '@/components/motion/use-motion';
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
 *
 * Stage advance (roadmap §2.4 / B2-60): the segment that just filled sweeps in
 * (280ms ease-out-strong) and the new current-node ring pops in (scale 0.8→1 +
 * opacity, 160ms) with a light haptic — only on a real advance, never on first
 * mount (that's just the thread loading, not a transition). Instant under
 * reduce-motion.
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

function fireAdvanceHaptic() {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function StageProgressBar({ stage, isDisputed }: { stage: DealStage; isDisputed: boolean }) {
  const { reduce } = useMotion();
  const currentIndexRaw = MAIN_LINE.findIndex((s) => s.stage === stage); // closed → 6, off-ramps → -1
  const mountedIndex = useRef<number | null>(null);
  const [justAdvancedTo, setJustAdvancedTo] = useState<number | null>(null);

  useEffect(() => {
    if (currentIndexRaw < 0) return;
    if (mountedIndex.current === null) {
      mountedIndex.current = currentIndexRaw;
      return;
    }
    if (currentIndexRaw > mountedIndex.current) {
      mountedIndex.current = currentIndexRaw;
      setJustAdvancedTo(currentIndexRaw);
      if (!reduce) fireAdvanceHaptic();
    }
  }, [currentIndexRaw, reduce]);

  // Terminal off-ramps never traversed the full line — show their own end-state.
  if (stage === 'declined' || stage === 'cancelled') {
    return <TerminalStrip label={stage === 'declined' ? 'This connection was declined' : 'This deal was cancelled'} />;
  }

  const currentIndex = currentIndexRaw;
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
              justArrived={justAdvancedTo === i}
            />
            {i < MAIN_LINE.length - 1 ? <Segment filled={i < currentIndex} /> : null}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

/** One line segment between two nodes; the ink fill sweeps in from the left
 *  when it newly fills (B2-60), instant on first render / under reduce-motion. */
function Segment({ filled }: { filled: boolean }) {
  const { t } = useMotion();
  const [trackWidth, setTrackWidth] = useState(0);
  const progress = useSharedValue(filled ? 1 : 0);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      progress.value = filled ? 1 : 0;
      return;
    }
    progress.value = withTiming(filled ? 1 : 0, { duration: t(280), easing: EASE_OUT_STRONG });
  }, [filled, progress, t]);

  const animatedStyle = useAnimatedStyle(() => ({ width: progress.value * trackWidth }));

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  return (
    <View className="h-[1.5px] flex-1 bg-cane-2" onLayout={onLayout}>
      <Animated.View className="h-[1.5px] bg-ink" style={animatedStyle} />
    </View>
  );
}

/** A single stepper node: done/current = ink; current sits in a soft ring;
 *  a disputed Payment node turns critical; upcoming = cane. The current-node
 *  ring pops in (scale 0.8→1 + opacity, 160ms) the moment it becomes current.
 *  The ring colours are the ink / critical TOKENS at the ring opacity design-
 *  tokens.md §185 names (`rgba(28,27,24,.12)`) — the codebase's proven
 *  `bg-[rgba(...)]` pattern (cf. creator-card scrim), not an invented colour. */
function StepNode({ done, current, critical, justArrived }: {
  done: boolean; current: boolean; critical: boolean; justArrived: boolean;
}) {
  const { reduce, t } = useMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!current || !justArrived) return;
    scale.value = reduce ? 1 : 0.8;
    opacity.value = reduce ? 1 : 0;
    scale.value = withTiming(1, { duration: t(160) });
    opacity.value = withTiming(1, { duration: t(160) });
  }, [current, justArrived, opacity, reduce, scale, t]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  if (current) {
    const ring = critical ? 'bg-[rgba(192,57,43,0.15)]' : 'bg-[rgba(28,27,24,0.12)]';
    return (
      <Animated.View style={animatedStyle} className={`h-[18px] w-[18px] items-center justify-center rounded-full ${ring}`}>
        <View className={`h-[9px] w-[9px] rounded-full ${critical ? 'bg-status-critical' : 'bg-ink'}`} />
      </Animated.View>
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
