import { ScrollView, Text, View } from 'react-native';

import { Chip } from '@/components/ui/chip';

/**
 * FilterChips — one horizontal, single-select facet row (Discovery filters). Tap a
 * chip to select it; tap it again to clear. Values are derived from the fetched set
 * by the container. Purely presentational; the container owns selection + filtering.
 */
export function FilterChips({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  if (options.length === 0) return null;
  return (
    <View className="mb-2.5">
      <Text className="mb-1.5 font-geist-medium text-[11px] uppercase tracking-wide text-ink-3">
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 pr-4"
      >
        {options.map((opt) => (
          <Chip
            key={opt}
            label={opt}
            selected={selected === opt}
            onPress={() => onSelect(selected === opt ? null : opt)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
