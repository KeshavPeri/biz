import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { EASE_OUT_STRONG, useMotion } from '@/components/motion/use-motion';

/**
 * OnboardingProgress — the mockup's `.progress` segmented bar. `total` segments,
 * filled (ink) through `current` (0-indexed), the rest warm-grey. Sized to the
 * actual step count of whichever wizard path (creator/brand) is active.
 * Stage advance (roadmap §2.4/B4-09): the fill stays mounted, and the segment
 * that just became current scales in from the left (240ms ease-out-strong);
 * earlier segments render filled instantly, never re-animating.
 */
export function OnboardingProgress({ total, current }: { total: number; current: number }) {
  return (
    <View className="flex-1 flex-row gap-[5px]">
      {Array.from({ length: total }).map((_, i) => (
        <Segment key={i} filled={i <= current} justArrived={i === current} />
      ))}
    </View>
  );
}

function Segment({ filled, justArrived }: { filled: boolean; justArrived: boolean }) {
  const { reduce, t } = useMotion();
  const scale = useSharedValue(filled ? 1 : 0);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      scale.value = filled ? 1 : 0;
      return;
    }
    if (filled && justArrived) {
      scale.value = reduce ? 1 : 0;
      scale.value = withTiming(1, { duration: t(240), easing: EASE_OUT_STRONG });
    } else {
      scale.value = filled ? 1 : 0;
    }
  }, [filled, justArrived, reduce, scale, t]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scale.value }],
  }));

  return (
    <View className="h-[3.5px] flex-1 overflow-hidden rounded-[2px] bg-cane-2">
      <Animated.View
        style={[{ transformOrigin: 'left' }, animatedStyle]}
        className="h-full rounded-[2px] bg-ink"
      />
    </View>
  );
}
