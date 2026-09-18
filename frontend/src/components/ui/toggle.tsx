import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { EASE_OUT, useMotion } from '@/components/motion/use-motion';

const TRACK_W = 48;
const TRACK_H = 29;
const KNOB = 23;
const KNOB_INSET = (TRACK_H - KNOB) / 2;
const TRAVEL = TRACK_W - KNOB - KNOB_INSET * 2;

/**
 * Toggle — the mockup's `.switch`: a 48×29 track (ink when on, cane when off) with a
 * lifted white knob. The knob and ink track share the motion timing so the state
 * change stays legible without becoming noisy.
 *
 * The animated layers use plain StyleSheet styles, never `className`: NativeWind only
 * converts className on components it has registered, and Reanimated's Animated.View
 * isn't one — its classes were silently dropped, leaving a size-less, invisible knob.
 */
export function Toggle({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const { reduce, t } = useMotion();
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, { duration: t(180), easing: EASE_OUT });
  }, [progress, t, value]);

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * TRAVEL }],
  }));
  const inkStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const press = () => {
    if (disabled) return;
    onValueChange(!value);
    if (!reduce && Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <Pressable
      onPress={press}
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      aria-checked={value}
      accessibilityLabel={accessibilityLabel}
      style={[styles.track, disabled && styles.disabled]}
    >
      <Animated.View pointerEvents="none" style={[styles.ink, inkStyle]} />
      <Animated.View pointerEvents="none" style={[styles.knob, knobStyle]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    // cane-2: warm off-state track; the recessed inset keeps it reading as a channel.
    backgroundColor: '#DFDACF',
    boxShadow: 'inset 0 1px 2px rgba(28,27,24,0.08)',
    flexShrink: 0,
  },
  ink: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: TRACK_H / 2,
    backgroundColor: '#1C1B18',
  },
  knob: {
    position: 'absolute',
    top: KNOB_INSET,
    left: KNOB_INSET,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(28,27,24,0.08)',
    // Lifted glass knob: contact + soft far shadow, warm-tinted from ink.
    boxShadow: '0 1px 1px rgba(28,27,24,0.10), 0 2px 5px rgba(28,27,24,0.14)',
  },
  disabled: { opacity: 0.4 },
});
