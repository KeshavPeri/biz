import { type ComponentType } from 'react';
import { View } from 'react-native';

import { PressableScale, type PressHaptic } from '@/components/motion/pressable-scale';

type Icon = ComponentType<{ width?: number; height?: number; color?: string }>;

export function IconButton({
  icon: Icon,
  label,
  onPress,
  disabled = false,
  color = '#5E574E',
  size = 44,
  haptic = 'selection',
}: {
  icon: Icon;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
  size?: number;
  haptic?: PressHaptic;
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic={haptic}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: size, height: size }}
      className={disabled ? 'opacity-30' : undefined}
    >
      <View className="h-full w-full items-center justify-center">
        <Icon width={20} height={20} color={color} />
      </View>
    </PressableScale>
  );
}
