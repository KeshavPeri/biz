import { View } from 'react-native';

/**
 * OnboardingProgress — the mockup's `.progress` segmented bar. `total` segments,
 * filled (ink) through `current` (0-indexed), the rest warm-grey. Sized to the
 * actual step count of whichever wizard path (creator/brand) is active.
 */
export function OnboardingProgress({ total, current }: { total: number; current: number }) {
  return (
    <View className="flex-1 flex-row gap-[5px]">
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} className="h-[3.5px] flex-1 overflow-hidden rounded-[2px] bg-cane-2">
          {i <= current ? <View className="h-full rounded-[2px] bg-ink" /> : null}
        </View>
      ))}
    </View>
  );
}
