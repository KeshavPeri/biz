import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import ChevronLeftIcon from '@/assets/icons/chevron-left.svg';
import { EASE_OUT } from '@/components/motion/use-motion';
import { GlassSurface } from '@/components/ui/glass-surface';

type DetailHeaderProps = {
  title: string;
  scrolled: SharedValue<number>;
  onBack: () => void;
  rightAction?: ReactNode;
};

/** Fixed route header shared by profile and deal detail screens. */
export function DetailHeader({ title, scrolled, onBack, rightAction }: DetailHeaderProps) {
  const glassStyle = useAnimatedStyle(() => ({ opacity: scrolled.value }));
  const titleStyle = useAnimatedStyle(() => ({ opacity: scrolled.value }));

  return (
    <View className="h-[52px] border-b border-hairline bg-app">
      <Animated.View pointerEvents="none" className="absolute inset-0" style={glassStyle}>
        <GlassSurface className="flex-1" radius={0} />
      </Animated.View>
      <Pressable
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onBack();
        }}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel="Back"
        className="absolute left-1 z-10 h-11 w-11 items-center justify-center"
      >
        <ChevronLeftIcon width={24} height={24} color="#1C1B18" />
      </Pressable>
      <Animated.View pointerEvents="none" className="absolute inset-0 items-center justify-center px-14" style={titleStyle}>
        <Text className="font-geist-semibold text-subtitle text-ink" numberOfLines={1} maxFontSizeMultiplier={1.25}>
          {title}
        </Text>
      </Animated.View>
      {rightAction ? <View className="absolute right-1 z-10 h-11 w-11 items-center justify-center">{rightAction}</View> : null}
    </View>
  );
}

/** Scroll handler that reveals the fixed header material after the first card moves. */
export function useDetailHeaderScroll() {
  const scrolled = useSharedValue(0);
  const reveal = (offset: number) => {
    const next = offset > 8 ? 1 : 0;
    if (next !== scrolled.value) scrolled.value = withTiming(next, { duration: 150, easing: EASE_OUT });
  };
  const onScroll = useAnimatedScrollHandler((event) => {
    const next = event.contentOffset.y > 8 ? 1 : 0;
    if (next !== scrolled.value) scrolled.value = withTiming(next, { duration: 150, easing: EASE_OUT });
  });
  return { onScroll, reveal, scrolled };
}
