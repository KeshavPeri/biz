import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { EditSheet } from '@/components/ui/edit-sheet';
import {
  PRIVATE_DELIVERABLE_LABELS,
  type PrivateDeliverableLabel,
} from '@/lib/private-deliverable-labels';

export function PrivateDeliverableLabelPicker({
  deliverableName,
  value,
  acting,
  onChange,
}: {
  deliverableName: string;
  value: PrivateDeliverableLabel | null;
  acting: boolean;
  onChange: (value: PrivateDeliverableLabel | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const choose = (next: PrivateDeliverableLabel | null) => {
    setOpen(false);
    onChange(next);
  };

  return (
    <>
      <View className="flex-row items-center justify-between gap-3 border-t border-hairline pt-2">
        <View className="min-w-0 flex-1">
          <Text className="font-geist-medium text-[10.5px] uppercase tracking-wide text-ink-3">
            Private label
          </Text>
          <Text className="mt-0.5 font-geist-medium text-[11.5px] text-ink-2">
            {value ?? 'None'}
          </Text>
        </View>
        <Pressable
          onPress={() => setOpen(true)}
          disabled={acting}
          accessibilityRole="button"
          accessibilityLabel={`Change private label for ${deliverableName}`}
          className={`rounded-full border border-hairline bg-surface-card px-3 py-1.5 ${acting ? 'opacity-50' : ''}`}
        >
          <Text className="font-geist-semibold text-[10.5px] text-ink-2">
            {value ? 'Change' : 'Add label'}
          </Text>
        </Pressable>
      </View>
      <EditSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Private label"
        subtitle={`Only you can see this organizer for ${deliverableName}.`}
      >
        <View className="gap-2">
          {PRIVATE_DELIVERABLE_LABELS.map((label) => (
            <LabelOption
              key={label}
              label={label}
              selected={label === value}
              disabled={acting}
              onPress={() => choose(label)}
            />
          ))}
          <LabelOption
            label="No label"
            selected={value === null}
            disabled={acting}
            onPress={() => choose(null)}
          />
        </View>
      </EditSheet>
    </>
  );
}

function LabelOption({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      className={`rounded-xl border px-3.5 py-3 ${
        selected ? 'border-ink bg-ink' : 'border-hairline bg-surface-card'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className={`font-geist-semibold text-[13px] ${selected ? 'text-white' : 'text-ink'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
