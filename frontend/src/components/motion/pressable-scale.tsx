import * as Haptics from 'expo-haptics';
import { cssInterop } from 'nativewind';
import React from 'react';
import {
  Platform,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { EASE_OUT, useMotion } from '@/components/motion/use-motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type PressHaptic = 'selection' | 'light' | 'none';

type PressableScaleProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Haptic fired on press-in, same frame as the visual (iOS/Android only). */
  haptic?: PressHaptic;
  className?: string;
};

type BaseProps = PressableScaleProps & {
  /** NativeWind's resolved className styles (see cssInterop below). */
  classStyle?: StyleProp<ViewStyle>;
};

function fireHaptic(haptic: PressHaptic) {
  if (haptic === 'none' || Platform.OS === 'web') return;
  if (haptic === 'light') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } else {
    Haptics.selectionAsync();
  }
}

const PressableScaleBase = React.forwardRef<View, BaseProps>(function PressableScaleBase(
  { classStyle, style, haptic = 'selection', hitSlop = 4, onPressIn, onPressOut, disabled, ...rest },
  ref
) {
  const { reduce } = useMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = (e: GestureResponderEvent) => {
    // Reduce-motion keeps the opacity dip (not motion) and drops the scale.
    if (!reduce) scale.value = withTiming(0.97, { duration: 120, easing: EASE_OUT });
    opacity.value = withTiming(0.9, { duration: reduce ? 0 : 120, easing: EASE_OUT });
    fireHaptic(haptic);
    onPressIn?.(e);
  };

  const handlePressOut = (e: GestureResponderEvent) => {
    scale.value = withTiming(1, { duration: reduce ? 0 : 160, easing: EASE_OUT });
    opacity.value = withTiming(1, { duration: reduce ? 0 : 160, easing: EASE_OUT });
    onPressOut?.(e);
  };

  return (
    <AnimatedPressable
      ref={ref}
      {...rest}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      // Class styles and the animated style are merged here rather than through
      // NativeWind's inline-style path, which flattens (and so breaks) animated styles.
      style={[classStyle, style, animatedStyle]}
    />
  );
});

/**
 * PressableScale — the shared press feedback (roadmap §2.1): scale 0.97 + opacity
 * 0.9 in 120ms on press-in, back in 160ms, with a haptic on the same frame. No
 * spring — a press is not a win (§8). Used by Button, Chip, the tab bar and cards.
 */
export const PressableScale = PressableScaleBase as React.ForwardRefExoticComponent<
  PressableScaleProps & React.RefAttributes<View>
>;

cssInterop(PressableScaleBase, { className: { target: 'classStyle' } });
