import { useEffect } from 'react';
import { Platform, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { EASE_OUT, useMotion } from '@/components/motion/use-motion';

/**
 * Toggle — the mockup's `.switch`: a 48×29 track (ink when on, warm-grey when
 * off) with a lifted knob. The knob and ink track crossfade use the shared
 * motion timing so the state change remains legible without becoming noisy.
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
  const knobPosition = useSharedValue(value ? 19 : 0);
  const trackOpacity = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    knobPosition.value = withTiming(value ? 19 : 0, { duration: t(160), easing: EASE_OUT });
    trackOpacity.value = withTiming(value ? 1 : 0, { duration: t(160), easing: EASE_OUT });
  }, [knobPosition, t, trackOpacity, value]);

  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: knobPosition.value }] }));
  const inkStyle = useAnimatedStyle(() => ({ opacity: trackOpacity.value }));

  const press = () => {
    if (disabled) return;
    onValueChange(!value);
    if (!reduce && Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <Pressable
      onPress={press}
      hitSlop={{ top: 8, bottom: 8 }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      className={`h-[29px] w-12 justify-center overflow-hidden rounded-pill bg-cane-2 ${disabled ? 'opacity-40' : ''}`}
    >
      <Animated.View pointerEvents="none" className="absolute inset-0 rounded-pill bg-ink" style={inkStyle} />
      {/* Lifted knob — white with a soft drop shadow (mockup's glass knob). */}
      <Animated.View
        className="absolute left-[3px] h-[23px] w-[23px] rounded-full bg-white"
        style={[
          {
            shadowColor: '#1C1B18',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.12,
            shadowRadius: 2,
            elevation: 2,
          },
          knobStyle,
        ]}
      />
    </Pressable>
  );
}
