import { type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { Chip } from '@/components/ui/chip';

export function ChipGroup({
  label,
  hint,
  options,
  selected,
  onToggle,
}: {
  label: string;
  hint?: ReactNode;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <View className="mb-4">
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="font-geist-semibold text-secondary text-ink-2">{label}</Text>
        {hint ? <View>{hint}</View> : null}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={selected.some((value) => value.toLowerCase() === option.toLowerCase())}
            onPress={() => onToggle(option)}
          />
        ))}
      </View>
    </View>
  );
}
