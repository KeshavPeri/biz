import { ScrollView, Text, View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import {
  EMPTY_TRACKER_FILTERS, TRACKER_DEAL_TYPES, TRACKER_DIRECTIONS, TRACKER_STAGES,
  TRACKER_STATUSES, type TrackerFilters as FilterState,
} from '@/lib/tracker-state';

type Props = {
  filters: FilterState;
  asOf: string;
  onChange: (filters: FilterState) => void;
};

function title(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function utcDateBefore(asOf: string, days: number): string {
  const date = new Date(asOf);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function TrackerFilters({ filters, asOf, onChange }: Props) {
  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    onChange({ ...filters, [key]: filters[key] === value ? null : value });
  const ranges = [
    { label: 'Any date', value: null },
    { label: 'Last 30d', value: utcDateBefore(asOf, 30) },
    { label: 'Last 90d', value: utcDateBefore(asOf, 90) },
  ];
  const groups: { label: string; values: readonly string[]; key: keyof FilterState }[] = [
    { label: 'Health', values: TRACKER_STATUSES, key: 'status' },
    { label: 'Stage', values: TRACKER_STAGES, key: 'stage' },
    { label: 'Type', values: TRACKER_DEAL_TYPES, key: 'dealType' },
    { label: 'Direction', values: TRACKER_DIRECTIONS, key: 'direction' },
  ];
  return (
    <View className="gap-3">
      {groups.map((group) => (
        <View key={group.key}>
          <Text className="mb-1.5 font-geist-medium text-micro text-ink-3">{group.label}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
            {group.values.map((value) => (
              <Chip key={value} label={title(value)} selected={filters[group.key] === value} onPress={() => set(group.key, value as never)} />
            ))}
          </ScrollView>
        </View>
      ))}
      <View>
        <Text className="mb-1.5 font-geist-medium text-micro text-ink-3">Created</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
          {ranges.map((range) => (
            <Chip
              key={range.label}
              label={range.label}
              selected={filters.createdFrom === range.value}
              onPress={() => onChange({ ...filters, createdFrom: range.value, createdTo: asOf.slice(0, 10) })}
            />
          ))}
          <Chip label="Clear all" selected={false} onPress={() => onChange(EMPTY_TRACKER_FILTERS)} />
        </ScrollView>
      </View>
    </View>
  );
}
