import React, { useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { useMotion } from '@/components/motion/use-motion';

/**
 * WinSpring — the ONLY spring in the app (design-direction §8, roadmap §2.5).
 * Fires once per transition (a `useEffect` keyed on `trigger`, so it never
 * re-fires on an unrelated re-render): success haptic, then the wrapped view
 * scales 1→1.03→1 (~350ms). Reduce-motion: haptic only, no scale. Sites: deal
 * closed, payment received, request sent, rating submit, contract signed
 * (roadmap §1 #10, decision 6). Pair with a plain `entering={FadeIn}` on any
 * content that mounts fresh at the win moment (e.g. a "Request sent" panel) —
 * WinSpring itself often wraps an already-mounted card, where `entering`
 * would fire on the CARD's mount rather than the win transition.
 */
export function WinSpring({ trigger, children, style }: {
  trigger: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { reduce } = useMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!trigger) return;
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (reduce) return;
    scale.value = withSequence(
      withTiming(1.03, { duration: 140 }),
      withSpring(1, { damping: 18, stiffness: 220 }),
    );
  }, [trigger, reduce, scale]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
