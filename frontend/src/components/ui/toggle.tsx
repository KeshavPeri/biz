import { Pressable, View } from 'react-native';

/**
 * Toggle — the mockup's `.switch`: a 48×29 track (ink when on, warm-grey when
 * off) with a lifted knob. Rebuilt in RN from CSS; the knob position is set
 * directly (no animation lib) since it's a simple two-state control.
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
  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      className={`h-[29px] w-12 justify-center rounded-pill shadow-recessInset ${
        value ? 'bg-ink' : 'bg-cane-2'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      {/* Lifted knob — white with a soft drop shadow (mockup's glass knob). */}
      <View
        className="h-[23px] w-[23px] rounded-full bg-white shadow-liftIn"
        style={{ marginLeft: value ? 22 : 3 }}
      />
    </Pressable>
  );
}
