import { Pressable, Text } from 'react-native';

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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`rounded-pill border px-[15px] py-2.5 ${
        selected ? 'border-ink bg-ink' : 'border-hairline bg-surface-card'
      }`}
    >
      <Text
        className={`text-[13.5px] ${
          selected ? 'font-geist-semibold text-white' : 'font-geist-medium text-ink-2'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
