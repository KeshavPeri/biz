import React, { useEffect } from 'react';
import { View, type DimensionValue } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useMotion } from '@/components/motion/use-motion';

type Radius = 'card' | 'panel' | 'pill';
const radiusClass: Record<Radius, string> = {
  card: 'rounded-card',
  panel: 'rounded-panel',
  pill: 'rounded-pill',
};

type BlockProps = { width?: DimensionValue; height: number; radius?: Radius; className?: string };

/**
 * Skeleton.Block — the base unit (roadmap §2.6): a `bg-surface-recess` block that
 * pulses opacity 0.6↔1 over 1200ms; static 0.8 under reduce-motion. Initial-load
 * only — on refetch, keep stale content (see `RefreshDip`) instead of re-mounting this.
 */
function Block({ width = '100%', height, radius = 'card', className }: BlockProps) {
  const { reduce } = useMotion();
  const opacity = useSharedValue(reduce ? 0.8 : 0.6);

  useEffect(() => {
    if (reduce) {
      opacity.value = 0.8;
      return;
    }
    opacity.value = withRepeat(withTiming(1, { duration: 1200 }), -1, true);
    return () => cancelAnimation(opacity);
  }, [reduce, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[{ width, height }, animatedStyle]}
      className={`bg-surface-recess ${radiusClass[radius]} ${className ?? ''}`}
    />
  );
}

/** Preset: 3 preview rows for an inbox/list (avatar + 2 lines) — chat.tsx (B3-01). */
function InboxRows({ rows = 3 }: { rows?: number }) {
  return (
    <View className="gap-3 px-4 pt-1">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} className="flex-row items-center gap-2.5 rounded-card border border-hairline-card bg-surface-card p-3.5">
          <Block width={34} height={34} radius="pill" />
          <View className="min-w-0 flex-1 gap-2">
            <Block width="55%" height={14} radius="pill" />
            <Block width="35%" height={12} radius="pill" />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Preset: N×M card tiles — discover-screen.tsx (B3-26). */
function CardGrid({ columns = 2, rows = 3 }: { columns?: 1 | 2; rows?: number }) {
  const count = columns * rows;
  return (
    <View className="flex-row flex-wrap justify-between gap-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ width: columns === 2 ? '48.5%' : '100%' }}>
          <Block height={180} radius="card" />
        </View>
      ))}
    </View>
  );
}

/** Preset: header bar + 3 chat bubbles — deal room thread load (B2-07). */
function Thread() {
  return (
    <View className="flex-1 gap-4 px-4 pt-4">
      <Block width="45%" height={18} radius="pill" />
      <Block width="70%" height={48} radius="card" className="self-start" />
      <Block width="55%" height={36} radius="card" className="self-end" />
      <Block width="62%" height={56} radius="card" className="self-start" />
    </View>
  );
}

/** Preset: avatar + 2 lines + a card — brand/[id], creator/[id] profile load (B3-49). */
function Profile() {
  return (
    <View className="flex-1 gap-4 px-4 pt-4">
      <View className="items-center gap-3">
        <Block width={72} height={72} radius="pill" />
        <Block width="45%" height={18} radius="pill" />
        <Block width="65%" height={13} radius="pill" />
      </View>
      <Block height={140} radius="card" />
    </View>
  );
}

export const Skeleton = { Block, InboxRows, CardGrid, Thread, Profile };

/**
 * RefreshDip — the refetch counterpart to Skeleton (roadmap §2.6 rule): on a
 * background refresh, keep stale content mounted and dip its opacity to 0.6 for
 * 150ms instead of swapping to a spinner/skeleton. No-op under reduce-motion.
 */
export function RefreshDip({ refreshing, children }: { refreshing: boolean; children: React.ReactNode }) {
  const { reduce } = useMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduce) return;
    opacity.value = withTiming(refreshing ? 0.6 : 1, { duration: 150 });
  }, [refreshing, reduce, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: reduce ? 1 : opacity.value }));

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}
