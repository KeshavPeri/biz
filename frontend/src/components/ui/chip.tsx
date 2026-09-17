import { useEffect } from 'react';
import { Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { PressableScale } from '@/components/motion/pressable-scale';
import { EASE_OUT, useMotion } from '@/components/motion/use-motion';

/**
 * Chip — the mockup's `.chip` selectable pill (niches, languages, credentials).
 * On = flat ink fill + white label; off = white surface + hairline + secondary
 * label. Purely presentational; selection state is owned by the parent screen.
 */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { t } = useMotion();
  // The ink fill is a layer faded in/out (opacity only) so selection doesn't hard-cut.
  const fill = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    fill.value = withTiming(selected ? 1 : 0, { duration: t(150), easing: EASE_OUT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const fillStyle = useAnimatedStyle(() => ({ opacity: fill.value }));

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`overflow-hidden rounded-pill border px-[15px] py-2.5 ${
        selected ? 'border-ink' : 'border-hairline'
      } bg-surface-card`}
    >
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#1C1B18' }, fillStyle]}
      />
      <Text
        className={`text-[13.5px] ${
          selected ? 'font-geist-semibold text-white' : 'font-geist-medium text-ink-2'
        }`}
      >
        {label}
      </Text>
    </PressableScale>
  );
}
